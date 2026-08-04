"use client";

import { useEffect, useState } from "react";

/**
 * 仅用于「挂载哪一套外壳」这类决定——内容不该靠它分叉。
 *
 * 交易页是唯一需要它的地方：桌面的 4 栏可拖拽布局和手机的全屏图表布局
 * 结构差异太大，用 CSS 同时挂载会导致 KlineChart、OrdersPanel 等
 * 带副作用的组件各跑两份（这正是 useUserDataStream 引用计数的由来）。
 *
 * SSR 阶段返回 false：先按手机渲染再在客户端修正，比反过来更安全——
 * 手机布局在宽屏上只是显得空旷，桌面布局在窄屏上会直接溢出。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
