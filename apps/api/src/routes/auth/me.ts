import { Hono } from "hono";
import { requireAuth } from "../../middleware/guard.js";
import type { AppEnv } from "../../types.js";

export const me = new Hono<AppEnv>().get("/", requireAuth, (c) => {
  const user = c.get("user")!;
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
});
