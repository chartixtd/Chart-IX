import { Skeleton } from "@/components/ui/Skeleton";

export default function TradeLoading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col gap-2 p-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="min-h-0 flex-1" />
      <Skeleton className="h-40 w-full lg:h-56" />
    </div>
  );
}
