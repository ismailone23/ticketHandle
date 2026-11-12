import { sql } from "drizzle-orm";
import { pgTable, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { orderStatus, paymentStatus, ticketStatus } from "./enum";
import { trip, tripSeat } from "./trips";

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
    expiresAt: t.timestamp("expires_at", { withTimezone: true }).notNull(),
    paidAt: t.timestamp("paid_at", { withTimezone: true }),
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
    // double-clicked "Buy" → second insert fails → return the first order
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

// Issued after payment, one per passenger. This is what gets checked on the train.
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
    tripSeatId: t
      .uuid("trip_seat_id")
      .notNull()
      .references(() => tripSeat.id, { onDelete: "restrict" }),
    userId: t
      .text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    passengerName: t.text("passenger_name").notNull(),
    unitPrice: t.integer("unit_price").notNull(), // snapshot at purchase
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
    // safety net: one active ticket per seat, even if app code has a bug
    uniqueIndex("ticket_seat_active_uq")
      .on(t.tripSeatId)
      .where(sql`${t.status} in ('valid', 'used')`),
    index("ticket_order_idx").on(t.orderId),
    index("ticket_user_idx").on(t.userId),
    index("ticket_trip_idx").on(t.tripId),
    check("ticket_price_positive", sql`${t.unitPrice} >= 0`),
  ],
);
