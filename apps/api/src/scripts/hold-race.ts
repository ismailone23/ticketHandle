// Race test for /ticket/hold on the real DB + Redis. Cleans up after itself.
// npm run test:hold-race
import type { AppEnv } from "@acme/auth/types";
import { db, pool } from "@acme/db/db";
import { order, train, trip, tripSeat, user } from "@acme/db/db/schema";
import { redis } from "@acme/db/redis";
import { eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { ticketRoute } from "../routes/journey/ticket";

const RACERS = 50;
const tag = `race-${Date.now()}`;

// real route; auth replaced by x-test-user header
const app = new Hono<AppEnv>()
  .use((c, next) => {
    c.set("user", {
      id: c.req.header("x-test-user")!,
    } as AppEnv["Variables"]["user"]);
    return next();
  })
  .route("/ticket", ticketRoute);

const hold = (userId: string, seatNumbers: number[]) =>
  app.request("/ticket/hold", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user": userId,
      "idempotency-key": `${tag}-${userId}`,
    },
    body: JSON.stringify({
      tripId,
      coachCode: "KA",
      seatType: "s_chair",
      seatNumbers,
    }),
  });

let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed = true;
};

// ---- seed
const [t] = await db
  .insert(train)
  .values({
    number: 900000 + (Date.now() % 99999),
    name: tag,
    fromStation: "A",
    toStation: "B",
  })
  .returning();
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const [tr] = await db
  .insert(trip)
  .values({
    trainId: t!.id,
    journeyDate: tomorrow,
    salesOpenAt: new Date(Date.now() - 3_600_000),
    departureTime: "10:00:00",
    arrivalTime: "18:00:00",
  })
  .returning();
const tripId = tr!.id;
await db.insert(tripSeat).values(
  Array.from({ length: 10 }, (_, i) => ({
    tripId,
    coachCode: "KA",
    coachPosition: 1,
    seatNumber: i + 1,
    seatType: "s_chair" as const,
    price: 50_000,
  })),
);
const users = Array.from({ length: RACERS + 6 }, (_, i) => ({
  id: `${tag}-u${i}`,
  name: `racer ${i}`,
  email: `${tag}-u${i}@example.test`,
}));
await db.insert(user).values(users);

try {
  // ---- live stream, opened before the race
  const stream = await app.request(
    `/ticket/trips/${tripId}/seats/stream?seatType=s_chair`,
  );
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const nextEvent = async (name: string, ms = 3000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const m = buffered.match(new RegExp(`event: ${name}\\ndata: (.*)\\n\\n`));
      if (m) {
        buffered = buffered.slice(buffered.indexOf(m[0]) + m[0].length);
        return JSON.parse(m[1]!) as { seatNumber: number; status: string }[];
      }
      const r = await Promise.race([
        reader.read(),
        new Promise<null>((res) =>
          setTimeout(() => res(null), deadline - Date.now()),
        ),
      ]);
      if (!r || r.done) break;
      buffered += decoder.decode(r.value);
    }
    return null;
  };
  const snapshot = await nextEvent("snapshot");
  check(
    snapshot?.length === 10 && snapshot.every((s) => s.status === "available"),
    "stream snapshot: 10 free seats",
  );

  // ---- 1. all want seats 1-3, half in reverse order
  const racers = users.slice(0, RACERS);
  const results = await Promise.all(
    racers.map((u, i) => hold(u.id, i % 2 ? [3, 2, 1] : [1, 2, 3])),
  );
  const codes = results.map((r) => r.status);
  const won = codes.filter((s) => s === 201).length;
  const lost = codes.filter((s) => s === 409).length;
  check(won === 1, `same seats: exactly one 201 (got ${won})`);
  check(
    lost === RACERS - 1,
    `same seats: the rest 409 (got ${lost}, codes ${[...new Set(codes)]})`,
  );

  const winner = results.find((r) => r.status === 201);
  const winnerOrder = winner
    ? ((await winner.json()) as { data: { order: { id: string } } }).data.order
        .id
    : null;
  const held = await db
    .select()
    .from(tripSeat)
    .where(eq(tripSeat.tripId, tripId));
  const s123 = held.filter((s) => s.seatNumber <= 3);
  check(
    s123.every((s) => s.status === "reserved" && s.orderId === winnerOrder),
    "seats 1-3 reserved by the winner's order only",
  );

  const live = await nextEvent("seats");
  check(
    live?.length === 3 && live.every((s) => s.status === "in_progress"),
    "stream pushed seats 1-3 as in_progress",
  );

  // ---- 2. different seats: all should succeed
  const solo = users.slice(RACERS);
  const soloCodes = (
    await Promise.all(solo.map((u, i) => hold(u.id, [4 + i])))
  ).map((r) => r.status);
  check(
    soloCodes.every((s) => s === 201),
    `different seats: all 201 (got ${soloCodes})`,
  );

  await reader.cancel();
} finally {
  // ---- cleanup, children first
  await db.delete(tripSeat).where(eq(tripSeat.tripId, tripId));
  await db.delete(order).where(eq(order.tripId, tripId));
  await db.delete(trip).where(eq(trip.id, tripId));
  await db.delete(train).where(eq(train.id, t!.id));
  await db.delete(user).where(like(user.id, `${tag}-%`));
  await pool.end();
  redis.disconnect();
}

console.log(failed ? "\nFAILED" : "\nall passed");
process.exit(failed ? 1 : 0);
