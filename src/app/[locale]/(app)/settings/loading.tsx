import { Skeleton } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 lg:py-12">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-8 h-64 w-full" />
      <Skeleton className="mt-6 h-32 w-full" />
      <Skeleton className="mt-6 h-28 w-full" />
    </div>
  );
}
