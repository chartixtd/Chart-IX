import { cn } from "@/lib/utils";

/**
 * 环境光晕层。本设计里"发光"的全部预算——氛围里的光，不是描边上的光。
 * 父容器必须是 relative + overflow-hidden，否则 80px 模糊会溢出到相邻区块。
 * 纯 CSS transform 动画，prefers-reduced-motion 下由 globals.css 直接停掉。
 */
export function AuraField({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="aura aura-gold animate-aura-a -left-40 -top-48 h-[36rem] w-[36rem]" />
      <div className="aura aura-warm animate-aura-b -right-32 top-1/3 h-[28rem] w-[28rem]" />
    </div>
  );
}
