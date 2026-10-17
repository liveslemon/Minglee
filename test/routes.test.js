import { setEnv } from "./helpers/env.js";
import { describe, test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { installFetchStub } from "./helpers/fetchStub.js";

const ADMIN_SECRET = "admin-secret-for-tests";
const PAYSTACK_KEY = "sk_test_routes";

// Must be set before paymentService.js (imported via src/app.js) is evaluated,
// so app modules are imported dynamically below.
setEnv({ ADMIN_SECRET, PAYSTACK_SECRET_KEY: PAYSTACK_KEY, NODE_ENV: "test" });

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/middleware/auth.js");
const jwt = (await import("jsonwebtoken")).default;

let server;
let base;
let stub;

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // Requests to our own server go out for real; anything else (Supabase,
  // gateways) is answered by the stub so nothing leaves the machine.
  stub = installFetchStub();
  stub.passthrough((req) => req.href.startsWith(base));
  stub.on(() => true, echoInserts);
});

// Default DB behaviour: inserts echo their rows back, everything else is empty.
function echoInserts(req) {
  if (req.method === "POST" && req.table) return (Array.isArray(req.body) ? req.body : [req.body]).map((r, i) => ({ id: `row-${i}`, ...r }));
  return [];
}

after(async () => {
  stub.restore();
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  stub.calls.length = 0;
});

const userToken = signAccessToken({ userId: "user-1", role: null });

