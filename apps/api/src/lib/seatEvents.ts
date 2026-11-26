import { redis } from "@acme/db/redis";
import { log } from "@acme/server/log";

export type SeatStatus = "available" | "in_progress" | "booked";
export type SeatChange = {
  coachCode: string;
  seatNumber: number;
  seatType: string;
  status: SeatStatus;
  until: string | null; // in_progress: hold expiry
};

const channel = (tripId: string) => `seats:${tripId}`;

// call after commit, never inside a transaction
export const publishSeats = (tripId: string, seats: SeatChange[]) =>
  redis
    .publish(channel(tripId), JSON.stringify(seats))
    .catch((err) => log.warn({ err, tripId }, "[seats] publish failed"));

// one Redis subscriber per worker; a trip is subscribed while someone watches it
type Listener = (seats: SeatChange[]) => void;
const watched = new Map<string, { listeners: Set<Listener>; ready: Promise<unknown> }>();
let sub: ReturnType<typeof redis.duplicate> | undefined;

// resolves once subscribed; returns an unsubscribe fn
export const watchSeats = async (tripId: string, fn: Listener) => {
  if (!sub) {
    sub = redis.duplicate();
    sub.on("message", (ch: string, msg: string) => {
      const entry = watched.get(ch.slice("seats:".length));
      if (!entry) return;
      const seats = JSON.parse(msg) as SeatChange[];
      for (const l of entry.listeners) l(seats);
    });
  }
  let entry = watched.get(tripId);
  if (!entry) {
    entry = { listeners: new Set(), ready: sub.subscribe(channel(tripId)) };
    watched.set(tripId, entry);
  }
  entry.listeners.add(fn);
  await entry.ready;

  return () => {
    entry.listeners.delete(fn);
    if (entry.listeners.size === 0) {
      watched.delete(tripId);
      sub?.unsubscribe(channel(tripId)).catch(() => {});
    }
  };
};
