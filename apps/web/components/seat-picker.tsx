"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/components/session-provider";
import { SEAT_LOOK, SeatLegend } from "@/components/seat-legend";
import { TripHeading } from "@/components/trip-summary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  seatStreamUrl,
  type ApiError,
  type Order,
  type Seat,
  type SeatType,
} from "@/lib/api";
import { CLASS_NAMES, taka } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX = 4;
const VAT = 0.05;
const key = (s: { coachCode: string; seatNumber: number }) =>
  `${s.coachCode}-${s.seatNumber}`;

export function SeatPicker({ tripId }: { tripId: string }) {
  const router = useRouter();
  const { request } = useSession();
  const q = useSearchParams();
  const [seatType, setSeatType] = useState(
    (q.get("class") ?? "s_chair") as SeatType,
  );
  const [seats, setSeats] = useState<Map<string, Seat> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [coach, setCoach] = useState<string | null>(null);
  const [holding, setHolding] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const holdKey = useRef(crypto.randomUUID()); // same key on retry → same order
  const holdingRef = useRef(false); // our own hold echoes back over the stream; don't call it "taken"

  // first load over fetch so a signed-out user is sent to sign in, then live updates
  useEffect(() => {
    let es: EventSource | undefined;
    const put = (list: Seat[], replace = false) =>
      setSeats((prev) => {
        const next = new Map(replace ? [] : (prev ?? []));
        for (const s of list) next.set(key(s), { ...next.get(key(s)), ...s });
        return next;
      });
    // every class at once, so switching class needs no new request
    request<Seat[]>(`/trips/${tripId}/seats`)
      .then((list) => {
        put(list, true);
        es = new EventSource(seatStreamUrl(tripId), { withCredentials: true });
        es.addEventListener("snapshot", (e) => put(JSON.parse(e.data), true));
        es.addEventListener("seats", (e) => put(JSON.parse(e.data)));
      })
      .catch((e: ApiError) => setError(e.message));
    return () => es?.close();
  }, [tripId, request]);

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
    if (!seats || holdingRef.current) return;
    const lost = picked.filter((k) => seats.get(k)?.status !== "available");
    if (!lost.length) return;
    setPicked((p) => p.filter((k) => !lost.includes(k)));
    toast(
      lost.length === 1
        ? `Seat ${lost[0]} was just taken.`
        : `Seats ${lost.join(", ")} were just taken.`,
    );
  }, [seats]); // eslint-disable-line react-hooks/exhaustive-deps

  // classes on this trip, in the usual order, with what's free in each
  const classes = useMemo(() => {
    const all = [
      ...new Set([...(seats?.values() ?? [])].map((s) => s.seatType)),
    ];
    return (Object.keys(CLASS_NAMES) as SeatType[]).filter((t) =>
      all.includes(t),
    );
  }, [seats]);
  const klass = classes.includes(seatType)
    ? seatType
    : (classes[0] ?? seatType);

  // this class's coaches, in the order they run
  const coaches = useMemo(() => {
    const by = new Map<string, Seat[]>();
    for (const s of seats?.values() ?? []) {
      if (s.seatType !== klass) continue;
      if (!by.has(s.coachCode)) by.set(s.coachCode, []);
      by.get(s.coachCode)!.push(s);
    }
    for (const list of by.values())
      list.sort((a, b) => a.seatNumber - b.seatNumber);
    return [...by.entries()].sort(
      ([, a], [, b]) => a[0]!.coachPosition - b[0]!.coachPosition,
    );
  }, [seats, klass]);
  const freeIn = (list: Seat[]) =>
    list.filter((s) => statusOf(s) === "available").length;
  // open on the first coach that still has room
  const active =
    (coach && coaches.some(([c]) => c === coach) ? coach : null) ??
    coaches.find(([, l]) => freeIn(l))?.[0] ??
    coaches[0]?.[0] ??
    null;
  const activeSeats = coaches.find(([c]) => c === active)?.[1] ?? [];
  const classFree = (t: SeatType) =>
    [...(seats?.values() ?? [])].filter(
      (s) => s.seatType === t && statusOf(s) === "available",
    ).length;
  const classFare = (t: SeatType) =>
    [...(seats?.values() ?? [])].find((s) => s.seatType === t)?.price ?? 0;

  function pickClass(t: SeatType) {
    setSeatType(t);
    setCoach(null);
    const next = new URLSearchParams(q.toString());
    next.set("class", t);
    router.replace(`?${next}`, { scroll: false }); // a reload stays on this class
  }

  const pickedSeats = picked
    .map((k) => seats?.get(k))
    .filter((s): s is Seat => !!s);
  const subtotal = pickedSeats.reduce((sum, s) => sum + s.price, 0);

  function toggle(s: Seat) {
    const k = key(s);
    if (picked.includes(k)) return setPicked(picked.filter((p) => p !== k));
    if (pickedSeats.some((p) => p.coachCode !== s.coachCode)) {
      toast(
        `One booking covers one coach, so your picks moved to coach ${s.coachCode}.`,
      );
      return setPicked([k]);
    }
    if (picked.length >= MAX)
      return toast(`You can hold up to ${MAX} seats per trip.`);
    setPicked([...picked, k]);
  }

  async function hold() {
    setHolding(true);
    holdingRef.current = true;
    try {
      const { order } = await request<{ order: Order }>("/hold", {
        method: "POST",
        headers: { "idempotency-key": holdKey.current },
        body: JSON.stringify({
          tripId,
          seatType: pickedSeats[0]!.seatType, // the picks' own class, even after switching
          coachCode: pickedSeats[0]!.coachCode,
          seatNumbers: pickedSeats.map((s) => s.seatNumber),
        }),
      });
      router.push(`/orders/${order.id}`);
    } catch (e) {
      holdKey.current = crypto.randomUUID(); // a failed hold created nothing; next try is new
      holdingRef.current = false;
      toast.error((e as ApiError).message);
      setHolding(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <TripHeading
          from={q.get("from") ?? ""}
          to={q.get("to") ?? ""}
          name={q.get("train") ?? "Choose your seats"}
          number={q.get("num") ?? ""}
          date={q.get("date") ?? ""}
          time={q.get("dep") ?? "00:00"}
        />
        <p className="text-muted-foreground">
          Pick up to {MAX} seats in one coach. The map updates live.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_18rem]">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn't load seats</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : !seats || !active ? (
          <Skeleton className="h-96" />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-56">
                <FieldLabel htmlFor="class">Class</FieldLabel>
                <Select
                  items={classes.map((t) => ({
                    value: t,
                    label: CLASS_NAMES[t],
                  }))}
                  value={klass}
                  onValueChange={(v) => v && pickClass(v as SeatType)}
                >
                  <SelectTrigger id="class" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {classes.map((t) => (
                        <SelectItem key={t} value={t}>
                          <span className="flex w-full justify-between gap-4">
                            {CLASS_NAMES[t]}
                            <span className="text-muted-foreground tabular">
                              {taka(classFare(t))} · {classFree(t)} free
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field className="w-44">
                <FieldLabel htmlFor="coach">Coach</FieldLabel>
                <Select
                  items={coaches.map(([c]) => ({
                    value: c,
                    label: `Coach ${c}`,
                  }))}
                  value={active}
                  onValueChange={(v) => v && setCoach(v as string)}
                >
                  <SelectTrigger id="coach" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {coaches.map(([c, list]) => (
                        <SelectItem key={c} value={c} disabled={!freeIn(list)}>
                          <span className="flex w-full justify-between gap-4">
                            Coach {c}
                            <span className="text-muted-foreground tabular">
                              {freeIn(list) ? `${freeIn(list)} free` : "Full"}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <SeatLegend className="pb-2" />
            </div>
            <section
              aria-label={`Coach ${active}, ${freeIn(activeSeats)} of ${activeSeats.length} seats free`}
              className="flex flex-col items-center gap-3 rounded-lg border bg-card px-4 py-5"
            >
              <p className="text-xs text-muted-foreground">
                Coach {active} · {freeIn(activeSeats)} of {activeSeats.length}{" "}
                free · {taka(activeSeats[0]?.price ?? 0)} a seat
              </p>
              {/* 2 + aisle + 2, like the carriage */}
              <div className="grid grid-cols-[repeat(2,2.75rem)_1.5rem_repeat(2,2.75rem)] gap-2">
                {activeSeats.map((s) => {
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
                        "flex size-11 items-center justify-center rounded-md border text-sm tabular transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        status === "available" &&
                          !on &&
                          cn(SEAT_LOOK.free, "hover:border-foreground"),
                        on && SEAT_LOOK.yours,
                        status === "in_progress" &&
                          cn(SEAT_LOOK.paying, "cursor-not-allowed"),
                        status === "booked" &&
                          cn(SEAT_LOOK.booked, "cursor-not-allowed"),
                      )}
                    >
                      {s.seatNumber}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* desktop: the pick and the action stay beside the coach; phones use the bar below */}
        <aside className="hidden flex-col gap-5 rounded-xl border bg-card p-5 lg:sticky lg:top-6 lg:flex">
          <span className="text-sm font-medium">Your seats</span>
          {picked.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {pickedSeats.map((s) => (
                <li key={key(s)} className="flex justify-between tabular">
                  <span>Seat {key(s)}</span>
                  <span className="text-muted-foreground">{taka(s.price)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tap free seats on the coach, up to {MAX} in one coach.
            </p>
          )}
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm">Total</span>
              <span className="text-xl tabular">
                {taka(Math.round(subtotal * (1 + VAT)))}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              5% VAT included
            </span>
          </div>
          <Button size="lg" disabled={!picked.length || holding} onClick={hold}>
            {holding ? <Spinner data-icon="inline-start" /> : null}
            Hold {picked.length || ""} {picked.length === 1 ? "seat" : "seats"}
          </Button>
        </aside>
      </div>

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm">
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
