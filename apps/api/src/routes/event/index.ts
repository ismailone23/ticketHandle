import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../../types.js";
import { requirePermission } from "../../middleware/guard.js";

const createEvent = z.object({
  name: z.string().min(3),
  seats: z.number().int().positive(),
});

export const eventRoute = new Hono<AppEnv>()
  .get("/", (c) => c.json({ events: [] }))
  .post(
    "/",
    requirePermission({ event: ["create"] }),
    zValidator("json", createEvent),
    (c) => {
      const body = c.req.valid("json");
      return c.json({ created: body, by: c.get("user")!.id }, 201);
    },
  );
