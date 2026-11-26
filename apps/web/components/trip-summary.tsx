import { RouteLine } from "@/components/route-line";
import type { Order } from "@/lib/api";
import { clock, longDate } from "@/lib/format";

// one heading for a trip everywhere: route, train, then date and time on their own line
export function TripHeading(p: { from: string; to: string; name: string; number: number | string; date: string; time: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid max-w-xs grid-cols-[auto_1fr_auto] items-center gap-3 text-sm text-muted-foreground">
        <span>{p.from}</span>
        <RouteLine />
        <span>{p.to}</span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        {p.name} <span className="text-base font-normal text-muted-foreground">#{p.number}</span>
      </h1>
      <p className="text-sm tabular">
        {longDate(p.date)} · {clock(p.time)}
      </p>
    </div>
  );
}

export function TripSummary({ order }: { order: Order }) {
  return (
    <TripHeading
      from={order.fromStation}
      to={order.toStation}
      name={order.trainName}
      number={order.trainNumber}
      date={order.journeyDate}
      time={order.departureTime}
    />
  );
}
