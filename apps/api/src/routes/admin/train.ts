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
  insertTrainSchema,
  MAX_TRAIN_NUMBER,
  querySchema,
  updateTrainSchema,
} from "../../types";
import { db } from "@acme/db/db";
import { coach, train } from "@acme/db/db/schema";
import { eq } from "drizzle-orm";
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
  if (!Number.isInteger(number) || number < 1 || number > MAX_TRAIN_NUMBER)
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
