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
