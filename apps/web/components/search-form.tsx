"use client";

import { ArrowLeftRightIcon, CalendarIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type SeatType } from "@/lib/api";
import { CLASS_NAMES, longDate, todayInDhaka } from "@/lib/format";

const CLASSES = (Object.keys(CLASS_NAMES) as SeatType[]).map((value) => ({
  value,
  label: CLASS_NAMES[value],
}));

const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// compact: one row above the results, so the search stays editable without the hero
export function SearchForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [date, setDate] = useState(params.get("date") ?? todayInDhaka());
  const [seatType, setSeatType] = useState<SeatType>(
    (params.get("class") as SeatType) ?? "s_chair",
  );
  const [open, setOpen] = useState(false);
  const [stations, setStations] = useState<string[]>([]);
  useEffect(() => {
    api<string[]>("/stations")
      .then(setStations)
      .catch(() => {});
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const q = new URLSearchParams({
          from: from.trim(),
          to: to.trim(),
          date,
          class: seatType,
        });
        router.push(`/search?${q}`);
      }}
      className={
        compact
          ? "grid gap-3 rounded-xl border bg-card p-4 lg:grid-cols-[2fr_1.4fr_auto] lg:items-end"
          : "flex flex-col gap-5 rounded-xl border bg-card p-5"
      }
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <Field>
          <FieldLabel htmlFor="from" className="text-muted-foreground">
            From station
          </FieldLabel>
          <StationPicker
            id="from"
            value={from}
            onChange={setFrom}
            stations={stations}
            placeholder="Pick a station"
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="rounded-full"
          aria-label="Swap stations"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <ArrowLeftRightIcon />
        </Button>
        <Field>
          <FieldLabel htmlFor="to" className="text-muted-foreground">
            To station
          </FieldLabel>
          <StationPicker
            id="to"
            value={to}
            onChange={setTo}
            stations={stations.filter((s) => s !== from)}
            placeholder="Pick a station"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="date" className="text-muted-foreground">
            Journey date
          </FieldLabel>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <Button
                  id="date"
                  type="button"
                  variant="outline"
                  size="lg"
                  className="justify-start bg-transparent text-base tabular md:text-sm"
                />
              }
            >
              <CalendarIcon data-icon="inline-start" />
              {longDate(date)}
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={new Date(`${date}T00:00:00`)}
                disabled={{ before: new Date(`${todayInDhaka()}T00:00:00`) }}
                onSelect={(d) => {
                  if (d) setDate(toIso(d));
                  setOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </Field>
        <Field>
          <FieldLabel htmlFor="class" className="text-muted-foreground">
            Class
          </FieldLabel>
          <Select
            items={CLASSES}
            value={seatType}
            onValueChange={(v) => v && setSeatType(v as SeatType)}
          >
            <SelectTrigger
              id="class"
              className="w-full text-base data-[size=default]:h-9 md:text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {CLASSES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Button type="submit" size="lg">
        Find trains
      </Button>
    </form>
  );
}

function StationPicker({
  id,
  value,
  onChange,
  stations,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  stations: string[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  // a value set from outside (swap button, URL) shows in the box too
  useEffect(() => setQuery(value), [value]);
  return (
    // suggestions only once something is typed, and never more than 8: the list stays short at any station count
    <Combobox
      items={stations}
      limit={8}
      value={value || null}
      onValueChange={(v) => onChange((v as string | null) ?? "")}
      inputValue={query}
      onInputValueChange={setQuery}
      open={open && query.trim().length > 0}
      onOpenChange={setOpen}
      openOnInputClick={false}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        required
        showTrigger={false}
        className="h-9 [&_input::placeholder]:text-muted-foreground/70"
      />
      <ComboboxContent>
        <ComboboxEmpty>No station by that name.</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
