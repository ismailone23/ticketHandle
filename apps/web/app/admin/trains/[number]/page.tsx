import { TrainDetail } from "@/components/admin/train-detail";

export default async function AdminTrainPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return <TrainDetail number={number} />;
}
