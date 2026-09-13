import { Skeleton } from "@/components/ui/Skeleton";

/**
 * 骨架的容器宽度与内容态必须一致（max-w-page / px-6 / py-12），否则数据到位
 * 时整页宽度会跳一次——这一条在第二轮改版里已经踩过一次。
 */
export default function LearnLoading() {
  return (
    <div className="mx-auto max-w-page px-6 py-12 lg:py-16">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <Skeleton className="h-10 w-56" />
          <Skeleton className="mt-4 h-4 w-72" />
        </div>
        <Skeleton className="h-5 w-24" />
      </div>

      {/* 继续学习 */}
      <Skeleton className="mt-8 h-[104px] w-full rounded-xl" />

      {/* 课程卡带 */}
      <div className="mt-12 flex items-baseline justify-between gap-4">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="mt-6 flex gap-3 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[184px] w-[168px] shrink-0 rounded-xl lg:h-[196px] lg:w-[200px]" />
        ))}
      </div>

      {/* 文章与资讯 */}
      <div className="mt-12 divide-y divide-border-default border-y border-border-default">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-5">
            <Skeleton className="h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-3 w-56" />
            </div>
            <Skeleton className="h-3.5 w-3.5 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
