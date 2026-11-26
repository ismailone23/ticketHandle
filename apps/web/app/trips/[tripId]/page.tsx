import { Suspense } from "react";
import { SeatPicker } from "@/components/seat-picker";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return (
    <Suspense>
      <SeatPicker tripId={tripId} />
    </Suspense>
  );
}
