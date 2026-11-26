import type { AppEnv } from "@acme/auth/types";
import { db } from "@acme/db/db";
import { order, payment, train, trip, user } from "@acme/db/db/schema";
import { log } from "@acme/server/log";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { stripe } from "../../lib/stripe";

export const refundRoute = new Hono<AppEnv>();

// Refunds are owed when an order is cancelled with refundAmount > 0 (user cancel, trip cancel,
// or a payment that landed after the hold was lost). Paid out here, then the order is "refunded".
refundRoute.get("/refunds", async (c) => {
  const rows = await db
    .select({
      orderId: order.id,
      status: order.status,
      refundAmount: order.refundAmount,
      totalAmount: order.totalAmount,
      cancelledAt: order.cancelledAt,
      customerName: user.name,
      customerEmail: user.email,
      trainName: train.name,
      trainNumber: train.number,
      journeyDate: trip.journeyDate,
      departureTime: trip.departureTime,
    })
    .from(order)
    .innerJoin(user, eq(user.id, order.userId))
    .innerJoin(trip, eq(trip.id, order.tripId))
    .innerJoin(train, eq(train.id, trip.trainId))
    .where(and(inArray(order.status, ["cancelled", "refunded"]), gt(order.refundAmount, 0)))
    .orderBy(desc(order.cancelledAt))
    // shortcut: latest 200 only; add paging when the queue grows past that
    .limit(200);
  return c.json({ data: rows });
});

refundRoute.post(
  "/refunds/:orderId",
  zValidator("param", z.object({ orderId: z.uuid() })),
  async (c) => {
    const { orderId } = c.req.valid("param");
    if (!stripe) return c.json({ error: "Payments are not configured" }, 503);

    const result = await db.transaction(async (tx) => {
      // lock: two admins clicking at once refund once
      const [o] = await tx.select().from(order).where(eq(order.id, orderId)).for("update");
      if (!o) return { error: "Order not found", status: 404 } as const;
      if (o.status === "refunded") return { error: "Already refunded", status: 409 } as const;
      if (o.status !== "cancelled" || !o.refundAmount) return { error: "Nothing to refund on this order", status: 409 } as const;

      const [p] = await tx
        .select()
        .from(payment)
        .where(and(eq(payment.orderId, orderId), eq(payment.status, "successful")));
      if (!p?.transactionId) return { error: "No card payment found for this order", status: 409 } as const;

      const session = await stripe!.checkout.sessions.retrieve(p.transactionId);
      const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (!intent) return { error: "Stripe has no payment for this checkout", status: 409 } as const;

      // same key on a retry, so Stripe never pays out twice
      await stripe!.refunds.create({ payment_intent: intent, amount: o.refundAmount }, { idempotencyKey: `refund-${orderId}` });
      await tx.update(order).set({ status: "refunded" }).where(eq(order.id, orderId));
      await tx.update(payment).set({ status: "refunded" }).where(eq(payment.id, p.id));
      return { refunded: o.refundAmount };
    }).catch((err) => {
      log.error({ err, orderId }, "[stripe] refund failed");
      return { error: "Stripe refused the refund, try again", status: 502 } as const;
    });

    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({ data: result });
  },
);
