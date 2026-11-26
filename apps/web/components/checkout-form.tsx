"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/components/session-provider";
import { type ApiError, type Order } from "@/lib/api";
import { taka } from "@/lib/format";
import { TripSummary } from "./trip-summary";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function CheckoutForm({
  order,
  onExpire,
}: {
  order: Order;
  onExpire: () => void;
}) {
  const { request } = useSession();
  const router = useRouter();
  const [left, setLeft] = useState(
    () => Date.parse(order.expiresAt) - Date.now(),
  );
  const [busy, setBusy] = useState<"pay" | "release" | null>(null);

  useEffect(() => {
    const t = setInterval(
      () => setLeft(Date.parse(order.expiresAt) - Date.now()),
      1000,
    );
    return () => clearInterval(t);
  }, [order.expiresAt]);

  if (left <= 0)
    return (
      <Alert>
        <AlertTitle>Your hold ran out</AlertTitle>
        <AlertDescription>
          The seats went back on sale.{" "}
          <Link href="/" className="underline underline-offset-4">
            Search again
          </Link>
        </AlertDescription>
      </Alert>
    );

  async function pay(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy("pay");
    try {
      await request(`/orders/${order.id}/passengers`, {
        method: "PUT",
        body: JSON.stringify({
          passengers: order.passengers.map((p, i) => ({
            coachCode: p.coachCode,
            seatNumber: p.seatNumber,
            name: String(form.get(`name-${i}`)).trim(),
            ...(form.get(`email-${i}`)
              ? { email: String(form.get(`email-${i}`)) }
              : {}),
          })),
        }),
      });
      const { url } = await request<{ url: string }>(
        `/orders/${order.id}/pay`,
        { method: "POST" },
      );
      location.href = url;
    } catch (err) {
      toast.error((err as ApiError).message);
      setBusy(null);
      onExpire();
    }
  }

  async function release() {
    setBusy("release");
    await request(`/orders/${order.id}/hold`, { method: "DELETE" }).catch(
      () => {},
    );
    router.back();
  }

  const urgent = left < 3 * 60_000;
  return (
    <form onSubmit={pay} className="flex flex-col gap-8">
      <TripSummary order={order} />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <FieldGroup>
          {order.passengers.map((p, i) => (
            <div
              key={`${p.coachCode}-${p.seatNumber}`}
              className="rounded-xl border bg-card p-5"
            >
              <FieldSet>
                <FieldLegend variant="label">
                  Seat {p.coachCode}-{p.seatNumber}
                </FieldLegend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`name-${i}`}>Name as on ID</FieldLabel>
                    <Input
                      id={`name-${i}`}
                      name={`name-${i}`}
                      defaultValue={p.name}
                      maxLength={100}
                      autoComplete={i ? "off" : "name"}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`email-${i}`}>
                      Email (optional)
                    </FieldLabel>
                    <Input
                      id={`email-${i}`}
                      name={`email-${i}`}
                      type="email"
                      defaultValue={p.email}
                    />
                  </Field>
                </div>
              </FieldSet>
            </div>
          ))}
        </FieldGroup>

        {/* what you're paying for, and how long it's yours; stays in view while filling names */}
        <aside className="flex flex-col gap-5 rounded-xl border bg-card p-5 lg:sticky lg:top-6">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted-foreground">
              Seats held for
            </span>
            <span
              role="timer"
              aria-live="off"
              className={
                urgent
                  ? "text-2xl text-destructive tabular"
                  : "text-2xl tabular"
              }
            >
              {mmss(left)}
            </span>
          </div>
          <Separator />
          <ul className="flex flex-col gap-1 text-sm">
            {order.passengers.map((p) => (
              <li key={`${p.coachCode}-${p.seatNumber}`} className="tabular">
                Seat {p.coachCode}-{p.seatNumber}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm">Total</span>
              <span className="text-xl tabular">{taka(order.totalAmount)}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              5% VAT included
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <Button type="submit" size="lg" disabled={!!busy}>
              {busy === "pay" ? <Spinner data-icon="inline-start" /> : null}
              Pay with card
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!!busy}
              onClick={release}
            >
              {busy === "release" ? <Spinner data-icon="inline-start" /> : null}
              Release seats
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            You'll pay on Stripe's secure page. Paying extends your hold to 30
            minutes.
          </p>
        </aside>
      </div>
    </form>
  );
}
