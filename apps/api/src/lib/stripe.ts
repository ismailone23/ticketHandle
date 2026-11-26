import Stripe from "stripe";
import { env } from "@acme/server/env";

// null until STRIPE_SECRET_KEY is set
export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;
