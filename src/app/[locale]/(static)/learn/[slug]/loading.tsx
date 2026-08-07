import { Skeleton } from "@/components/ui/Skeleton";

export default function LearningPathLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Skeleton className="h-8 w-64" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    </div>
  );
}
