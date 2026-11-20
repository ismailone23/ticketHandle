import { db } from "@acme/db/db";
import { coach, offDay, seatType, train } from "@acme/db/db/schema";
import {
  and,
  asc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  or,
  sql,
  SQL,
} from "drizzle-orm";

type Cursor = { number: number };
const encodeCursor = (c: Cursor) =>
  Buffer.from(JSON.stringify(c)).toString("base64url");
// cursor comes from the client: bad input returns null instead of throwing a 500
const decodeCursor = (s: string): Cursor | null => {
  try {
    const c = JSON.parse(Buffer.from(s, "base64url").toString());
    return Number.isInteger(c?.number) ? { number: c.number } : null;
  } catch {
    return null;
  }
};

export class InvalidCursorError extends Error {}

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

  // stations match case-insensitively ("dhaka" == "Dhaka")
  if (q.from) conditions.push(ilike(train.fromStation, escapeLike(q.from)));
  if (q.to) conditions.push(ilike(train.toStation, escapeLike(q.to)));
  if (q.search) {
    const byName = ilike(train.name, `%${escapeLike(q.search)}%`);
    // a numeric search like "701" also matches the train number
    conditions.push(
      /^\d{1,9}$/.test(q.search)
        ? or(byName, eq(train.number, Number(q.search)))!
        : byName,
    );
  }

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
    if (!c) throw new InvalidCursorError();
    conditions.push(gt(train.number, c.number)); // number is unique, no tiebreaker needed
  }

  const trains = await db
    .select()
    .from(train)
    .where(and(...conditions))
    .orderBy(asc(train.number))
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
        .orderBy(asc(coach.position))
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
    hasMore && last ? encodeCursor({ number: last.number }) : null;
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
    .orderBy(asc(coach.position));
  return { ...t, coaches };
};
