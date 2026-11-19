import { db } from "@acme/db/db";
import { coach, offDay, seatType, train } from "@acme/db/db/schema";
import { invalidateTrains, redis } from "@acme/db/redis";
import {
  and,
  asc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
  SQL,
} from "drizzle-orm";

type Cursor = { dep: string; id: string };
const encodeCursor = (c: Cursor) =>
  Buffer.from(JSON.stringify(c)).toString("base64url");
const decodeCursor = (s: string): Cursor =>
  JSON.parse(Buffer.from(s, "base64url").toString());

export type TrainQuery = {
  limit: number;
  cursor?: string;
  from?: string;
  to?: string;
  date?: string;
  seatType?: (typeof seatType.enumValues)[number];
  search?: string;
};
type OffDay = (typeof offDay.enumValues)[number];

const WEEKDAYS = [
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
] as const satisfies readonly OffDay[];

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export const getAllTrains = async (q: TrainQuery) => {
  const conditions: SQL[] = [];

  if (q.from) conditions.push(eq(train.fromStation, q.from));
  if (q.to) conditions.push(eq(train.toStation, q.to));
  if (q.search) conditions.push(ilike(train.name, `%${escapeLike(q.search)}%`));

  if (q.date) {
    const day = WEEKDAYS[new Date(q.date).getUTCDay()];
    conditions.push(
      sql`(${train.offDay} IS NULL OR ${train.offDay} <> ${day})`,
    );
  }

  if (q.seatType) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(coach)
          .where(
            and(eq(coach.trainId, train.id), eq(coach.seatType, q.seatType)),
          ),
      ),
    );
  }

  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    conditions.push(
      or(
        gt(train.departureTime, c.dep),
        and(eq(train.departureTime, c.dep), gt(train.id, c.id)),
      )!,
    );
  }

  const trains = await db
    .select()
    .from(train)
    .where(and(...conditions))
    .orderBy(asc(train.departureTime), asc(train.id))
    .limit(q.limit + 1);

  const hasMore = trains.length > q.limit;
  const page = hasMore ? trains.slice(0, q.limit) : trains;

  const coaches = page.length
    ? await db
        .select()
        .from(coach)
        .where(
          inArray(
            coach.trainId,
            page.map((t) => t.id),
          ),
        )
    : [];

  const byTrain = new Map<string, typeof coaches>();

  for (const co of coaches) {
    const list = byTrain.get(co.trainId) ?? [];
    list.push(co);
    byTrain.set(co.trainId, list);
  }

  const items = page.map((t) => ({ ...t, coaches: byTrain.get(t.id) ?? [] }));

  const last = page.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor({ dep: last.createdAt.toISOString(), id: last.id })
      : null;
  return { items, nextCursor };
};

export const getTrainByNumber = async (number: number) => {
  const [t] = await db
    .select()
    .from(train)
    .where(eq(train.number, number))
    .limit(1);
  if (!t) return null;
  const coaches = await db
    .select()
    .from(coach)
    .where(eq(coach.trainId, t.id))
    .orderBy(asc(coach.code));
  return { ...t, coaches };
};
