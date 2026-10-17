import "./helpers/env.js";
import { describe, test, beforeEach, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { installFetchStub, pgError } from "./helpers/fetchStub.js";
import { loadPaymentService } from "./helpers/payments.js";
import { SUPABASE_HOST } from "./helpers/env.js";
import { ApiError } from "../src/utils/apiError.js";

const PAYSTACK_KEY = "sk_test_unit_paystack";
const FLW_KEY = "FLWSECK_TEST_unit";
const PAYSTACK = "api.paystack.co";
const FLUTTERWAVE = "api.flutterwave.com";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user-1";

function approvedEvent(overrides = {}) {
  return { id: EVENT_ID, ticket_price: 5000, status: "approved", ...overrides };
}

function pendingPayment(overrides = {}) {
  return {
    id: "pay-1",
    reference: "MGL-1700000000000-abcdef",
    user_id: USER_ID,
    payment_type: "event_ticket",
    event_id: EVENT_ID,
    amount: 5000,
    currency: "NGN",
    gateway: "paystack",
    status: "pending",
    ...overrides,
  };
}

// Assert the promise rejects with an ApiError carrying this status code.
async function rejectsWithStatus(promise, statusCode, messagePattern) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.statusCode, statusCode, `status (message: ${err.message})`);
    if (messagePattern) assert.match(err.message, messagePattern);
    return true;
  });
}

let stub;
beforeEach(() => {
  stub = installFetchStub();
});
afterEach(() => {
  stub.restore();
});

// Echo inserted payment rows back, as PostgREST does with return=representation.
function stubPaymentInsert() {
  stub.on({ table: "payments", method: "POST" }, (req) => {
    const rows = Array.isArray(req.body) ? req.body : [req.body];
    return rows.map((row, i) => ({ id: `pay-new-${i}`, ...row }));
  });
}

function gatewayCalls() {
  return stub.calls.filter((c) => c.host === PAYSTACK || c.host === FLUTTERWAVE);
}

