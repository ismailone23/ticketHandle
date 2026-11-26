// Prepare logged-in users for a load test, without the HTTP sign-in rate limit.
//   bun --env-file=../../.env src/scripts/load-users.ts 5000      -> ../../load/users.json
//   bun --env-file=../../.env src/scripts/load-users.ts --clean   -> removes them and their orders
import { auth } from "@acme/auth";
import { db, pool } from "@acme/db/db";
import { user } from "@acme/db/db/schema";
import { redis } from "@acme/db/redis";
import { eq } from "drizzle-orm";

const PREFIX = "load-";
const DOMAIN = "@example.test";
const OUT = new URL("../../../../load/users.json", import.meta.url).pathname;

if (process.argv[2] === "--clean") {
  const ids = (await pool.query(`select id from "user" where email like $1`, [`${PREFIX}%${DOMAIN}`])).rows.map((r) => r.id);
  const c = await pool.connect();
  try {
    await c.query("begin");
    const orders = (await c.query(`select id from "order" where user_id = any($1)`, [ids])).rows.map((r) => r.id);
    // seats they held go back on sale
    await c.query(`update trip_seat set status='available', order_id=null, reserved_until=null where order_id = any($1)`, [orders]);
    await c.query(`delete from ticket where order_id = any($1)`, [orders]);
    await c.query(`delete from payment where order_id = any($1)`, [orders]);
    await c.query(`delete from "order" where id = any($1)`, [orders]);
    await c.query(`delete from "user" where id = any($1)`, [ids]); // sessions and accounts cascade
    await c.query("commit");
    console.log(`removed ${ids.length} users, ${orders.length} orders`);
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  await redis.quit();
  await pool.end();
  process.exit(0);
}

const n = Number(process.argv[2] ?? 100);
const password = "load-test-password";
const cookies: string[] = [];

const one = async (i: number) => {
  const email = `${PREFIX}${i}${DOMAIN}`;
  await auth.api.signUpEmail({ body: { email, password, name: `Load ${i}` } }).catch(() => {}); // exists already: fine
  await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (!res.ok) throw new Error(`sign-in ${email}: ${res.status}`);
  cookies.push(res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "));
};

// password hashing is the slow part; 32 at a time keeps every core busy
for (let i = 0; i < n; i += 32) {
  await Promise.all(Array.from({ length: Math.min(32, n - i) }, (_, k) => one(i + k)));
  if ((i / 32) % 20 === 0) console.log(`${Math.min(i + 32, n)} / ${n}`);
}
await Bun.write(OUT, JSON.stringify(cookies));
console.log(`wrote ${cookies.length} sessions to ${OUT}`);
await redis.quit();
await pool.end();
process.exit(0);
