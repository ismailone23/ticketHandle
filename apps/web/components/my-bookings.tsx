"use client";

import { TicketIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RouteLine } from "@/components/route-line";
import { useSession } from "@/components/session-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiError, Order } from "@/lib/api";
import { clock, longDate, taka } from "@/lib/format";

// what each order means to the traveller, not the database word
const label = (o: Order) =>
  o.status === "paid"
    ? o.ticketStatus === "used"
      ? "Boarded"
      : "Ticket ready"
    : o.status === "pending"
      ? Date.parse(o.expiresAt) > Date.now()
        ? "Waiting for payment"
        : "Hold expired"
      : o.status === "cancelled"
        ? o.refundAmount
          ? "Cancelled, refund on its way"
          : "Cancelled"
        : o.status === "refunded"
          ? "Refunded"
          : "Hold expired";

export function MyBookings() {
  const { request } = useSession();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<Order[]>("/orders")
      .then(setOrders)
      .catch((e: ApiError) => setError(e.message));
  }, [request]);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">My bookings</h1>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load your bookings</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : !orders ? (
        <Skeleton className="h-40" />
      ) : !orders.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TicketIcon />
            </EmptyMedia>
            <EmptyTitle>No bookings yet</EmptyTitle>
            <EmptyDescription>Tickets you buy show up here, with their QR code.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link href="/" />} nativeButton={false}>
              Find a train
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/orders/${o.id}`}
                className="flex flex-col gap-3 rounded-xl border bg-card p-5 transition-colors outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">
                      {o.trainName} <span className="text-sm font-normal text-muted-foreground">#{o.trainNumber}</span>
                    </span>
                    <span className="text-sm tabular">
                      {longDate(o.journeyDate)} · {clock(o.departureTime)}
                    </span>
                  </div>
                  <Badge variant={o.status === "paid" && o.ticketStatus === "valid" ? "default" : "secondary"}>{label(o)}</Badge>
                </div>
                <div className="grid max-w-sm grid-cols-[auto_1fr_auto] items-center gap-3 text-sm text-muted-foreground">
                  <span>{o.fromStation}</span>
                  <RouteLine />
                  <span>{o.toStation}</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground tabular">
                  <span>
                    {o.passengers.map((p) => `${p.coachCode}-${p.seatNumber}`).join(" · ")}
                  </span>
                  <span>{taka(o.totalAmount)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
