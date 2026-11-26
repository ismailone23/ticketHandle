import { cn } from "@/lib/utils";

// The four ways a seat can look, shared by the real seat map and the home preview
export const SEAT_LOOK = {
  free: "bg-background",
  yours: "border-primary bg-primary text-primary-foreground",
  paying: "border-dashed text-muted-foreground",
  booked: "border-transparent bg-muted text-muted-foreground/60 line-through",
} as const;

const ITEMS: [keyof typeof SEAT_LOOK, string][] = [
  ["free", "Free"],
  ["yours", "Your pick"],
  ["paying", "Someone is paying"],
  ["booked", "Booked"],
];

// each swatch is a tiny seat with a number, so "crossed out" reads as booked without explanation
export function SeatLegend({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground", className)}>
      {ITEMS.map(([look, label]) => (
        <li key={look} className="flex items-center gap-1.5">
          <span className={cn("flex size-5 items-center justify-center rounded border text-[10px] tabular", SEAT_LOOK[look])} aria-hidden>
            7
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