describe("initializePayment (gateway keys configured)", () => {
  let paymentService;
  before(async () => {
    paymentService = await loadPaymentService({
      PAYSTACK_SECRET_KEY: PAYSTACK_KEY,
      FLUTTERWAVE_SECRET_KEY: FLW_KEY,
    });
  });

  test("charges the event's ticket_price from the DB, ignoring any client amount (Paystack)", async () => {
    stub.on({ table: "events", method: "GET" }, [approvedEvent({ ticket_price: 5000 })]);
    stubPaymentInsert();
    stub.on({ host: PAYSTACK, pathIncludes: "/transaction/initialize" }, {
      status: true,
      data: { authorization_url: "https://checkout.paystack.com/abc", access_code: "ac_1" },
    });

    const result = await paymentService.initializePayment({
      userId: USER_ID,
      event_id: EVENT_ID,
      email: "a@b.co",
      amount: 1, // a tampered client amount must be ignored
      currency: "USD",
      user_id: "someone-else",
    });

    const [insert] = stub.callsTo({ table: "payments", method: "POST" });
    const row = insert.body[0];
    assert.equal(row.amount, 5000);
    assert.equal(row.currency, "NGN");
    assert.equal(row.user_id, USER_ID);
    assert.equal(row.status, "pending");
    assert.equal(row.payment_type, "event_ticket");
    assert.match(row.reference, /^MGL-\d+-[0-9a-f]{12}$/);

    const [init] = stub.callsTo({ host: PAYSTACK });
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("authorization"), `Bearer ${PAYSTACK_KEY}`);
    assert.equal(init.body.amount, 500000, "kobo = ticket_price * 100");
    assert.equal(init.body.currency, "NGN");
    assert.equal(init.body.reference, row.reference);
    assert.equal(init.body.metadata.user_id, USER_ID);

    assert.equal(result.authorization_url, "https://checkout.paystack.com/abc");
    assert.equal(result.access_code, "ac_1");
    assert.equal(result.reference, row.reference);
    assert.deepEqual(stub.unexpected, []);
  });

  test("Flutterwave initialization also uses the DB price", async () => {
    stub.on({ table: "events", method: "GET" }, [approvedEvent({ ticket_price: 2500 })]);
    stubPaymentInsert();
    stub.on({ host: FLUTTERWAVE }, { status: "success", data: { link: "https://flw.example/pay" } });

    const result = await paymentService.initializePayment({
      userId: USER_ID,
      event_id: EVENT_ID,
      email: "a@b.co",
      gateway: "flutterwave",
      amount: 1,
    });

    const [call] = stub.callsTo({ host: FLUTTERWAVE });
    assert.equal(call.body.amount, 2500);
    assert.equal(call.headers.get("authorization"), `Bearer ${FLW_KEY}`);
    assert.equal(stub.callsTo({ table: "payments", method: "POST" })[0].body[0].amount, 2500);
    assert.equal(result.authorization_url, "https://flw.example/pay");
  });

  test("queries the event by id", async () => {
    stub.on({ table: "events", method: "GET" }, [approvedEvent()]);
    stubPaymentInsert();
    stub.on({ host: PAYSTACK }, { status: true, data: { authorization_url: "u", access_code: "c" } });
    await paymentService.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co" });
    const [eventQuery] = stub.callsTo({ table: "events" });
    assert.equal(eventQuery.url.searchParams.get("id"), `eq.${EVENT_ID}`);
  });

  test("rejects free events (ticket_price 0 / null) without creating a payment", async () => {
    for (const ticket_price of [0, null]) {
      stub.reset();
      stub.on({ table: "events", method: "GET" }, [approvedEvent({ ticket_price })]);
      await rejectsWithStatus(
        paymentService.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co", amount: 100 }),
        400,
        /free/
      );
      assert.equal(stub.callsTo({ table: "payments" }).length, 0);
      assert.equal(gatewayCalls().length, 0);
    }
  });

  test("rejects events that are not approved", async () => {
    for (const status of ["pending", "rejected"]) {
      stub.reset();
      stub.on({ table: "events", method: "GET" }, [approvedEvent({ status })]);
      await rejectsWithStatus(
        paymentService.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co" }),
        400,
        /not on sale/
      );
      assert.equal(stub.callsTo({ table: "payments" }).length, 0);
    }
  });

  test("missing event -> 404", async () => {
    stub.on({ table: "events", method: "GET" }, []);
    await rejectsWithStatus(
      paymentService.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co" }),
      404
    );
    assert.equal(stub.callsTo({ table: "payments" }).length, 0);
  });

  test("gateway refusing to initialize -> 502 (no fake checkout URL)", async () => {
    stub.on({ table: "events", method: "GET" }, [approvedEvent()]);
    stubPaymentInsert();
    stub.on({ host: PAYSTACK }, { status: false, message: "Invalid key" });
    await rejectsWithStatus(
      paymentService.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co" }),
      502
    );
  });
});

describe("initializePayment (no gateway keys)", () => {
  let paymentService;
  before(async () => {
    paymentService = await loadPaymentService({});
  });

  for (const gateway of ["paystack", "flutterwave"]) {
    test(`${gateway} without a secret key -> 503 and no payment row`, async () => {
      stub.on({ table: "events", method: "GET" }, [approvedEvent()]);
      await rejectsWithStatus(
        paymentService.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co", gateway }),
        503
      );
      assert.equal(stub.callsTo({ table: "payments" }).length, 0);
      assert.equal(gatewayCalls().length, 0);
    });
  }

  test("only Paystack configured: Flutterwave still 503", async () => {
    const svc = await loadPaymentService({ PAYSTACK_SECRET_KEY: PAYSTACK_KEY });
    stub.on({ table: "events", method: "GET" }, [approvedEvent()]);
    await rejectsWithStatus(
      svc.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co", gateway: "flutterwave" }),
      503
    );
  });
});

