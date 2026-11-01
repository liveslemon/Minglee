import { supabase } from "../supabase.js";
import { ApiError } from "../utils/apiError.js";
import { randomUUID } from "node:crypto";

function mapEvent(event) {
  return {
    id: event.id,
    event_name: event.event_name,
    event_description: event.event_description || event.description || "",
    ticket_type: event.ticket_type || "Regular",
    location: event.location || "Campus",
    status: event.status || "approved",
    event_picture: event.event_picture,
    event_day: event.event_day,
    ticket_price: Number(event.ticket_price ?? 0),
    created_at: event.created_at ?? null,
    is_boosted: Boolean(event.is_boosted),
    attendee_count: Number(event.attendee_count ?? 0),
    paid_attendees_count: Number(event.paid_attendees_count ?? 0),
    total_revenue: Number(event.total_revenue ?? 0),
    host_payout_amount: Number(event.host_payout_amount ?? 0),
  };
}

export async function createEvent(input) {
  const insertPayload = {
    event_name: input.event_name,
    event_description: input.event_description || "",
    ticket_type: input.ticket_type || "Regular",
    location: input.location || "Campus",
    event_picture: input.event_picture,
    event_day: input.event_day,
    ticket_price: input.ticket_price || 0,
    status: input.status || "pending",
  };

  try {
    const { data, error } = await supabase
      .from("events")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      // If new columns not yet in DB schema, fallback to core fields
      if (error.message && (error.message.includes("column") || error.code === "PGRST204")) {
        const fallbackPayload = {
          event_name: input.event_name,
          event_picture: input.event_picture,
          event_day: input.event_day,
          ticket_price: input.ticket_price || 0,
        };
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("events")
          .insert(fallbackPayload)
          .select("id,event_name,event_picture,event_day,ticket_price,created_at")
          .single();
        if (fallbackError) throw fallbackError;
        return mapEvent({ ...fallbackData, ...insertPayload, attendee_count: 0 });
      }
      throw error;
    }
    return mapEvent({ ...data, attendee_count: 0, paid_attendees_count: 0, total_revenue: 0, host_payout_amount: 0 });
  } catch (error) {
    throw new ApiError(400, "Unable to create event", {
      message: error.message,
      details: error.details,
    });
  }
}

export async function listEvents() {
  const { data: events, error } = await supabase
    .from("events")
    .select("*")
    .order("event_day", { ascending: true });

  if (error) {
    throw new ApiError(400, "Unable to fetch events", {
      message: error.message,
      details: error.details,
    });
  }

  const safeEvents = events ?? [];

  // Fetch all attendees count per event
  const { data: attendees, error: attendeeError } = await supabase
    .from("v_event_attendees")
    .select("event_id");

  if (attendeeError) {
    throw new ApiError(400, "Unable to fetch event attendees", {
      message: attendeeError.message,
      details: attendeeError.details,
    });
  }

  const attendeeCounts = new Map();
  for (const attendee of attendees ?? []) {
    const currentCount = attendeeCounts.get(attendee.event_id) ?? 0;
    attendeeCounts.set(attendee.event_id, currentCount + 1);
  }

  // Fetch successful payment financial records per event
  const { data: payments, error: paymentError } = await supabase
    .from("payments")
    .select("event_id, amount, status")
    .eq("payment_type", "event_ticket")
    .eq("status", "success");

  if (paymentError) {
    throw new ApiError(400, "Unable to fetch event payments", {
      message: paymentError.message,
      details: paymentError.details,
    });
  }

  const paidCounts = new Map();
  const revenueTotals = new Map();

  for (const payment of payments ?? []) {
    const count = paidCounts.get(payment.event_id) ?? 0;
    paidCounts.set(payment.event_id, count + 1);

    const sum = revenueTotals.get(payment.event_id) ?? 0;
    revenueTotals.set(payment.event_id, sum + Number(payment.amount || 0));
  }

  // Events with a live, approved ticket_boost ad are pinned to the top of
  // the listing as sponsored/promoted placements.
  const boostedEventIds = await getBoostedEventIds();

  const mapped = safeEvents.map((event) => {
    const totalRev = revenueTotals.get(event.id) ?? 0;
    return mapEvent({
      ...event,
      is_boosted: boostedEventIds.has(event.id),
      attendee_count: attendeeCounts.get(event.id) ?? 0,
      paid_attendees_count: paidCounts.get(event.id) ?? 0,
      total_revenue: totalRev,
      host_payout_amount: totalRev, // Total payout owed to event hosters
    });
  });

  // Boosted events first (most recently boosted first), then the rest in
  // their normal chronological order.
  return mapped.sort((a, b) => {
    if (a.is_boosted !== b.is_boosted) return a.is_boosted ? -1 : 1;
    return new Date(a.event_day).getTime() - new Date(b.event_day).getTime();
  });
}

async function getBoostedEventIds() {
  const now = new Date().toISOString();
  try {
    const { data: boosts, error } = await supabase
      .from("ads")
      .select("event_id")
      .eq("ad_type", "ticket_boost")
      .eq("status", "approved")
      .eq("is_active", true)
      .not("event_id", "is", null)
      .lte("start_date", now)
      .gte("end_date", now);

    if (error) {
      // ticket_boost/event_id support may not be migrated onto this DB yet;
      // treat as "no boosts" rather than failing the whole events list.
      return new Set();
    }
    return new Set((boosts ?? []).map((row) => row.event_id));
  } catch {
    return new Set();
  }
}

export async function registerForEvent({ eventId, userId }) {
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id,event_name,event_picture,event_day,ticket_price,created_at")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    throw new ApiError(400, "Unable to check event", {
      message: eventError.message,
      details: eventError.details,
    });
  }

  if (!event) {
    throw new ApiError(404, "Event not found");
  }

  if (Number(event.ticket_price) > 0) {
    throw new ApiError(400, "Paid events require ticket checkout");
  }

  const { data: existing, error: existingError } = await supabase
    .from("v_event_attendees")
    .select("event_id,user_id")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    throw new ApiError(400, "Unable to check registration", {
      message: existingError.message,
      details: existingError.details,
    });
  }

  if (existing) {
    throw new ApiError(409, "User already registered for this event");
  }

  const { data: ticket, error: insertError } = await supabase
    .from("tickets")
    .insert({
      event_id: eventId,
      user_id: userId,
      ticket_code: `RSVP-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
      status: "valid",
    })
    .select("id,event_id,user_id,ticket_code,status,issued_at")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      throw new ApiError(409, "User already registered for this event");
    }
    throw new ApiError(400, "Unable to register for event", {
      message: insertError.message,
      details: insertError.details,
    });
  }

  const { count, error: countError } = await supabase
    .from("v_event_attendees")
    .select("user_id", { count: "exact", head: true })
    .eq("event_id", eventId);

  if (countError) {
    throw new ApiError(400, "Unable to count event attendees", {
      message: countError.message,
      details: countError.details,
    });
  }

  return {
    event: mapEvent({ ...event, attendee_count: count ?? 0 }),
    registration: {
      event_id: eventId,
      user_id: userId,
      ticket_code: ticket.ticket_code,
    },
  };
}

