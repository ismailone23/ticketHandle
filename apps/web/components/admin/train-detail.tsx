"use client";

import { ArrowLeftIcon, CalendarPlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NewTrainDialog } from "./new-train-dialog";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/components/session-provider";
import type { AdminTrip, ApiError, Train } from "@/lib/api";
import { CLASS_NAMES, clock, longDate, serviceDays, taka, todayInDhaka } from "@/lib/format";
import { nextServiceDate, salesOpenFor } from "@/lib/next-trip";

export function TrainDetail({ number }: { number: string }) {
  const { request } = useSession();
  const router = useRouter();
  const [train, setTrain] = useState<Train | null>(null);
  const [trips, setTrips] = useState<AdminTrip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // bump to reload after an edit that kept the number

  const loadTrips = useCallback(
    (id: string) => request<AdminTrip[]>(`/api/admin/trips?trainId=${id}`).then(setTrips),
    [request],
  );
  useEffect(() => {
    request<Train>(`/api/admin/trains/number/${number}`)
      .then((t) => {
        setTrain(t);
        return loadTrips(t.id);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [number, request, loadTrips, version]);

  if (error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn't load train {number}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!train) return <Skeleton className="h-96" />;

  const seatTotal = train.coaches.reduce((n, c) => n + c.seatCount, 0);
  return (
    <div className="flex flex-col gap-8">
      <Button variant="link" className="self-start px-0" render={<Link href="/admin" />} nativeButton={false}>
        <ArrowLeftIcon data-icon="inline-start" />
        All trains
      </Button>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          {train.fromStation} → {train.toStation} · {serviceDays(train.offDay)}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {train.name} <span className="text-base font-normal text-muted-foreground">#{train.number}</span>
        </h1>
        </div>
        <div className="flex gap-2">
          <NewTrainDialog editing={train} onCreated={(n) => (n === train.number ? setVersion((v) => v + 1) : router.push(`/admin/trains/${n}`))} />
          <NewTrainDialog copyOf={train} onCreated={(n) => router.push(`/admin/trains/${n}`)} />
          <DeleteTrain train={train} onDone={() => router.push("/admin")} />
        </div>
      </header>

      <section className="flex flex-col gap-3" aria-label="Coaches">
        <h2 className="text-sm font-medium">Coaches · {seatTotal} seats</h2>
        <ul className="flex flex-wrap gap-2">
          {train.coaches.map((c) => (
            <li key={c.code} className="flex items-baseline gap-2 rounded-md border bg-card px-3 py-2 text-sm">
              <span className="font-semibold">{c.code}</span>
              <span className="text-muted-foreground">
                {CLASS_NAMES[c.seatType]} · {c.seatCount} · {taka(c.price)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-label="Trips">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Trips</h2>
          {trips?.length ? <ScheduleNext train={train} last={trips[0]!} onCreated={() => loadTrips(train.id)} /> : null}
        </div>
        {!trips ? (
          <Skeleton className="h-32" />
        ) : !trips.length ? (
          <p className="text-sm text-muted-foreground">No trips scheduled yet.</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Times</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sold / held / seats</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {trips.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{longDate(t.journeyDate)}</TableCell>
                    <TableCell className="tabular">
                      {clock(t.departureTime)} → {clock(t.arrivalTime)}
                      {t.arrivalDayOffset ? <sup className="text-muted-foreground">+{t.arrivalDayOffset}</sup> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.status === "scheduled" ? "secondary" : "outline"} className="capitalize">{t.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {t.booked} / {t.held} / {t.seats}
                    </TableCell>
                    <TableCell>{t.status === "scheduled" ? <CancelTrip trip={t} onDone={() => loadTrips(train.id)} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <NewTripForm train={train} onCreated={() => loadTrips(train.id)} />
    </div>
  );
}

function NewTripForm({ train, onCreated }: { train: Train; onCreated: () => void }) {
  const { request } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setPending(true);
    setError(null);
    try {
      await request("/api/admin/add-trip", {
        method: "POST",
        body: JSON.stringify({
          trainId: train.id,
          journeyDate: f.get("date"),
          departureTime: `${f.get("dep")}:00`,
          arrivalTime: `${f.get("arr")}:00`,
          arrivalDayOffset: Number(f.get("offset")),
          // the picker gives Dhaka wall-clock time without a zone
          salesOpenAt: `${f.get("sales")}:00+06:00`,
        }),
      });
      toast.success(`Trip on ${longDate(String(f.get("date")))} added`);
      form.reset();
      setSales(now);
      onCreated();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setPending(false);
    }
  }

  const now = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 16); // Dhaka "YYYY-MM-DDTHH:mm"
  // filled from the journey date (12:00 AM, 10 days before); still editable
  const [sales, setSales] = useState(now);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedule a trip</CardTitle>
        <CardDescription>Seats are copied from this train's coaches.</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="new-trip" onSubmit={submit}>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="date">Date</FieldLabel>
                <Input id="date" name="date" type="date" min={todayInDhaka()} required onChange={(e) => e.target.value && setSales(salesOpenFor(e.target.value).slice(0, 16))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="dep">Departs</FieldLabel>
                <Input id="dep" name="dep" type="time" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="arr">Arrives</FieldLabel>
                <Input id="arr" name="arr" type="time" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="offset">Arrival day</FieldLabel>
                <Input id="offset" name="offset" type="number" min={0} max={3} defaultValue={0} required />
                <FieldDescription>+1 if it arrives next day</FieldDescription>
              </Field>
            </div>
            <Field className="sm:max-w-xs">
              <FieldLabel htmlFor="sales">Sales open (Dhaka time)</FieldLabel>
              <Input id="sales" name="sales" type="datetime-local" value={sales} onChange={(e) => setSales(e.target.value)} required />
              <FieldDescription>Picking a date sets this to 12:00 AM, 10 days before</FieldDescription>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter>
        <Button type="submit" form="new-trip" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : <CalendarPlusIcon data-icon="inline-start" />}
          Add trip
        </Button>
      </CardFooter>
    </Card>
  );
}

function CancelTrip({ trip, onDone }: { trip: AdminTrip; onDone: () => void }) {
  const { request } = useSession();
  async function cancel() {
    try {
      const r = await request<{ ordersNeedingRefund: string[] }>(`/api/admin/cancel-trip/${trip.id}`, { method: "POST" });
      toast.success(
        r.ordersNeedingRefund.length ? `Trip cancelled. ${r.ordersNeedingRefund.length} bookings queued for a full refund.` : "Trip cancelled.",
      );
      onDone();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Cancel</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel the {longDate(trip.journeyDate)} trip?</AlertDialogTitle>
          <AlertDialogDescription>
            {trip.booked
              ? `${trip.booked} sold seats will be refunded in full and their tickets stop working. This can't be undone.`
              : "No seats are sold yet. This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep trip</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={cancel}>
            Cancel trip
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteTrain({ train, onDone }: { train: Train; onDone: () => void }) {
  const { request } = useSession();
  async function remove() {
    try {
      await request(`/api/admin/trains/${train.id}`, { method: "DELETE" });
      toast.success(`${train.name} deleted`);
      onDone();
    } catch (e) {
      toast.error((e as ApiError).message); // e.g. it has trips on record
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" />}>
        <Trash2Icon data-icon="inline-start" />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {train.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Only a train that has never had a trip can be deleted; its coaches go with it. A train with trips stays, so its
            bookings and tickets keep their history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep train</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remove}>
            Delete train
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// one click: the latest trip again on the next running day (list is newest first, so last = trips[0])
function ScheduleNext({ train, last, onCreated }: { train: Train; last: AdminTrip; onCreated: () => void }) {
  const { request } = useSession();
  const [busy, setBusy] = useState(false);
  const date = nextServiceDate(last.journeyDate, train.offDay, todayInDhaka());

  async function schedule() {
    setBusy(true);
    try {
      await request("/api/admin/add-trip", {
        method: "POST",
        body: JSON.stringify({
          trainId: train.id,
          journeyDate: date,
          departureTime: last.departureTime,
          arrivalTime: last.arrivalTime,
          arrivalDayOffset: last.arrivalDayOffset,
          salesOpenAt: salesOpenFor(date),
        }),
      });
      toast.success(`Trip on ${longDate(date)} added`);
      onCreated();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={schedule} title={`Copies the ${longDate(last.journeyDate)} trip`}>
      {busy ? <Spinner data-icon="inline-start" /> : <CalendarPlusIcon data-icon="inline-start" />}
      Schedule {longDate(date).replace(/ \d{4}$/, "")}
    </Button>
  );
}
