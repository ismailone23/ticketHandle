// "YYYY-MM-DD" arithmetic in UTC, so the local timezone never shifts a date
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const WEEKDAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// the day after the last trip (never before today), skipping the train's off day
export const nextServiceDate = (lastDate: string, offDay: string | null, today: string) => {
  let d = addDays(lastDate, 1);
  if (d < today) d = today;
  if (offDay && WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()] === offDay) d = addDays(d, 1);
  return d;
};

export const SALES_WINDOW_DAYS = 10;

// tickets go on sale at 12:00 AM Dhaka time, 10 days before the journey
export const salesOpenFor = (journeyDate: string) => `${addDays(journeyDate, -SALES_WINDOW_DAYS)}T00:00:00+06:00`;
