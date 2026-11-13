import { Hono } from "hono";
import type { AppEnv } from "@acme/auth/types";
import { getRouterName } from "hono/dev";

export const route = new Hono<AppEnv>();

route.post("/");
