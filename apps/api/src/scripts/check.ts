import { pool } from "@acme/server/db";
import { log } from "@acme/server/log";
import { redis } from "@acme/server/redis";

const pg = await pool.query("select now()");

log.info({ info: pg.rows[0].now }, "Postgres");
log.info({ info: await redis.ping() }, "Redis");

await pool.end();
redis.disconnect();