async function call(method, path, { token, adminSecret, headers = {}, body, rawBody } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (adminSecret !== undefined) h["x-admin-secret"] = adminSecret;
  let payload;
  if (rawBody !== undefined) {
    payload = rawBody;
    h["content-type"] = "application/json";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

function supabaseCalls() {
  return stub.calls.length;
}

describe("JWT-protected routes reject anonymous requests", () => {
  const cases = [
    ["POST", "/payments/initialize", { event_id: "11111111-1111-4111-8111-111111111111", email: "a@b.co" }],
    ["GET", "/payments/verify/MGL-123"],
    ["GET", "/payments/tickets"],
    ["POST", "/events", { title: "x" }],
    ["POST", "/events/register", { event_id: "x" }],
    ["POST", "/ads", { title: "x" }],
    ["POST", "/ads/upload"],
    ["GET", "/matches/current"],
    ["POST", "/matches/11111111-1111-4111-8111-111111111111/feedback"],
    ["GET", "/notifications"],
    ["GET", "/notifications/popups"],
    ["POST", "/notifications/subscribe", {}],
    ["POST", "/reports", { reported_user_id: "x", reason: "spam" }],
    ["POST", "/users/123/block", {}],
  ];

  for (const [method, path, body] of cases) {
    test(`${method} ${path} -> 401 without JWT`, async () => {
      const res = await call(method, path, { body });
      assert.equal(res.status, 401);
      assert.equal(supabaseCalls(), 0, "must not touch the database");
    });
  }

  test("a token signed with the wrong secret is rejected", async () => {
    const forged = jwt.sign({ sub: "user-1" }, "not-the-secret");
    for (const path of ["/payments/tickets", "/matches/current"]) {
      const res = await call("GET", path, { token: forged });
      assert.equal(res.status, 401, path);
    }
  });

  test("an unsigned (alg=none) token is rejected", async () => {
    const none = jwt.sign({ sub: "user-1" }, null, { algorithm: "none" });
    const res = await call("GET", "/matches/current", { token: none });
    assert.equal(res.status, 401);
  });

  test("an expired token is rejected", async () => {
    const expired = jwt.sign({ sub: "user-1", exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
    const res = await call("GET", "/matches/current", { token: expired });
    assert.equal(res.status, 401);
  });

  test("a token without a sub is rejected", async () => {
    const noSub = jwt.sign({ role: "admin" }, process.env.JWT_SECRET);
    const res = await call("GET", "/matches/current", { token: noSub });
    assert.equal(res.status, 401);
  });

  test("control: a valid JWT gets past auth on GET /matches/current", async () => {
    const res = await call("GET", "/matches/current", { token: userToken });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { match: null });
  });

  test("control: a valid JWT gets past auth on GET /payments/tickets", async () => {
    const res = await call("GET", "/payments/tickets", { token: userToken });
    assert.equal(res.status, 200);
  });
});

describe("payments: client cannot set the amount or user", () => {
  test("POST /payments/initialize with a JWT reads the price from the event, not the body", async () => {
    stub.on({ table: "events", method: "GET" }, [
      { id: "11111111-1111-4111-8111-111111111111", ticket_price: 7000, status: "approved" },
    ]);
    stub.on({ table: "payments", method: "POST" }, (req) => [{ id: "p", ...req.body[0] }]);
    stub.on({ host: "api.paystack.co" }, { status: true, data: { authorization_url: "u", access_code: "c" } });
    try {
      const res = await call("POST", "/payments/initialize", {
        token: userToken,
        body: {
          event_id: "11111111-1111-4111-8111-111111111111",
          email: "a@b.co",
          amount: 1,
          user_id: "victim",
        },
      });
      assert.equal(res.status, 201);
      const [insert] = stub.callsTo({ table: "payments", method: "POST" });
      assert.equal(insert.body[0].amount, 7000);
      assert.equal(insert.body[0].user_id, "user-1");
    } finally {
      stub.reset();
      stub.on(() => true, echoInserts);
    }
  });
});

describe("Paystack webhook requires a valid signature", () => {
  const payload = JSON.stringify({ event: "transfer.success", data: { reference: "MGL-1" } });
  const sign = (key, body = payload) => crypto.createHmac("sha512", key).update(body).digest("hex");

  test("no signature -> 401", async () => {
    const res = await call("POST", "/payments/webhook", { rawBody: payload });
    assert.equal(res.status, 401);
  });

  test("wrong signature -> 401", async () => {
    const res = await call("POST", "/payments/webhook", {
      rawBody: payload,
      headers: { "x-paystack-signature": sign("sk_test_wrong") },
    });
    assert.equal(res.status, 401);
  });

  test("signature over a different body -> 401", async () => {
    const res = await call("POST", "/payments/webhook", {
      rawBody: payload.replace("MGL-1", "MGL-2"),
      headers: { "x-paystack-signature": sign(PAYSTACK_KEY) },
    });
    assert.equal(res.status, 401);
  });

  test("a JWT does not substitute for the signature", async () => {
    const res = await call("POST", "/payments/webhook", { rawBody: payload, token: userToken });
    assert.equal(res.status, 401);
  });

  test("control: valid signature over the raw body -> 200", async () => {
    const res = await call("POST", "/payments/webhook", {
      rawBody: payload,
      headers: { "x-paystack-signature": sign(PAYSTACK_KEY) },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { received: true, event: "transfer.success" });
  });
});

describe("admin-only notification routes", () => {
  const cases = [
    ["POST", "/notifications/trigger", { title: "x", message: "y" }],
    ["POST", "/notifications/popups", { title: "x", message: "y" }],
    ["POST", "/notifications", { title: "x", message: "y", user_id: "user-2" }],
  ];

  for (const [method, path, body] of cases) {
    test(`${method} ${path} -> 401 with a normal user JWT`, async () => {
      const res = await call(method, path, { token: userToken, body });
      assert.equal(res.status, 401);
      assert.equal(supabaseCalls(), 0);
    });

    test(`${method} ${path} -> 401 with a wrong admin secret`, async () => {
      const res = await call(method, path, { adminSecret: "nope", body });
      assert.equal(res.status, 401);
    });

    test(`control: ${method} ${path} passes auth with the admin secret`, async () => {
      const res = await call(method, path, { adminSecret: ADMIN_SECRET, body });
      assert.notEqual(res.status, 401);
      assert.notEqual(res.status, 503);
    });
  }
});

describe("admin routes", () => {
  const cases = [
    ["GET", "/admin/stats"],
    ["GET", "/admin/dashboard"],
    ["GET", "/admin/ads/pending"],
    ["POST", "/admin/ads/123/review", { status: "approved" }],
    ["GET", "/admin/tickets/pending"],
    ["POST", "/admin/tickets/123/review", { status: "approved" }],
    ["GET", "/admin/users/flagged"],
    ["POST", "/admin/users/123/flag", { flagged: true }],
    ["POST", "/admin/matching/run"],
    ["POST", "/admin/notifications/send", { title: "x", body: "y" }],
  ];

  for (const [method, path, body] of cases) {
    test(`${method} ${path} -> 401 with a wrong x-admin-secret`, async () => {
      const res = await call(method, path, { adminSecret: "wrong-secret", body });
      assert.equal(res.status, 401);
      assert.equal(supabaseCalls(), 0);
    });
  }

  test("missing x-admin-secret -> 401", async () => {
    const res = await call("GET", "/admin/stats");
    assert.equal(res.status, 401);
  });

  test("a user JWT is not an admin credential", async () => {
    const adminRoleToken = signAccessToken({ userId: "user-1", role: "admin" });
    const res = await call("GET", "/admin/stats", { token: adminRoleToken });
    assert.equal(res.status, 401);
  });

  test("a secret that is a prefix of the real one -> 401", async () => {
    const res = await call("GET", "/admin/stats", { adminSecret: ADMIN_SECRET.slice(0, -1) });
    assert.equal(res.status, 401);
  });

  test("when ADMIN_SECRET is unset, admin routes are closed (503), even with an empty header", async () => {
    const restore = setEnv({ ADMIN_SECRET: undefined });
    try {
      for (const adminSecret of [undefined, "", "anything"]) {
        const res = await call("GET", "/admin/stats", { adminSecret });
        assert.equal(res.status, 503);
      }
    } finally {
      restore();
    }
  });
});

test("public routes stay public (control)", async () => {
  assert.equal((await call("GET", "/health")).status, 200);
  assert.equal((await call("GET", "/events")).status, 200);
});
