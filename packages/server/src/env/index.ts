import { z } from "zod";
import { log } from "../lib/logger";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Tickets <onboarding@resend.dev>"),
  PORT: z.coerce.number().default(3000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  log.error({ err: "Invalid environment variable" }, "[env]");
  log.error({ err: parsed.error }, "[env]");
  process.exit(1);
}

export const env = parsed.data;
