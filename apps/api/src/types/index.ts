import { offDay, seatType } from "@acme/db/db/schema";
import * as z from "zod";

export const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  seatType: z.enum(seatType.enumValues).optional(),
  search: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((s) => s.toLowerCase())
    .optional(),
});
// "ka", " KA" -> "KA" so the unique index and duplicate checks agree
const coachCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{1,5}$/);

export const coachSchema = z.object({
  code: coachCode,
  position: z.number().int().positive(),
  seatType: z.enum(seatType.enumValues),
  seatCount: z.number().int().positive(),
  price: z.number().int().nonnegative(),
});

export const trainBase = z.object({
  number: z.number().int().positive(),
  name: z.string().trim().min(1),
  fromStation: z.string().trim().min(1),
  toStation: z.string().trim().min(1),
  offDay: z.enum(offDay.enumValues).nullable(),
});

export const insertTrainSchema = trainBase
  .extend({
    offDay: trainBase.shape.offDay.default(null),
    coach: z.array(coachSchema).min(1),
  })
  .refine((t) => t.fromStation !== t.toStation, {
    path: ["toStation"],
    message: "Must differ from fromStation",
  })
  .refine((t) => new Set(t.coach.map((c) => c.code)).size === t.coach.length, {
    path: ["coach"],
    message: "Duplicate coach code",
  })
  .refine(
    (t) => new Set(t.coach.map((c) => c.position)).size === t.coach.length,
    { path: ["coach"], message: "Duplicate coach position" },
  );

export const updateTrainSchema = trainBase
  .partial()
  .refine((t) => Object.keys(t).length > 0, { message: "No fields to update" })
  .refine(
    (t) => !t.fromStation || !t.toStation || t.fromStation !== t.toStation,
    {
      path: ["toStation"],
      message: "Must differ from fromStation",
    },
  );

export const tripBase = z.object({
  trainId: z.uuid(),
  journeyDate: z.iso.date(), // "2026-11-12"; column is date mode:"string"
  salesOpenAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  departureTime: z.iso.time(),
  arrivalTime: z.iso.time(),
  arrivalDayOffset: z.number().int().min(0),
});

export const tripSeatBase = z.object({
  coachCode,
  coachPosition: z.number().int().positive(),
  seatNumber: z.number().int().positive(),
  seatType: z.enum(seatType.enumValues),
  price: z.number().int().nonnegative(),
});

export const insertTripSchema = tripBase
  .extend({ seats: z.array(tripSeatBase).min(1) })
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    t.seats.forEach((s, i) => {
      const key = `${s.coachCode}-${s.seatNumber}`;
      if (seen.has(key))
        ctx.addIssue({
          code: "custom",
          path: ["seats", i],
          message: `Duplicate seat ${key}`,
        });
      seen.add(key);
    });
  });

const uniqueBy = <T>(xs: T[], key: (x: T) => unknown) =>
  new Set(xs.map(key)).size === xs.length;

// Only times and coaches change after a trip is created.
// detach runs before attach, so detach "KA" + attach "KA" replaces that coach.
export const updateTripSchema = z
  .object({
    departureTime: z.iso.time(),
    arrivalTime: z.iso.time(),
    arrivalDayOffset: z.number().int().min(0),
    attach: z.array(coachSchema).min(1),
    detach: z.array(coachCode).min(1),
  })
  .partial()
  .refine((t) => Object.keys(t).length > 0, { message: "No fields to update" })
  .refine((t) => !t.attach || uniqueBy(t.attach, (c) => c.code), {
    path: ["attach"],
    message: "Duplicate coach code",
  })
  .refine((t) => !t.attach || uniqueBy(t.attach, (c) => c.position), {
    path: ["attach"],
    message: "Duplicate coach position",
  })
  .refine((t) => !t.detach || uniqueBy(t.detach, (c) => c), {
    path: ["detach"],
    message: "Duplicate coach code",
  });

export const purchaseTicketSchema = z.object({
  tripId: z.uuid(),
  seatType: z.enum(seatType.enumValues).default("s_chair"),
  coachCode,
  // one entry per seat, so seat count and name count can't disagree
  passengers: z
    .array(
      z.object({
        seatNumber: z.number().int().min(1),
        name: z.string().trim().min(1).max(100),
        email: z.email().optional(),
      }),
    )
    .min(1)
    .max(4)
    .refine(
      (p) => new Set(p.map((x) => x.seatNumber)).size === p.length,
      "Duplicate seat number",
    ),
  provider: z.enum(["bkash", "nagad", "sslcommerz"]),
});
