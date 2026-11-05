import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRoute } from "./routes/auth/index.js";
import { log } from "@acme/server/log";
import app from "./app.js";

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
  fetch: app.fetch,
  port: process.env.PORT || 5030,
};
