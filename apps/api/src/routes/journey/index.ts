import type { AppEnv } from "@acme/auth/types";
import { db } from "@acme/db/db";
import { train } from "@acme/db/db/schema";
import { cached, getTrainsVersion } from "@acme/db/redis";
import { Hono } from "hono";
import { requireAuth, requirePermission } from "../../middleware/guard.js";
import { ticketRoute } from "./ticket.js";

export const journeyRoute = new Hono<AppEnv>();

// public, registered before the auth guard: station names for the search box
journeyRoute.get("/ticket/stations", async (c) => {
  const data = await cached(`stations:v${await getTrainsVersion()}`, 3600, async () => {
    const rows = await db
      .selectDistinct({ name: train.fromStation })
      .from(train)
      .union(db.selectDistinct({ name: train.toStation }).from(train));
    return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
  });
  return c.json({ data });
});

journeyRoute.use(requireAuth, requirePermission({ ticket: ["purchase"] }));

journeyRoute.route("/ticket", ticketRoute);
