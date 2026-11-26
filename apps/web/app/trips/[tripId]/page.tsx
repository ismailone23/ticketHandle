import { Suspense } from "react";
import { SeatPicker } from "@/components/seat-picker";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return (
    <Suspense>
      <div className="mx-auto w-full max-w-5xl">
        <SeatPicker tripId={tripId} />
      </div>
    </Suspense>
  );
}
