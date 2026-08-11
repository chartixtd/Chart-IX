"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import {
  computePositionSize,
  FOREX_PAIRS,
  type AssetClass,
  type Direction,
  type ForexPairKey,
  type PositionSizeInput,
  type RiskMode,
  type StopMode,
} from "@/lib/position-size";

const ASSET_CLASSES: AssetClass[] = ["stocks", "crypto", "forex", "futures"];
const LEVERAGES = [1, 2, 5, 10, 20, 30, 50, 100, 200, 500];

/** 空字符串要保留成空（而不是 0），否则用户清空输入框会立刻变成 0。 */
function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const BAND_KEY = {
  "very-conservative": "band_very_conservative",
  conservative: "band_conservative",
  moderate: "band_moderate",
  high: "band_high",
  "very-high": "band_very_high",
} as const;

const BAND_COLOR = {
  "very-conservative": "text-success",
  conservative: "text-success",
  moderate: "text-warning",
  high: "text-danger",
  "very-high": "text-danger",
} as const;

const ERR_KEY = {
  "balance-invalid": "err_balance",
  "entry-invalid": "err_entry",
  "risk-invalid": "err_risk",
  "leverage-invalid": "err_leverage",
  "stop-invalid": "err_stop",
  "stop-distance-zero": "err_stop_zero",
} as const;

