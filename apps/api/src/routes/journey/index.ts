import type { AppEnv } from "@acme/auth/types";
import { Hono } from "hono";
import { requireAuth, requirePermission } from "../../middleware/guard.js";
import { tripRoute } from "./trip.js";

export const journeyRoute = new Hono<AppEnv>();

journeyRoute.use(requireAuth, requirePermission({ event: ["create"] }));

journeyRoute.route("/trip", tripRoute);
