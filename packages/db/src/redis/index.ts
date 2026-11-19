import Redis from "ioredis";
import { env } from "@acme/server/env";
import { log } from "@acme/server/log";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

export const cached = async <T>(
  key: string,
  ttlSec: number,
  fetcher: () => Promise<T>,
): Promise<T> => {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch (err) {
    log.warn({ err, key }, "[redis] get failed, falling back to db");
  }

  const data = await fetcher();

  if (data != null) {
    redis
      .set(key, JSON.stringify(data), "EX", ttlSec)
      .catch((err) => log.warn({ err, key }, "[redis] set failed"));
  }
  return data;
};

redis.on("error", (err) => log.error({ err }, "[redis]"));

const TRAINS_VERSION_KEY = "trains:list:version";

export const getTrainsVersion = async () => {
  try {
    return (await redis.get(TRAINS_VERSION_KEY)) ?? "0";
  } catch {
    return "0";
  }
};

export const invalidateTrains = async () => {
  try {
    await redis.incr(TRAINS_VERSION_KEY);
  } catch (err) {
    log.error({ err }, "[redis] failed to invalidate trains");
  }
};
