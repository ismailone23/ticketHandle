import { db } from "@acme/db/db";
import { order, ticket, tripSeat } from "@acme/db/db/schema";
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  HOUR,
  buyPaid,
  call,
  cleanup,
  createTrip,
  createUser,
  hold,
  nameAll,
} from "../../test/fixture";

afterAll(cleanup);

const seatsOf = (tripId: string) =>
  call(null, "GET", `/trips/${tripId}/seats?seatType=s_chair`).then((r) => r.body.data as { seatNumber: number; status: string }[]);
const orderRow = async (id: string) => (await db.select().from(order).where(eq(order.id, id)))[0]!;

describe("search", () => {
  test("lists future trips with class counts, hides departed ones", async () => {
    const future = await createTrip({ departIn: 2 * HOUR });
    const gone = await createTrip({ departIn: -HOUR });
    const search = (t: typeof future) =>
      call(null, "GET", `/search?journeyDate=${t.journeyDate}&fromStation=${t.fromStation}&toStation=${t.toStation}`);

    const found = (await search(future)).body.data;
    expect(found).toHaveLength(1);
    expect(found[0].classes).toEqual([{ seatType: "s_chair", available: 10, fromPrice: 50_000 }]);
    expect((await search(gone)).body.data).toHaveLength(0);
  });
});

describe("hold", () => {
  test("reserves seats; seat map shows them in progress without order ids", async () => {
    const t = await createTrip();
    const u = await createUser();
    const r = await hold(u, t.id, [1, 2]);
    expect(r.status).toBe(201);
    expect(r.body.data.order.passengers).toEqual([
      { coachCode: "KA", seatNumber: 1, name: "" },
      { coachCode: "KA", seatNumber: 2, name: "" },
    ]);

    const map = await seatsOf(t.id);
    expect(map.filter((s) => s.status === "in_progress").map((s) => s.seatNumber)).toEqual([1, 2]);
    expect(JSON.stringify(map)).not.toContain("orderId");
  });

  test("same idempotency key returns the same order", async () => {
    const t = await createTrip();
    const u = await createUser();
    const a = await hold(u, t.id, [1], "same-key");
    const b = await hold(u, t.id, [1], "same-key");
    expect(b.status).toBe(200);
    expect(b.body.data.order.id).toBe(a.body.data.order.id);
  });

  test("rejects taken seats, more than 4 per user, and closed sales", async () => {
    const t = await createTrip();
    const [a, b] = [await createUser(), await createUser()];
    await hold(a, t.id, [1, 2, 3]);

    expect((await hold(b, t.id, [3, 4])).status).toBe(409); // seat 3 taken
    expect((await hold(a, t.id, [5, 6])).status).toBe(409); // 3 + 2 > 4

    const later = await createTrip({ salesOpenAt: new Date(Date.now() + HOUR) });
    expect((await hold(a, later.id, [1])).status).toBe(403);
  });
});

describe("passengers, pay, release", () => {
  test("passengers must match the held seats and belong to the user", async () => {
    const t = await createTrip();
    const [u, other] = [await createUser(), await createUser()];
    const id = (await hold(u, t.id, [1, 2])).body.data.order.id;

    expect((await nameAll(u, id, [1, 3])).status).toBe(400);
    expect((await nameAll(u, id, [1])).status).toBe(400);
    expect((await nameAll(other, id, [1, 2])).status).toBe(404);
    expect((await nameAll(u, id, [1, 2])).status).toBe(200);
    expect((await orderRow(id)).passengers.map((p) => p.name)).toEqual(["P1", "P2"]);
  });

  test("pay needs names; returns a checkout url, reused on a second click", async () => {
    const t = await createTrip();
    const u = await createUser();
    const id = (await hold(u, t.id, [1])).body.data.order.id;
    const pay = () => call(u, "POST", `/orders/${id}/pay`);

    expect((await pay()).status).toBe(400);
    await nameAll(u, id, [1]);
    const first = await pay();
    expect(first.status).toBe(201);
    expect(first.body.data.url).toStartWith("https://checkout.test/");
    expect((await pay()).body.data.url).toBe(first.body.data.url);

    // hold stretched to cover Stripe's 30 min minimum checkout window
    const left = (await orderRow(id)).expiresAt.getTime() - Date.now();
    expect(left).toBeGreaterThan(31 * 60_000);
  });

  test("expired hold can't be changed", async () => {
    const t = await createTrip();
    const u = await createUser();
    const id = (await hold(u, t.id, [1])).body.data.order.id;
    await db.update(order).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(order.id, id));
    expect((await nameAll(u, id, [1])).status).toBe(409);
  });

  test("release frees the seats and closes the order", async () => {
    const t = await createTrip();
    const u = await createUser();
    const id = (await hold(u, t.id, [1, 2])).body.data.order.id;

    expect((await call(u, "DELETE", `/orders/${id}/hold`)).status).toBe(200);
    expect((await orderRow(id)).status).toBe("cancelled");
    expect((await seatsOf(t.id)).every((s) => s.status === "available")).toBe(true);
    expect((await call(u, "POST", `/orders/${id}/pay`)).status).toBe(409);
  });
});

