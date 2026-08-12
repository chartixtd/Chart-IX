"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 价格变动闪烁 —— 交易面允许保留的"功能性动效"。
 *
 * 它不是装饰：行情列表里十几个交易对同时刷新，纯数字变化在余光里几乎不可见，
 * 一次 800ms 的底色闪烁是用户察觉"这一行刚动了"的唯一线索。
 *
 * 实现上刻意不用 state 存旧价：只在价格真的变化时触发一次 setState，
 * 相同价格重复推送（BingX 的 ticker 流会）不会造成任何重渲染。
 */
export type PriceFlash = "up" | "down" | null;

export function usePriceFlash(price: number | undefined): PriceFlash {
  const prevRef = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<PriceFlash>(null);

  useEffect(() => {
    if (price === undefined || Number.isNaN(price)) return;
    const prev = prevRef.current;
    prevRef.current = price;
    // 首次拿到价格不闪——那是"加载完成"，不是"价格变了"
    if (prev === undefined || prev === price) return;

    setFlash(price > prev ? "up" : "down");
    // 与 tailwind.config 里 price-up / price-down 的 0.8s 时长对齐；
    // 提前清掉 class，下一次同向变化才能重新触发动画
    const timer = window.setTimeout(() => setFlash(null), 800);
    return () => window.clearTimeout(timer);
  }, [price]);

  return flash;
}
