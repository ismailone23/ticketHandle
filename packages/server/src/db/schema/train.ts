import { sql } from "drizzle-orm";
import { pgTable, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { offDay, seatType } from "./index";

export const train = pgTable(
  "train",
  (t) => ({
    id: t.uuid("id").defaultRandom().primaryKey(),
    number: t.integer("number").notNull(),
    name: t.text("name").notNull(),
    fromStation: t.text("from_station").notNull(),
    toStation: t.text("to_station").notNull(),
    departureTime: t.time("departure_time").notNull(),
    arrivalTime: t.time("arrival_time").notNull(),
    arrivalDayOffset: t.integer("arrival_day_offset").notNull().default(0), // 1 = arrives next day (night trains)
    offDay: offDay("off_day"), // null = runs every day
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
    uniqueIndex("train_number_uq").on(t.number),
    index("train_route_idx").on(t.fromStation, t.toStation),
    check("train_arrival_offset_valid", sql`${t.arrivalDayOffset} >= 0`),
    check("train_route_valid", sql`${t.fromStation} <> ${t.toStation}`),
  ],
);

// A coach on that train: "KA, AC_S, 50 seats, ৳1,200"
export const coach = pgTable(
  "coach",
  (t) => ({
    id: t.uuid("id").defaultRandom().primaryKey(),
    trainId: t
      .uuid("train_id")
      .notNull()
      .references(() => train.id, { onDelete: "cascade" }),
    code: t.text("code").notNull(), // "KA", "KHA", "GA" ...
    seatType: seatType("seat_type").notNull(),
    seatCount: t.integer("seat_count").notNull(),
    price: t.integer("price").notNull(), // poisha: ৳1,200 = 120000
  }),
  (t) => [
    uniqueIndex("coach_train_code_uq").on(t.trainId, t.code),
    check("coach_seat_count_positive", sql`${t.seatCount} > 0`),
    check("coach_price_positive", sql`${t.price} >= 0`),
  ],
);
