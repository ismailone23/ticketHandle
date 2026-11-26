import { sql } from "drizzle-orm";
import { pgTable, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { orderStatus, paymentStatus, ticketStatus } from "./enum";
import { trip } from "./trips";

// One checkout: "I'm buying KA-12 and KA-13 on the 12 Nov trip"
export const order = pgTable(
  "order",
  (t) => ({
    id: t.uuid("id").defaultRandom().primaryKey(),
    userId: t
      .text("user_id") // text: better-auth user.id is text
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    tripId: t
      .uuid("trip_id")
      .notNull()
      .references(() => trip.id, { onDelete: "restrict" }),
    status: orderStatus("status").notNull().default("pending"),
    totalAmount: t.integer("total_amount").notNull(), // poisha
    currency: t.text("currency").notNull().default("BDT"),
    idempotencyKey: t.text("idempotency_key").notNull(),
    // one per seat; coachCode + seatNumber match a tripSeat
    passengers: t
      .jsonb("passengers")
      .$type<
        { coachCode: string; seatNumber: number; name: string; email?: string }[]
      >()
      .notNull(),
    expiresAt: t.timestamp("expires_at", { withTimezone: true }).notNull(),
    paidAt: t.timestamp("paid_at", { withTimezone: true }),
    // cancelled + refundAmount > 0 = refund pending; admin sets "refunded" when paid
    cancelledAt: t.timestamp("cancelled_at", { withTimezone: true }),
    refundAmount: t.integer("refund_amount"), // poisha
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  }),
  (t) => [
    // idempotent hold: same key returns the first order
    uniqueIndex("order_user_idempotency_uq").on(t.userId, t.idempotencyKey),
    index("order_user_created_idx").on(t.userId, t.createdAt), // "my orders", newest first
    index("order_status_expires_idx").on(t.status, t.expiresAt), // cleanup job
    index("order_trip_idx").on(t.tripId),
    check("order_total_positive", sql`${t.totalAmount} >= 0`),
  ],
);

// Each attempt to pay. One order can have a failed payment, then a successful one.
export const payment = pgTable(
  "payment",
  (t) => ({
    id: t.uuid("id").defaultRandom().primaryKey(),
    orderId: t
      .uuid("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "restrict" }),
    amount: t.integer("amount").notNull(), // poisha
    status: paymentStatus("status").notNull().default("pending"),
    provider: t.text("provider").notNull(), // "bkash", "nagad", "sslcommerz"
    transactionId: t.text("transaction_id"),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  }),
  (t) => [
    index("payment_order_idx").on(t.orderId),
    // same gateway callback can't be recorded twice
    uniqueIndex("payment_provider_txn_uq").on(t.provider, t.transactionId),
    check("payment_amount_positive", sql`${t.amount} > 0`),
  ],
);

// one per paid order; one QR covers all its seats
export const ticket = pgTable(
  "ticket",
  (t) => ({
    id: t.uuid("id").defaultRandom().primaryKey(),
    orderId: t
      .uuid("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "restrict" }),
    tripId: t
      .uuid("trip_id")
      .notNull()
      .references(() => trip.id, { onDelete: "restrict" }),
    userId: t
      .text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    code: t.text("code").notNull(), // random, for the QR. Never the id.
    status: ticketStatus("status").notNull().default("valid"),
    checkedAt: t.timestamp("checked_at", { withTimezone: true }),
    createdAt: t
      .timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }),
  (t) => [
    uniqueIndex("ticket_code_uq").on(t.code),
    // one ticket per order, even if the gateway calls back twice
    uniqueIndex("ticket_order_uq").on(t.orderId),
    index("ticket_user_idx").on(t.userId),
    index("ticket_trip_idx").on(t.tripId),
  ],
);
