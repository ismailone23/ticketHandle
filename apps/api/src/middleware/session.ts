import { createMiddleware } from "hono/factory";
import { auth } from "@acme/auth";
import type { AppEnv } from "@acme/auth/types";

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const data = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", data?.user ?? null);
  c.set("session", data?.session ?? null);
  await next();
});