describe("verifyPayment (fails closed)", () => {
  let paymentService;
  before(async () => {
    paymentService = await loadPaymentService({
      PAYSTACK_SECRET_KEY: PAYSTACK_KEY,
      FLUTTERWAVE_SECRET_KEY: FLW_KEY,
    });
  });

  // DB: one payment row; PATCH echoes the update; tickets: none yet, insert echoes.
  function stubDb(payment) {
    stub.on({ table: "payments", method: "GET" }, payment ? [payment] : []);
    stub.on({ table: "payments", method: "PATCH" }, (req) => [{ ...payment, ...req.body }]);
    stub.on({ table: "tickets", method: "GET" }, []);
    stub.on({ table: "tickets", method: "POST" }, (req) => [{ id: "tkt-1", ...req.body[0] }]);
  }

  function paystackSays(data, status = true) {
    stub.on({ host: PAYSTACK, pathIncludes: "/transaction/verify/" }, { status, data });
  }

  function paystackSuccess(payment, overrides = {}) {
    return {
      status: "success",
      reference: payment.reference,
      currency: "NGN",
      amount: Math.round(payment.amount * 100),
      ...overrides,
    };
  }

  function paymentPatches() {
    return stub.callsTo({ table: "payments", method: "PATCH" });
  }

  test("gateway confirms success -> payment marked success and a ticket is issued", async () => {
    const payment = pendingPayment();
    stubDb(payment);
    paystackSays(paystackSuccess(payment));

    const result = await paymentService.verifyPayment(payment.reference, { userId: USER_ID });

    const [verifyCall] = stub.callsTo({ host: PAYSTACK });
    assert.equal(verifyCall.path, `/transaction/verify/${payment.reference}`);
    assert.equal(verifyCall.headers.get("authorization"), `Bearer ${PAYSTACK_KEY}`);

    const patches = paymentPatches();
    assert.equal(patches.length, 1);
    assert.equal(patches[0].body.status, "success");
    assert.equal(patches[0].url.searchParams.get("id"), `eq.${payment.id}`);

    const [ticketInsert] = stub.callsTo({ table: "tickets", method: "POST" });
    assert.equal(ticketInsert.body[0].payment_id, payment.id);
    assert.equal(ticketInsert.body[0].user_id, USER_ID);
    assert.equal(ticketInsert.body[0].event_id, EVENT_ID);
    assert.match(ticketInsert.body[0].ticket_code, /^TKT-[0-9A-F]{16}$/);

    assert.equal(result.payment.status, "success");
    assert.equal(result.ticket.id, "tkt-1");
    assert.deepEqual(stub.unexpected, []);
  });

  test("gateway says the charge failed -> 402 and payment marked failed, no ticket", async () => {
    const payment = pendingPayment();
    stubDb(payment);
    paystackSays(paystackSuccess(payment, { status: "failed" }));

    await rejectsWithStatus(paymentService.verifyPayment(payment.reference, { userId: USER_ID }), 402);

    const patches = paymentPatches();
    assert.equal(patches.length, 1);
    assert.equal(patches[0].body.status, "failed");
    assert.equal(stub.callsTo({ table: "tickets", method: "POST" }).length, 0);
  });

  test("gateway envelope status false -> 402", async () => {
    const payment = pendingPayment();
    stubDb(payment);
    paystackSays(paystackSuccess(payment), false);
    await rejectsWithStatus(paymentService.verifyPayment(payment.reference), 402);
    assert.equal(paymentPatches()[0].body.status, "failed");
  });

  test("gateway amount lower than the payment amount -> rejected", async () => {
    const payment = pendingPayment({ amount: 5000 });
    stubDb(payment);
    paystackSays(paystackSuccess(payment, { amount: 499999 }));

    await rejectsWithStatus(paymentService.verifyPayment(payment.reference, { userId: USER_ID }), 402);
    assert.equal(paymentPatches()[0].body.status, "failed");
    assert.equal(stub.callsTo({ table: "tickets", method: "POST" }).length, 0);
  });

  test("gateway amount reported in naira instead of kobo (100x too low) -> rejected", async () => {
    const payment = pendingPayment({ amount: 5000 });
    stubDb(payment);
    paystackSays(paystackSuccess(payment, { amount: 5000 }));
    await rejectsWithStatus(paymentService.verifyPayment(payment.reference), 402);
  });

  test("currency mismatch -> rejected", async () => {
    const payment = pendingPayment();
    stubDb(payment);
    paystackSays(paystackSuccess(payment, { currency: "USD" }));
    await rejectsWithStatus(paymentService.verifyPayment(payment.reference, { userId: USER_ID }), 402);
    assert.equal(paymentPatches()[0].body.status, "failed");
  });

  test("reference mismatch -> rejected", async () => {
    const payment = pendingPayment();
    stubDb(payment);
    paystackSays(paystackSuccess(payment, { reference: "MGL-someone-elses-charge" }));
    await rejectsWithStatus(paymentService.verifyPayment(payment.reference, { userId: USER_ID }), 402);
    assert.equal(paymentPatches()[0].body.status, "failed");
  });

  test("unparseable gateway response -> rejected", async () => {
    const payment = pendingPayment();
    stubDb(payment);
    stub.on({ host: PAYSTACK }, () => new Response("<html>bad gateway</html>", { status: 200 }));
    await rejectsWithStatus(paymentService.verifyPayment(payment.reference), 402);
  });

  test("network error -> 502 and payment left pending (no DB update)", async () => {
    const payment = pendingPayment();
    stubDb(payment);
    stub.on({ host: PAYSTACK }, () => {
      throw new TypeError("fetch failed");
    });

    await rejectsWithStatus(paymentService.verifyPayment(payment.reference, { userId: USER_ID }), 502);
    assert.equal(paymentPatches().length, 0, "payment must not be marked failed or success");
    assert.equal(stub.callsTo({ table: "tickets" }).length, 0);
  });

  test("payment owned by another user -> 404 without calling the gateway", async () => {
    const payment = pendingPayment({ user_id: "someone-else" });
    stubDb(payment);
    paystackSays(paystackSuccess(payment));

    await rejectsWithStatus(paymentService.verifyPayment(payment.reference, { userId: USER_ID }), 404);
    assert.equal(gatewayCalls().length, 0);
    assert.equal(paymentPatches().length, 0);
  });

  test("unknown reference -> 404", async () => {
    stubDb(null);
    await rejectsWithStatus(paymentService.verifyPayment("MGL-nope", { userId: USER_ID }), 404);
    assert.equal(gatewayCalls().length, 0);
  });

  test("non-ticket payment -> 400", async () => {
    const payment = pendingPayment({ payment_type: "ad" });
    stubDb(payment);
    await rejectsWithStatus(paymentService.verifyPayment(payment.reference), 400);
    assert.equal(gatewayCalls().length, 0);
  });

  test("already-successful payment returns the existing ticket without calling the gateway", async () => {
    const payment = pendingPayment({ status: "success" });
    const ticket = { id: "tkt-existing", payment_id: payment.id, ticket_code: "TKT-OLD" };
    stub.on({ table: "payments", method: "GET" }, [payment]);
    stub.on({ table: "tickets", method: "GET" }, [ticket]);

    const result = await paymentService.verifyPayment(payment.reference, { userId: USER_ID });

    assert.deepEqual(result.ticket, ticket);
    assert.equal(result.message, "Payment already verified");
    assert.equal(gatewayCalls().length, 0);
    assert.equal(paymentPatches().length, 0);
    assert.equal(stub.callsTo({ table: "tickets", method: "POST" }).length, 0);
  });

  test("an existing ticket is reused rather than duplicated", async () => {
    const payment = pendingPayment();
    stubDb(payment);
    stub.on({ table: "tickets", method: "GET" }, [{ id: "tkt-already" }]);
    paystackSays(paystackSuccess(payment));
    const result = await paymentService.verifyPayment(payment.reference);
    assert.equal(result.ticket.id, "tkt-already");
    assert.equal(stub.callsTo({ table: "tickets", method: "POST" }).length, 0);
  });

  describe("Flutterwave", () => {
    function flwPayment() {
      return pendingPayment({ gateway: "flutterwave", amount: 2500 });
    }
    function flwSays(data, status = "success") {
      stub.on({ host: FLUTTERWAVE }, { status, data });
    }
    function flwSuccess(payment, overrides = {}) {
      return { status: "successful", tx_ref: payment.reference, currency: "NGN", amount: 2500, ...overrides };
    }

    test("success", async () => {
      const payment = flwPayment();
      stubDb(payment);
      flwSays(flwSuccess(payment));
      const result = await paymentService.verifyPayment(payment.reference, { userId: USER_ID });
      const [call] = stub.callsTo({ host: FLUTTERWAVE });
      assert.equal(call.url.searchParams.get("tx_ref"), payment.reference);
      assert.equal(result.payment.status, "success");
      assert.equal(gatewayCalls().filter((c) => c.host === PAYSTACK).length, 0);
    });

    for (const [name, overrides] of [
      ["lower amount", { amount: 2499 }],
      ["currency mismatch", { currency: "USD" }],
      ["reference mismatch", { tx_ref: "MGL-other" }],
      ["failed status", { status: "failed" }],
    ]) {
      test(`${name} -> rejected`, async () => {
        const payment = flwPayment();
        stubDb(payment);
        flwSays(flwSuccess(payment, overrides));
        await rejectsWithStatus(paymentService.verifyPayment(payment.reference), 402);
        assert.equal(paymentPatches()[0].body.status, "failed");
      });
    }
  });

  test("handleWebhook re-verifies with the gateway instead of trusting the webhook body", async () => {
    const payment = pendingPayment();
    stubDb(payment);
    paystackSays(paystackSuccess(payment, { status: "failed" }));

    await rejectsWithStatus(
      paymentService.handleWebhook({
        event: "charge.success",
        data: { reference: payment.reference, status: "success", amount: 500000, currency: "NGN" },
      }),
      402
    );
    assert.equal(stub.callsTo({ host: PAYSTACK }).length, 1);
  });

  test("handleWebhook ignores other events", async () => {
    const result = await paymentService.handleWebhook({ event: "transfer.success", data: {} });
    assert.deepEqual(result, { received: true, event: "transfer.success" });
    assert.equal(stub.calls.length, 0);
  });

  test("a DB error while loading the payment surfaces as 404, not success", async () => {
    stub.on({ table: "payments", method: "GET" }, pgError("boom", { status: 400 }));
    await rejectsWithStatus(paymentService.verifyPayment("MGL-x"), 404);
    assert.equal(gatewayCalls().length, 0);
  });
});

