"use client";

import { useEffect } from "react";
import { readPlatform } from "@/lib/pwa/platform";

/**
 * 禁用页面级双指缩放——但**只在安装到主屏的 standalone 模式下**。
 *
 * 浏览器标签页里必须放行缩放：viewport 已不再写 user-scalable=no，这里再
 * 无条件拦 gesture* 的话，文章/免责声明这类长文本在手机上就彻底无法放大
 * （WCAG 1.4.4）。standalone 里禁缩放是原生应用的预期行为，才值得拦。
 *
 * iOS 从 10 开始忽略 user-scalable=no，只有拦掉这三个 WebKit 私有事件才真正
 * 生效。K 线图和绘图层必须保留双指缩放（那是看图的核心操作），所以挂了
 * data-allow-zoom 的容器内一律放行。
 *
 * 同时给 <html> 打 standalone 类：globals.css 里 touch-action: pan-x pan-y
 * 这条（第二层禁缩放）也只该在 standalone 下生效。
 */
export function ZoomGuard() {
  useEffect(() => {
    if (!readPlatform().isStandalone) return;

    document.documentElement.classList.add("standalone");

    const block = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-allow-zoom]")) return;
      event.preventDefault();
    };

    const events = ["gesturestart", "gesturechange", "gestureend"];
    events.forEach((name) => document.addEventListener(name, block, { passive: false }));
    return () => {
      events.forEach((name) => document.removeEventListener(name, block));
      document.documentElement.classList.remove("standalone");
    };
  }, []);

  return null;
}
