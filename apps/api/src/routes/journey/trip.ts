import { Hono } from "hono";
import type { AppEnv } from "@acme/auth/types";

export const tripRoute = new Hono<AppEnv>();

tripRoute.post("/", async (c) => {});
