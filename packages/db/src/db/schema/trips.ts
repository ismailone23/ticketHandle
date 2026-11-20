import { sql } from "drizzle-orm";
import { pgTable, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { train, order } from "./index";
import { tripStatus, seatStatus, seatType } from "./enum";
// One run of a train on one date: "Subarna 701 on 12 Nov 2026"
export const trip = pgTable(
  "trip",
  (t) => ({
    id: t.uuid("id").defaultRandom().primaryKey(),
    trainId: t
      .uuid("train_id")
      .notNull()
      .references(() => train.id, { onDelete: "restrict" }),
    journeyDate: t.date("journey_date", { mode: "string" }).notNull(),
    salesOpenAt: t.timestamp("sales_open_at", { withTimezone: true }).notNull(),
    status: tripStatus("status").notNull().default("scheduled"),
    departureTime: t.time("departure_time").notNull(),
    arrivalTime: t.time("arrival_time").notNull(),
    arrivalDayOffset: t.integer("arrival_day_offset").notNull().default(0),
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
    // A train can run several times a day, but its runs must not overlap.
    // Enforced by the "trip_no_overlap" EXCLUDE constraint in a custom migration
    // (drizzle can't express EXCLUDE); it ignores cancelled trips.
    index("trip_train_date_idx").on(t.trainId, t.journeyDate),
    index("trip_date_status_idx").on(t.journeyDate, t.status),
    check("train_arrival_offset_valid", sql`${t.arrivalDayOffset} >= 0`),
    // arrival strictly after departure, or the run's time range is invalid
    check(
      "trip_arrival_after_departure",
      sql`(${t.journeyDate} + ${t.arrivalDayOffset}) + ${t.arrivalTime} > ${t.journeyDate} + ${t.departureTime}`,
    ),
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
    coachPosition: t.integer("coach_position").notNull(), // copied from coach; per-trip so rush-time coaches can slot in
    seatNumber: t.integer("seat_number").notNull(),
    seatType: seatType("seat_type").default("s_chair").notNull(),
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
