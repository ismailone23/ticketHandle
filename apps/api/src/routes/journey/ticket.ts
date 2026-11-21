import type { AppEnv } from "@acme/auth/types";
import { db } from "@acme/db/db";
import {
  order,
  payment,
  ticket,
  trip,
  tripSeat,
  user as userTable,
} from "@acme/db/db/schema";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, inArray, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { cached, getTrainsVersion } from "@acme/db/redis";
import { getAvailableTrain } from "@acme/server/services";
import { requirePermission } from "../../middleware/guard";
import { purchaseTicketSchema } from "../../types";
import { isUniqueViolation } from "@acme/server/lib";
import { trainRoute } from "../admin/train";

export const ticketRoute = new Hono<AppEnv>();

ticketRoute.get(
  "/search",
  zValidator(
    "query",
    z.object({
      journeyDate: z.iso.date(),
      fromStation: z.string(),
      toStation: z.string(),
    }),
  ),
  async (c) => {
    const { fromStation, journeyDate, toStation } = c.req.valid("query");

    const key = `search:v${await getTrainsVersion()}:${fromStation}:${toStation}:${journeyDate}`;

    const { availableTrain, tripsOfAvailableTrains } = await cached(
      key,
      600,
      () => getAvailableTrain({ fromStation, toStation, journeyDate }),
    );

    if (!availableTrain) {
      return c.json({ data: [] }, 201);
    }

    const seatsOfTrains = await db
      .select()
      .from(tripSeat)
      .where(
        and(
          inArray(
            tripSeat.tripId,
            tripsOfAvailableTrains.map((t) => t.id),
          ),
        ),
      );

    const byTrips = new Map<string, Map<string, typeof seatsOfTrains>>();
    for (const seat of seatsOfTrains) {
      let byCoach = byTrips.get(seat.tripId);
      if (!byCoach) byTrips.set(seat.tripId, (byCoach = new Map()));
      let coach = byCoach.get(seat.coachCode);
      if (!coach) byCoach.set(seat.coachCode, (coach = []));
      coach.push(seat);
    }

    const trainById = new Map(availableTrain.map((t) => [t.id, t]));
    const items = tripsOfAvailableTrains.map((t) => ({
      train: trainById.get(t.trainId),
      trip: t,
      coaches: Object.fromEntries(byTrips.get(t.id) ?? []),
    }));

    return c.json({ data: items });
  },
);
export const vat = 0.05;
const MAX_TICKETS = 4; // per user per trip

ticketRoute.post(
  "/purchase",
  zValidator("json", purchaseTicketSchema),
  async (c) => {
    const { coachCode, passengers, seatType, tripId, provider } =
      c.req.valid("json");
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const key = c.req.header("Idempotency-Key");
    if (!key) return c.json({ error: "Idempotency-Key header required" }, 400);

    const findExisting = () =>
      db
        .select()
        .from(order)
        .where(and(eq(order.userId, user.id), eq(order.idempotencyKey, key)));
    // must run before the seat lookup: on a retry the seats are already
    // reserved by the first attempt, so it would fail with "not available"
    const [existing] = await findExisting();
    if (existing) return c.json({ data: { order: existing } });

    // thrown inside the transaction so everything rolls back
    const fail = (status: 403 | 404 | 409, message: string): never => {
      throw new HTTPException(status, { message });
    };

    try {
      const created = await db.transaction(async (tx) => {
        // serialize this user's checkouts so two tabs can't both pass the limit
        await tx
          .select({ id: userTable.id })
          .from(userTable)
          .where(eq(userTable.id, user.id))
          .for("update");

        const [t] = await tx
          .select({ status: trip.status, salesOpenAt: trip.salesOpenAt })
          .from(trip)
          .where(eq(trip.id, tripId))
          .for("share"); // blocks a concurrent cancel until we commit
        if (!t) return fail(404, "Trip not found");
        if (t.status !== "scheduled") return fail(409, `Trip is ${t.status}`);
        if (t.salesOpenAt > new Date())
          return fail(403, "Ticket sales are not open yet");

        // reserved (pending orders) + booked (paid) seats this user holds on this trip
        const [held] = await tx
          .select({ n: count() })
          .from(tripSeat)
          .innerJoin(order, eq(order.id, tripSeat.orderId))
          .where(
            and(
              eq(order.userId, user.id),
              eq(tripSeat.tripId, tripId),
              inArray(tripSeat.status, ["reserved", "booked"]),
            ),
          );
        if (held!.n + passengers.length > MAX_TICKETS)
          return fail(
            409,
            `Max ${MAX_TICKETS} tickets per trip, you already have ${held!.n}`,
          );

        const now = new Date();
        const seats = await tx
          .select()
          .from(tripSeat)
          .where(
            and(
              eq(tripSeat.tripId, tripId),
              eq(tripSeat.seatType, seatType),
              eq(tripSeat.coachCode, coachCode),
              inArray(
                tripSeat.seatNumber,
                passengers.map((p) => p.seatNumber),
              ),
              or(
                eq(tripSeat.status, "available"),
                // shortcut: expired holds are reclaimed here; still need a cleanup job
                // to mark their orders "expired" so a late payment is rejected
                and(
                  eq(tripSeat.status, "reserved"),
                  lt(tripSeat.reservedUntil, now),
                ),
              ),
            ),
          )
          .for("update");
        if (seats.length !== passengers.length)
          return fail(409, "Some selected seats are no longer available");

        // prices are poisha (integers), so round after VAT
        const totalAmount = Math.round(
          seats.reduce((sum, s) => sum + s.price, 0) * (1 + vat),
        );
        const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

        const [newOrder] = await tx
          .insert(order)
          .values({
            userId: user.id,
            tripId,
            totalAmount,
            expiresAt,
            idempotencyKey: key,
            passengers,
          })
          .returning();

        const [newPayment] = await tx
          .insert(payment)
          .values({ amount: totalAmount, orderId: newOrder!.id, provider })
          .returning();

        await tx
          .update(tripSeat)
          .set({
            status: "reserved",
            reservedUntil: expiresAt,
            orderId: newOrder!.id,
          })
          .where(
            inArray(
              tripSeat.id,
              seats.map((s) => s.id),
            ),
          );

        return { order: newOrder!, payment: newPayment! };
      });

      // Todo: start the gateway session with created.payment.id and return its redirect URL.
      // Its callback marks payment/order paid, seats booked, and creates one ticket per order.passengers entry.
      return c.json({ data: created }, 201);
    } catch (err) {
      if (err instanceof HTTPException)
        return c.json({ error: err.message }, err.status as 403 | 404 | 409);
      // a concurrent retry with the same key won the insert: return its order
      if (isUniqueViolation(err, "order_user_idempotency_uq")) {
        const [first] = await findExisting();
        return c.json({ data: { order: first } });
      }
      throw err;
    }
  },
);

