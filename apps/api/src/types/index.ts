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
export const coachSchema = z.object({
  code: z.string().min(1),
  seatType: z.enum(seatType.enumValues),
  seatCount: z.number().int().positive(),
  price: z.number().int().nonnegative(),
});

export const trainBase = z.object({
  number: z.number().int().positive(),
  name: z.string().trim().min(1),
  fromStation: z.string().trim().min(1),
  toStation: z.string().trim().min(1),
  departureTime: z.iso.time(),
  arrivalTime: z.iso.time(),
  arrivalDayOffset: z.number().int().min(0),
  offDay: z.enum(offDay.enumValues).nullable(),
});

export const insertTrainSchema = trainBase
  .extend({
    arrivalDayOffset: trainBase.shape.arrivalDayOffset.default(0),
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
  });

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
