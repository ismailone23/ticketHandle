import Redis from "ioredis";
import { env } from "@acme/server/env";
import { log } from "@acme/server/log";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => log.error({ err }, "[redis]"));