describe("verifyPayment without gateway keys", () => {
  test("pending payment -> 503, left pending", async () => {
    const svc = await loadPaymentService({});
    const payment = pendingPayment();
    stub.on({ table: "payments", method: "GET" }, [payment]);
    await rejectsWithStatus(svc.verifyPayment(payment.reference), 503);
    assert.equal(stub.callsTo({ table: "payments", method: "PATCH" }).length, 0);
    assert.equal(gatewayCalls().length, 0);
  });
});

describe("verifyWebhookSignature", () => {
  const body = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "MGL-1" } }));
  const sign = (key, buf = body) => crypto.createHmac("sha512", key).update(buf).digest("hex");

  let paymentService;
  before(async () => {
    paymentService = await loadPaymentService({ PAYSTACK_SECRET_KEY: PAYSTACK_KEY });
  });

  test("accepts a correct HMAC-SHA512 of the raw body", () => {
    assert.equal(paymentService.verifyWebhookSignature(body, sign(PAYSTACK_KEY)), true);
  });

  test("rejects a signature made with the wrong key", () => {
    assert.equal(paymentService.verifyWebhookSignature(body, sign("sk_test_wrong")), false);
  });

  test("rejects a signature for a different body", () => {
    const tampered = Buffer.from(body.toString().replace("MGL-1", "MGL-2"));
    assert.equal(paymentService.verifyWebhookSignature(tampered, sign(PAYSTACK_KEY)), false);
  });

  test("rejects malformed / truncated / uppercased signatures", () => {
    const good = sign(PAYSTACK_KEY);
    assert.equal(paymentService.verifyWebhookSignature(body, good.slice(0, -2)), false);
    assert.equal(paymentService.verifyWebhookSignature(body, good.toUpperCase()), false);
    assert.equal(paymentService.verifyWebhookSignature(body, "not-a-signature"), false);
  });

  test("rejects missing signature or missing raw body", () => {
    assert.equal(paymentService.verifyWebhookSignature(body, undefined), false);
    assert.equal(paymentService.verifyWebhookSignature(body, ""), false);
    assert.equal(paymentService.verifyWebhookSignature(undefined, sign(PAYSTACK_KEY)), false);
  });

  test("rejects everything when no secret is configured", async () => {
    const unconfigured = await loadPaymentService({});
    // Common forgeries when the key is missing: HMAC with "undefined" or "".
    assert.equal(unconfigured.verifyWebhookSignature(body, sign("undefined")), false);
    assert.equal(unconfigured.verifyWebhookSignature(body, sign("")), false);
    assert.equal(unconfigured.verifyWebhookSignature(body, sign(PAYSTACK_KEY)), false);
  });
});