describe("cancel", () => {
  test("50h before departure: 90% refund, seats freed, ticket cancelled, retry-safe", async () => {
    const t = await createTrip({ departIn: 50 * HOUR });
    const u = await createUser();
    const { orderId } = await buyPaid(u, t.id, [1, 2]);
    const total = (await orderRow(orderId)).totalAmount;

    const r = await call(u, "POST", `/cancel/${orderId}`);
    expect(r.status).toBe(200);
    expect(r.body.data.refundAmount).toBe(Math.floor(total * 0.9));

    const o = await orderRow(orderId);
    expect(o.status).toBe("cancelled");
    expect(o.refundAmount).toBe(Math.floor(total * 0.9));
    const [tk] = await db.select().from(ticket).where(eq(ticket.orderId, orderId));
    expect(tk!.status).toBe("cancelled");
    expect((await db.select().from(tripSeat).where(eq(tripSeat.orderId, orderId))).length).toBe(0);

    const again = await call(u, "POST", `/cancel/${orderId}`);
    expect(again.body.data.refundAmount).toBe(r.body.data.refundAmount);
  });

  test("under 6h: cancel allowed, no refund", async () => {
    const t = await createTrip({ departIn: 3 * HOUR });
    const u = await createUser();
    const { orderId } = await buyPaid(u, t.id, [1]);
    const r = await call(u, "POST", `/cancel/${orderId}`);
    expect(r.status).toBe(200);
    expect(r.body.data.refundAmount).toBe(0);
  });

  test("someone else's order is 404, a departed train is 409", async () => {
    const t = await createTrip();
    const [u, other] = [await createUser(), await createUser()];
    const { orderId } = await buyPaid(u, t.id, [1]);
    expect((await call(other, "POST", `/cancel/${orderId}`)).status).toBe(404);

    const gone = await createTrip({ departIn: -HOUR });
    const late = await buyPaid(u, gone.id, [1]);
    expect((await call(u, "POST", `/cancel/${late.orderId}`)).status).toBe(409);
  });
});

describe("scan", () => {
  // today's trip in Dhaka; scan checks the date, not the departure time
  const todayTrip = () => createTrip({ departIn: 0 });

  test("buyers can't scan", async () => {
    const u = await createUser();
    expect((await call(u, "POST", "/check/anything")).status).toBe(403);
  });

  test("first scan returns names per seat, second scan is rejected", async () => {
    const t = await todayTrip();
    const [u, checker] = [await createUser(), await createUser()];
    const { code } = await buyPaid(u, t.id, [1, 2]);
    const scan = () => call(checker, "POST", `/check/${code}`, undefined, { "x-test-role": "organizer" });

    const r = await scan();
    expect(r.status).toBe(200);
    expect(r.body.data.passengers).toEqual([
      { coachCode: "KA", seatNumber: 1, name: "P1" },
      { coachCode: "KA", seatNumber: 2, name: "P2" },
    ]);
    expect((await scan()).status).toBe(409);
  });

  test("ticket for another day is rejected", async () => {
    const t = await createTrip({ departIn: 48 * HOUR });
    const [u, checker] = [await createUser(), await createUser()];
    const { code } = await buyPaid(u, t.id, [1]);
    const r = await call(checker, "POST", `/check/${code}`, undefined, { "x-test-role": "organizer" });
    expect(r.status).toBe(409);
  });
});
