import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { TRADE_SHELL_HEIGHT } from "./shell";

export default function TradeLoading() {
  return (
    <div className={cn("flex flex-col gap-2 p-2", TRADE_SHELL_HEIGHT)}>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="min-h-0 flex-1" />
      <Skeleton className="h-40 w-full lg:h-56" />
    </div>
  );
}
