import { Hono } from "hono";
import { cors } from "hono/cors";
import { log } from "@acme/server/log";
import { env } from "@acme/server/env";
import { auth } from "@acme/server/auth";
import { sessionMiddleware } from "./middleware/session.js";
import { eventRoute } from "./routes/event/index.js";
import { me } from "./routes/me.js";
const app = new Hono();

app.use(
  "*",
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  log.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Math.round(performance.now() - start),
  });
});

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.onError((err, c) => {
  log.error({ err, path: c.req.path }, "Unhandled Error");
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/ping", (c) => {
  return c.json({ message: "Service is running", status: "OK" });
});

app.use("/api/*", sessionMiddleware);
const routes = app.route("/event", eventRoute).route("/me", me);
app.notFound((c) => c.json({ error: "Not Found" }, 404));

export type AppType = typeof routes;
export default app;
