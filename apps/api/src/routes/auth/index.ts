import { Hono } from "hono";

const authRoute = new Hono();

authRoute.get("/", (c) => {
  return c.json({ message: "auth route" });
});

export { authRoute };
