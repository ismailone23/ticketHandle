"use client";

import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSession } from "@/components/session-provider";
import { type ApiError, type Order } from "@/lib/api";
import { refundPercent, taka } from "@/lib/format";
import { TripSummary } from "./trip-summary";

const STATUS = {
  valid: "Valid",
  used: "Boarded",
  cancelled: "Cancelled",
} as const;

export function TicketStub({
  order,
  onChange,
}: {
  order: Order;
  onChange: () => void;
}) {
  const { request } = useSession();
  const [busy, setBusy] = useState(false);
  const pct = refundPercent(order.journeyDate, order.departureTime);
  const refund = Math.floor((order.totalAmount * pct) / 100);

  async function cancel() {
    setBusy(true);
    try {
      const r = await request<{ refundAmount: number }>(`/cancel/${order.id}`, {
        method: "POST",
      });
      toast.success(
        r.refundAmount
          ? `Cancelled. ${taka(r.refundAmount)} will be refunded.`
          : "Cancelled.",
      );
      onChange();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <article
        className="flex flex-col rounded-lg border bg-card sm:flex-row"
        aria-label="Ticket"
      >
        <div className="flex flex-1 flex-col gap-6 p-5">
          <div className="flex items-start justify-between gap-3">
            <TripSummary order={order} />
            {order.ticketStatus ? (
              <Badge
                variant={
                  order.ticketStatus === "valid" ? "default" : "secondary"
                }
              >
                {STATUS[order.ticketStatus]}
              </Badge>
            ) : null}
          </div>
          <ul className="flex flex-col gap-2">
            {order.passengers.map((p) => (
              <li
                key={`${p.coachCode}-${p.seatNumber}`}
                className="flex items-baseline gap-4"
              >
                <span className="w-14 font-mono text-sm tabular">
                  {p.coachCode}-{p.seatNumber}
                </span>
                <span className="truncate">{p.name}</span>
              </li>
            ))}
          </ul>
          <p className="font-mono text-sm tabular text-muted-foreground">
            Paid {taka(order.totalAmount)}
          </p>
        </div>
        <Separator
          orientation="vertical"
          className="hidden border-l border-dashed bg-transparent sm:block"
        />
        <Separator className="border-t border-dashed bg-transparent sm:hidden" />
        <div className="flex flex-col items-center justify-center gap-3 p-5">
          {order.ticketCode ? (
            <>
              {/* staff scan this; one code covers every seat on the booking */}
              <QRCodeSVG
                value={order.ticketCode}
                size={148}
                bgColor="transparent"
                aria-label="Ticket QR code"
              />
              <code className="font-mono text-xs text-muted-foreground">
                {order.ticketCode}
              </code>
            </>
          ) : null}
        </div>
      </article>

      <p className="text-sm text-muted-foreground">
        Show this QR at the platform gate. Every passenger boards together on
        one scan.
      </p>

      <div className="flex gap-2 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          Print ticket
        </Button>
        {order.ticketStatus === "valid" ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="ghost" disabled={busy} />}
            >
              Cancel booking
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                <AlertDialogDescription>
                  {pct
                    ? `You'll get back ${taka(refund)} (${pct}% of ${taka(order.totalAmount)}). Refunds go to your card within a few days.`
                    : "It's less than 6 hours to departure, so there's no refund. The seats go back on sale."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep ticket</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={cancel}>
                  Cancel booking
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </div>
  );
}
