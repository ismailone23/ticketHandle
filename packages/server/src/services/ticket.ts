import { db } from "@acme/db/db";
import { offDay, train, trip } from "@acme/db/db/schema";
import { and, eq, inArray, isNull, ne, not, or } from "drizzle-orm";

export const getAvailableTrain = async ({
  fromStation,
  toStation,
  journeyDate,
}: {
  fromStation: string;
  toStation: string;
  journeyDate: string;
}) => {
  const day = offDay.enumValues[new Date(journeyDate).getUTCDay()]!;

  const availableTrain = await db
    .select()
    .from(train)
    .where(
      and(
        eq(train.fromStation, fromStation),
        eq(train.toStation, toStation),
        or(isNull(train.offDay), ne(train.offDay, day)),
      ),
    );
  const tripsOfAvailableTrains = await db
    .select()
    .from(trip)
    .where(
      and(
        eq(trip.journeyDate, journeyDate),
        eq(trip.status, "scheduled"),
        inArray(
          trip.trainId,
          availableTrain.map((t) => t.id),
        ),
      ),
    );
  return { tripsOfAvailableTrains, availableTrain };
};
