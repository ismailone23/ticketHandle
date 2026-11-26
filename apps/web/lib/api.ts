export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5030";
const BASE = `${API_URL}/api/journey/ticket`;

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
  const res = await fetch(BASE + path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(res.status, body.error ?? "Something went wrong");
  return body.data as T;
}

export const seatStreamUrl = (tripId: string, seatType: string) =>
  `${BASE}/trips/${tripId}/seats/stream?seatType=${seatType}`;

export type SeatType = "s_chair" | "snigdha" | "ac_s" | "ac_c";
export type SeatStatus = "available" | "in_progress" | "booked";
export type Seat = {
  coachCode: string;
  seatNumber: number;
  seatType: SeatType;
  price: number;
  status: SeatStatus;
  until: string | null;
};
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
