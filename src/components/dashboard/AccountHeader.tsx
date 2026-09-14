"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { useMarketStore } from "@/stores/market";
import { usePaperAccount } from "@/hooks/usePaperTrading";
import { useSpotBalances } from "@/hooks/useTradingAccount";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn, formatPrice } from "@/lib/utils";

/** 模拟盘的起始本金。盈亏是拿当前总值减它算出来的 */
const PAPER_SEED = 10_000;

const BTN_BASE =
  "inline-flex h-11 select-none items-center justify-center rounded-sm px-6 text-xs font-medium uppercase" +
  " tracking-[0.14em] transition-all duration-300 ease-out active:translate-y-px active:duration-75" +
  " focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold focus-visible:ring-offset-2" +
  " focus-visible:ring-offset-bg-primary";

/**
 * 带符号的金额。零单独走 `±`——参考图上就是这么写的，而且它比一个光秃秃的
 * `0.00` 更明确地说「这一栏是盈亏，现在是平的」。
 */
function signedAmount(value: number): string {
  if (value === 0) return `±${formatPrice(0)}`;
  return `${value > 0 ? "+" : "−"}${formatPrice(Math.abs(value))}`;
}

function MetaItem({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-text-muted">{label}</span>{" "}
      <span
        className={cn(
          "font-mono tabular-nums",
          tone === "up" ? "text-success" : tone === "down" ? "text-danger" : "text-text-secondary"
        )}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * 主页抬头：一个数说清你现在有多少，一行刻度说清它由什么构成，两枚按钮
 * 说清接下来能做什么。
 *
 * 实盘 / 模拟的切换做在微标签那一格里，而不是另起一行分段控件。抬头的第一行
 * 本来就是「这是什么账户」，让它同时可点，比在巨型数字上面再压一条 tab 更省
 * 一层结构——那条 tab 在上一版里正好把数字推下去了一屏的四分之一。
 */
export function AccountHeader() {
  const locale = useLocale();
  const t = useTranslations("dashboard");
  const auth = useAuth();
  const [mode, setMode] = useState<"live" | "paper">("live");

  const { data: paperData, isLoading: paperLoading } = usePaperAccount(!!auth.userId);
  const { data: spotBalances, isLoading: spotLoading, error: spotError } = useSpotBalances(!!auth.userId);

  // 现货全部持仓按最新价折算 USDT——只报可用 USDT 现金会把有持仓的账户报成空的
  const { data: spotTickers } = useQuery({
    queryKey: ["dashboard", "spot-tickers"],
    queryFn: async () => {
      const res = await fetch("/api/bingx/market/ticker");
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Request failed");
      return json.data as { symbol: string; lastPrice: string }[];
    },
    enabled: !!auth.userId,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: false,
  });

  // 合约账户。`unrealizedProfit` 一直在这个响应里，只是以前没取
  const { data: futuresBalance } = useQuery({
    queryKey: ["dashboard", "futures-balance"],
    queryFn: async () => {
      const res = await fetch("/api/bingx/futures/positions?type=balance");
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || "Request failed");
      return json.data as { equity: string; unrealizedProfit: string } | null;
    },
    enabled: !!auth.userId,
    staleTime: 15_000,
    retry: false,
  });

  const spotPriceMap = useMemo(() => {
    const map = new Map<string, number>();
    (spotTickers ?? []).forEach((tk) => map.set(tk.symbol, parseFloat(tk.lastPrice) || 0));
    return map;
  }, [spotTickers]);

  const spotTotal = useMemo(
    () =>
      (spotBalances ?? []).reduce((sum, b) => {
        const qty = (parseFloat(b.free) || 0) + (parseFloat(b.locked) || 0);
        if (qty <= 0) return sum;
        if (b.asset === "USDT") return sum + qty;
        const price = spotPriceMap.get(`${b.asset}-USDT`);
        return price ? sum + qty * price : sum;
      }, 0),
    [spotBalances, spotPriceMap]
  );

  const futuresEquity = parseFloat(futuresBalance?.equity ?? "0") || 0;
  const futuresPnl = parseFloat(futuresBalance?.unrealizedProfit ?? "0") || 0;

  // 模拟盘：可用余额 + Σ(占用保证金 + 未实现盈亏)
  const paperPositionsEquity = (paperData?.positions ?? []).reduce((sum, p) => {
    const ticker = useMarketStore.getState().tickers[p.symbol];
    const entry = parseFloat(String(p.entry_price));
    const qty = parseFloat(String(p.quantity));
    const margin = parseFloat(String(p.margin));
    const mark = ticker ? Number(ticker.lastPrice) : entry;
    const uPnl = p.side === "long" ? (mark - entry) * qty : (entry - mark) * qty;
    return sum + margin + uPnl;
  }, 0);
  const paperTotal = (paperData?.account.balance_usdt ?? 0) + paperPositionsEquity;

  const isPaper = mode === "paper";
  const notConnected = !isPaper && !spotLoading && !!spotError;
  const loading = isPaper ? paperLoading : spotLoading;
  const total = isPaper ? paperTotal : spotTotal + futuresEquity;

  return (
    // 桌面：数字与刻度在左，两枚按钮在右端对齐底线。手机：上下堆叠
    <header className="lg:flex lg:items-end lg:justify-between lg:gap-12">
      <div className="min-w-0 lg:flex-1">
      <div className="flex items-start justify-between gap-4">
        {/* 微标签就是切换器本身 */}
        <div className="flex items-center gap-3">
          {(["live", "paper"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              aria-pressed={mode === key}
              className={cn(
                "text-[11px] font-medium uppercase tracking-[0.22em] transition-colors",
                mode === key ? "text-gold" : "text-text-faint hover:text-text-muted"
              )}
            >
              {t(key === "live" ? "live_account" : "paper_tab")}
            </button>
          ))}
        </div>

        <Link
          href={`/${locale}/settings`}
          aria-label={t("account_settings")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-hover lg:hidden text-text-muted transition-colors hover:border-gold/50 hover:text-gold"
        >
          <Icon name="users" className="h-4 w-4" />
        </Link>
      </div>

      {loading ? (
        <Skeleton className="mt-4 h-[3.25rem] w-56" />
      ) : notConnected ? (
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-text-secondary">
          {t("not_connected")}{" "}
          <Link href={`/${locale}/settings/api-keys`} className="link-underline text-gold">
            {t("connect_api_cta")}
          </Link>
        </p>
      ) : (
        <>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="numeral text-[clamp(2.5rem,11vw,3.5rem)] lg:text-[4rem] leading-none text-text-primary">
              {formatPrice(total)}
            </span>
            <span className="font-mono text-[13px] text-text-muted">USDT</span>
          </p>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
            {isPaper ? (
              <>
                <MetaItem label={t("meta_balance")} value={formatPrice(paperData?.account.balance_usdt ?? 0)} />
                <MetaItem
                  label={t("meta_pnl")}
                  value={signedAmount(paperData ? paperTotal - PAPER_SEED : 0)}
                  tone={paperTotal - PAPER_SEED > 0 ? "up" : paperTotal - PAPER_SEED < 0 ? "down" : undefined}
                />
              </>
            ) : (
              <>
                <MetaItem label={t("meta_futures")} value={formatPrice(futuresEquity)} />
                <MetaItem label={t("meta_spot")} value={formatPrice(spotTotal)} />
                <MetaItem
                  label={t("meta_pnl")}
                  value={signedAmount(futuresPnl)}
                  tone={futuresPnl > 0 ? "up" : futuresPnl < 0 ? "down" : undefined}
                />
              </>
            )}
          </div>
        </>
      )}

      </div>

      {/* 手机上两枚按钮平分整行；桌面上它们收成自己的宽度靠右——
          一枚撑满半屏的按钮不会因为更大而更容易点中 */}
      <div className="mt-6 flex gap-3 lg:mt-0 lg:shrink-0">
        <Link
          href={`/${locale}/trade`}
          className={cn(BTN_BASE, "flex-1 gilt foil-sheen font-semibold lg:flex-none lg:w-40")}
        >
          {t("trade_cta")}
        </Link>
        <Link
          href={`/${locale}/orders`}
          className={cn(
            BTN_BASE,
            "flex-1 border border-gold/50 text-gold hover:border-gold hover:bg-gold/[0.07] lg:flex-none lg:w-40"
          )}
        >
          {t("orders_cta")}
        </Link>
      </div>
    </header>
  );
}
