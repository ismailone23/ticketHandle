import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "@acme/auth/types";
import { zValidator } from "@hono/zod-validator";
import { insertTripSchema, updateTripSchema } from "../../types";
import { db } from "@acme/db/db";
import { invalidateTrains } from "@acme/db/redis";
import { coach, order, ticket, trip, tripSeat } from "@acme/db/db/schema";
import { tripDbError } from "@acme/server/lib";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { departureAt } from "../journey/refund";
import { z } from "zod";
export const tripRoute = new Hono<AppEnv>();

// Todo: add a corn job or background function to auto update the trip status for departed
tripRoute.post("/add-trip", zValidator("json", insertTripSchema), async (c) => {
  const { seats: given, ...tripD } = c.req.valid("json");
  try {
    const created = await db.transaction(async (tx) => {
      const [newTrip] = await tx.insert(trip).values(tripD).returning();
      if (!newTrip) throw Error("Trip insert retruned nothing!");

      const seats =
        given ??
        (
          await tx.select().from(coach).where(eq(coach.trainId, tripD.trainId))
        ).flatMap((k) =>
          Array.from({ length: k.seatCount }, (_, i) => ({
            coachCode: k.code,
            coachPosition: k.position,
            seatNumber: i + 1,
            seatType: k.seatType,
            price: k.price,
          })),
        );
      if (!seats.length) throw new HTTPException(400, { message: "This train has no coaches" });

      const insertedSeates = await tx
        .insert(tripSeat)
        .values(seats.map((s) => ({ ...s, tripId: newTrip.id })))
        .returning();

      return { ...newTrip, seats: insertedSeates };
    });
    await invalidateTrains();
    return c.json({ data: created }, 201);
  } catch (err) {
    if (err instanceof HTTPException) return c.json({ error: err.message }, 400);
    const e = tripDbError(err);
    if (e) return c.json({ error: e.error }, e.status);
    throw err;
  }
});

// a train's trips, newest date first, with how many seats are sold or held
tripRoute.get(
  "/trips",
  zValidator("query", z.object({ trainId: z.uuid() })),
  async (c) => {
    const { trainId } = c.req.valid("query");
    const rows = await db
      .select({
        id: trip.id,
        journeyDate: trip.journeyDate,
        departureTime: trip.departureTime,
        arrivalTime: trip.arrivalTime,
        arrivalDayOffset: trip.arrivalDayOffset,
        salesOpenAt: trip.salesOpenAt,
        status: trip.status,
        seats: count(tripSeat.id),
        booked: sql<number>`count(*) filter (where ${tripSeat.status} = 'booked')::int`,
        held: sql<number>`count(*) filter (where ${tripSeat.status} = 'reserved')::int`,
      })
      .from(trip)
      .leftJoin(tripSeat, eq(tripSeat.tripId, trip.id))
      .where(eq(trip.trainId, trainId))
      .groupBy(trip.id)
      .orderBy(desc(trip.journeyDate), desc(trip.departureTime))
      .limit(100);
    return c.json({ data: rows });
  },
);

