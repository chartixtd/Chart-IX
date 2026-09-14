"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useFavoritesStore } from "@/stores/favorites";
import { useMarketStore } from "@/stores/market";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { GoldChart } from "@/components/motion/GoldChart";
import { DashSection, DashNote } from "./Section";
import { cn, formatPrice, formatPercent } from "@/lib/utils";

/**
 * 主页上最多列五行。自选超过五个的人，第六个之后的价值在交易页而不是这里；
 * 每一行还挂着一条自取 K 线的曲线，行数就是请求数。
 */
const MAX_ROWS = 5;

function WatchRow({ symbol }: { symbol: string }) {
  const ticker = useMarketStore((s) => s.tickers[symbol]);
  const coin = symbol.replace(/-USDT$/, "");
  // 用 parseFloat 不用 Number：上游的涨跌幅可能带着结尾的 % 号，
  // Number("-0.15%") 是 NaN，会在行情行上印出一个 NaN%。
  // 有限性检查照样留着——拿不到就不渲染这一行，不要印 NaN。
  const rawPct = ticker ? parseFloat(ticker.priceChangePercent) : NaN;
  const pct = Number.isFinite(rawPct) ? rawPct : null;

  return (
    <li className="flex items-center gap-4 border-b border-border-default py-3 last:border-b-0">
      {/* 最小宽度让短代号对齐，但不设上限：NCCOGOLD2USD 这类长代号必须
          完整读得出来，挤掉一点曲线的宽度是对的取舍 */}
      <span className="min-w-[3.5rem] shrink-0 font-mono text-[15px] font-medium tracking-tight text-text-primary">
        {coin}
      </span>

      {/* 曲线是这一行的「形状」，不是它的读数——不加标签、不加坐标 */}
      <span className="h-6 min-w-0 flex-1 opacity-70">
        <GoldChart symbol={symbol} interval="1h" limit={48} labels={false} grid={false} dot={false} height={28} />
      </span>

      <span className="shrink-0 text-right">
        <span className="block font-mono text-[13px] tabular-nums text-text-primary">
          {ticker ? formatPrice(Number(ticker.lastPrice)) : "—"}
        </span>
        {pct !== null && (
          <span
            className={cn(
              "mt-0.5 block font-mono text-[11px] tabular-nums",
              pct >= 0 ? "text-success" : "text-danger"
            )}
          >
            {formatPercent(pct)}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * 自选行情。
 *
 * 行情走 spot 的 WebSocket（`useBingXWebSocket` 订阅、`useMarketStore` 读），
 * 与交易页是同一条连接的同一套数据；曲线各自取 1 小时 K 线。**不要换成
 * `useCardPrices`**——那一个取的是永续价，代号看起来一模一样，混用会得到
 * 一个静悄悄错掉的价格（见那个文件顶部的说明）。
 */
export function WatchlistSection() {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const favorites = useFavoritesStore((s) => s.favorites);
  const shown = favorites.slice(0, MAX_ROWS);

  useBingXWebSocket(shown);

  return (
    <DashSection
      title={t("favorites_title")}
      action={
        favorites.length > MAX_ROWS ? (
          <Link
            href={`/${locale}/trade`}
            className="shrink-0 text-[13px] text-gold transition-colors hover:text-gold-hover"
          >
            {t("favorites_more", { count: favorites.length - MAX_ROWS })}
          </Link>
        ) : null
      }
    >
      {shown.length === 0 ? (
        <DashNote>
          {t("favorites_empty")}{" "}
          <Link href={`/${locale}/trade`} className="link-underline text-gold">
            {t("favorites_cta")}
          </Link>
        </DashNote>
      ) : (
        <ul className="flex flex-col">
          {shown.map((symbol) => (
            <WatchRow key={symbol} symbol={symbol} />
          ))}
        </ul>
      )}
    </DashSection>
  );
}
