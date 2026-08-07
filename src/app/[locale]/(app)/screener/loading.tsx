import { Skeleton } from "@/components/ui/Skeleton";

export default function ScreenerLoading() {
  return (
    <div className="mx-auto max-w-[110rem] px-4 py-6">
      <Skeleton className="h-8 w-48" />
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
