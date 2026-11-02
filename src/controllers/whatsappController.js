import crypto from "crypto";
import { processIncomingMessage } from "../services/whatsappService.js";

const verifySignature = (req) => {
  const skipSig = process.env.WHATSAPP_SKIP_SIGNATURE_VERIFY === "true" || process.env.WHATSAPP_SKIP_SIGNATURE_VERIFY === "1";
  if (skipSig) return true;

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.warn("META_APP_SECRET unset — webhook signature verification skipped.");
    return true;
  }

  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !signature.startsWith("sha256=")) return false;

  const payload = req.rawBody ? req.rawBody : JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature.substring(7)),
    Buffer.from(expectedSignature)
  );
};

export const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;

  if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    console.warn("WEBHOOK VERIFY FAILED");
    return res.status(403).send("Forbidden");
  }
};

export const receiveWebhook = async (req, res) => {
  if (!verifySignature(req)) {
    console.error("WEBHOOK POST signature FAILED");
    return res.status(403).send("Forbidden");
  }

  // Acknowledge immediately per Meta's requirement
  res.status(200).send("OK");

  try {
    const payload = req.body;

    if (payload.object !== "whatsapp_business_account") {
      return;
    }

    // Process in background
    processIncomingMessage(payload).catch(err => {
      console.error("Error processing whatsapp payload:", err);
    });
  } catch (err) {
    console.error("Error in webhook processing:", err);
  }
};
