import { Skeleton } from "@/components/ui/Skeleton";

export default function VideosLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <div className="h-9 w-48 animate-pulse rounded-sm bg-bg-tertiary" />
      <div className="mt-6 flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-sm" />
        ))}
      </div>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-md panel">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
