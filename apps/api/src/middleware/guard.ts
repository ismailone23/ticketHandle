import { statement, roles } from "@acme/server/auth/permissions";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types.js";

type Statement = typeof statement;
type Permissions = { [K in keyof Statement]?: Statement[K][number][] };

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (user.banned) return c.json({ error: "User banned" }, 403);
  await next();
});

export const requirePermission = (permission: Permissions) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);

    const userRole = (user.role ?? "buyer").split(
      ",",
    ) as (keyof typeof roles)[];

    const allowed = userRole.some(
      (r) => roles[r]?.authorize(permission).success,
    );

    if (!allowed) return c.json({ error: "Forbidden" }, 403);
    await next();
  });
