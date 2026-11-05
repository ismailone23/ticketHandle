import { Hono } from "hono";
import { cors } from "hono/cors";
import { log } from "./lib/logger.js";
const app = new Hono();

app.use("*", cors({ origin: "http://localhost:3000" }));

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

app.onError((err, c) => {
  log.error({ err, path: c.req.path }, "Unhandled Error");
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/health", (c) => {
  return c.json({ message: "Service is running", status: "OK" });
});

export type AppType = typeof app;

const serve = Bun.serve({
  port: process.env.PORT || 5030,
  fetch: app.fetch,
});

let shuttingDown = false;

// grace shutdown so that when the server is stopped no request got hamperred
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "Shutting down");

  const timer = setTimeout(() => {
    log.fatal("Shutdown time out, forcing exit");
    exit(1);
  }, 10_000);

  try {
    await serve.stop();

    clearTimeout(timer);
    log.info({ signal }, "Shutdown complete");
    exit(0);
  } catch (err) {
    log.error({ err }, "Error during shutdown");
    exit(1);
  }
}

function exit(code: number) {
  log.flush(() => process.exit(code));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default {
  port: process.env.PORT || 5030,
  fetch: app.fetch,
};
