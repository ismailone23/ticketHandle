import type { AppEnv } from "@acme/auth/types";
import { Hono } from "hono";
import { requireAuth, requirePermission } from "../../middleware/guard.js";
import { ticketRoute } from "./ticket.js";

export const journeyRoute = new Hono<AppEnv>();
journeyRoute.use(requireAuth, requirePermission({ ticket: ["purchase"] }));

journeyRoute.route("/ticket", ticketRoute);
