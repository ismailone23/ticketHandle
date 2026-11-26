import type { AppEnv } from "@acme/auth/types";
import { db } from "@acme/db/db";
import {
  order,
  payment,
  ticket,
  train,
  trip,
  tripSeat,
  seatType,
  user as userTable,
} from "@acme/db/db/schema";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { cached, getTrainsVersion, redis } from "@acme/db/redis";
import { getAvailableTrain } from "@acme/server/services";
import { requirePermission } from "../../middleware/guard";
import { holdSeatsSchema, passengersSchema } from "../../types";
import { stripe } from "../../lib/stripe";
import { env } from "@acme/server/env";
import { log } from "@acme/server/log";
import { isUniqueViolation } from "@acme/server/lib";
import { departureAt, refundPercent } from "./refund";
import { streamSSE } from "hono/streaming";
import {
  publishSeats,
  watchSeats,
  type SeatChange,
  type SeatStatus,
} from "../../lib/seatEvents";

export const ticketRoute = new Hono<AppEnv>();

// free = available, or a hold that has expired
const freedSeat = {
  coachCode: tripSeat.coachCode,
  seatNumber: tripSeat.seatNumber,
  seatType: tripSeat.seatType,
};
const asAvailable = (s: {
  coachCode: string;
  seatNumber: number;
  seatType: string;
}): SeatChange => ({ ...s, status: "available", until: null });

const isFree = sql`(${tripSeat.status} = 'available' or (${tripSeat.status} = 'reserved' and ${tripSeat.reservedUntil} < now()))`;

ticketRoute.get(
  "/search",
  zValidator(
    "query",
    z.object({
      journeyDate: z.iso.date(),
      fromStation: z.string().trim().min(1).max(100),
      toStation: z.string().trim().min(1).max(100),
    }),
  ),
  async (c) => {
    const { fromStation, journeyDate, toStation } = c.req.valid("query");

    const key = `search:v${await getTrainsVersion()}:${fromStation}:${toStation}:${journeyDate}`;

    const cachedResult = await cached(key, 600, () =>
      getAvailableTrain({ fromStation, toStation, journeyDate }),
    );
    const { availableTrain } = cachedResult;
    // cache is up to 10 min old, so re-check departure
    const now = Date.now();
    const tripsOfAvailableTrains = cachedResult.tripsOfAvailableTrains.filter(
      (t) => departureAt(t.journeyDate, t.departureTime).getTime() > now,
    );

    if (!availableTrain) {
      return c.json({ data: [] }, 201);
    }

    // free seats + lowest price per class
    const counts = await db
      .select({
        tripId: tripSeat.tripId,
        seatType: tripSeat.seatType,
        available: sql<number>`count(*) filter (where ${isFree})::int`,
        fromPrice: sql<number>`min(${tripSeat.price})::int`,
      })
      .from(tripSeat)
      .where(
        inArray(
          tripSeat.tripId,
          tripsOfAvailableTrains.map((t) => t.id),
        ),
      )
      .groupBy(tripSeat.tripId, tripSeat.seatType);

    const trainById = new Map(availableTrain.map((t) => [t.id, t]));
    const items = tripsOfAvailableTrains.map((t) => ({
      train: trainById.get(t.trainId),
      trip: t,
      classes: counts
        .filter((x) => x.tripId === t.id)
        .map(({ tripId: _, ...rest }) => rest),
    }));

    return c.json({ data: items });
  },
);
// public seat info only (no orderId)
const seatMap = (tripId: string, type: (typeof seatType.enumValues)[number]) =>
  db
    .select({
      coachCode: tripSeat.coachCode,
      seatNumber: tripSeat.seatNumber,
      seatType: tripSeat.seatType,
      price: tripSeat.price,
      status: sql<SeatStatus>`case
        when ${isFree} then 'available'
        when ${tripSeat.status} = 'reserved' then 'in_progress'
        else 'booked' end`,
      until: sql<string | null>`case
        when not ${isFree} and ${tripSeat.status} = 'reserved' then ${tripSeat.reservedUntil} end`,
    })
    .from(tripSeat)
    .where(and(eq(tripSeat.tripId, tripId), eq(tripSeat.seatType, type)))
    .orderBy(asc(tripSeat.coachCode), asc(tripSeat.seatNumber));

