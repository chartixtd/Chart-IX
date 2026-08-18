"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SCAN_INTERVAL_MS } from "@/lib/screener/types";

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 每秒更新的 state 关在这个小组件里，不放在 ScreenerPage 上——
 * 否则每秒的 setNow 会让整个页面重渲染，把 ScannerTable 外面的 memo
 * 打废（即便 memo 本身比对通过，父组件重渲染这件事也会白跑一轮 diff）。
 *
 * lastUpdated <= 0（还没成功拉到过数据）时不渲染任何东西；报错时
 * 由调用方决定是否渲染这个组件——那会是一个冻在 00:00 的假进度，
 * 不该继续显示。
 */
export function ScanCountdown({ lastUpdated }: { lastUpdated: number }) {
  const t = useTranslations("screener");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (lastUpdated <= 0) return null;

  const remaining = lastUpdated + SCAN_INTERVAL_MS - now;

  return (
    <span className="tnum text-xs text-text-secondary">
      {t("next_scan")} {formatCountdown(remaining)}
    </span>
  );
}
