"use client";

import { ArrowLeftRightIcon, CalendarIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SeatType } from "@/lib/api";
import { CLASS_NAMES, longDate, todayInDhaka } from "@/lib/format";

const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function SearchForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [date, setDate] = useState(params.get("date") ?? todayInDhaka());
  const [seatType, setSeatType] = useState<SeatType>(
    (params.get("class") as SeatType) ?? "s_chair",
  );
  const [open, setOpen] = useState(false);

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
        router.push(`/?${q}`);
      }}
    >
      <FieldGroup>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <Field>
            <FieldLabel htmlFor="from">From</FieldLabel>
            <Input
              id="from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="Dhaka"
              required
            />
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Swap stations"
            onClick={() => {
              setFrom(to);
              setTo(from);
            }}
          >
            <ArrowLeftRightIcon />
          </Button>
          <Field>
            <FieldLabel htmlFor="to">To</FieldLabel>
            <Input
              id="to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="Chattogram"
              required
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="date">Journey date</FieldLabel>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <Button
                  id="date"
                  type="button"
                  variant="outline"
                  className="justify-start"
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

        <FieldSet>
          <FieldLegend variant="label">Class</FieldLegend>
          <ToggleGroup
            variant="outline"
            value={[seatType]}
            onValueChange={(v) => v[0] && setSeatType(v[0] as SeatType)}
            className="flex-wrap"
          >
            {(Object.keys(CLASS_NAMES) as SeatType[]).map((t) => (
              <ToggleGroupItem key={t} value={t}>
                {CLASS_NAMES[t]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>

        <Button type="submit" size="lg" className="sm:self-start">
          Find trains
        </Button>
      </FieldGroup>
    </form>
  );
}
