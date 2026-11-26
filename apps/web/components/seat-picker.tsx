"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/components/session-provider";
import {
  type ApiError,
  seatStreamUrl,
  type Order,
  type Seat,
  type SeatType,
} from "@/lib/api";
import { CLASS_NAMES, clock, longDate, taka } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX = 4;
const VAT = 0.05;
const key = (s: { coachCode: string; seatNumber: number }) =>
  `${s.coachCode}-${s.seatNumber}`;

export function SeatPicker({ tripId }: { tripId: string }) {
  const { request } = useSession();
  const router = useRouter();
  const q = useSearchParams();
  const seatType = (q.get("class") ?? "s_chair") as SeatType;
  const [seats, setSeats] = useState<Map<string, Seat> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [holding, setHolding] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const holdKey = useRef(crypto.randomUUID()); // same key on retry → same order

  // first load over fetch so a signed-out user is sent to sign in, then live updates
  useEffect(() => {
    let es: EventSource | undefined;
    const put = (list: Seat[], replace = false) =>
      setSeats((prev) => {
        const next = new Map(replace ? [] : (prev ?? []));
        for (const s of list) next.set(key(s), { ...next.get(key(s)), ...s });
        return next;
      });
    request<Seat[]>(`/trips/${tripId}/seats?seatType=${seatType}`)
      .then((list) => {
        put(list, true);
        es = new EventSource(seatStreamUrl(tripId, seatType), {
          withCredentials: true,
        });
        es.addEventListener("snapshot", (e) => put(JSON.parse(e.data), true));
        es.addEventListener("seats", (e) => put(JSON.parse(e.data)));
      })
      .catch((e: ApiError) => setError(e.message));
    return () => es?.close();
  }, [tripId, seatType, request]);

  // holds lapse on their own; flip them back without waiting for the server
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const statusOf = (s: Seat) =>
    s.status === "in_progress" && s.until && Date.parse(s.until) < now
      ? "available"
      : s.status;

  // someone else took a seat this user had picked
  useEffect(() => {
    if (!seats) return;
    const lost = picked.filter((k) => seats.get(k)?.status !== "available");
    if (!lost.length) return;
    setPicked((p) => p.filter((k) => !lost.includes(k)));
    toast(`Seat ${lost.join(", ")} was just taken by someone else.`);
  }, [seats]); // eslint-disable-line react-hooks/exhaustive-deps

  const coaches = useMemo(() => {
    const by = new Map<string, Seat[]>();
    for (const s of seats?.values() ?? []) {
      if (!by.has(s.coachCode)) by.set(s.coachCode, []);
      by.get(s.coachCode)!.push(s);
    }
    for (const list of by.values())
      list.sort((a, b) => a.seatNumber - b.seatNumber);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [seats]);

  const pickedSeats = picked
    .map((k) => seats?.get(k))
    .filter((s): s is Seat => !!s);
  const subtotal = pickedSeats.reduce((sum, s) => sum + s.price, 0);

  function toggle(s: Seat) {
    const k = key(s);
    if (picked.includes(k)) return setPicked(picked.filter((p) => p !== k));
    const otherCoach = pickedSeats.some((p) => p.coachCode !== s.coachCode);
    if (otherCoach) {
      toast(`One booking covers one coach. Switched to coach ${s.coachCode}.`);
      return setPicked([k]);
    }
    if (picked.length >= MAX)
      return toast(`You can hold up to ${MAX} seats per trip.`);
    setPicked([...picked, k]);
  }

  async function hold() {
    setHolding(true);
    try {
      const { order } = await request<{ order: Order }>("/hold", {
        method: "POST",
        headers: { "idempotency-key": holdKey.current },
        body: JSON.stringify({
          tripId,
          seatType,
          coachCode: pickedSeats[0]!.coachCode,
          seatNumbers: pickedSeats.map((s) => s.seatNumber),
        }),
      });
      router.push(`/orders/${order.id}`);
    } catch (e) {
      holdKey.current = crypto.randomUUID(); // a failed hold created nothing; next try is new
      toast.error((e as ApiError).message);
      setHolding(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {q.get("from")} → {q.get("to")} ·{" "}
          {q.get("date") ? longDate(q.get("date")!) : null}
          {q.get("dep") ? ` · departs ${clock(q.get("dep")!)}` : null}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {q.get("train") ?? "Choose your seats"}
        </h1>
        <p className="text-muted-foreground">
          {CLASS_NAMES[seatType]} · pick up to {MAX} seats in one coach. The map
          updates live.
        </p>
      </header>

      <Legend />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load seats</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : !seats ? (
        <Skeleton className="h-72" />
      ) : (
        coaches.map(([coach, list]) => (
          <section
            key={coach}
            className="flex flex-col gap-3"
            aria-label={`Coach ${coach}`}
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-sm font-semibold">Coach {coach}</h2>
              <span className="text-xs text-muted-foreground">
                {list.filter((s) => statusOf(s) === "available").length} of{" "}
                {list.length} free
              </span>
            </div>
            {/* 2 + aisle + 2, like the carriage */}
            <div className="grid w-fit grid-cols-[repeat(2,2.75rem)_1.5rem_repeat(2,2.75rem)] gap-2 rounded-lg border bg-card p-3">
              {list.map((s) => {
                const status = statusOf(s);
                const on = picked.includes(key(s));
                const col = ((s.seatNumber - 1) % 4) + 1;
                return (
                  <button
                    key={key(s)}
                    type="button"
                    disabled={status !== "available"}
                    aria-pressed={on}
                    aria-label={`Seat ${key(s)}, ${status === "in_progress" ? "held by someone" : status}, ${taka(s.price)}`}
                    title={
                      status === "in_progress"
                        ? "Someone is paying for this seat"
                        : undefined
                    }
                    onClick={() => toggle(s)}
                    style={{ gridColumn: col > 2 ? col + 1 : col }}
                    className={cn(
                      "flex size-11 items-center justify-center rounded-md border font-mono text-sm tabular transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      status === "available" &&
                        !on &&
                        "bg-background hover:border-foreground",
                      on && "border-primary bg-primary text-primary-foreground",
                      status === "in_progress" &&
                        "cursor-not-allowed border-dashed text-muted-foreground",
                      status === "booked" &&
                        "cursor-not-allowed border-transparent bg-muted text-muted-foreground/60 line-through",
                    )}
                  >
                    {s.seatNumber}
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-sm">
              {picked.length ? picked.join(" · ") : "No seats picked"}
            </span>
            <span className="text-xs text-muted-foreground tabular">
              {picked.length
                ? `${taka(Math.round(subtotal * (1 + VAT)))} incl. 5% VAT`
                : `Up to ${MAX} seats`}
            </span>
          </div>
          <Button size="lg" disabled={!picked.length || holding} onClick={hold}>
            {holding ? <Spinner data-icon="inline-start" /> : null}
            Hold {picked.length || ""} {picked.length === 1 ? "seat" : "seats"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const item = (cls: string, label: string) => (
    <li className="flex items-center gap-2">
      <span className={cn("size-4 rounded-sm border", cls)} aria-hidden />
      {label}
    </li>
  );
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
      {item("bg-background", "Free")}
      {item("border-primary bg-primary", "Your pick")}
      {item("border-dashed", "Someone is paying")}
      {item("border-transparent bg-muted", "Booked")}
    </ul>
  );
}
