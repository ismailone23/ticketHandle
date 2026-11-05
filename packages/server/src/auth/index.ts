import { betterAuth } from "better-auth";
import { env } from "../env";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db";
import * as schema from "../db/schema";
import { redis } from "../redis";
import { admin as adminPlugin, emailOTP } from "better-auth/plugins";
import { otpEmail, sendEmail } from "../email";
import { log } from "../lib/logger";
import { ac, roles } from "./permissions";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],

  database: drizzleAdapter(db, { provider: "pg", schema }),

  secondaryStorage: {
    get: (key) => redis.get(key),
    set: async (key, value, ttl) => {
      if (ttl) await redis.set(key, value, "EX", ttl);
      else await redis.set(key, value);
    },
    getAndDelete: (key) => redis.getdel(key),
    // INCR + EXPIRE-on-create in one script so the window is fixed and atomic
    increment: async (key, ttl) =>
      Number(
        await redis.eval(
          "local v=redis.call('INCR',KEYS[1]) if v==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end return v",
          1,
          key,
          ttl,
        ),
      ),
    delete: async (key) => {
      await redis.del(key);
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  rateLimit: {
    enabled: true,
    storage: "secondary-storage",
    window: 60,
    max: 100,
    customRules: {
      "/auth/sign-in/email": { window: 60, max: 5 },
      "/auth/sign-up/email": { window: 60, max: 3 },
      "/auth/email-otp/send-verification-otp": { window: 60, max: 3 },
    },
  },

  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 5 * 60,
      allowedAttempts: 3,
      sendVerificationOnSignUp: true,
      overrideDefaultEmailVerification: true,
      async sendVerificationOTP({ email, otp, type }) {
        const mail = otpEmail(otp, type);
        void sendEmail({ to: email, ...mail }).catch((err) => {
          log.error({ err }, "[otp]");
        });
      },
    }),
    adminPlugin({
      ac,
      roles,
      defaultRole: "buyer",
      adminRoles: ["admin"],
    }),
  ],
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session["user"];
