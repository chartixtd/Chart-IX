import { Skeleton } from "@/components/ui/Skeleton";

export default function LearnLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:py-12">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-3 h-4 w-72" />

      <ul className="mt-8 divide-y divide-border-default border-y border-border-default">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex min-h-[64px] items-center justify-between gap-4 px-1 py-4">
            <span className="min-w-0 flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-3 w-40" />
            </span>
            <Skeleton className="h-4 w-4 shrink-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}
