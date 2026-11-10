import { sql } from "drizzle-orm";
import { pgTable, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { seatStatus, seatType, tripStatus, train, order } from "./index";

// One run of a train on one date: "Subarna 701 on 12 Nov 2026"
export const trip = pgTable(
  "trip",
  (t) => ({
    id: t.uuid("id").defaultRandom().primaryKey(),
    trainId: t
      .uuid("train_id")
      .notNull()
      .references(() => train.id, { onDelete: "restrict" }),
    journeyDate: t.date("journey_date", { mode: "string" }).notNull(), // "2026-11-12"
    departsAt: t.timestamp("departs_at", { withTimezone: true }).notNull(),
    salesOpenAt: t.timestamp("sales_open_at", { withTimezone: true }).notNull(),
    status: tripStatus("status").notNull().default("scheduled"),
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
    uniqueIndex("trip_train_date_uq").on(t.trainId, t.journeyDate),
    index("trip_date_status_idx").on(t.journeyDate, t.status),
  ],
);

// One physical seat on one trip. This is the inventory that gets booked.
export const tripSeat = pgTable(
  "trip_seat",
  (t) => ({
    id: t.uuid("id").defaultRandom().primaryKey(),
    tripId: t
      .uuid("trip_id")
      .notNull()
      .references(() => trip.id, { onDelete: "restrict" }),
    coachCode: t.text("coach_code").notNull(),
    seatNumber: t.integer("seat_number").notNull(),
    seatType: seatType("seat_type").notNull(),
    price: t.integer("price").notNull(), // copied from coach when the trip is created
    status: seatStatus("status").notNull().default("available"),
    orderId: t
      .uuid("order_id")
      .references(() => order.id, { onDelete: "restrict" }),
    reservedUntil: t.timestamp("reserved_until", { withTimezone: true }),
    updatedAt: t
      .timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  }),
  (t) => [
    // a physical seat exists once per trip
    uniqueIndex("trip_seat_position_uq").on(
      t.tripId,
      t.coachCode,
      t.seatNumber,
    ),
    // "available AC_S seats on this trip"
    index("trip_seat_availability_idx").on(t.tripId, t.seatType, t.status),
    // cleanup job: "reserved seats whose hold has expired"
    index("trip_seat_expiry_idx").on(t.status, t.reservedUntil),
    index("trip_seat_order_idx").on(t.orderId),

    check("trip_seat_price_positive", sql`${t.price} >= 0`),
    // available ⇔ no order attached
    check(
      "trip_seat_order_consistent",
      sql`(${t.status} = 'available') = (${t.orderId} IS NULL)`,
    ),
    // a reservation must have an expiry, or a closed browser locks the seat forever
    check(
      "trip_seat_reservation_expires",
      sql`${t.status} <> 'reserved' OR ${t.reservedUntil} IS NOT NULL`,
    ),
  ],
);
