import Redis from "ioredis";
import { env } from "../env";
import { log } from "../lib/logger";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => log.error({ err }, "[redis]"));
