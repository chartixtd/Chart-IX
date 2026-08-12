import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-sm", className)} />;
}

export function SkeletonCard() {
  return (
    <div className="panel space-y-3 rounded-xl p-4">
      <Skeleton className="aspect-video w-full rounded-lg" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}
