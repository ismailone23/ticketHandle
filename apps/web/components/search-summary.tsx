"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { SearchForm } from "@/components/search-form";
import { Button } from "@/components/ui/button";
import type { SeatType } from "@/lib/api";
import { CLASS_NAMES, longDate, todayInDhaka } from "@/lib/format";

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

// what was searched, a way to change it, and the day before or after in one click
export function SearchSummary() {
  const params = useSearchParams();
  const [editing, setEditing] = useState(false);
  const from = params.get("from")!;
  const to = params.get("to")!;
  const date = params.get("date")!;
  const seatType = (params.get("class") ?? "s_chair") as SeatType;

  const today = todayInDhaka();
  const href = (d: string) =>
    `/search?${new URLSearchParams({ from, to, date: d, class: seatType })}`;

  return (
    <section className="flex flex-col gap-4" aria-label="Your search">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {from} → {to}
          </h1>
          <p className="text-sm text-muted-foreground tabular">
            {longDate(date)} · {CLASS_NAMES[seatType]}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setEditing((e) => !e)}
          aria-expanded={editing}
        >
          {editing ? (
            <XIcon data-icon="inline-start" />
          ) : (
            <PencilIcon data-icon="inline-start" />
          )}
          {editing ? "Close" : "Modify search"}
        </Button>
      </div>

      {/* a new search closes the form: the URL changes, this remounts with the new key */}
      {editing ? <SearchForm compact /> : null}

      <nav
        aria-label="Change date"
        className="flex items-center justify-between gap-3"
      >
        <Button
          variant="outline"
          disabled={date <= today}
          render={<Link href={href(addDays(date, -1))} />}
          nativeButton={false}
        >
          <ChevronLeftIcon data-icon="inline-start" />
          Previous day
        </Button>
        <Button
          variant="outline"
          render={<Link href={href(addDays(date, 1))} />}
          nativeButton={false}
        >
          Next day
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </nav>
    </section>
  );
}
