import { pgEnum } from "drizzle-orm/pg-core";

export const seatType = pgEnum("seat_type", [
  "s_chair",
  "snigdha",
  "ac_s",
  "ac_c",
]);

export const offDay = pgEnum("off_day", [
  "SAT",
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
]);

export const tripStatus = pgEnum("trip_status", [
  "scheduled",
  "cancelled",
  "departed",
  "completed",
]);

export const seatStatus = pgEnum("seat_status", [
  "available",
  "reserved",
  "booked",
]);

export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "cancelled",
  "expired",
  "refunded",
]);

export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "successful",
  "failed",
  "refunded",
]);

export const ticketStatus = pgEnum("ticket_status", [
  "valid",
  "used",
  "cancelled",
]);
