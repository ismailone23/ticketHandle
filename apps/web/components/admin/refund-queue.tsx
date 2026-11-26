"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import { clock, longDate, taka } from "@/lib/format";

type Refund = {
  orderId: string;
  status: "cancelled" | "refunded";
  refundAmount: number;
  totalAmount: number;
  cancelledAt: string | null;
  customerName: string;
  customerEmail: string;
  trainName: string;
  trainNumber: number;
  journeyDate: string;
  departureTime: string;
};

export function RefundQueue() {
  const { request } = useSession();
  const [rows, setRows] = useState<Refund[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      request<Refund[]>("/api/admin/refunds")
        .then(setRows)
        .catch((e: ApiError) => setError(e.message)),
    [request],
  );
  useEffect(() => void load(), [load]);

  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load refunds</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!rows) return <Skeleton className="h-48" />;

  const pending = rows.filter((r) => r.status === "cancelled");
  const done = rows.filter((r) => r.status === "refunded");
  const owed = pending.reduce((n, r) => n + r.refundAmount, 0);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3" aria-labelledby="pending-title">
        <div className="flex items-baseline justify-between gap-4">
          <h1
            id="pending-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Refunds to pay
          </h1>
          {pending.length ? (
            <span className="text-sm text-muted-foreground tabular">
              {pending.length} owed · {taka(owed)}
            </span>
          ) : null}
        </div>
        {!pending.length ? (
          <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
            Nothing owed. Cancelled bookings with money to return show up here.
          </p>
        ) : (
          <RefundTable rows={pending} onRefunded={load} />
        )}
      </section>

      {done.length ? (
        <section className="flex flex-col gap-3" aria-labelledby="done-title">
          <h2 id="done-title" className="text-sm font-medium">
            Refunded
          </h2>
          <RefundTable rows={done} />
        </section>
      ) : null}
    </div>
  );
}

function RefundTable({
  rows,
  onRefunded,
}: {
  rows: Refund[];
  onRefunded?: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Trip</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Refund</TableHead>
            {onRefunded ? <TableHead className="w-0" /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.orderId}>
              <TableCell>
                <div className="flex flex-col">
                  <span>{r.customerName}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.customerEmail}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span>
                    {r.trainName}{" "}
                    <span className="text-xs text-muted-foreground">
                      #{r.trainNumber}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular">
                    {longDate(r.journeyDate)} · {clock(r.departureTime)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular">
                {taka(r.totalAmount)}
              </TableCell>
              <TableCell className="text-right tabular">
                {taka(r.refundAmount)}
              </TableCell>
              {onRefunded ? (
                <TableCell>
                  <PayRefund row={r} onDone={onRefunded} />
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PayRefund({ row, onDone }: { row: Refund; onDone: () => void }) {
  const { request } = useSession();
  const [busy, setBusy] = useState(false);
  async function pay() {
    setBusy(true);
    try {
      await request(`/api/admin/refunds/${row.orderId}`, { method: "POST" });
      toast.success(
        `${taka(row.refundAmount)} refunded to ${row.customerName}`,
      );
      onDone();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button size="sm" disabled={busy} />}>
        Refund {taka(row.refundAmount)}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Refund {taka(row.refundAmount)} to {row.customerName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The money goes back to the card they paid with, through Stripe. It
            usually reaches them within 5 to 10 days. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={pay}>
            Refund {taka(row.refundAmount)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
