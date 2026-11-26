// Test helpers: real DB + Redis, fake auth, throwaway data removed by cleanup().
import type { AppEnv } from "@acme/auth/types";
import { db } from "@acme/db/db";
import {
  order,
  payment,
  ticket,
  train,
  trip,
  tripSeat,
  user,
} from "@acme/db/db/schema";
import { invalidateTrains } from "@acme/db/redis";
import { env } from "@acme/server/env";
import { mock } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import Stripe from "stripe";

// fake Stripe: sessions live in this map, nothing leaves the machine
export const sessions = new Map<string, { id: string; status: string; url: string; expires_at: number }>();
mock.module("../lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: async (params: { expires_at: number }, opts: { idempotencyKey: string }) => {
          const s = { id: `cs_test_${opts.idempotencyKey}`, status: "open", url: `https://checkout.test/${opts.idempotencyKey}`, expires_at: params.expires_at };
          sessions.set(s.id, s);
          return s;
        },
        retrieve: async (id: string) => sessions.get(id),
        expire: async (id: string) => Object.assign(sessions.get(id)!, { status: "expired" }),
      },
    },
  },
}));
env.STRIPE_WEBHOOK_SECRET = "whsec_test";
// imported after the mock so the routes get the fake client
const { ticketRoute } = await import("../routes/journey/ticket");
const { paymentRoute } = await import("../routes/payments");
const { adminRoute } = await import("../routes/admin");

// auth replaced by x-test-user / x-test-role headers
export const app = new Hono<AppEnv>()
  .use((c, next) => {
    const id = c.req.header("x-test-user");
    c.set(
      "user",
      id
        ? ({
            id,
            role: c.req.header("x-test-role") ?? "buyer",
            banned: false,
          } as AppEnv["Variables"]["user"])
        : null,
    );
    return next();
  })
  .route("/ticket", ticketRoute)
  .route("/payments", paymentRoute)
  .route("/admin", adminRoute);

// a signed Stripe event, as Stripe would POST it
export const webhook = async (
  type: string,
  session: Record<string, unknown>,
  secret = "whsec_test",
) => {
  const payload = JSON.stringify({ id: `evt_${crypto.randomUUID()}`, object: "event", type, data: { object: session } });
  const res = await app.request("/payments/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret }) },
    body: payload,
  });
  return res.status;
};

// what Stripe sends when the customer paid `amount`
export const paidSession = (paymentId: string, amount: number) => ({
  id: `cs_test_${paymentId}`,
  object: "checkout.session",
  client_reference_id: paymentId,
  payment_status: "paid",
  amount_total: amount,
  currency: "bdt",
});

export const call = async (
  userId: string | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) => {
  const res = await app.request(`/ticket${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(userId && { "x-test-user": userId }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json()) as any };
};

// Dhaka date + time `ms` from now, as the trip table stores them
export const dhakaAt = (ms: number) => {
  const iso = new Date(Date.now() + ms + 6 * 3_600_000).toISOString();
  return { journeyDate: iso.slice(0, 10), departureTime: iso.slice(11, 19) };
};
export const HOUR = 3_600_000;

const tag = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const created = {
  trains: [] as string[],
  trips: [] as string[],
  users: [] as string[],
};
let n = 0;

// a train with one trip and 10 s_chair seats in coach KA, 500 taka each
export const createTrip = async (
  opts: {
    departIn?: number;
    salesOpenAt?: Date;
  } = {},
) => {
  const [t] = await db
    .insert(train)
    .values({
      number: 800_000 + Math.floor(Math.random() * 99_999),
      name: tag,
      fromStation: `${tag}-${n}-A`, // unique per trip so searches don't overlap
      toStation: `${tag}-${n++}-B`,
    })
    .returning();
  created.trains.push(t!.id);
  await invalidateTrains(); // like the admin route, so cached search/station lists see it
  const [tr] = await db
    .insert(trip)
    .values({
      trainId: t!.id,
      ...dhakaAt(opts.departIn ?? 72 * HOUR),
      arrivalTime: "23:59:59",
      arrivalDayOffset: 1,
      salesOpenAt: opts.salesOpenAt ?? new Date(Date.now() - HOUR),
    })
    .returning();
  created.trips.push(tr!.id);
  await db.insert(tripSeat).values(
    Array.from({ length: 10 }, (_, i) => ({
      tripId: tr!.id,
      coachCode: "KA",
      coachPosition: 1,
      seatNumber: i + 1,
      seatType: "s_chair" as const,
      price: 50_000,
    })),
  );
  return { ...tr!, fromStation: t!.fromStation, toStation: t!.toStation };
};

export const createUser = async () => {
  const id = `${tag}-u${n++}`;
  await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  created.users.push(id);
  return id;
};

export const hold = (
  userId: string,
  tripId: string,
  seatNumbers: number[],
  key: string = crypto.randomUUID(),
) =>
  call(
    userId,
    "POST",
    "/hold",
    { tripId, coachCode: "KA", seatType: "s_chair", seatNumbers },
    { "idempotency-key": key },
  );

export const nameAll = (
  userId: string,
  orderId: string,
  seatNumbers: number[],
) =>
  call(userId, "PUT", `/orders/${orderId}/passengers`, {
    passengers: seatNumbers.map((seatNumber) => ({
      coachCode: "KA",
      seatNumber,
      name: `P${seatNumber}`,
    })),
  });

// hold → names → pay → Stripe webhook, the same path a real customer takes
export const buyPaid = async (
  userId: string,
  tripId: string,
  seatNumbers: number[],
) => {
  const h = await hold(userId, tripId, seatNumbers);
  const orderId = h.body.data.order.id as string;
  await nameAll(userId, orderId, seatNumbers);
  await call(userId, "POST", `/orders/${orderId}/pay`);
  const [p] = await db.select().from(payment).where(eq(payment.orderId, orderId));
  await webhook("checkout.session.completed", paidSession(p!.id, p!.amount));
  const [t] = await db.select().from(ticket).where(eq(ticket.orderId, orderId));
  return { orderId, code: t!.code, paymentId: p!.id };
};

export const cleanup = async () => {
  const { trips, trains, users } = created;
  if (trips.length) {
    const orders = (
      await db
        .select({ id: order.id })
        .from(order)
        .where(inArray(order.tripId, trips))
    ).map((o) => o.id);
    await db.delete(ticket).where(inArray(ticket.tripId, trips));
    if (orders.length)
      await db.delete(payment).where(inArray(payment.orderId, orders));
    await db.delete(tripSeat).where(inArray(tripSeat.tripId, trips));
    await db.delete(order).where(inArray(order.tripId, trips));
    await db.delete(trip).where(inArray(trip.id, trips));
  }
  if (trains.length) await db.delete(train).where(inArray(train.id, trains));
  if (users.length) await db.delete(user).where(inArray(user.id, users));
  await invalidateTrains(); // drop cached lists that still name the deleted trains
};
