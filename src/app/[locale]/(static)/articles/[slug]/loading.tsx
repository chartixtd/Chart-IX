import { Skeleton } from "@/components/ui/Skeleton";

export default function ArticleDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Skeleton className="h-4 w-28" />

      <Skeleton className="mt-6 h-4 w-20" />
      <Skeleton className="mt-3 h-9 w-5/6" />

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-14 rounded-sm" />
      </div>

      <Skeleton className="mt-6 aspect-video w-full rounded-lg" />

      <div className="mt-8 space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className={i % 4 === 3 ? "h-4 w-2/3" : "h-4 w-full"} />
        ))}
      </div>
    </div>
  );
}