tripRoute.put(
  "/update-trip/:tripId",
  zValidator("param", z.object({ tripId: z.uuid() })),
  zValidator("json", updateTripSchema),
  async (c) => {
    const { tripId } = c.req.valid("param");
    const { attach, detach, ...times } = c.req.valid("json");
    // thrown inside the transaction so everything done so far rolls back
    const fail = (status: 404 | 409, message: string) => {
      throw new HTTPException(status, { message });
    };

    try {
      const updated = await db.transaction(async (tx) => {
        // lock the trip so two admins can't edit it at once
        const [t] = await tx
          .select({
            status: trip.status,
            journeyDate: trip.journeyDate,
            departureTime: trip.departureTime,
          })
          .from(trip)
          .where(eq(trip.id, tripId))
          .for("update");
        if (!t) return fail(404, "Trip not found");
        if (t.status !== "scheduled")
          return fail(409, `Trip is ${t.status} and can't be changed`);

        if (Object.keys(times).length) {
          const dep = times.departureTime ?? t.departureTime;
          if (departureAt(t.journeyDate, dep) <= new Date())
            return fail(409, "New departure time is already in the past");
          // passengers bought for the old time; rescheduling = cancel-trip, which refunds them
          const [sold] = await tx
            .select({ n: count() })
            .from(tripSeat)
            .where(
              and(
                eq(tripSeat.tripId, tripId),
                inArray(tripSeat.status, ["reserved", "booked"]),
              ),
            );
          if (sold!.n)
            return fail(
              409,
              `${sold!.n} seats are held or sold; cancel the trip instead of changing its times`,
            );
        }

        if (detach) {
          const inCoaches = and(
            eq(tripSeat.tripId, tripId),
            inArray(tripSeat.coachCode, detach),
          );
          // delete only free seats; a seat reserved meanwhile is skipped, then caught below
          const removed = await tx
            .delete(tripSeat)
            .where(and(inCoaches, eq(tripSeat.status, "available")))
            .returning({ code: tripSeat.coachCode });
          const [left] = await tx
            .select({ code: tripSeat.coachCode })
            .from(tripSeat)
            .where(inCoaches)
            .limit(1);
          if (left)
            return fail(409, `Coach ${left.code} has reserved or booked seats`);
          const missing = detach.filter(
            (code) => !removed.some((r) => r.code === code),
          );
          if (missing.length)
            return fail(404, `Not on this trip: ${missing.join(", ")}`);
        }
        // Todo: if detach is done then update the customer and refund money

        if (attach) {
          const [clash] = await tx
            .select({ code: tripSeat.coachCode })
            .from(tripSeat)
            .where(
              and(
                eq(tripSeat.tripId, tripId),
                or(
                  inArray(
                    tripSeat.coachCode,
                    attach.map((a) => a.code),
                  ),
                  inArray(
                    tripSeat.coachPosition,
                    attach.map((a) => a.position),
                  ),
                ),
              ),
            )
            .limit(1);
          if (clash)
            return fail(409, `Coach code or position taken by ${clash.code}`);

          await tx.insert(tripSeat).values(
            attach.flatMap((a) =>
              Array.from({ length: a.seatCount }, (_, i) => ({
                tripId,
                coachCode: a.code,
                coachPosition: a.position,
                seatNumber: i + 1,
                seatType: a.seatType,
                price: a.price,
              })),
            ),
          );
        }

        const [row] = Object.keys(times).length
          ? await tx
              .update(trip)
              .set(times)
              .where(eq(trip.id, tripId))
              .returning()
          : await tx.select().from(trip).where(eq(trip.id, tripId));
        // Todo: if a customer already purchased a ticket and after that time is rescheduled
        // then have to inform via email and need to either canceld
        // or on a new coach have to adjust with previous seat
        const seats = await tx
          .select()
          .from(tripSeat)
          .where(eq(tripSeat.tripId, tripId))
          .orderBy(asc(tripSeat.coachPosition), asc(tripSeat.seatNumber));
        return { ...row!, seats };
      });
      await invalidateTrains();
      return c.json({ data: updated });
    } catch (err) {
      if (err instanceof HTTPException)
        return c.json({ error: err.message }, err.status as 404 | 409);
      const e = tripDbError(err);
      if (e) return c.json({ error: e.error }, e.status);
      throw err;
    }
  },
);

tripRoute.post(
  "/cancel-trip/:tripId",
  zValidator("param", z.object({ tripId: z.uuid() })),
  async (c) => {
    const { tripId } = c.req.valid("param");

    const result = await db.transaction(async (tx) => {
      const [t] = await tx
        .select({ status: trip.status })
        .from(trip)
        .where(eq(trip.id, tripId))
        .for("update");
      if (!t) return { error: "Trip not found", status: 404 } as const;
      // departed/completed can't be undone; cancelled twice is a mistake worth flagging
      if (t.status !== "scheduled")
        return { error: `Trip is already ${t.status}`, status: 409 } as const;

      const [cancelled] = await tx
        .update(trip)
        .set({ status: "cancelled" })
        .where(eq(trip.id, tripId))
        .returning();

      const tickets = await tx
        .update(ticket)
        .set({ status: "cancelled" })
        .where(and(eq(ticket.tripId, tripId), eq(ticket.status, "valid")))
        .returning({ id: ticket.id });

      await tx
        .update(order)
        .set({ status: "cancelled" })
        .where(and(eq(order.tripId, tripId), eq(order.status, "pending")));

      // our fault, so paid customers get everything back via the admin refund queue
      // Todo: email the customers
      const paid = await tx
        .update(order)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          refundAmount: sql`${order.totalAmount}`,
        })
        .where(and(eq(order.tripId, tripId), eq(order.status, "paid")))
        .returning({ id: order.id });

      return {
        data: {
          trip: cancelled!,
          cancelledTickets: tickets.length,
          ordersNeedingRefund: paid.map((o) => o.id),
        },
      };
    });

    if ("error" in result)
      return c.json({ error: result.error }, result.status);
    await invalidateTrains();
    return c.json({ data: result.data });
  },
);
