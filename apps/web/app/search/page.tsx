import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SearchResults } from "@/components/search-results";
import { SearchSummary } from "@/components/search-summary";

export const metadata: Metadata = { title: "Trains — TicketHandle" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  if (!q.from || !q.to || !q.date) redirect("/");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {/* keyed by the search so a new one starts with the form closed */}
      <Suspense>
        <SearchSummary key={`${q.from}|${q.to}|${q.date}|${q.class}`} />
      </Suspense>
      <Suspense>
        <SearchResults />
      </Suspense>
    </div>
  );
}
