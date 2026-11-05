import type { Session } from "@acme/server/auth";

export type AppEnv = {
  Variables: {
    user: Session["user"] | null;
    session: Session["session"] | null;
  };
};
