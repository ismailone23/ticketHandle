import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import { relations } from "./relations";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle({ client: pool, relations });
export type DB = typeof db;
