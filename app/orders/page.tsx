import { OrdersClient } from "@/components/orders/orders-client";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-6">
      <h1 className="border-b pb-3 text-2xl font-semibold">Order reviews</h1>
      <OrdersClient />
    </main>
  );
}
