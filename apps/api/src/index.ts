import { Hono } from "hono";
import { cors } from "hono/cors";
const app = new Hono();

app.use("*", cors({ origin: "http://localhost:3000" }));

app.get("/", (c) => {
  return c.json({ message: "Hello World!" });
});

export type AppType = typeof app;

export default {
  port: process.env.PORT || 5030,
  fetch: app.fetch,
};
