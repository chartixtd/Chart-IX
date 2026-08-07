import { Skeleton } from "@/components/ui/Skeleton";

export default function CommunityPostLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-6 h-8 w-3/4" />
      <div className="mt-4 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
      <Skeleton className="mt-8 h-24 w-full" />
    </div>
  );
}
