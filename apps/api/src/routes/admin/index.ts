import { Hono } from "hono";
import type { AppEnv } from "@acme/auth/types";
import { requireAuth, requirePermission } from "../../middleware/guard";
import { db } from "@acme/db/db";
import { user } from "@acme/db/db/schema";

export const adminRoute = new Hono<AppEnv>();

adminRoute.use(requireAuth, requirePermission({ user: ["list"] }));
adminRoute.get("/users", async (c) => {
  const allusers = await db.select().from(user);
  return c.json({ users: allusers });
});
