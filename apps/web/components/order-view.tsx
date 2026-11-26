"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/components/session-provider";
import { type ApiError, type Order } from "@/lib/api";
import { taka } from "@/lib/format";
import { CheckoutForm } from "./checkout-form";
import { TicketStub } from "./ticket-stub";

export function OrderView({ id }: { id: string }) {
  const { request } = useSession();
  const justPaid = useSearchParams().get("paid") === "1";
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      request<Order>(`/orders/${id}`)
        .then(setOrder)
        .catch((e: ApiError) => setError(e.message)),
    [id, request],
  );
  useEffect(() => void load(), [load]);

  // back from Stripe: the webhook usually lands within seconds
  useEffect(() => {
    if (!justPaid || order?.status !== "pending") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [justPaid, order?.status, load]);

  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't open this order</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!order) return <Skeleton className="h-96" />;

  if (order.status === "paid")
    return <TicketStub order={order} onChange={load} />;

  if (order.status === "pending" && justPaid)
    return (
      <Alert>
        <Spinner />
        <AlertTitle>Confirming your payment</AlertTitle>
        <AlertDescription>
          Stripe has your payment. Your ticket appears here as soon as it's
          confirmed.
        </AlertDescription>
      </Alert>
    );

  if (order.status === "pending")
    return <CheckoutForm order={order} onExpire={load} />;

  const closed = {
    expired: [
      "Hold expired",
      "The seats went back on sale because payment wasn't finished in time.",
    ],
    cancelled: ["Booking cancelled", "These seats are no longer yours."],
    refunded: ["Refunded", "The refund has been sent to your card."],
  }[order.status];
  return (
    <Alert>
      <AlertTitle>{closed[0]}</AlertTitle>
      <AlertDescription>
        {closed[1]}
        {order.status === "cancelled" && order.refundAmount
          ? ` A refund of ${taka(order.refundAmount)} is on its way; it can take a few days.`
          : null}
      </AlertDescription>
    </Alert>
  );
}
