import { Suspense } from "react";
import { OrderView } from "@/components/order-view";

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense>
      <OrderView id={id} />
    </Suspense>
  );
}