const seatMapParams = [
  zValidator("param", z.object({ tripId: z.uuid() })),
  zValidator(
    "query",
    z.object({ seatType: z.enum(seatType.enumValues).default("s_chair") }),
  ),
] as const;

// seat map, cached 2s
ticketRoute.get("/trips/:tripId/seats", ...seatMapParams, async (c) => {
  const { tripId } = c.req.valid("param");
  const { seatType: type } = c.req.valid("query");
  const seats = await cached(`seats:${tripId}:${type}`, 2, () =>
    seatMap(tripId, type),
  );
  return c.json({ data: seats });
});

// live seat map (SSE): one "snapshot", then "seats" events with changes only
ticketRoute.get("/trips/:tripId/seats/stream", ...seatMapParams, (c) => {
  const { tripId } = c.req.valid("param");
  const { seatType: type } = c.req.valid("query");
  // disable Bun's 10s idle timeout for this stream
  (
    c.env as { timeout?: (req: Request, s: number) => void } | undefined
  )?.timeout?.(c.req.raw, 0);

  return streamSSE(c, async (stream) => {
    // buffer changes until the snapshot is sent
    let pending: SeatChange[][] | null = [];
    const send = (seats: SeatChange[]) =>
      stream.writeSSE({ event: "seats", data: JSON.stringify(seats) });

    const stop = await watchSeats(tripId, (seats) => {
      const mine = seats.filter((s) => s.seatType === type);
      if (!mine.length) return;
      if (pending) pending.push(mine);
      else void send(mine);
    });
    // keep-alive for proxies
    const ping = setInterval(() => void stream.write(": ping\n\n"), 25_000);
    stream.onAbort(() => {
      clearInterval(ping);
      stop();
    });

    // snapshot after subscribing, so no change is missed
    await stream.writeSSE({
      event: "snapshot",
      data: JSON.stringify(await seatMap(tripId, type)),
    });
    for (const seats of pending) await send(seats);
    pending = null;

    await new Promise<void>((resolve) => stream.onAbort(resolve));
  });
});

export const vat = 0.05;
const MAX_TICKETS = 4; // per user per trip
const HOLDS_PER_WINDOW = 10;
const HOLD_WINDOW_SEC = 600;

