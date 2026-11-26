import { Hono } from "hono";
import type { AppEnv } from "@acme/auth/types";
import { requireAuth, requirePermission } from "../../middleware/guard";
import { db } from "@acme/db/db";
import { user } from "@acme/db/db/schema";
import { trainRoute } from "./train";
import { tripRoute } from "./trip";
import { expireHolds } from "../../lib/cleanup";

export const adminRoute = new Hono<AppEnv>();

adminRoute.use(requireAuth, requirePermission({ user: ["list"] }));
adminRoute.get("/users", async (c) => {
  const allusers = await db.select().from(user);
  return c.json({ users: allusers });
});
// run the expired-hold cleanup now instead of waiting for the next minute
adminRoute.post("/cleanup/expired-holds", async (c) =>
  c.json({ data: await expireHolds() }),
);
adminRoute.route("/", trainRoute);
adminRoute.route("/", tripRoute);
