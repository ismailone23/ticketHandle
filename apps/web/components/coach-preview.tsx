import { RouteLine } from "@/components/route-line";
import { SEAT_LOOK, SeatLegend } from "@/components/seat-legend";
import { cn } from "@/lib/utils";

// What the product actually does, shown on the home page: one coach, live seat states,
// two seats picked. Drawn with the seat map's own styles; decorative, so hidden from AT.
type S = "free" | "booked" | "paying" | "yours";
const ROWS: S[][] = [
  ["booked", "booked", "free", "booked"],
  ["free", "booked", "paying", "paying"],
  ["booked", "free", "yours", "yours"],
  ["free", "free", "booked", "free"],
  ["booked", "free", "free", "booked"],
  ["free", "booked", "free", "free"],
];

const seat: Record<S, string> = { free: SEAT_LOOK.free, booked: SEAT_LOOK.booked, paying: SEAT_LOOK.paying, yours: SEAT_LOOK.yours };

export function CoachPreview() {
  return (
    <div className="w-full max-w-md cursor-default rounded-xl border bg-card select-none">
      <div aria-hidden className="flex flex-col gap-3 border-b p-5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Subarna Express</span>
          <span className="text-muted-foreground tabular">7:00 AM</span>
        </div>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-sm">
          <span>Dhaka</span>
          <RouteLine label="5h 05m" />
          <span>Chattogram</span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 p-5">
        <p className="text-xs text-muted-foreground">Coach KA · Shovan Chair</p>
        <div aria-hidden className="grid grid-cols-[repeat(2,2.5rem)_1.5rem_repeat(2,2.5rem)] gap-2">
          {ROWS.flatMap((row, r) =>
            row.map((s, c) => (
              <span
                key={`${r}-${c}`}
                style={{ gridColumn: c > 1 ? c + 2 : c + 1 }}
                className={cn("flex size-10 items-center justify-center rounded-md border text-sm tabular", seat[s])}
              >
                {r * 4 + c + 1}
              </span>
            )),
          )}
        </div>
        <SeatLegend className="grid grid-cols-2 gap-x-6 pt-1" />
      </div>

      <div aria-hidden className="flex items-center justify-between gap-3 border-t p-4">
        <div className="flex flex-col">
          <span className="text-sm tabular">KA-11 · KA-12</span>
          <span className="text-xs text-muted-foreground tabular">৳850.50 incl. 5% VAT</span>
        </div>
        <span className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Hold 2 seats</span>
      </div>
    </div>
  );
}
