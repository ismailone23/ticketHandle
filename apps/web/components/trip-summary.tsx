import type { Order } from "@/lib/api";
import { clock, longDate } from "@/lib/format";

export function TripSummary({ order }: { order: Order }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">
        {order.fromStation} → {order.toStation}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {order.trainName}{" "}
        <span className="font-mono text-base font-normal text-muted-foreground">
          #{order.trainNumber}
        </span>
      </h1>
      <p className="font-mono text-sm tabular">
        {longDate(order.journeyDate)} · {clock(order.departureTime)}
      </p>
    </div>
  );
}
