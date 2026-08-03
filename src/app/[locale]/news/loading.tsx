import { Skeleton } from "@/components/ui/Skeleton";

export default function NewsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <Skeleton className="h-9 w-48" />

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-md border border-border-default bg-bg-secondary"
          >
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-3 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
