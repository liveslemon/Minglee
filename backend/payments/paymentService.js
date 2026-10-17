import crypto from "crypto";
import { supabase } from "../../src/supabase.js";
import { ApiError } from "../../src/utils/apiError.js";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;

// Mock mode lets local dev run the full flow without a gateway. It can never be
// enabled in production, and it must be opted into explicitly.
const MOCK_MODE =
  process.env.PAYMENTS_MOCK_MODE === "true" && process.env.NODE_ENV !== "production";

function requireGatewayKey(gateway) {
  const key = gateway === "flutterwave" ? FLUTTERWAVE_SECRET_KEY : PAYSTACK_SECRET_KEY;
  if (!key) throw new ApiError(503, `Payments via ${gateway} are not configured on this server`);
  return key;
}

function generateReference() {
  return `MGL-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function generateTicketCode() {
  return `TKT-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
}

export const paymentService = {
  // Initialize Payment with Paystack or Flutterwave.
  // The amount is always taken from the event record, never from the client.
  async initializePayment({ userId, event_id, email, gateway = "paystack", callback_url }) {
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id,ticket_price,status")
      .eq("id", event_id)
      .maybeSingle();

    if (eventErr) throw eventErr;
    if (!event) throw new ApiError(404, "Event not found");
    if (event.status && event.status !== "approved") {
      throw new ApiError(400, "Tickets are not on sale for this event");
    }

    const amount = Number(event.ticket_price ?? 0);
    if (!(amount > 0)) {
      throw new ApiError(400, "This event is free; register via /events/register instead");
    }

    const currency = "NGN";
    const secretKey = MOCK_MODE ? null : requireGatewayKey(gateway);
    const reference = generateReference();

    // 1. Create pending payment record in Supabase
    const { data: paymentRecord, error: dbErr } = await supabase
      .from("payments")
      .insert([{
        reference,
        user_id: userId,
        payment_type: "event_ticket",
        event_id,
        amount,
        currency,
        gateway,
        status: "pending"
      }])
      .select()
      .single();

    if (dbErr) throw dbErr;

    if (MOCK_MODE) {
      return {
        payment: paymentRecord,
        authorization_url: `https://checkout.example.invalid/mock-${reference}`,
        reference,
        note: "PAYMENTS_MOCK_MODE is on: no real gateway was called"
      };
    }

    // 2. Call gateway API based on selected gateway
    if (gateway === "flutterwave") {
      const response = await fetch("https://api.flutterwave.com/v3/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          tx_ref: reference,
          amount,
          currency,
          redirect_url: callback_url,
          customer: { email },
          meta: { user_id: userId, event_id },
          customizations: { title: "Minglee Event Ticket" }
        })
      });

      const resData = await response.json().catch(() => null);
      if (resData?.status === "success") {
        return { payment: paymentRecord, authorization_url: resData.data.link, reference };
      }
      throw new ApiError(502, "Unable to start payment with Flutterwave");
    }

    // Default: Paystack API
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100), // convert to kobo
        reference,
        currency,
        callback_url,
        metadata: { user_id: userId, event_id }
      })
    });

    const resData = await response.json().catch(() => null);
    if (resData?.status) {
      return {
        payment: paymentRecord,
        authorization_url: resData.data.authorization_url,
        access_code: resData.data.access_code,
        reference
      };
    }
    throw new ApiError(502, "Unable to start payment with Paystack");
  },

  // Ask the gateway whether the payment really succeeded for the expected amount.
  async _confirmWithGateway(payment) {
    if (MOCK_MODE) {
      return { status: "success", gateway_response: "Mock verification (PAYMENTS_MOCK_MODE)" };
    }

    const secretKey = requireGatewayKey(payment.gateway);
    const reference = payment.reference;

    if (payment.gateway === "flutterwave") {
      const res = await fetch(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const resData = await res.json().catch(() => null);
      const data = resData?.data;
      const ok =
        resData?.status === "success" &&
        data?.status === "successful" &&
        data?.tx_ref === reference &&
        data?.currency === payment.currency &&
        Number(data?.amount) >= Number(payment.amount);
      return ok ? data : null;
    }

    const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` }
    });
    const resData = await res.json().catch(() => null);
    const data = resData?.data;
    const ok =
      resData?.status === true &&
      data?.status === "success" &&
      data?.reference === reference &&
      data?.currency === payment.currency &&
      Number(data?.amount) >= Math.round(Number(payment.amount) * 100);
    return ok ? data : null;
  },

  // Verify payment status with gateway and issue ticket.
  // When userId is given, the payment must belong to that user (webhooks pass none).
  async verifyPayment(reference, { userId } = {}) {
    const { data: payment, error } = await supabase
      .from("payments")
      .select("*")
      .eq("reference", reference)
      .maybeSingle();

    if (error || !payment) throw new ApiError(404, "Payment record not found");
    if (userId && payment.user_id !== userId) throw new ApiError(404, "Payment record not found");
    if (payment.payment_type !== "event_ticket") {
      throw new ApiError(400, "Payment is not for an event ticket");
    }

    if (payment.status === "success") {
      const { data: ticket } = await supabase
        .from("tickets")
        .select("*")
        .eq("payment_id", payment.id)
        .maybeSingle();
      return { payment, ticket, message: "Payment already verified" };
    }

    let gatewayData = null;
    try {
      gatewayData = await this._confirmWithGateway(payment);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // Network trouble: leave the payment pending so it can be re-verified later.
      throw new ApiError(502, "Could not reach payment gateway; please retry verification");
    }

    if (!gatewayData) {
      await supabase
        .from("payments")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", payment.id);
      throw new ApiError(402, "Payment verification failed at gateway");
    }

    // Update payment record to success
    const { data: updatedPayment, error: updateErr } = await supabase
      .from("payments")
      .update({
        status: "success",
        gateway_response: gatewayData,
        updated_at: new Date().toISOString()
      })
      .eq("id", payment.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Issue / Link ticket purchase
    const ticket = await this.issueTicket(updatedPayment);

    return { payment: updatedPayment, ticket };
  },

  // Verify Webhook Signature (Paystack HMAC SHA512)
  verifyWebhookSignature(rawBody, signatureHeader) {
    if (!signatureHeader || !PAYSTACK_SECRET_KEY || !rawBody) return false;
    const expected = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signatureHeader));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  // Handle Paystack Webhook Event
  async handleWebhook(eventPayload) {
    const { event, data } = eventPayload || {};
    if (event === "charge.success" && data?.reference) {
      // Re-confirms with the gateway rather than trusting the webhook body.
      return await this.verifyPayment(data.reference);
    }
    return { received: true, event };
  },

  // Helper method to issue ticket upon successful payment
  async issueTicket(payment) {
    // Check if ticket already created
    const { data: existingTicket } = await supabase
      .from("tickets")
      .select("*")
      .eq("payment_id", payment.id)
      .maybeSingle();

    if (existingTicket) return existingTicket;

    const { data: ticket, error } = await supabase
      .from("tickets")
      .insert([{
        payment_id: payment.id,
        user_id: payment.user_id,
        event_id: payment.event_id,
        ticket_code: generateTicketCode(),
        status: "valid"
      }])
      .select()
      .single();

    if (error) throw error;

    return ticket;
  },

  async getUserTickets(userId) {
    const { data: tickets, error } = await supabase
      .from("tickets")
      .select("*, payments(*)")
      .eq("user_id", userId)
      .order("issued_at", { ascending: false });

    if (error) throw error;
    return tickets;
  }
};
