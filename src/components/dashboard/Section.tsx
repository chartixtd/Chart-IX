import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 主页的区块头。
 *
 * 与 ui/Section.tsx 的 `SectionHeading` 是两件东西：那一个带 `.section-mark`
 * 的金色短线，给的是「这是一节内容」的仪式感；主页是**一屏之内四个区块连排**，
 * 四条金线会把这一页变成一张清单。这里只用字号与明度分层：标题 + 右侧一段
 * 等宽的读数（几个活着、多久重扫一次、多少期）。
 */
export function DashSection({
  title,
  meta,
  action,
  children,
  className,
}: {
  title: string;
  /** 右侧的等宽读数。是数据不是装饰——没有就别放 */
  meta?: ReactNode;
  /** 右侧的链接。与 meta 二选一 */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-10 lg:mt-12", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xl font-medium tracking-tight text-text-primary lg:text-2xl">
          {title}
        </h2>
        {meta ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-muted">{meta}</span>
        ) : null}
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** 区块里的一行提示：空态、报错、未连接。一句话 + 可选的一个出口 */
export function DashNote({ children }: { children: ReactNode }) {
  return <p className="py-3 text-[13px] leading-relaxed text-text-muted">{children}</p>;
}