describe("PAYMENTS_MOCK_MODE", () => {
  test("is honoured outside production: no gateway call, verification succeeds", async () => {
    const svc = await loadPaymentService({ PAYMENTS_MOCK_MODE: "true", NODE_ENV: "development" });
    stub.on({ table: "events", method: "GET" }, [approvedEvent()]);
    stubPaymentInsert();

    const init = await svc.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co" });
    assert.match(init.authorization_url, /mock-/);
    assert.equal(gatewayCalls().length, 0);

    const payment = pendingPayment();
    stub.on({ table: "payments", method: "GET" }, [payment]);
    stub.on({ table: "payments", method: "PATCH" }, (req) => [{ ...payment, ...req.body }]);
    stub.on({ table: "tickets", method: "GET" }, []);
    stub.on({ table: "tickets", method: "POST" }, (req) => [{ id: "tkt-mock", ...req.body[0] }]);
    const verified = await svc.verifyPayment(payment.reference, { userId: USER_ID });
    assert.equal(verified.payment.status, "success");
    assert.equal(gatewayCalls().length, 0);
  });

  test("must be exactly 'true'", async () => {
    const svc = await loadPaymentService({ PAYMENTS_MOCK_MODE: "1", NODE_ENV: "development" });
    stub.on({ table: "events", method: "GET" }, [approvedEvent()]);
    await rejectsWithStatus(
      svc.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co" }),
      503
    );
  });

  test("is ignored when NODE_ENV=production (no keys -> 503 on initialize and verify)", async () => {
    const svc = await loadPaymentService({ PAYMENTS_MOCK_MODE: "true", NODE_ENV: "production" });

    stub.on({ table: "events", method: "GET" }, [approvedEvent()]);
    stubPaymentInsert();
    await rejectsWithStatus(
      svc.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co" }),
      503
    );
    assert.equal(stub.callsTo({ table: "payments", method: "POST" }).length, 0);

    const payment = pendingPayment();
    stub.on({ table: "payments", method: "GET" }, [payment]);
    await rejectsWithStatus(svc.verifyPayment(payment.reference, { userId: USER_ID }), 503);
    assert.equal(stub.callsTo({ table: "payments", method: "PATCH" }).length, 0);
  });

  test("is ignored when NODE_ENV=production (keys set -> real gateway is consulted and can fail)", async () => {
    const svc = await loadPaymentService({
      PAYMENTS_MOCK_MODE: "true",
      NODE_ENV: "production",
      PAYSTACK_SECRET_KEY: PAYSTACK_KEY,
    });
    const payment = pendingPayment();
    stub.on({ table: "payments", method: "GET" }, [payment]);
    stub.on({ table: "payments", method: "PATCH" }, (req) => [{ ...payment, ...req.body }]);
    stub.on({ host: PAYSTACK }, { status: true, data: { status: "abandoned", reference: payment.reference } });

    await rejectsWithStatus(svc.verifyPayment(payment.reference, { userId: USER_ID }), 402);
    assert.equal(stub.callsTo({ host: PAYSTACK }).length, 1);
  });
});

test("sanity: Supabase requests go to the test SUPABASE_URL", async () => {
  const svc = await loadPaymentService({ PAYSTACK_SECRET_KEY: PAYSTACK_KEY });
  stub.on({ table: "events", method: "GET" }, []);
  await assert.rejects(svc.initializePayment({ userId: USER_ID, event_id: EVENT_ID, email: "a@b.co" }));
  assert.equal(stub.calls[0].host, SUPABASE_HOST);
});
