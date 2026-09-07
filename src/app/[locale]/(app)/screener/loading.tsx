import { Skeleton } from "@/components/ui/Skeleton";

/**
 * 骨架照着真实构图摆：抬头（微标签 / 巨型数字 / 表盘 / tab）→ 门槛带 →
 * 区块标题 → 表格行。宽度与真实态一致，数据到位时整页不跳。
 */
export default function ScreenerLoading() {
  return (
    <div>
      <section className="hero-ground relative overflow-hidden">
        <div className="mx-auto max-w-[110rem] px-4 pt-8 lg:px-6 lg:pt-10">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-6 lg:mt-8 lg:gap-16">
            <div>
              <Skeleton className="h-[clamp(3rem,7.5vw,5.5rem)] w-[clamp(3rem,7.5vw,5.5rem)]" />
              <Skeleton className="mt-3 h-3 w-20" />
              <Skeleton className="mt-2 h-3 w-28" />
            </div>
            <div className="flex flex-col items-center">
              <Skeleton className="aspect-square w-[clamp(7rem,14vw,10rem)] rounded-full" />
              <Skeleton className="mt-4 h-3 w-16" />
            </div>
          </div>
        </div>
        <div className="mt-7 border-b border-border-default lg:mt-9">
          <div className="mx-auto flex max-w-[110rem] gap-6 px-4 py-3.5 lg:px-6">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[110rem] px-4 py-10 lg:px-6 lg:py-14">
        <div className="grid grid-cols-2 gap-px border-y border-border-default bg-border-default sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-bg-primary px-1 py-5 sm:px-5 sm:first:pl-0">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-5 w-24" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-14 h-7 w-40 lg:mt-20" />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
