import { db } from "@acme/db/db";
import { order, train as trainTable, trip, tripSeat } from "@acme/db/db/schema";
import { afterAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { HOUR, app, buyPaid, call, cleanup, createTrip, createUser, dhakaAt } from "../../test/fixture";

afterAll(cleanup);

const as = (role: string) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/admin${path}`, {
    method,
    headers: { "x-test-user": "admin-test", "x-test-role": role, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};
const admin = as("admin");

const coach = { code: "KA", position: 1, seatType: "s_chair", seatCount: 10, price: 100 };
const train = { name: "X", fromStation: "A", toStation: "B", coach: [coach] };

describe("admin routes", () => {
  test("only admins get in", async () => {
    expect((await as("buyer")("GET", "/users")).status).toBe(403);
    expect((await as("organizer")("GET", "/all-trains")).status).toBe(403);
    expect((await app.request("/admin/users")).status).toBe(401);
  });

  // each of these used to reach Postgres and come back as a 500
  test("bad input is a 400/404, not a server error", async () => {
    const t = await createTrip();
    const cases: [string, string, unknown, number][] = [
      ["POST", "/new-train", { ...train, number: 2 ** 31 }, 400],
      ["POST", "/new-train", { ...train, number: 9001, coach: [{ ...coach, price: 2 ** 31 }] }, 400],
      ["PUT", "/update-train/not-a-uuid", { name: "Y" }, 400],
      ["GET", "/trains/number/99999999999", undefined, 400],
      ["GET", "/trains/number/2000000000", undefined, 404], // above the create limit, still looked up
      ["GET", "/all-trains?date=2026-13-45", undefined, 400],
      ["GET", `/all-trains?from=${"A".repeat(101)}`, undefined, 400],
      ["PUT", `/update-trip/${t.id}`, { attach: [{ ...coach, code: "ZZ", position: 9, seatCount: 20_000 }] }, 400],
      [
        "POST",
        "/add-trip",
        {
          trainId: crypto.randomUUID(),
          journeyDate: "2026-12-30",
          salesOpenAt: "2026-12-01T00:00:00+06:00",
          departureTime: "10:00:00",
          arrivalTime: "12:00:00",
          arrivalDayOffset: 0,
          seats: [{ coachCode: "KA", coachPosition: 1, seatNumber: 1, seatType: "s_chair", price: 1 }],
        },
        404,
      ],
    ];
    for (const [method, path, body, want] of cases)
      expect({ path, status: (await admin(method, path, body)).status }).toEqual({ path, status: want });
  });

  test("trip times can't change once seats are sold, or move into the past", async () => {
    const t = await createTrip();
    expect((await admin("PUT", `/update-trip/${t.id}`, { departureTime: "00:00:01", arrivalDayOffset: 3 })).status).toBe(200);

    const past = await createTrip({ departIn: 2 * HOUR });
    const earlier = dhakaAt(-HOUR);
    if (earlier.journeyDate === past.journeyDate) // skip right after midnight
      expect((await admin("PUT", `/update-trip/${past.id}`, { departureTime: earlier.departureTime })).status).toBe(409);

    const sold = await createTrip();
    await buyPaid(await createUser(), sold.id, [1]);
    const r = await admin("PUT", `/update-trip/${sold.id}`, { arrivalDayOffset: 2 });
    expect(r.status).toBe(409);
    // coaches can still be added to a sold trip
    expect((await admin("PUT", `/update-trip/${sold.id}`, { attach: [{ ...coach, code: "GA", position: 5 }] })).status).toBe(200);
  });

  test("add-trip copies seats from the train's coaches; /trips lists it", async () => {
    const number = 90_000 + Math.floor(Math.random() * 9_999);
    const tr = await admin("POST", "/new-train", {
      ...train,
      number,
      fromStation: `adm-${number}-A`,
      coach: [coach, { ...coach, code: "KHA", position: 2, seatCount: 5, seatType: "ac_s", price: 900 }],
    });
    expect(tr.status).toBe(201);
    const trainId = tr.body.data.id;
    try {
      const when = dhakaAt(72 * HOUR);
      const t = await admin("POST", "/add-trip", {
        trainId,
        journeyDate: when.journeyDate,
        salesOpenAt: new Date().toISOString(),
        departureTime: "07:00:00",
        arrivalTime: "12:00:00",
        arrivalDayOffset: 0,
      });
      expect(t.status).toBe(201);
      expect(t.body.data.seats).toHaveLength(15);
      expect(t.body.data.seats.filter((s: { seatType: string }) => s.seatType === "ac_s")).toHaveLength(5);

      const list = await admin("GET", `/trips?trainId=${trainId}`);
      expect(list.body.data[0]).toMatchObject({ id: t.body.data.id, seats: 15, booked: 0, held: 0 });
    } finally {
      // created outside the fixture, so removed here
      await db.delete(tripSeat).where(inArray(tripSeat.tripId, db.select({ id: trip.id }).from(trip).where(eq(trip.trainId, trainId))));
      await db.delete(trip).where(eq(trip.trainId, trainId));
      await db.delete(trainTable).where(eq(trainTable.id, trainId));
    }
  });

  test("users list is paged", async () => {
    const r = await admin("GET", "/users?limit=1");
    expect(r.status).toBe(200);
    expect(r.body.users).toHaveLength(1);
    expect((await admin("GET", "/users?limit=1000")).status).toBe(400);
  });

  test("cancelling a trip queues a full refund for paid customers", async () => {
    const t = await createTrip();
    const u = await createUser();
    const { orderId } = await buyPaid(u, t.id, [1, 2]);

    const r = await admin("POST", `/cancel-trip/${t.id}`);
    expect(r.status).toBe(200);
    expect(r.body.data.ordersNeedingRefund).toEqual([orderId]);

    const o = (await db.select().from(order).where(eq(order.id, orderId)))[0]!;
    expect(o.status).toBe("cancelled");
    expect(o.refundAmount).toBe(o.totalAmount);
    expect((await call(u, "GET", `/orders/${orderId}`)).body.data.ticketStatus).toBe("cancelled");
  });
});

describe("stations", () => {
  test("public list of every from/to station, refreshed when trains change", async () => {
    const { journeyRoute } = await import("../journey");
    const t = await createTrip();
    const r = await journeyRoute.request("/ticket/stations"); // no session
    expect(r.status).toBe(200);
    const { data } = (await r.json()) as { data: string[] };
    expect(data).toContain(t.fromStation);
    expect(data).toContain(t.toStation);
  });
});