// POST, not GET: scanning marks the ticket used, and GETs get prefetched/retried
ticketRoute.post(
  "/check/:code",
  requirePermission({ ticket: ["scan"] }),
  zValidator("param", z.object({ code: z.string().trim().min(1).max(100) })),
  async (c) => {
    const { code } = c.req.valid("param");

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
    }).format(new Date());

    const result = await db.transaction(async (tx) => {
      // lock the ticket so two scanners can't both accept it
      const [row] = await tx
        .select({
          id: ticket.id,
          orderId: ticket.orderId,
          status: ticket.status,
          checkedAt: ticket.checkedAt,
          passengers: order.passengers,
          journeyDate: trip.journeyDate,
          tripStatus: trip.status,
        })
        .from(ticket)
        .innerJoin(trip, eq(trip.id, ticket.tripId))
        .innerJoin(order, eq(order.id, ticket.orderId))
        .where(eq(ticket.code, code))
        .for("update", { of: ticket });

      if (!row) return { error: "Ticket not found", status: 404 } as const;
      if (row.status === "used")
        return {
          error: `Already used at ${row.checkedAt?.toISOString()}`,
          status: 409,
        } as const;
      if (row.status === "cancelled" || row.tripStatus === "cancelled")
        return { error: "Ticket is cancelled", status: 409 } as const;
      if (row.journeyDate !== today)
        return {
          error: `Ticket is for ${row.journeyDate}, not today`,
          status: 409,
        } as const;

      const [used] = await tx
        .update(ticket)
        .set({ status: "used", checkedAt: new Date() })
        .where(eq(ticket.id, row.id))
        .returning({ checkedAt: ticket.checkedAt });

      const seats = await tx
        .select({
          coachCode: tripSeat.coachCode,
          seatNumber: tripSeat.seatNumber,
        })
        .from(tripSeat)
        .where(eq(tripSeat.orderId, row.orderId))
        .orderBy(asc(tripSeat.coachCode), asc(tripSeat.seatNumber));

      // staff compare the names with the travellers' IDs
      return {
        data: {
          journeyDate: row.journeyDate,
          checkedAt: used!.checkedAt,
          passengers: seats.map((s) => ({
            ...s,
            name:
              row.passengers.find((p) => p.seatNumber === s.seatNumber)?.name ??
              null,
          })),
        },
      };
    });

    if ("error" in result)
      return c.json({ error: result.error }, result.status);
    return c.json({ data: result.data });
  },
);

trainRoute.post(
  "/cancel-ticket/:orderId",
  zValidator("param", z.object({ orderId: z.string() })),
  async (c) => {
    const { orderId } = c.req.valid("param");
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const key = c.req.header("Idempotency-Key");
    if (!key) return c.json({ error: "Idempotency-Key header required" }, 400);
    const [ticketOwner] = await db
      .select({ userId: userTable.id, tripId: trip.id })
      .from(order)
      .where(eq(order.id, orderId))
      .innerJoin(userTable, eq(userTable.id, user.id));
    // todo finish it
  },
);
