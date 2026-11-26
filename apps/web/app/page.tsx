import { Suspense } from "react";
import { SearchForm } from "@/components/search-form";
import { SearchResults } from "@/components/search-results";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Where are you going?</h1>
        <p className="text-muted-foreground">
          Seats are held for 15 minutes while you add passengers and pay. Up to 4 tickets per trip.
        </p>
      </section>
      <Suspense>
        <SearchForm />
        <SearchResults />
      </Suspense>
    </div>
  );
}
