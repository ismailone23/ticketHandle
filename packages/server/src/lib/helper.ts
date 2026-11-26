export const isUniqueViolation = (err: unknown, constraint?: string) => {
  const e = ((err as any)?.cause ?? err) as Record<string, unknown>; // Drizzle wraps driver errors in .cause
  const isUnique = e?.code === "23505" || e?.errno === "23505";
  const name = e?.constraint_name ?? e?.constraint;
  return isUnique && (!constraint || name === constraint);
};
export const pgError = (err: unknown, code: string, constraint?: string) => {
  const e = ((err as any)?.cause ?? err) as Record<string, unknown>;
  const matches = e?.code === code || e?.errno === code;
  const name = e?.constraint_name ?? e?.constraint;
  return matches && (!constraint || name === constraint);
};
export const tripDbError = (err: unknown) => {
  // 23P01 = exclusion violation (see the trip_no_overlap migration)
  if (pgError(err, "23P01", "trip_no_overlap"))
    return {
      error: "This train already has a trip running during that time",
      status: 409,
    } as const;
  if (pgError(err, "23514", "trip_arrival_after_departure"))
    return { error: "Arrival must be after departure", status: 400 } as const;
  if (isUniqueViolation(err, "trip_seat_position_uq"))
    return { error: "Duplicate seat in this trip", status: 409 } as const;
  // 23503 = foreign key: the trainId doesn't exist
  if (pgError(err, "23503", "trip_train_id_train_id_fkey"))
    return { error: "Train not found", status: 404 } as const;
  return null;
};
