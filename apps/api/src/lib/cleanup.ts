import { db } from "@acme/db/db";
import { order, payment, tripSeat } from "@acme/db/db/schema";
import { log } from "@acme/server/log";
import { and, eq, inArray, lt } from "drizzle-orm";
import { publishSeats, type SeatChange } from "./seatEvents";

const BATCH = 500;

// Pending orders past their hold → "expired", seats freed, open payments failed.
// SKIP LOCKED: safe to run from every worker at once, and never waits on a live checkout.
// A Stripe payment that still lands afterwards is refunded by the webhook.
export const expireHolds = async () => {
  const result = await db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: order.id })
      .from(order)
      .where(and(eq(order.status, "pending"), lt(order.expiresAt, new Date())))
      .limit(BATCH)
      .for("update", { skipLocked: true });
    if (!stale.length) return { orders: 0, freed: [] };
    const ids = stale.map((o) => o.id);

    await tx.update(order).set({ status: "expired" }).where(inArray(order.id, ids));
    await tx
      .update(payment)
      .set({ status: "failed" })
      .where(and(inArray(payment.orderId, ids), eq(payment.status, "pending")));
    const freed = await tx
      .update(tripSeat)
      .set({ status: "available", orderId: null, reservedUntil: null })
      .where(inArray(tripSeat.orderId, ids))
      .returning({
        tripId: tripSeat.tripId,
        coachCode: tripSeat.coachCode,
        seatNumber: tripSeat.seatNumber,
        seatType: tripSeat.seatType,
      });
    return { orders: ids.length, freed };
  });

  const byTrip = new Map<string, SeatChange[]>();
  for (const { tripId, ...s } of result.freed) {
    if (!byTrip.has(tripId)) byTrip.set(tripId, []);
    byTrip.get(tripId)!.push({ ...s, status: "available", until: null });
  }
  for (const [tripId, seats] of byTrip) void publishSeats(tripId, seats);

  return { expiredOrders: result.orders, freedSeats: result.freed.length, more: result.orders === BATCH };
};

// background timer; one failed run just waits for the next
export const startCleanup = (everyMs = 60_000) =>
  setInterval(() => {
    expireHolds()
      .then((r) => r.expiredOrders && log.info(r, "[cleanup] expired holds"))
      .catch((err) => log.error({ err }, "[cleanup] failed"));
  }, everyMs);
