"use client";

import { TrainFrontIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
        {state.data.length} {state.data.length === 1 ? "train" : "trains"} ·{" "}
        {from} → {to} · {longDate(date)}
      </p>
      {state.data.map(({ train, trip, classes }) => {
        const cls = classes.find((c) => c.seatType === seatType);
        const q = new URLSearchParams({
          class: seatType,
          train: train.name,
          num: String(train.number),
          from: train.fromStation,
          to: train.toStation,
          date: trip.journeyDate,
          dep: trip.departureTime,
        });
        return (
          <article
            key={trip.id}
            className="flex flex-col rounded-lg border bg-card sm:flex-row"
          >
            <div className="flex flex-1 flex-col gap-3 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="truncate font-medium">{train.name}</h2>
                <span className="text-xs text-muted-foreground">
                  #{train.number}
                </span>
              </div>
              {/* departure and arrival, each under its station, with the journey time between */}
              <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
                <div className="flex flex-col">
                  <span className="text-xl tabular">{clock(trip.departureTime)}</span>
                  <span className="truncate text-sm text-muted-foreground">{train.fromStation}</span>
                </div>
                <div className="pt-3" aria-label={`Journey time ${duration(trip)}`}>
                  <RouteLine label={duration(trip)} />
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xl tabular">
                    {clock(trip.arrivalTime)}
                    {trip.arrivalDayOffset ? (
                      <sup className="ml-0.5 text-xs text-muted-foreground">+{trip.arrivalDayOffset}</sup>
                    ) : null}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">{train.toStation}</span>
                </div>
              </div>
            </div>
        <div className="border-t sm:border-t-0 sm:border-l" aria-hidden />
            <div className="flex items-center justify-between gap-4 p-4 sm:w-56 sm:flex-col sm:items-stretch sm:justify-center">
              {cls ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      {CLASS_NAMES[seatType]} from
                    </span>
                    <span className="text-lg tabular">
                      {taka(cls.fromPrice)}
                    </span>
                    <Badge variant={cls.available ? "secondary" : "outline"}>
                      {cls.available
                        ? `${cls.available} seats left`
                        : "Sold out"}
                    </Badge>
                  </div>
                  <Button
                    disabled={!cls.available}
                    render={<Link href={`/trips/${trip.id}?${q}`} />}
                    nativeButton={false}
                  >
                    Choose seats
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No {CLASS_NAMES[seatType]} on this train
                </p>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
