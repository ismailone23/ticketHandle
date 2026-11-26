import cluster from "node:cluster";
import os from "node:os";
import { log } from "@acme/server/log";

// Half the threads in production (the rest go to Postgres/Redis on the same box); dev stays
// single-process so `bun --hot` works. WORKERS overrides it, e.g. WORKERS=1 for a single-core test.
const workers =
  Number(process.env.WORKERS) ||
  (process.env.NODE_ENV === "production"
    ? Math.max(1, Math.floor(os.availableParallelism() / 2))
    : 1);

if (cluster.isPrimary && workers > 1) {
  let shuttingDown = false;

  for (let i = 0; i < workers; i++) cluster.fork();

  cluster.on("exit", (worker, code) => {
    if (shuttingDown) {
      if (Object.keys(cluster.workers ?? {}).length === 0) process.exit(0);
      return;
    }
    // shortcut: restarts forever on crash loops (e.g. bad env), add backoff if that bites
    log.error({ pid: worker.process.pid, code }, "Worker died, restarting");
    cluster.fork();
  });

  // Workers do their own graceful shutdown; primary just forwards the signal.
  const stop = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal, workers }, "Primary shutting down workers");
    for (const w of Object.values(cluster.workers ?? {}))
      w?.process.kill(signal);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  log.info({ workers }, "Primary started");
} else {
  // Imported here so the primary never opens DB/Redis connections.
  const { default: app } = await import("./app.js");
  const { startCleanup } = await import("./lib/cleanup.js");
  startCleanup();

  const serve = Bun.serve({
    port: process.env.PORT || 5030,
    reusePort: true, // lets every worker bind the same port; Linux kernel load-balances
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
}
