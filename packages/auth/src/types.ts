import type { Session } from "./index";

export type AppEnv = {
  Variables: {
    user: Session["user"] | null;
    session: Session["session"] | null;
  };
};
