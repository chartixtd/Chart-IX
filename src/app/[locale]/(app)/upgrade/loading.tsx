import { Skeleton } from "@/components/ui/Skeleton";

export default function UpgradeLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <Skeleton className="mx-auto h-4 w-40" />
        <Skeleton className="mx-auto mt-6 h-12 w-3/4" />
        <Skeleton className="mx-auto mt-5 h-5 w-2/3" />
      </div>
      <div className="mx-auto mt-16 grid max-w-3xl gap-6 md:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