export default function PositionSizeClient() {
  const t = useTranslations("calculator");

  const [assetClass, setAssetClass] = useState<AssetClass>("stocks");
  const [direction, setDirection] = useState<Direction>("long");
  const [forexPair, setForexPair] = useState<ForexPairKey>("EUR/USD");
  const [balance, setBalance] = useState("10000");
  const [riskMode, setRiskMode] = useState<RiskMode>("percent");
  const [riskPercent, setRiskPercent] = useState("2");
  const [riskAmount, setRiskAmount] = useState("");
  const [entry, setEntry] = useState("");
  const [stopMode, setStopMode] = useState<StopMode>("price");
  const [stopPrice, setStopPrice] = useState("");
  const [stopPips, setStopPips] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [takeProfit, setTakeProfit] = useState("");
  const [feePercent, setFeePercent] = useState("");
  const [slippage, setSlippage] = useState("");
  // 期货标签页的默认状态是这个输入框空着（只有 placeholder），而引擎对空值
  // 回退按乘数 1 计算——初始值直接设成 "1"，让这个回退在界面上可见、可改，
  // 不要让用户以为「没填」等于「没影响」。
  const [multiplier, setMultiplier] = useState("1");

  const input: PositionSizeInput = {
    assetClass,
    direction,
    accountBalance: num(balance) ?? 0,
    riskMode,
    riskPercent: num(riskPercent),
    riskAmount: num(riskAmount),
    entryPrice: num(entry) ?? 0,
    // stopMode 只在外汇下可切换（相邻的 forexPair / contractMultiplier 同理按
    // 资产类别门控）——切回股票之类时页面渲染的是止损价输入框，若还把 "pips"
    // 原样透传给引擎，两边看到的字段就对不上了。
    stopMode: assetClass === "forex" ? stopMode : "price",
    stopPrice: num(stopPrice),
    stopPips: num(stopPips),
    leverage: num(leverage) ?? 1,
    forexPair: assetClass === "forex" ? forexPair : undefined,
    contractMultiplier: assetClass === "futures" ? num(multiplier) : undefined,
    takeProfitPrice: showAdvanced ? num(takeProfit) ?? null : null,
    feePercent: showAdvanced ? num(feePercent) : undefined,
    slippage: showAdvanced ? num(slippage) : undefined,
  };

  // 收起时把三个高级字段一并清空——否则输入框里的值还在但已不参与计算，
  // 重新展开时又会突然复活，结果变了却看不出原因。
  const toggleAdvanced = () => {
    setShowAdvanced((v) => {
      if (v) {
        setTakeProfit("");
        setFeePercent("");
        setSlippage("");
      }
      return !v;
    });
  };

  const result = computePositionSize(input);

  // 用户还没填完时不该看到红色报错——只有动过入场价才提示
  const touched = entry.trim() !== "";

  const unitLabel =
    assetClass === "forex" ? t("units_lots")
    : assetClass === "futures" ? t("units_contracts")
    : assetClass === "crypto" ? t("units_coins")
    : t("units_shares");

  const field = "w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none focus:border-gold/60";
  const label = "mb-1 block text-xs text-text-muted";
  const seg = (active: boolean) =>
    cn(
      "flex-1 rounded-sm px-3 py-2 text-sm transition-colors",
      active ? "bg-gold/15 text-gold" : "text-text-secondary hover:text-text-primary"
    );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:py-10">
      <h1 className="font-display text-2xl tracking-tighter text-text-primary lg:text-3xl">
        {t("title")}
      </h1>
      <p className="mt-2 text-sm text-text-secondary">{t("subtitle")}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ── 输入 ── */}
        <Card className="space-y-4">
          <div>
            <span className={label} id="asset-class-label">{t("asset_class")}</span>
            <div className="flex gap-1 rounded-sm border border-border-default p-1" role="group" aria-labelledby="asset-class-label">
              {ASSET_CLASSES.map((a) => (
                <button key={a} type="button" aria-pressed={assetClass === a} onClick={() => setAssetClass(a)} className={seg(assetClass === a)}>
                  {t(a)}
                </button>
              ))}
            </div>
          </div>

          {assetClass === "forex" && (
            <div>
              <label className={label} htmlFor="pair">{t("forex_pair")}</label>
              <select id="pair" className={field} value={forexPair}
                onChange={(e) => setForexPair(e.target.value as ForexPairKey)}>
                {(Object.keys(FOREX_PAIRS) as ForexPairKey[]).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <span className={label} id="direction-label">{t("direction")}</span>
            <div className="flex gap-1 rounded-sm border border-border-default p-1" role="group" aria-labelledby="direction-label">
              <button type="button" aria-pressed={direction === "long"} onClick={() => setDirection("long")} className={seg(direction === "long")}>
                {t("long")}
              </button>
              <button type="button" aria-pressed={direction === "short"} onClick={() => setDirection("short")} className={seg(direction === "short")}>
                {t("short")}
              </button>
            </div>
          </div>

          <div>
            <label className={label} htmlFor="balance">{t("account_balance")} (USD)</label>
            <input id="balance" type="number" inputMode="decimal" className={field}
              value={balance} onChange={(e) => setBalance(e.target.value)} />
          </div>

          <div>
            <label className={label} htmlFor="risk" id="risk-group-label">{t("risk_per_trade")}</label>
            <div className="mb-2 flex gap-1 rounded-sm border border-border-default p-1" role="group" aria-labelledby="risk-group-label">
              <button type="button" aria-pressed={riskMode === "percent"} onClick={() => setRiskMode("percent")} className={seg(riskMode === "percent")}>
                {t("risk_percent")}
              </button>
              <button type="button" aria-pressed={riskMode === "amount"} onClick={() => setRiskMode("amount")} className={seg(riskMode === "amount")}>
                {t("risk_amount")}
              </button>
            </div>
            {riskMode === "percent" ? (
              <input id="risk" type="number" inputMode="decimal" className={field} placeholder="2"
                value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} />
            ) : (
              <input id="risk" type="number" inputMode="decimal" className={field} placeholder="200"
                value={riskAmount} onChange={(e) => setRiskAmount(e.target.value)} />
            )}
          </div>

          <div>
            <label className={label} htmlFor="entry">{t("entry_price")}</label>
            <input id="entry" type="number" inputMode="decimal" className={field}
              value={entry} onChange={(e) => setEntry(e.target.value)} />
          </div>

          <div>
            <label className={label} htmlFor="stop" id="stop-group-label">{t("stop_loss")}</label>
            {assetClass === "forex" && (
              <div className="mb-2 flex gap-1 rounded-sm border border-border-default p-1" role="group" aria-labelledby="stop-group-label">
                <button type="button" aria-pressed={stopMode === "price"} onClick={() => setStopMode("price")} className={seg(stopMode === "price")}>
                  {t("stop_by_price")}
                </button>
                <button type="button" aria-pressed={stopMode === "pips"} onClick={() => setStopMode("pips")} className={seg(stopMode === "pips")}>
                  {t("stop_by_pips")}
                </button>
              </div>
            )}
            {stopMode === "price" || assetClass !== "forex" ? (
              <input id="stop" type="number" inputMode="decimal" className={field}
                value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} />
            ) : (
              <input id="stop" type="number" inputMode="decimal" className={field} placeholder="50"
                value={stopPips} onChange={(e) => setStopPips(e.target.value)} />
            )}
          </div>

          {assetClass === "futures" && (
            <div>
              <label className={label} htmlFor="mult">{t("contract_multiplier")}</label>
              <input id="mult" type="number" inputMode="decimal" className={field} placeholder="50"
                value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
            </div>
          )}

          <div>
            <label className={label} htmlFor="lev">{t("leverage")}</label>
            <select id="lev" className={field} value={leverage} onChange={(e) => setLeverage(e.target.value)}>
              {LEVERAGES.map((l) => <option key={l} value={l}>1:{l}</option>)}
            </select>
          </div>

          <button type="button" onClick={toggleAdvanced}
            className="text-xs text-text-muted transition-colors hover:text-gold">
            {showAdvanced ? "− " : "+ "}{t("advanced")}
          </button>

          {showAdvanced && (
            <div className="space-y-3 border-t border-border-default pt-3">
              <div>
                <label className={label} htmlFor="tp">{t("take_profit")}</label>
                <input id="tp" type="number" inputMode="decimal" className={field}
                  value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="fee">{t("fee_percent")}</label>
                <input id="fee" type="number" inputMode="decimal" className={field} placeholder="0.1"
                  value={feePercent} onChange={(e) => setFeePercent(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="slip">{t("slippage")}</label>
                <input id="slip" type="number" inputMode="decimal" className={field}
                  value={slippage} onChange={(e) => setSlippage(e.target.value)} />
              </div>
            </div>
          )}
        </Card>

        {/* ── 结果 ── */}
        <Card className="space-y-4">
          <h2 className="text-sm font-medium text-text-primary">{t("results")}</h2>

          {!result.ok ? (
            <p className={cn("text-sm", touched ? "text-danger" : "text-text-muted")}>
              {touched ? t(ERR_KEY[result.reason]) : t("enter_values")}
            </p>
          ) : (
            <>
              <div className="border-b border-border-default pb-4">
                <p className="text-xs text-text-muted">{t("position_size")}</p>
                <p className="mt-1 font-display text-3xl tracking-tighter text-gold">
                  {fmt(result.lots ?? result.units, result.lots !== null ? 3 : 2)}{" "}
                  <span className="text-base text-text-secondary">{unitLabel}</span>
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  ${fmt(result.positionValue)} {t("position_value")}
                </p>
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t("risk_amount_label")}</dt>
                  <dd className="tabular-nums text-text-primary">${fmt(result.riskAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t("stop_distance")}</dt>
                  <dd className="tabular-nums text-text-primary">
                    {/* 外汇的止损距离是点数尺度，不该套 $；其余资产类别的止损
                        距离就是一段美元价差，加 $ 前缀才对得上单位。 */}
                    {assetClass === "forex" ? "" : "$"}{fmt(result.stopDistance, 4)} ({fmt(result.stopDistancePct)}%)
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t("required_margin")}</dt>
                  <dd className="tabular-nums text-text-primary">${fmt(result.requiredMargin)}</dd>
                </div>
              </dl>

              <div className="border-t border-border-default pt-4">
                <p className="mb-2 text-xs text-text-muted">{t("risk_breakdown")}</p>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t("account_risk")}</dt>
                    <dd className="tabular-nums text-text-primary">{fmt(result.accountRiskPct, 1)}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t("position_risk")}</dt>
                    <dd className="tabular-nums text-text-primary">{fmt(result.positionRiskPct, 1)}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t("margin_used")}</dt>
                    <dd className="tabular-nums text-text-primary">{fmt(result.marginUsedPct, 1)}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t("max_losses")}</dt>
                    <dd className="tabular-nums text-text-primary">
                      {result.maxLosses} {t("max_losses_unit")}
                    </dd>
                  </div>
                </dl>
              </div>

              {result.riskRewardRatio !== null && (
                <div className="border-t border-border-default pt-4">
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-text-muted">{t("risk_reward")}</dt>
                      <dd className="tabular-nums text-text-primary">1:{fmt(result.riskRewardRatio)}</dd>
                    </div>
                    {/* expectedProfit 与 riskRewardRatio 由引擎里同一个 hasTp 判断驱动，
                        不会出现只有一个为 null 的情况——外层已经判过 riskRewardRatio
                        !== null，这里不用再判一次（原来的判断是死代码）。 */}
                    <div className="flex justify-between">
                      <dt className="text-text-muted">{t("expected_profit")}</dt>
                      <dd className="tabular-nums text-success">${fmt(result.expectedProfit as number)}</dd>
                    </div>
                  </dl>
                </div>
              )}

              <div className="border-t border-border-default pt-4">
                <p className="mb-1 text-xs text-text-muted">{t("risk_assessment")}</p>
                <p className={cn("text-lg font-medium", BAND_COLOR[result.riskBand])}>
                  {fmt(result.accountRiskPct, 1)}% · {t(BAND_KEY[result.riskBand])}
                </p>
              </div>
            </>
          )}
        </Card>
      </div>

      <p className="mt-6 text-xs text-text-muted">{t("disclaimer")}</p>
    </div>
  );
}
