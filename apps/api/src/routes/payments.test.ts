import { db } from "@acme/db/db";
import { order, payment, ticket, tripSeat } from "@acme/db/db/schema";
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  buyPaid,
  call,
  cleanup,
  createTrip,
  createUser,
  hold,
  nameAll,
  paidSession,
  sessions,
  webhook,
} from "../test/fixture";

afterAll(cleanup);

const orderRow = async (id: string) => (await db.select().from(order).where(eq(order.id, id)))[0]!;
const ticketsOf = (orderId: string) => db.select().from(ticket).where(eq(ticket.orderId, orderId));
const seatsOf = (orderId: string) => db.select().from(tripSeat).where(eq(tripSeat.orderId, orderId));

// hold + names + pay, but not yet paid at Stripe
const checkout = async (seatNumbers = [1, 2]) => {
  const t = await createTrip();
  const u = await createUser();
  const orderId = (await hold(u, t.id, seatNumbers)).body.data.order.id as string;
  await nameAll(u, orderId, seatNumbers);
  await call(u, "POST", `/orders/${orderId}/pay`);
  const [p] = await db.select().from(payment).where(eq(payment.orderId, orderId));
  return { u, orderId, p: p! };
};

describe("stripe webhook", () => {
  test("rejects unsigned and wrongly signed events", async () => {
    const { p } = await checkout();
    expect(await webhook("checkout.session.completed", paidSession(p.id, p.amount), "whsec_wrong")).toBe(400);
    expect((await orderRow(p.orderId)).status).toBe("pending");
  });

  test("paid: order paid, seats booked, one ticket; GET /orders/:id shows it", async () => {
    const { u, orderId, p } = await checkout();
    expect(await webhook("checkout.session.completed", paidSession(p.id, p.amount))).toBe(200);

    expect((await orderRow(orderId)).status).toBe("paid");
    expect((await seatsOf(orderId)).map((s) => s.status)).toEqual(["booked", "booked"]);
    const [tk] = await ticketsOf(orderId);
    expect(tk!.code.length).toBeGreaterThanOrEqual(20);

    const view = await call(u, "GET", `/orders/${orderId}`);
    expect(view.body.data).toMatchObject({ status: "paid", ticketCode: tk!.code, ticketStatus: "valid" });
  });

  test("Stripe retrying the same event issues no second ticket", async () => {
    const { orderId, p } = await checkout();
    const ev = paidSession(p.id, p.amount);
    await Promise.all([webhook("checkout.session.completed", ev), webhook("checkout.session.completed", ev)]);
    await webhook("checkout.session.completed", ev);
    expect(await ticketsOf(orderId)).toHaveLength(1);
  });

  test("paid after the user released the hold: seats stay free, full refund flagged", async () => {
    const { u, orderId, p } = await checkout();
    await call(u, "DELETE", `/orders/${orderId}/hold`);
    expect(sessions.get(`cs_test_${p.id}`)!.status).toBe("expired");

    await webhook("checkout.session.completed", paidSession(p.id, p.amount));
    const o = await orderRow(orderId);
    expect(o.status).toBe("cancelled");
    expect(o.refundAmount).toBe(p.amount);
    expect(await ticketsOf(orderId)).toHaveLength(0);
  });

  test("wrong amount: no ticket, refund flagged, seats freed", async () => {
    const { orderId, p } = await checkout();
    await webhook("checkout.session.completed", paidSession(p.id, 100));
    const o = await orderRow(orderId);
    expect(o.status).toBe("cancelled");
    expect(o.refundAmount).toBe(100);
    expect(await seatsOf(orderId)).toHaveLength(0);
  });

  test("expired checkout marks the payment failed; paying again opens a new one", async () => {
    const { u, orderId, p } = await checkout();
    await webhook("checkout.session.expired", { ...paidSession(p.id, p.amount), payment_status: "unpaid" });
    const [after] = await db.select().from(payment).where(eq(payment.id, p.id));
    expect(after!.status).toBe("failed");

    const again = await call(u, "POST", `/orders/${orderId}/pay`);
    expect(again.status).toBe(201);
    expect(again.body.data.url).not.toContain(p.id);
  });

  test("full flow through buyPaid gives a scannable ticket", async () => {
    const t = await createTrip({ departIn: 0 });
    const [u, checker] = [await createUser(), await createUser()];
    const { code } = await buyPaid(u, t.id, [3]);
    const r = await call(checker, "POST", `/check/${code}`, undefined, { "x-test-role": "organizer" });
    expect(r.status).toBe(200);
  });
});
