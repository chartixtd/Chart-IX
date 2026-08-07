import { Skeleton } from "@/components/ui/Skeleton";

export default function LearnLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-3 h-4 w-72" />

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border-default bg-bg-secondary p-5"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20 rounded-sm" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="mt-4 h-5 w-3/4" />
            <Skeleton className="mt-2.5 h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
