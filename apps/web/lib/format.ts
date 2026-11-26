import type { SeatType } from "./api";

export const CLASS_NAMES: Record<SeatType, string> = {
  s_chair: "Shovan Chair",
  snigdha: "Snigdha",
  ac_s: "AC Seat",
  ac_c: "AC Cabin",
};

// prices are poisha
export const taka = (poisha: number) =>
  `৳${(poisha / 100).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;

// "14:05:00" → "2:05 PM"
export const clock = (time: string) => {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export const longDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// same tiers as the API's refund.ts; shown before the user confirms
export const refundPercent = (journeyDate: string, departureTime: string) => {
  const hours =
    (new Date(`${journeyDate}T${departureTime}+06:00`).getTime() - Date.now()) /
    3_600_000;
  if (hours >= 48) return 90;
  if (hours >= 36) return 80;
  if (hours >= 24) return 70;
  if (hours >= 12) return 50;
  if (hours >= 6) return 20;
  return 0;
};

export const todayInDhaka = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(
    new Date(),
  );

// only same-site paths: "//evil.com" and "https://…" would leave the site after login
export const safeNext = (raw: string | null) => (raw?.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/");
