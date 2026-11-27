import { createMiddleware } from "hono/factory";
import { auth } from "@acme/auth";
import type { AppEnv } from "@acme/auth/types";
import { forget, memo } from "../lib/memo";

export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const cookie = c.req.header("cookie");
  // no cookie, no session: skip better-auth for anonymous calls (e.g. /stations)
  // 5s per exact cookie header: sign-out or a ban can lag 5s (cookieCache already allows 5 min)
  const key = `session:${cookie}`;
  const data = cookie
    ? await memo(key, 5000, () =>
        auth.api.getSession({ headers: c.req.raw.headers }),
      )
    : null;
  // only valid sessions stay cached, so junk cookies can't fill memory
  if (cookie && !data) forget(key);
  c.set("user", data?.user ?? null);
  c.set("session", data?.session ?? null);
  await next();
});
