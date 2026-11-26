import { Hono } from "hono";
import type { AppEnv } from "@acme/auth/types";
import { requireAuth, requirePermission } from "../../middleware/guard";
import { db } from "@acme/db/db";
import { user } from "@acme/db/db/schema";
import { zValidator } from "@hono/zod-validator";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { trainRoute } from "./train";
import { tripRoute } from "./trip";
import { expireHolds } from "../../lib/cleanup";

export const adminRoute = new Hono<AppEnv>();

adminRoute.use(requireAuth, requirePermission({ user: ["list"] }));
adminRoute.get(
  "/users",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  ),
  async (c) => {
    const { limit, offset } = c.req.valid("query");
    const users = await db
      .select()
      .from(user)
      .orderBy(asc(user.createdAt), asc(user.id))
      .limit(limit)
      .offset(offset);
    return c.json({ users, nextOffset: users.length === limit ? offset + limit : null });
  },
);
// run the expired-hold cleanup now instead of waiting for the next minute
adminRoute.post("/cleanup/expired-holds", async (c) =>
  c.json({ data: await expireHolds() }),
);
adminRoute.route("/", trainRoute);
adminRoute.route("/", tripRoute);
