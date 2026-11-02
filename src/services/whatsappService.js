import { supabase } from "../supabase.js";

export const sendWhatsAppMessage = async (to, text) => {
  const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
  const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
  const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v18.0";

  if (!META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
    console.warn("SENDING WHATSAPP REPLY skipped: META_ACCESS_TOKEN or META_PHONE_NUMBER_ID unset");
    return;
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "text",
    text: { body: text },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`WhatsApp send failed: HTTP ${response.status} ${errorBody}`);
    }
  } catch (err) {
    console.error("WhatsApp send failed:", err);
  }
};

const INTENT_REPLIES = [
  {
    intent: "next_match",
    keywords: ["match", "when is my", "friday", "date drop", "who is my"],
    reply:
      "Your next Friday match drops every Friday at 8:00 AM WAT on the Minglee app — open the app and check the Date tab!",
    requiresHumanFollowup: false,
  },
  {
    intent: "safety",
    keywords: ["unsafe", "harass", "report", "block", "scam", "threat", "assault"],
    reply:
      "We take this seriously. A member of the Minglee safety team will reach out to you here shortly. If you're in immediate danger, please contact local authorities first.",
    requiresHumanFollowup: true,
  },
  {
    intent: "account",
    keywords: ["delete my account", "unsubscribe", "cancel", "remove me", "opt out"],
    reply:
      "To delete your account or data, open the Minglee app and go to Me > Delete My Data, or reply here and our team will process it for you within 48 hours.",
    requiresHumanFollowup: true,
  },
  {
    intent: "help",
    keywords: ["help", "support", "how does this work", "how do i", "question"],
    reply:
      "Hi! I'm the Minglee WhatsApp assistant. I can help with: your next match (ask \"when's my match\"), account/data requests, or safety concerns. For anything else, our team will follow up here.",
    requiresHumanFollowup: false,
  },
];

const matchIntent = (text) => {
  const normalized = text.toLowerCase();
  return INTENT_REPLIES.find(({ keywords }) =>
    keywords.some((keyword) => normalized.includes(keyword))
  );
};

// Every reply above that promises a human follow-up needs an actual record
// a human can act on — otherwise it's just a bot lying to the user. This is
// that record; admins review it at GET/POST /admin/whatsapp-inquiries.
async function flagForHumanFollowup(from, textBody) {
  const { error } = await supabase
    .from("whatsapp_inquiries")
    .insert({ whatsapp_number: from, message: textBody, status: "open" });

  if (error) {
    console.error(`Could not record WhatsApp inquiry from=${from}:`, error);
  }
}

export const processIncomingMessage = async (payload) => {
  const entries = payload.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];

    for (const change of changes) {
      const value = change.value || {};
      const messages = value.messages || [];

      for (const message of messages) {
        if (message.type === "text") {
          const from = message.from; // Sender's phone number
          const textBody = message.text.body;

          const matched = matchIntent(textBody);

          if (matched) {
            await sendWhatsAppMessage(from, matched.reply);
            if (matched.requiresHumanFollowup) {
              await flagForHumanFollowup(from, textBody);
            }
          } else {
            // Nothing in our keyword list matched — don't fake an answer.
            // Record it for a human to review, and tell the sender honestly
            // that a person (not the bot) will get back to them.
            await flagForHumanFollowup(from, textBody);
            await sendWhatsAppMessage(
              from,
              "Thanks for reaching out! A member of the Minglee team will reply to your message here shortly."
            );
          }
        }
      }
    }
  }
};
