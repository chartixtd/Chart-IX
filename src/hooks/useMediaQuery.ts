"use client";

import { useEffect, useState } from "react";

/**
 * 仅用于「挂载哪一套外壳」这类决定——内容不该靠它分叉。
 *
 * 交易页是唯一需要它的地方：桌面的 4 栏可拖拽布局和手机的全屏图表布局
 * 结构差异太大，用 CSS 同时挂载会导致 KlineChart、OrdersPanel 等
 * 带副作用的组件各跑两份（这正是 useUserDataStream 引用计数的由来）。
 *
 * SSR 阶段仍返回 false；但客户端首次渲染（含水合帧）就是 lazy 初始化出的
 * 真实断点值，不再是「false → 下一帧翻转」。这意味着消费方如果在水合首帧就
 * 用它分叉出结构不同的两棵树，会跟 SSR 输出的 false 分支对不上，触发水合
 * 不一致——这种用法必须额外配合 useHydrated 门控（水合帧渲染中性骨架，
 * 之后再用 isDesktop 的首个真实值一次性挂载正确的树）。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
