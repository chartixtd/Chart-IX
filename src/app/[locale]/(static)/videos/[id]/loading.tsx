import { Skeleton } from "@/components/ui/Skeleton";

export default function VideoDetailLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Skeleton className="aspect-video w-full" />
      <Skeleton className="mt-6 h-8 w-2/3" />
      <div className="mt-3 flex gap-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="mt-8 h-40 w-full" />
    </div>
  );
}
