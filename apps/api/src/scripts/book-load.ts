// Booking load test: N customers each buy one seat end to end (hold -> names -> pay -> Stripe webhook)
// on the real DB + Redis, with a fake Stripe (nothing leaves the machine). Cleans up after itself.
// Runs under `bun test` because the fake Stripe uses mock.module. From apps/api:
//   TICKETS=2000 CONCURRENCY=16 taskset -c 0-1 nice -n 10 bun --env-file=../../.env test ./src/scripts/book-load.ts
import { db } from "@acme/db/db";
import { payment, ticket, tripSeat } from "@acme/db/db/schema";
import { afterAll, expect, test } from "bun:test";
import { and, count, countDistinct, eq } from "drizzle-orm";
import { call, cleanup, createTrip, createUser, paidSession, webhook } from "../test/fixture";

const TICKETS = Number(process.env.TICKETS ?? 2000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 16); // customers in flight at once
const PER_COACH = 1000; // MAX_SEAT

afterAll(cleanup);

test(`${TICKETS} customers book and pay`, async () => {
  // one trip, TICKETS seats over coaches KA, KB, ... (createTrip already made KA 1-10)
  const t = await createTrip();
  const seats = Array.from({ length: TICKETS }, (_, i) => ({
    coachCode: `K${String.fromCharCode(65 + Math.floor(i / PER_COACH))}`,
    seatNumber: (i % PER_COACH) + 1,
  }));
  const extra = seats.filter((s) => !(s.coachCode === "KA" && s.seatNumber <= 10));
  for (let i = 0; i < extra.length; i += 1000)
    await db.insert(tripSeat).values(
      extra.slice(i, i + 1000).map((s) => ({
        tripId: t.id,
        ...s,
        coachPosition: s.coachCode.charCodeAt(1) - 64,
        seatType: "s_chair" as const,
        price: 50_000,
      })),
    );

  const failures: string[] = [];
  const ms: number[] = [];
  const buy = async (seat: (typeof seats)[number]) => {
    const start = performance.now();
    const u = await createUser();
    const step = (name: string, r: { status: number; body: unknown }, ok: number[]) => {
      if (!ok.includes(r.status)) throw new Error(`${name} ${r.status} ${JSON.stringify(r.body)}`);
      return r.body as { data: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const held = step("hold", await call(u, "POST", "/hold", { tripId: t.id, seatType: "s_chair", coachCode: seat.coachCode, seatNumbers: [seat.seatNumber] }, { "idempotency-key": crypto.randomUUID() }), [201]);
    const orderId = held.data.order.id as string;
    step("names", await call(u, "PUT", `/orders/${orderId}/passengers`, { passengers: [{ ...seat, name: "Load Test" }] }), [200]);
    step("pay", await call(u, "POST", `/orders/${orderId}/pay`), [200, 201]);
    const [p] = await db.select().from(payment).where(eq(payment.orderId, orderId));
    const hook = await webhook("checkout.session.completed", paidSession(p!.id, p!.amount));
    if (hook !== 200) throw new Error(`webhook ${hook}`);
    ms.push(performance.now() - start);
  };

  // fixed pool of workers pulling the next seat
  const began = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < seats.length) {
        const seat = seats[next++]!;
        await buy(seat).catch((e: Error) => failures.push(e.message));
        if (ms.length % 250 === 0 && ms.length) console.log(`${ms.length} / ${TICKETS}`);
      }
    }),
  );
  const secs = (performance.now() - began) / 1000;

  ms.sort((a, b) => a - b);
  const pct = (q: number) => Math.round(ms[Math.floor((ms.length - 1) * q)] ?? 0);
  console.log(
    `booked ${ms.length}/${TICKETS} in ${secs.toFixed(1)}s = ${(ms.length / secs).toFixed(0)} bookings/s ` +
      `(~${((ms.length * 4) / secs).toFixed(0)} API calls/s); per booking p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${pct(1)}ms`,
  );
  if (failures.length) console.log(`${failures.length} failed, first: ${failures.slice(0, 3).join(" | ")}`);

  // the database must agree: one paid ticket per seat, every seat booked, no seat sold twice
  const [tk] = await db.select({ n: count() }).from(ticket).where(eq(ticket.tripId, t.id));
  const [paid] = await db.select({ n: count() }).from(payment).innerJoin(ticket, eq(ticket.orderId, payment.orderId)).where(and(eq(ticket.tripId, t.id), eq(payment.status, "successful")));
  // every booked seat points at its own order
  const [booked] = await db.select({ n: count(), orders: countDistinct(tripSeat.orderId) }).from(tripSeat).where(and(eq(tripSeat.tripId, t.id), eq(tripSeat.status, "booked")));
  expect(failures).toEqual([]);
  expect([tk!.n, paid!.n, booked!.n, booked!.orders]).toEqual([TICKETS, TICKETS, TICKETS, TICKETS]);
}, 30 * 60_000);
