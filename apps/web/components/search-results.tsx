"use client";

import { TrainFrontIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { RouteLine } from "@/components/route-line";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/components/session-provider";
import { type ApiError, type SearchResult, type SeatType } from "@/lib/api";
import { CLASS_NAMES, clock, longDate, taka } from "@/lib/format";
import { cn } from "@/lib/utils";

const CLASS_ORDER = Object.keys(CLASS_NAMES) as SeatType[];

const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
const duration = (trip: SearchResult["trip"]) => {
  const total =
    minutes(trip.arrivalTime) +
    trip.arrivalDayOffset * 1440 -
    minutes(trip.departureTime);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
};

export function SearchResults() {
  const { request } = useSession();
  const params = useSearchParams();
  const from = params.get("from");
  const to = params.get("to");
  const date = params.get("date");
  const seatType = (params.get("class") ?? "s_chair") as SeatType;
  const [state, setState] = useState<{
    data?: SearchResult[];
    error?: string;
    loading: boolean;
  }>({ loading: false });

  useEffect(() => {
    if (!from || !to || !date) return;
    setState({ loading: true });
    const q = new URLSearchParams({
      journeyDate: date,
      fromStation: from,
      toStation: to,
    });
    request<SearchResult[]>(`/search?${q}`)
      .then((data) => setState({ data, loading: false }))
      .catch((e: ApiError) => setState({ error: e.message, loading: false }));
  }, [from, to, date, request]);

  if (!from || !to || !date) return null;

  if (state.loading)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );

  if (state.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Search failed</AlertTitle>
        <AlertDescription>{state.error}</AlertDescription>
      </Alert>
    );

  if (!state.data?.length)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TrainFrontIcon />
          </EmptyMedia>
          <EmptyTitle>No trains on {longDate(date)}</EmptyTitle>
          <EmptyDescription>
            Nothing runs from {from} to {to} that day, or every train has
            already left. Try another date.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  return (
    <section className="flex flex-col gap-3" aria-label="Trains">
      <p className="text-sm text-muted-foreground">
        {state.data.length} {state.data.length === 1 ? "train" : "trains"}
      </p>
      {state.data.map(({ train, trip, classes }) => {
        const ordered = [...classes].sort(
          (a, b) =>
            Number(b.seatType === seatType) - Number(a.seatType === seatType) ||
            CLASS_ORDER.indexOf(a.seatType) - CLASS_ORDER.indexOf(b.seatType),
        );
        const link = (t: SeatType) =>
          `/trips/${trip.id}?${new URLSearchParams({
            class: t,
            train: train.name,
            num: String(train.number),
            from: train.fromStation,
            to: train.toStation,
            date: trip.journeyDate,
            dep: trip.departureTime,
          })}`;
        return (
          <article
            key={trip.id}
            className="flex flex-col rounded-xl border bg-card"
          >
            <div className="flex flex-col gap-3 p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="truncate font-medium">{train.name}</h2>
                <span className="text-xs text-muted-foreground">
                  #{train.number}
                </span>
              </div>
              {/* departure and arrival, each under its station, with the journey time between */}
              <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
                <div className="flex flex-col">
                  <span className="text-xl tabular">
                    {clock(trip.departureTime)}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {train.fromStation}
                  </span>
                </div>
                <div
                  className="pt-3"
                  aria-label={`Journey time ${duration(trip)}`}
                >
                  <RouteLine label={duration(trip)} />
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xl tabular">
                    {clock(trip.arrivalTime)}
                    {trip.arrivalDayOffset ? (
                      <sup className="ml-0.5 text-xs text-muted-foreground">
                        +{trip.arrivalDayOffset}
                      </sup>
                    ) : null}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {train.toStation}
                  </span>
                </div>
              </div>
            </div>
            {/* every class on the train, each with its own fare and seats */}
            <ul className="grid gap-3 border-t p-5 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
              {ordered.map((c) => (
                <li
                  key={c.seatType}
                  className={cn(
                    "flex flex-col gap-3 rounded-lg border p-4",
                    c.seatType === seatType && "border-primary",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">
                      {CLASS_NAMES[c.seatType]}
                    </span>
                    <span className="text-lg tabular">{taka(c.fromPrice)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground tabular">
                    {c.available ? `${c.available} seats left` : "Sold out"}
                  </span>
                  <Button
                    size="sm"
                    variant={c.seatType === seatType ? "default" : "outline"}
                    disabled={!c.available}
                    render={<Link href={link(c.seatType)} />}
                    nativeButton={false}
                  >
                    Choose seats
                  </Button>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
