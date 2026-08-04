"use client";

import { useEffect } from "react";

/**
 * 禁用页面级双指缩放的第三层（前两层是 viewport meta 与 html 的 touch-action）。
 * iOS 从 10 开始忽略 user-scalable=no，只有拦掉这三个 WebKit 私有事件才真正生效
 * ——而且仅在安装到主屏的 standalone 模式下可靠，浏览器标签页里 Safari 仍可能放行。
 *
 * K 线图和绘图层必须保留双指缩放（那是看图的核心操作），所以挂了
 * data-allow-zoom 的容器内一律放行。
 */
export function ZoomGuard() {
  useEffect(() => {
    const block = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-allow-zoom]")) return;
      event.preventDefault();
    };

    const events = ["gesturestart", "gesturechange", "gestureend"];
    events.forEach((name) => document.addEventListener(name, block, { passive: false }));
    return () => events.forEach((name) => document.removeEventListener(name, block));
  }, []);

  return null;
}
