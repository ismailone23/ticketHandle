import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CoachPreview } from "@/components/coach-preview";
import { SearchForm } from "@/components/search-form";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  // older links put the search on the home page; the results live at /search now
  if (q.from && q.to && q.date) redirect(`/search?${new URLSearchParams(q as Record<string, string>)}`);

  return (
    <div className="flex flex-col">
      {/* split: what you do on the left, what you get on the right. Height = viewport minus header (56 + 1px border) and main padding (32 + 96) */}
      <section className="grid items-center gap-12 lg:min-h-[calc(100dvh-11.5rem-1px)] lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Pick your seat, not just a ticket
            </h1>
            <p className="max-w-md text-lg text-muted-foreground text-pretty">
              See every seat on the coach as it fills up. Yours are held for 15
              minutes while you pay, and one QR boards the whole group of up to
              4.
            </p>
          </div>
          <Suspense>
            <SearchForm />
          </Suspense>
        </div>
        <div className="flex justify-center">
          <CoachPreview />
        </div>
      </section>
    </div>
  );
}
