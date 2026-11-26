import { db } from "@acme/db/db";
import { order, payment, ticket, tripSeat } from "@acme/db/db/schema";
import { env } from "@acme/server/env";
import { log } from "@acme/server/log";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import Stripe from "stripe";
import { publishSeats } from "../lib/seatEvents";

export const paymentRoute = new Hono();

// Stripe calls this; no login, the signature proves it's Stripe. Retries are safe.
paymentRoute.post("/stripe/webhook", async (c) => {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "Webhook not configured" }, 503);
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "Missing signature" }, 400);

  let event: Stripe.Event;
  try {
    // must be the raw body, not parsed JSON
    event = await Stripe.webhooks.constructEventAsync(
      await c.req.text(),
      signature,
      secret,
    );
  } catch {
    return c.json({ error: "Bad signature" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (event.data.object.payment_status === "paid")
        await fulfill(event.data.object);
      break;
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await db
        .update(payment)
        .set({ status: "failed" })
        .where(
          and(
            eq(payment.id, event.data.object.client_reference_id ?? ""),
            eq(payment.status, "pending"),
          ),
        );
      break;
  }
  return c.json({ received: true });
});

// paid → book seats + issue the ticket; if the seats are gone, flag a full refund
const fulfill = async (session: Stripe.Checkout.Session) => {
  const paymentId = session.client_reference_id;
  if (!paymentId) return;

  const result = await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(payment)
      .where(eq(payment.id, paymentId))
      .for("update");
    if (!p || p.status === "successful") return null; // unknown or already handled

    const [o] = await tx
      .select()
      .from(order)
      .where(eq(order.id, p.orderId))
      .for("update");
    const seats = await tx
      .select()
      .from(tripSeat)
      .where(eq(tripSeat.orderId, p.orderId))
      .for("update");

    await tx
      .update(payment)
      .set({ status: "successful", transactionId: session.id })
      .where(eq(payment.id, p.id));

    const charged = session.amount_total ?? 0;
    const ok =
      o!.status === "pending" &&
      seats.length === o!.passengers.length &&
      charged === p.amount &&
      session.currency === "bdt";

    if (ok) {
      await tx
        .update(order)
        .set({ status: "paid", paidAt: new Date() })
        .where(eq(order.id, o!.id));
      await tx
        .update(tripSeat)
        .set({ status: "booked", reservedUntil: null })
        .where(eq(tripSeat.orderId, o!.id));
      await tx.insert(ticket).values({
        orderId: o!.id,
        tripId: o!.tripId,
        userId: o!.userId,
        code: randomBytes(16).toString("base64url"),
      });
      return { tripId: o!.tripId, seats, booked: true };
    }

    // shortcut: an order already paid by another session is only logged; refund it by hand in Stripe
    if (o!.status === "paid") {
      log.error(
        { paymentId, orderId: o!.id },
        "[stripe] second payment for a paid order",
      );
      return null;
    }
    // released, expired or resold meanwhile: the money goes back via the admin refund job
    await tx
      .update(order)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        refundAmount: charged,
      })
      .where(eq(order.id, o!.id));
    await tx
      .update(tripSeat)
      .set({ status: "available", orderId: null, reservedUntil: null })
      .where(eq(tripSeat.orderId, o!.id));
    log.warn(
      { paymentId, orderId: o!.id },
      "[stripe] paid after hold was lost, refund flagged",
    );
    return { tripId: o!.tripId, seats, booked: false };
  });

  if (result)
    void publishSeats(
      result.tripId,
      result.seats.map((s) => ({
        coachCode: s.coachCode,
        seatNumber: s.seatNumber,
        seatType: s.seatType,
        status: result.booked ? "booked" : "available",
        until: null,
      })),
    );
};
