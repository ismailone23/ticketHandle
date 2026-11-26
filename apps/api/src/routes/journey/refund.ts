// hours before departure → refund %
const TIERS = [
  { minHours: 48, percent: 90 },
  { minHours: 36, percent: 80 },
  { minHours: 24, percent: 70 },
  { minHours: 12, percent: 50 },
  { minHours: 6, percent: 20 },
] as const;

export const refundPercent = (hoursLeft: number) =>
  TIERS.find((t) => hoursLeft >= t.minHours)?.percent ?? 0;

// Dhaka is always +06:00 (no DST)
export const departureAt = (journeyDate: string, departureTime: string) =>
  new Date(`${journeyDate}T${departureTime}+06:00`);
