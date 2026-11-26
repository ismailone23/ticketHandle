"use client";

import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/components/session-provider";
import type { ApiError, SeatType, Train } from "@/lib/api";
import { CLASS_NAMES } from "@/lib/format";

const OFF_DAYS = [
  { value: "none", label: "Runs every day" },
  ...["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => ({ value: d, label: `Off on ${d}` })),
];
const CLASSES = (Object.keys(CLASS_NAMES) as SeatType[]).map((value) => ({ value, label: CLASS_NAMES[value] }));
// Bangladesh Railway style coach letters, in order
const CODES = ["KA", "KHA", "GA", "GHA", "UMA", "CHA", "SCHA", "JA", "JHA", "NEO"];

type CoachRow = { code: string; seatType: SeatType; seatCount: string; taka: string };
const blank = (i: number): CoachRow => ({ code: CODES[i] ?? "", seatType: "s_chair", seatCount: "60", taka: "" });

// a copy starts from every field of the original except its number, which must be unique
const fromTrain = (t: Train): CoachRow[] =>
  t.coaches.map((c) => ({ code: c.code, seatType: c.seatType, seatCount: String(c.seatCount), taka: String(c.price / 100) }));

// editing changes the train's own fields only: trips copied their seats from its coaches, so coaches stay
export function NewTrainDialog({ onCreated, copyOf, editing }: { onCreated: (number: number) => void; copyOf?: Train; editing?: Train }) {
  const source = copyOf ?? editing;
  const { request } = useSession();
  const [open, setOpen] = useState(false);
  const [offDay, setOffDay] = useState(source?.offDay ?? "none");
  const [coaches, setCoaches] = useState<CoachRow[]>(copyOf ? fromTrain(copyOf) : [blank(0)]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const setCoach = (i: number, patch: Partial<CoachRow>) =>
    setCoaches((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const fields = {
        number: Number(f.get("number")),
        name: String(f.get("name")),
        fromStation: String(f.get("from")),
        toStation: String(f.get("to")),
        offDay: offDay === "none" ? null : offDay,
      };
      const created = editing
        ? await request<{ number: number }>(`/api/admin/update-train/${editing.id}`, { method: "PUT", body: JSON.stringify(fields) })
        : await request<{ number: number }>("/api/admin/new-train", {
        method: "POST",
        body: JSON.stringify({
          ...fields,
          coach: coaches.map((c, i) => ({
            code: c.code,
            position: i + 1,
            seatType: c.seatType,
            seatCount: Number(c.seatCount),
            price: Math.round(Number(c.taka) * 100), // form takes taka, API stores poisha
          })),
        }),
      });
      toast.success(editing ? "Train updated" : copyOf ? "Copy saved" : "Train added");
      setOpen(false);
      setCoaches([blank(0)]);
      onCreated(created.number);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setOffDay(source?.offDay ?? "none");
          setCoaches(copyOf ? fromTrain(copyOf) : [blank(0)]);
          setError(null);
        }
        setOpen(o);
      }}
    >
      <DialogTrigger render={<Button variant={source ? "outline" : "default"} />}>
        {editing ? <PencilIcon data-icon="inline-start" /> : copyOf ? <CopyIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
        {editing ? "Edit" : copyOf ? "Duplicate" : "New train"}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : copyOf ? `Duplicate ${copyOf.name}` : "New train"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Coaches stay as they are because trips copied their seats from them. To change coaches, duplicate the train."
              : copyOf
              ? `Starts from #${copyOf.number}: route, off day and ${copyOf.coaches.length === 1 ? "its coach" : `all ${copyOf.coaches.length} coaches`}. Give it a new number and change what differs.`
              : "Coaches are listed in the order they run, engine first."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} id="new-train">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field>
                <FieldLabel htmlFor="number">Number</FieldLabel>
                <Input id="number" name="number" type="number" inputMode="numeric" min={1} max={99999} required autoFocus={!!copyOf} defaultValue={editing?.number} />
              </Field>
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input id="name" name="name" placeholder="Subarna Express" maxLength={100} required defaultValue={source?.name} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="from">From</FieldLabel>
                <Input id="from" name="from" maxLength={100} required defaultValue={source?.fromStation} />
              </Field>
              <Field>
                <FieldLabel htmlFor="to">To</FieldLabel>
                <Input id="to" name="to" maxLength={100} required defaultValue={source?.toStation} />
              </Field>
              <Field>
                <FieldLabel htmlFor="offday">Off day</FieldLabel>
                <Select items={OFF_DAYS} value={offDay} onValueChange={(v) => setOffDay(v as string)}>
                  <SelectTrigger id="offday" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {OFF_DAYS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {editing ? null : (
            <FieldSet>
              <FieldLegend variant="label">Coaches</FieldLegend>
              <div className="flex flex-col gap-2">
                {coaches.map((c, i) => (
                  <div key={i} className="grid grid-cols-[4.5rem_1fr_4.5rem_6rem_auto] items-end gap-2">
                    <Field>
                      <FieldLabel htmlFor={`code-${i}`} className={i ? "sr-only" : undefined}>Code</FieldLabel>
                      <Input id={`code-${i}`} value={c.code} onChange={(e) => setCoach(i, { code: e.target.value.toUpperCase() })} maxLength={5} required />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`class-${i}`} className={i ? "sr-only" : undefined}>Class</FieldLabel>
                      <Select items={CLASSES} value={c.seatType} onValueChange={(v) => setCoach(i, { seatType: v as SeatType })}>
                        <SelectTrigger id={`class-${i}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {CLASSES.map((k) => (
                              <SelectItem key={k.value} value={k.value}>
                                {k.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`seats-${i}`} className={i ? "sr-only" : undefined}>Seats</FieldLabel>
                      <Input id={`seats-${i}`} type="number" min={1} max={1000} value={c.seatCount} onChange={(e) => setCoach(i, { seatCount: e.target.value })} required className="tabular" />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`price-${i}`} className={i ? "sr-only" : undefined}>Fare ৳</FieldLabel>
                      <Input id={`price-${i}`} type="number" min={0} step="0.01" value={c.taka} onChange={(e) => setCoach(i, { taka: e.target.value })} required className="tabular" />
                    </Field>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove coach ${c.code || i + 1}`} disabled={coaches.length === 1} onClick={() => setCoaches(coaches.filter((_, j) => j !== i))}>
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setCoaches([...coaches, blank(coaches.length)])}>
                <PlusIcon data-icon="inline-start" />
                Add coach
              </Button>
            </FieldSet>
            )}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button type="submit" form="new-train" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {editing ? "Save changes" : copyOf ? "Save copy" : "Add train"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
