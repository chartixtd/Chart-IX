"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 首屏的金属 IX。
 *
 * 三层叠加构成"金属"的观感：
 *   1. 9 段金箔渐变（.foil-text），50% 处的高光带缓慢横扫
 *   2. 指针视差 ±10px，字与背景反向位移，产生浮起的深度
 *   3. 背后两团环境光晕（由页面提供），透过字面边缘漏光
 *
 * 视差只在有精确指针（鼠标/触控板）时启用。触摸设备走 deviceorientation
 * 在 iOS 上需要用户手势授权，为了一个装饰效果弹权限框是不划算的——那里
 * 由扫光动画独自承担。
 */
export function MetallicMonogram({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    let raf = 0;
    let tx = 0;
    let ty = 0;

    const onMove = (e: PointerEvent) => {
      // 归一化到 [-1, 1]，再乘位移上限。反向位移让字看起来比背景更靠近观察者。
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      tx = -nx * 10;
      ty = -ny * 10;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(
        "foil-text pointer-events-none select-none font-display font-bold leading-none",
        // will-change 只在这一个元素上，别扩散——它是有显存成本的
        "will-change-transform [transition:transform_600ms_cubic-bezier(0.16,1,0.3,1)]",
        className
      )}
    >
      IX
    </span>
  );
}
