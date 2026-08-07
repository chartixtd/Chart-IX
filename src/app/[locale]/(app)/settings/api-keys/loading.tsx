import { Skeleton } from "@/components/ui/Skeleton";

export default function ApiKeysLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:py-12">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-72" />
      <Skeleton className="mt-8 h-48 w-full" />
      <Skeleton className="mt-6 h-40 w-full" />
    </div>
  );
}
