"use client";

import { TrainFrontIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSession } from "@/components/session-provider";
import type { ApiError, Train } from "@/lib/api";
import { NewTrainDialog } from "./new-train-dialog";

export function TrainList() {
  const { request } = useSession();
  const [trains, setTrains] = useState<Train[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // shortcut: first 100 trains only (api() drops nextCursor); add paging past 100 trains
  const load = useCallback(
    () =>
      request<Train[]>("/api/admin/all-trains?limit=100")
        .then(setTrains)
        .catch((e: ApiError) => setError(e.message)),
    [request],
  );
  useEffect(() => void load(), [load]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Trains</h1>
        <NewTrainDialog onCreated={load} />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load trains</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : !trains ? (
        <Skeleton className="h-48" />
      ) : !trains.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TrainFrontIcon />
            </EmptyMedia>
            <EmptyTitle>No trains yet</EmptyTitle>
            <EmptyDescription>Add a train with its coaches, then schedule trips for it.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewTrainDialog onCreated={load} />
          </EmptyContent>
        </Empty>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">No.</TableHead>
                <TableHead>Train</TableHead>
                <TableHead>Route</TableHead>
                <TableHead className="text-right">Seats</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trains.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="tabular">{t.number}</TableCell>
                  <TableCell>
                    <Link href={`/admin/trains/${t.number}`} className="font-medium underline-offset-4 hover:underline">
                      {t.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.fromStation} → {t.toStation}
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {t.coaches.reduce((n, c) => n + c.seatCount, 0)}
                    <span className="text-muted-foreground"> · {t.coaches.length} coaches</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
