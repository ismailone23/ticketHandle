import type { AppEnv } from "@acme/auth/types";
import { Hono } from "hono";
import {
  cached,
  getTrainsVersion,
  invalidateTrains,
  redis,
} from "@acme/db/redis";
import {
  getAllTrains,
  getTrainByNumber,
  InvalidCursorError,
} from "@acme/server/services";
import * as z from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  faresSchema,
  insertTrainSchema,
  querySchema,
  updateTrainSchema,
} from "../../types";
import { db } from "@acme/db/db";
import { coach, train, trip, tripSeat } from "@acme/db/db/schema";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { isUniqueViolation, pgError } from "@acme/server/lib";
import { log } from "@acme/server/log";
export const trainRoute = new Hono<AppEnv>();

trainRoute.get("/all-trains", zValidator("query", querySchema), async (c) => {
  const q = c.req.valid("query");
  const key = `trains:list:v${await getTrainsVersion()}:${JSON.stringify(q)}`;
  const result = await cached(key, 300, () => getAllTrains(q)).catch((e) => {
    if (e instanceof InvalidCursorError) return null;
    throw e;
  });
  if (!result) return c.json({ error: "Invalid cursor" }, 400);
  return c.json({ data: result.items, nextCursor: result.nextCursor });
});

trainRoute.get("/trains/number/:number", async (c) => {
  const number = Number(c.req.param("number"));
  // read any stored train (older rows may exceed the create limit); only stay inside Postgres int
  if (!Number.isInteger(number) || number < 1 || number > 2_147_483_647)
    return c.json({ error: "Invalid number" }, 400);

  const data = await cached(`train:number:${number}`, 300, () =>
    getTrainByNumber(number),
  );
  return data ? c.json({ data }) : c.json({ error: "Not found" }, 404);
});

trainRoute.post(
  "/new-train",
  zValidator("json", insertTrainSchema),
  async (c) => {
    const { coach: coaches, ...trainData } = c.req.valid("json");
    try {
      const created = await db.transaction(async (tx) => {
        const [newTrain] = await tx.insert(train).values(trainData).returning();
        if (!newTrain) new Error("Train insert retruned nothing!");

        const newCoaches = await tx
          .insert(coach)
          .values(coaches.map((c) => ({ ...c, trainId: newTrain.id })))
          .returning();
        return { ...newTrain, coaches: newCoaches };
      });
      await invalidateTrains();
      return c.json({ data: created }, 201);
    } catch (err) {
      if (isUniqueViolation(err, "train_number_uq")) {
        return c.json(
          { error: `Train number ${trainData.number} already exists` },
          409,
        );
      }
      throw err;
    }
  },
);

trainRoute.put(
  "/update-train/:trainId",
  zValidator("param", z.object({ trainId: z.uuid() })),
  zValidator("json", updateTrainSchema),
  async (c) => {
    const { trainId } = c.req.valid("param");
    const data = c.req.valid("json");

    try {
      const result = await db.transaction(async (tx) => {
        const [old] = await tx
          .select({ number: train.number })
          .from(train)
          .where(eq(train.id, trainId))
          .for("update");

        if (!old) return null;

        const [updated] = await tx
          .update(train)
          .set(data)
          .where(eq(train.id, trainId))
          .returning();
        return { oldNumber: old.number, updated: updated! };
      });

      if (!result) return c.json({ error: "Train not found" }, 404);
      await invalidateTrains();
      await redis
        .del(`train:number:${result.oldNumber}`)
        .catch((err) => log.warn({ err }, "[redis] del failed"));
      return c.json({ data: result.updated });
    } catch (err) {
      if (pgError(err, "23505", "train_number_uq")) {
        return c.json(
          { error: `Train number ${data.number} already exists` },
          409,
        );
      }
      if (pgError(err, "23514", "train_route_valid")) {
        return c.json({ error: "fromStation and toStation must differ" }, 400);
      }
      throw err;
    }
  },
);

// only a train nothing points at: trips (and their orders and tickets) keep a reference to it
trainRoute.delete(
  "/trains/:trainId",
  zValidator("param", z.object({ trainId: z.uuid() })),
  async (c) => {
    const { trainId } = c.req.valid("param");
    const result = await db.transaction(async (tx) => {
      // row lock: a trip being added right now waits on it, so it can't slip in after the check
      const [t] = await tx.select({ number: train.number }).from(train).where(eq(train.id, trainId)).for("update");
      if (!t) return { error: "Train not found", status: 404 } as const;
      const [used] = await tx.select({ n: count() }).from(trip).where(eq(trip.trainId, trainId));
      if (used!.n)
        return { error: `This train has ${used!.n} ${used!.n === 1 ? "trip" : "trips"} on record, so it can't be deleted`, status: 409 } as const;
      await tx.delete(train).where(eq(train.id, trainId)); // coaches go with it (cascade)
      return { number: t.number };
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    await invalidateTrains();
    await redis.del(`train:number:${result.number}`).catch((err) => log.warn({ err }, "[redis] del failed"));
    return c.json({ data: { deleted: true } });
  },
);

// New fares apply to future trips (seats copy the coach fare) and to unsold seats on upcoming
// trips. Held or sold seats keep the price the customer already saw.
trainRoute.put(
  "/trains/:trainId/fares",
  zValidator("param", z.object({ trainId: z.uuid() })),
  zValidator("json", faresSchema),
  async (c) => {
    const { trainId } = c.req.valid("param");
    const { fares } = c.req.valid("json");
    const result = await db.transaction(async (tx) => {
      let repriced = 0;
      for (const f of fares) {
        const [k] = await tx
          .update(coach)
          .set({ price: f.price })
          .where(and(eq(coach.trainId, trainId), eq(coach.code, f.code)))
          .returning({ code: coach.code });
        if (!k) return { error: `Coach ${f.code} is not on this train`, status: 404 } as const;
        const seats = await tx
          .update(tripSeat)
          .set({ price: f.price })
          .where(
            and(
              eq(tripSeat.coachCode, f.code),
              eq(tripSeat.status, "available"),
              inArray(
                tripSeat.tripId,
                tx
                  .select({ id: trip.id })
                  .from(trip)
                  .where(
                    and(
                      eq(trip.trainId, trainId),
                      eq(trip.status, "scheduled"),
                      sql`(${trip.journeyDate} + ${trip.departureTime}) at time zone 'Asia/Dhaka' > now()`,
                    ),
                  ),
              ),
            ),
          )
          .returning({ id: tripSeat.id });
        repriced += seats.length;
      }
      const [t] = await tx.select({ number: train.number }).from(train).where(eq(train.id, trainId));
      return { coaches: fares.length, seatsRepriced: repriced, number: t!.number };
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    await invalidateTrains();
    await redis.del(`train:number:${result.number}`).catch((err) => log.warn({ err }, "[redis] del failed"));
    return c.json({ data: { coaches: result.coaches, seatsRepriced: result.seatsRepriced } });
  },
);
