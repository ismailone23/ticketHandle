import { db } from "@acme/db/db";
import { order, payment, tripSeat } from "@acme/db/db/schema";
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  app,
  buyPaid,
  call,
  cleanup,
  createTrip,
  createUser,
  hold,
  nameAll,
  paidSession,
  webhook,
} from "../test/fixture";
import { expireHolds } from "./cleanup";

afterAll(cleanup);

const orderRow = async (id: string) => (await db.select().from(order).where(eq(order.id, id)))[0]!;

// a held order whose hold ran out a second ago, with an open checkout
const staleOrder = async (tripId: string, seatNumbers: number[]) => {
  const u = await createUser();
  const id = (await hold(u, tripId, seatNumbers)).body.data.order.id as string;
  await nameAll(u, id, seatNumbers);
  await call(u, "POST", `/orders/${id}/pay`);
  const past = new Date(Date.now() - 1000);
  await db.update(order).set({ expiresAt: past }).where(eq(order.id, id));
  await db.update(tripSeat).set({ reservedUntil: past }).where(eq(tripSeat.orderId, id));
  const [p] = await db.select().from(payment).where(eq(payment.orderId, id));
  return { id, p: p! };
};

describe("expireHolds", () => {
  test("expires stale orders, frees seats, fails payments; leaves live and paid orders alone", async () => {
    const t = await createTrip();
    const stale = await staleOrder(t.id, [1, 2]);
    const live = (await hold(await createUser(), t.id, [3])).body.data.order.id;
    const paid = await buyPaid(await createUser(), t.id, [4]);

    const r = await expireHolds();
    expect(r.expiredOrders).toBeGreaterThanOrEqual(1);

    expect((await orderRow(stale.id)).status).toBe("expired");
    expect(await db.select().from(tripSeat).where(eq(tripSeat.orderId, stale.id))).toHaveLength(0);
    const [p] = await db.select().from(payment).where(eq(payment.id, stale.p.id));
    expect(p!.status).toBe("failed");

    expect((await orderRow(live)).status).toBe("pending");
    expect((await orderRow(paid.orderId)).status).toBe("paid");
  });

  test("parallel runs (one per worker) expire each order exactly once", async () => {
    const t = await createTrip();
    const ids = await Promise.all([1, 2, 3, 4, 5].map((n) => staleOrder(t.id, [n])));
    await Promise.all(Array.from({ length: 5 }, () => expireHolds()));
    for (const { id } of ids) expect((await orderRow(id)).status).toBe("expired");
    const seats = await db.select().from(tripSeat).where(eq(tripSeat.tripId, t.id));
    expect(seats.every((s) => s.status === "available")).toBe(true);
  });

  test("a Stripe payment landing after cleanup gets a refund, not a ticket", async () => {
    const t = await createTrip();
    const { id, p } = await staleOrder(t.id, [1]);
    await expireHolds();
    await webhook("checkout.session.completed", paidSession(p.id, p.amount));
    const o = await orderRow(id);
    expect(o.status).toBe("cancelled");
    expect(o.refundAmount).toBe(p.amount);
  });
});

describe("POST /admin/cleanup/expired-holds", () => {
  const run = (userId: string, role: string) =>
    app.request("/admin/cleanup/expired-holds", {
      method: "POST",
      headers: { "x-test-user": userId, "x-test-role": role },
    });

  test("admin only", async () => {
    const u = await createUser();
    expect((await run(u, "buyer")).status).toBe(403);
    expect((await run(u, "organizer")).status).toBe(403);
    const ok = await run(u, "admin");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ data: { expiredOrders: expect.any(Number) } });
  });
});
