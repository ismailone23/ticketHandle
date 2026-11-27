export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5030";
const BASE = `${API_URL}/api/journey/ticket`;

// validation failures arrive as a zod error whose message is a JSON list of issues
export const errorText = (e: unknown): string => {
  if (typeof e === "string") return e;
  try {
    const [first] = JSON.parse((e as { message: string }).message) as {
      path: (string | number)[];
      message: string;
    }[];
    if (first)
      return first.path.length
        ? `${first.path.join(".")}: ${first.message}`
        : first.message;
  } catch {}
  return "Something went wrong";
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// every journey route needs the session cookie from the API's domain
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  // "/api/..." paths (admin) go to the API root, the rest to the ticket routes
  const res = await fetch(
    path.startsWith("/api/") ? API_URL + path : BASE + path,
    {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...init.headers },
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, errorText(body.error));
  return body.data as T;
}

export const seatStreamUrl = (tripId: string, seatType?: string) =>
  `${BASE}/trips/${tripId}/seats/stream${seatType ? `?seatType=${seatType}` : ""}`;

export type SeatType = "s_chair" | "snigdha" | "ac_s" | "ac_c";
export type SeatStatus = "available" | "in_progress" | "booked";
export type Seat = {
  coachCode: string;
  seatNumber: number;
  seatType: SeatType;
  coachPosition: number;
  price: number;
  status: SeatStatus;
  until: string | null;
};
// seat map as the API sends it (see packSeats in the API); unpackSeats turns it back into Seat[]
export type PackedCoach = {
  coach: string;
  type: SeatType;
  position: number;
  price: number;
  seats: [number, 0 | 1 | 2, string?][];
};
const STATUSES: SeatStatus[] = ["available", "in_progress", "booked"];
export const unpackSeats = (coaches: PackedCoach[]): Seat[] =>
  coaches.flatMap((c) =>
    c.seats.map(([seatNumber, status, until]) => ({
      coachCode: c.coach,
      seatType: c.type,
      coachPosition: c.position,
      price: c.price,
      seatNumber,
      status: STATUSES[status]!,
      until: until ?? null,
    })),
  );

export type SearchResult = {
  train: {
    id: string;
    number: number;
    name: string;
    fromStation: string;
    toStation: string;
  };
  trip: {
    id: string;
    journeyDate: string;
    departureTime: string;
    arrivalTime: string;
    arrivalDayOffset: number;
  };
  classes: { seatType: SeatType; available: number; fromPrice: number }[];
};
export type Passenger = {
  coachCode: string;
  seatNumber: number;
  name: string;
  email?: string;
};
export type Order = {
  id: string;
  status: "pending" | "paid" | "cancelled" | "expired" | "refunded";
  totalAmount: number;
  refundAmount: number | null;
  expiresAt: string;
  passengers: Passenger[];
  ticketCode: string | null;
  ticketStatus: "valid" | "used" | "cancelled" | null;
  journeyDate: string;
  departureTime: string;
  trainName: string;
  trainNumber: number;
  fromStation: string;
  toStation: string;
};

export type Coach = {
  code: string;
  position: number;
  seatType: SeatType;
  seatCount: number;
  price: number;
};
export type Train = {
  id: string;
  number: number;
  name: string;
  fromStation: string;
  toStation: string;
  offDay: string | null;
  coaches: Coach[];
};
export type AdminTrip = {
  id: string;
  journeyDate: string;
  departureTime: string;
  arrivalTime: string;
  arrivalDayOffset: number;
  salesOpenAt: string;
  status: "scheduled" | "cancelled" | "departed" | "completed";
  seats: number;
  booked: number;
  held: number;
};