// fixed window counter; Redis down → allow, holds still work
const tooManyHolds = async (userId: string) => {
  try {
    const key = `holds:${userId}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, HOLD_WINDOW_SEC);
    return n > HOLDS_PER_WINDOW;
  } catch {
    return false;
  }
};

ticketRoute.post("/hold", zValidator("json", holdSeatsSchema), async (c) => {
  const { coachCode, seatNumbers, seatType, tripId } = c.req.valid("json");
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const key = c.req.header("Idempotency-Key");
  if (!key) return c.json({ error: "Idempotency-Key header required" }, 400);

  const findExisting = () =>
    db
      .select()
      .from(order)
      .where(and(eq(order.userId, user.id), eq(order.idempotencyKey, key)));
  // retry with same key: return the first order (its seats are already held)
  const [existing] = await findExisting();
  if (existing) return c.json({ data: { order: existing } });

  // stops hold → release loops that keep seats off sale
  if (await tooManyHolds(user.id))
    return c.json({ error: "Too many holds, try again in a few minutes" }, 429);

  // throw = rollback
  const fail = (status: 403 | 404 | 409, message: string): never => {
    throw new HTTPException(status, { message });
  };

  try {
    const created = await db.transaction(async (tx) => {
      // one checkout per user at a time (enforces MAX_TICKETS)
      await tx
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.id, user.id))
        .for("update");

      const [t] = await tx
        .select({
          status: trip.status,
          salesOpenAt: trip.salesOpenAt,
          journeyDate: trip.journeyDate,
          departureTime: trip.departureTime,
        })
        .from(trip)
        .where(eq(trip.id, tripId))
        .for("share"); // blocks a concurrent cancel until we commit
      if (!t) return fail(404, "Trip not found");
      if (t.status !== "scheduled") return fail(409, `Trip is ${t.status}`);
      if (t.salesOpenAt > new Date())
        return fail(403, "Ticket sales are not open yet");
      if (departureAt(t.journeyDate, t.departureTime) <= new Date())
        return fail(409, "This train has already left");

      // seats this user already holds or owns on this trip
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
      if (held!.n + seatNumbers.length > MAX_TICKETS)
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
            inArray(tripSeat.seatNumber, seatNumbers),
            or(
              eq(tripSeat.status, "available"),
              // expired holds are reusable before cleanup gets to them
              and(
                eq(tripSeat.status, "reserved"),
                lt(tripSeat.reservedUntil, now),
              ),
            ),
          ),
        )
        // fixed lock order, avoids deadlocks
        .orderBy(asc(tripSeat.seatNumber))
        .for("update");
      if (seats.length !== seatNumbers.length)
        return fail(409, "Some selected seats are no longer available");

      // poisha: round after VAT
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
          // names come later via PUT /orders/:id/passengers
          passengers: seats.map((s) => ({
            coachCode,
            seatNumber: s.seatNumber,
            name: "",
          })),
        })
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

      return { order: newOrder!, seats, expiresAt };
    });

    void publishSeats(
      tripId,
      created.seats.map((s) => ({
        coachCode: s.coachCode,
        seatNumber: s.seatNumber,
        seatType: s.seatType,
        status: "in_progress",
        until: created.expiresAt.toISOString(),
      })),
    );
    return c.json({ data: { order: created.order } }, 201);
  } catch (err) {
    if (err instanceof HTTPException)
      return c.json({ error: err.message }, err.status as 403 | 404 | 409);
    // parallel retry won the insert: return its order
    if (isUniqueViolation(err, "order_user_idempotency_uq")) {
      const [first] = await findExisting();
      return c.json({ data: { order: first } });
    }
    throw err;
  }
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// lock the user's pending, unexpired order
const lockHeldOrder = async (tx: Tx, orderId: string, userId: string) => {
  const [row] = await tx
    .select()
    .from(order)
    .where(and(eq(order.id, orderId), eq(order.userId, userId)))
    .for("update");
  if (!row) return { error: "Order not found", status: 404 } as const;
  if (row.status !== "pending")
    return { error: `Order is ${row.status}`, status: 409 } as const;
  if (row.expiresAt <= new Date())
    return { error: "Seat hold has expired", status: 409 } as const;
  return { order: row } as const;
};

const orderIdParam = zValidator("param", z.object({ id: z.uuid() }));

ticketRoute.put(
  "/orders/:id/passengers",
  orderIdParam,
  zValidator("json", passengersSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { passengers } = c.req.valid("json");
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const result = await db.transaction(async (tx) => {
      const held = await lockHeldOrder(tx, id, user.id);
      if ("error" in held) return { error: held.error, status: held.status };

      // must name exactly the held seats
      const key = (p: { coachCode: string; seatNumber: number }) =>
        `${p.coachCode}-${p.seatNumber}`;
      const heldKeys = new Set(held.order.passengers.map(key));
      const sentKeys = new Set(passengers.map(key));
      if (
        sentKeys.size !== passengers.length ||
        sentKeys.size !== heldKeys.size ||
        ![...sentKeys].every((k) => heldKeys.has(k))
      )
        return {
          error: "Passengers must match the held seats",
          status: 400,
        } as const;

      const [updated] = await tx
        .update(order)
        .set({ passengers })
        .where(eq(order.id, id))
        .returning();
      return { data: updated! } as const;
    });

    if ("error" in result)
      return c.json({ error: result.error }, result.status);
    return c.json({ data: result.data });
  },
);

// Stripe needs a checkout window of at least 30 min, so paying extends the hold to this
const PAY_WINDOW_MS = 32 * 60 * 1000;

ticketRoute.post("/orders/:id/pay", orderIdParam, async (c) => {
  const { id } = c.req.valid("param");
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (!stripe) return c.json({ error: "Payments are not configured" }, 503);

  const result = await db.transaction(async (tx) => {
    const held = await lockHeldOrder(tx, id, user.id);
    if ("error" in held) return { error: held.error, status: held.status };
    if (held.order.passengers.some((p) => !p.name))
      return { error: "Fill in every passenger first", status: 400 } as const;

    // reuse an open payment (double-click)
    const [open] = await tx
      .select()
      .from(payment)
      .where(and(eq(payment.orderId, id), eq(payment.status, "pending")));
    if (open) return { payment: open, order: held.order, extended: [] };

    // only the first payment extends the hold; otherwise re-paying holds seats forever
    const [earlier] = await tx
      .select({ id: payment.id })
      .from(payment)
      .where(eq(payment.orderId, id))
      .limit(1);
    if (earlier && held.order.expiresAt.getTime() - Date.now() < PAY_WINDOW_MS - 60_000)
      return { error: "Your hold is ending, please hold the seats again", status: 409 } as const;

    const expiresAt = earlier ? held.order.expiresAt : new Date(Date.now() + PAY_WINDOW_MS);
    const [o] = await tx
      .update(order)
      .set({ expiresAt })
      .where(eq(order.id, id))
      .returning();
    const extended = await tx
      .update(tripSeat)
      .set({ reservedUntil: expiresAt })
      .where(eq(tripSeat.orderId, id))
      .returning(freedSeat);
    const [created] = await tx
      .insert(payment)
      .values({ orderId: id, amount: o!.totalAmount, provider: "stripe" })
      .returning();
    return { payment: created!, order: o!, extended };
  });
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { payment: p, order: o, extended } = result;
  if (extended.length)
    void publishSeats(
      o.tripId,
      extended.map((s) => ({
        ...s,
        status: "in_progress",
        until: o.expiresAt.toISOString(),
      })),
    );

  const fail = async (status: 409 | 502, error: string) => {
    // a fresh click then starts a new payment and checkout
    await db
      .update(payment)
      .set({ status: "failed" })
      .where(and(eq(payment.id, p.id), eq(payment.status, "pending")));
    return c.json({ error }, status);
  };

  if (p.transactionId) {
    const s = await stripe.checkout.sessions.retrieve(p.transactionId);
    if (s.status === "open") return c.json({ data: { url: s.url } });
    if (s.status === "complete")
      return c.json({ error: "Already paid, ticket is on its way" }, 409);
    return fail(409, "Checkout expired, please pay again");
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: p.id,
        metadata: { orderId: o.id, paymentId: p.id },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "bdt",
              unit_amount: p.amount, // poisha
              product_data: { name: `Train ticket × ${o.passengers.length}` },
            },
          },
        ],
        // a minute before the hold ends, so nobody pays for released seats
        expires_at: Math.floor(o.expiresAt.getTime() / 1000) - 60,
        success_url: `${env.WEB_ORIGIN}/orders/${o.id}?paid=1`,
        cancel_url: `${env.WEB_ORIGIN}/orders/${o.id}`,
      },
      { idempotencyKey: p.id },
    );
    await db
      .update(payment)
      .set({ transactionId: session.id })
      .where(eq(payment.id, p.id));
    return c.json({ data: { url: session.url } }, 201);
  } catch (err) {
    log.error({ err, paymentId: p.id }, "[stripe] checkout create failed");
    return fail(502, "Could not start payment, try again");
  }
});

// what the user sees of an order, in the list and on its own page
const orderView = {
      id: order.id,
      status: order.status,
      totalAmount: order.totalAmount,
      refundAmount: order.refundAmount,
      expiresAt: order.expiresAt,
      passengers: order.passengers,
      ticketCode: ticket.code,
      ticketStatus: ticket.status,
      journeyDate: trip.journeyDate,
      departureTime: trip.departureTime,
      trainName: train.name,
      trainNumber: train.number,
      fromStation: train.fromStation,
      toStation: train.toStation,
};
const ordersOf = (userId: string) =>
  db
    .select(orderView)
    .from(order)
    .innerJoin(trip, eq(trip.id, order.tripId))
    .innerJoin(train, eq(train.id, trip.trainId))
    .leftJoin(ticket, eq(ticket.orderId, order.id))
    .where(eq(order.userId, userId))
    .$dynamic();

// "My bookings", newest first
ticketRoute.get("/orders", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  // shortcut: latest 50 only, add paging when someone has more
  const rows = await ordersOf(user.id).orderBy(desc(order.createdAt)).limit(50);
  return c.json({ data: rows });
});

// order + ticket for the return page; poll it until status is "paid"
ticketRoute.get("/orders/:id", orderIdParam, async (c) => {
  const { id } = c.req.valid("param");
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const [row] = await ordersOf(user.id).where(and(eq(order.userId, user.id), eq(order.id, id)));
  if (!row) return c.json({ error: "Order not found" }, 404);
  return c.json({ data: row });
});

// release a hold early (user went back)
ticketRoute.delete("/orders/:id/hold", orderIdParam, async (c) => {
  const { id } = c.req.valid("param");
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const result = await db.transaction(async (tx) => {
    const held = await lockHeldOrder(tx, id, user.id);
    if ("error" in held) return { error: held.error, status: held.status };

    await tx
      .update(order)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(order.id, id));
    const [open] = await tx
      .select({ sessionId: payment.transactionId })
      .from(payment)
      .where(and(eq(payment.orderId, id), eq(payment.status, "pending")));
    const freed = await tx
      .update(tripSeat)
      .set({ status: "available", orderId: null, reservedUntil: null })
      .where(eq(tripSeat.orderId, id))
      .returning(freedSeat);
    return {
      data: { released: true },
      tripId: held.order.tripId,
      freed,
      sessionId: open?.sessionId,
    } as const;
  });

  if ("error" in result) return c.json({ error: result.error }, result.status);
  void publishSeats(result.tripId, result.freed.map(asAvailable));
  // stop a payment for released seats; if it already went through, the webhook refunds it
  if (result.sessionId)
    void stripe?.checkout.sessions.expire(result.sessionId).catch(() => {});
  return c.json({ data: result.data });
});

// POST: scanning changes state
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
      // lock: two scanners can't both accept
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

      // names for staff to check against IDs
      return {
        data: {
          journeyDate: row.journeyDate,
          checkedAt: used!.checkedAt,
          passengers: seats.map((s) => ({
            ...s,
            name:
              row.passengers.find(
                (p) =>
                  p.coachCode === s.coachCode && p.seatNumber === s.seatNumber,
              )?.name ?? null,
          })),
        },
      };
    });

    if ("error" in result)
      return c.json({ error: result.error }, result.status);
    return c.json({ data: result.data });
  },
);

// cancel a paid order; refund is recorded, paid out later by admin. Retry-safe.
ticketRoute.post(
  "/cancel/:orderId",
  zValidator("param", z.object({ orderId: z.uuid() })),
  async (c) => {
    const { orderId } = c.req.valid("param");
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const result = await db.transaction(async (tx) => {
      // lock the order
      const [row] = await tx
        .select({
          status: order.status,
          totalAmount: order.totalAmount,
          refundAmount: order.refundAmount,
          cancelledAt: order.cancelledAt,
          tripId: order.tripId,
          journeyDate: trip.journeyDate,
          departureTime: trip.departureTime,
          tripStatus: trip.status,
        })
        .from(order)
        .innerJoin(trip, eq(trip.id, order.tripId))
        // other users' orders → 404
        .where(and(eq(order.id, orderId), eq(order.userId, user.id)))
        .for("update", { of: order });

      if (!row) return { error: "Order not found", status: 404 } as const;
      if (row.status === "cancelled" && row.cancelledAt)
        return {
          data: {
            refundAmount: row.refundAmount ?? 0,
            cancelledAt: row.cancelledAt,
          },
        } as const;
      if (row.status !== "paid")
        return { error: `Order is ${row.status}`, status: 409 } as const;
      // cancelled trips get a full refund from admin instead
      if (row.tripStatus !== "scheduled")
        return { error: `Trip is ${row.tripStatus}`, status: 409 } as const;

      const now = new Date();
      const hoursLeft =
        (departureAt(row.journeyDate, row.departureTime).getTime() -
          now.getTime()) /
        3_600_000;
      if (hoursLeft <= 0)
        return { error: "Train has already departed", status: 409 } as const;

      // used tickets can't be cancelled
      const [t] = await tx
        .update(ticket)
        .set({ status: "cancelled" })
        .where(and(eq(ticket.orderId, orderId), eq(ticket.status, "valid")))
        .returning({ id: ticket.id });
      if (!t) return { error: "Ticket is not valid", status: 409 } as const;

      const refundAmount = Math.floor(
        (row.totalAmount * refundPercent(hoursLeft)) / 100,
      );
      await tx
        .update(order)
        .set({ status: "cancelled", cancelledAt: now, refundAmount })
        .where(eq(order.id, orderId));

      const freed = await tx
        .update(tripSeat)
        .set({ status: "available", orderId: null, reservedUntil: null })
        .where(eq(tripSeat.orderId, orderId))
        .returning(freedSeat);

      return {
        data: { refundAmount, cancelledAt: now },
        tripId: row.tripId,
        freed,
      } as const;
    });

    if ("error" in result)
      return c.json({ error: result.error }, result.status);
    // repeat cancel frees nothing
    if (result.freed && result.tripId)
      void publishSeats(result.tripId, result.freed.map(asAvailable));
    return c.json({ data: result.data });
  },
);
