"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn, formatBySpec } from "@/lib/utils";
import { useFuturesContracts, type FuturesPosition } from "@/hooks/useTradingAccount";

interface ActionResult {
  ok: boolean;
  message?: string;
}

interface FuturesPositionRowProps {
  position: FuturesPosition;
  /** 当前图表 symbol 是否匹配这条持仓——只影响高亮，不影响列表内容 */
  highlighted: boolean;
  /** 当前生效的止盈/止损触发价——BingX 持仓接口本身不带这个，由调用方从挂单列表反查后传入 */
  currentTp?: string;
  currentSl?: string;
  onClose: (position: FuturesPosition) => Promise<ActionResult>;
  onReduceOnlyClose: (position: FuturesPosition, percent: number) => Promise<ActionResult>;
  onReverse: (position: FuturesPosition) => Promise<ActionResult>;
  onSaveTpSl: (position: FuturesPosition, tp: string, sl: string) => Promise<ActionResult>;
}

const CLOSE_PERCENTS = [25, 50, 75, 100];

export function FuturesPositionRow({
  position: pos, highlighted, currentTp, currentSl, onClose, onReduceOnlyClose, onReverse, onSaveTpSl,
}: FuturesPositionRowProps) {
  const t = useTranslations();
  const { data: contracts } = useFuturesContracts();
  const spec = contracts?.get(pos.symbol);
  const [closing, setClosing] = useState(false);
  const [reducingPct, setReducingPct] = useState<number | null>(null);
  const [reversing, setReversing] = useState(false);
  const [reverseConfirmOpen, setReverseConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [editingTpSl, setEditingTpSl] = useState(false);
  const [tpValue, setTpValue] = useState("");
  const [slValue, setSlValue] = useState("");
  const [savingTpSl, setSavingTpSl] = useState(false);
  const [tpSlError, setTpSlError] = useState<string | null>(null);

  const pnl = parseFloat(pos.unrealizedProfit);
  const isLong = pos.positionSide === "LONG";
  const mark = parseFloat(pos.markPrice);
  const qty = parseFloat(pos.positionAmt);
  const margin = parseFloat(pos.initialMargin);
  // BingX 持仓接口不直接返回仓位名义价值，按数量 × 标记价现算，不依赖
  // 未经验证的 notional 字段（该字段在 BingX 文档里叫 positionValue，
  // 名字对不上，实测很可能是 undefined）
  const notional = Math.abs(qty) * mark;
  const roi = margin > 0 ? (pnl / margin) * 100 : 0;

  const startTpSl = () => {
    setTpValue("");
    setSlValue("");
    setTpSlError(null);
    setEditingTpSl(true);
  };

  const saveTpSl = async () => {
    const tp = parseFloat(tpValue);
    const sl = parseFloat(slValue);
    const hasTp = tp > 0;
    const hasSl = sl > 0;
    if (!hasTp && !hasSl) {
      setTpSlError(t("trading.tpsl_required"));
      return;
    }
    if (hasTp && (isLong ? tp <= mark : tp >= mark)) {
      setTpSlError(isLong ? t("trading.tp_must_be_above") : t("trading.tp_must_be_below"));
      return;
    }
    if (hasSl && (isLong ? sl >= mark : sl <= mark)) {
      setTpSlError(isLong ? t("trading.sl_must_be_below") : t("trading.sl_must_be_above"));
      return;
    }
    // 只校验方向（上面两条）挡不住"少打两个零"这类离谱输入——比如止损打成 1，
    // 仍然满足"低于标记价"，会一路发到 BingX 才被拒（报错还很含糊）。这里补一
    // 道数量级检查，在本地就能给出明确提示。
    const isFarFromMark = (price: number) => price < mark * 0.2 || price > mark * 5;
    if ((hasTp && isFarFromMark(tp)) || (hasSl && isFarFromMark(sl))) {
      setTpSlError(t("trading.price_too_far_from_mark", { limit: mark.toFixed(4) }));
      return;
    }
    setSavingTpSl(true);
    setTpSlError(null);
    const result = await onSaveTpSl(pos, hasTp ? String(tp) : "", hasSl ? String(sl) : "");
    setSavingTpSl(false);
    if (!result.ok) {
      setTpSlError(result.message ?? "Failed to save TP/SL");
      return;
    }
    setEditingTpSl(false);
  };

  const handleClose = async () => {
    setClosing(true);
    setActionError(null);
    const result = await onClose(pos);
    setClosing(false);
    if (!result.ok) setActionError(result.message ?? "Failed to close position");
  };

  const handleReduceOnlyClose = async (percent: number) => {
    setReducingPct(percent);
    setActionError(null);
    const result = await onReduceOnlyClose(pos, percent);
    setReducingPct(null);
    if (!result.ok) setActionError(result.message ?? "Failed to reduce position");
  };

  const handleReverse = async () => {
    setReversing(true);
    setActionError(null);
    const result = await onReverse(pos);
    setReversing(false);
    setReverseConfirmOpen(false);
    if (!result.ok) setActionError(result.message ?? "Failed to reverse position");
  };

  const stats: Array<{ label: string; value: string }> = [
    { label: "Size", value: formatBySpec(Math.abs(qty), spec?.quantityPrecision) },
    { label: "Entry", value: formatBySpec(parseFloat(pos.avgPrice), spec?.pricePrecision) },
    { label: "Mark", value: formatBySpec(mark, spec?.pricePrecision) },
    { label: "Liq", value: formatBySpec(parseFloat(pos.liquidationPrice), spec?.pricePrecision) },
    { label: "Margin", value: `${margin.toFixed(2)}` },
    { label: "Value", value: `${notional.toFixed(2)}` },
  ];

  return (
    <div className={cn("px-3 py-3 transition-colors hover:bg-bg-hover/40", highlighted && "bg-gold/[0.04]")}>
      {/* 标识行：symbol + 方向徽记 + 保证金模式/杠杆，操作按钮靠右 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{pos.symbol}</span>
          <span
            className={cn(
              "rounded-xs px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
              isLong ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
            )}
          >
            {isLong ? "LONG" : "SHORT"}
          </span>
          <span className="text-[11px] text-text-muted">{pos.isolated ? "isolated" : "cross"} · {pos.leverage}x</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => (editingTpSl ? setEditingTpSl(false) : startTpSl())}
            className={cn(
              "rounded-xs border px-2 py-1 text-[11px] font-medium transition-colors",
              editingTpSl
                ? "border-gold/50 bg-gold/10 text-gold"
                : "border-border-default text-text-secondary hover:border-gold/40 hover:text-gold"
            )}
          >
            {editingTpSl ? t("common.cancel") : "TP/SL"}
          </button>
          <button
            onClick={() => setReverseConfirmOpen(true)}
            disabled={closing || reducingPct !== null || reversing}
            className="rounded-xs border border-border-default px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-gold/40 hover:text-gold disabled:opacity-40"
          >
            {reversing ? "…" : "Reverse"}
          </button>
          <button
            onClick={handleClose}
            disabled={closing || reducingPct !== null || reversing}
            className="rounded-xs border border-danger/30 bg-danger-bg px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:border-danger/60 disabled:opacity-40"
          >
            {closing ? "…" : "Close"}
          </button>
        </div>
      </div>

      {/* PnL 是整行里最重要的数字，单独一行放大；ROI 用色块标出正负 */}
      <div className="mt-2 flex items-baseline gap-2">
        <span className={cn("font-mono text-lg font-semibold tabular-nums", pnl >= 0 ? "text-success" : "text-danger")}>
          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
        </span>
        <span className="text-xs text-text-muted">USDT</span>
        <span
          className={cn(
            "rounded-xs px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums",
            roi >= 0 ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
          )}
        >
          {roi >= 0 ? "+" : ""}{roi.toFixed(2)}%
        </span>
      </div>

      {/* 次要数据用统一的标签在上、等宽数字在下的格子铺开，比一行一个 label:value 更好扫读 */}
      <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-[10px] uppercase tracking-wide text-text-muted">{s.label}</div>
            <div className="font-mono text-xs tabular-nums text-text-primary">{s.value}</div>
          </div>
        ))}
      </div>

      {/* 当前止盈止损用色块徽记而不是一串"数字/数字"，一眼能看出有没有设置、设的是哪边 */}
      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">TP/SL</span>
        {currentTp ? (
          <span className="rounded-xs bg-success-bg px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-success">
            {formatBySpec(parseFloat(currentTp), spec?.pricePrecision)}
          </span>
        ) : (
          <span className="text-[11px] text-text-muted/60">—</span>
        )}
        {currentSl ? (
          <span className="rounded-xs bg-danger-bg px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-danger">
            {formatBySpec(parseFloat(currentSl), spec?.pricePrecision)}
          </span>
        ) : (
          <span className="text-[11px] text-text-muted/60">—</span>
        )}
      </div>

      {/* 部分平仓：按比例快捷按钮，点了直接下市价只减仓单，不需要额外输入数量 */}
      <div className="mt-2 flex items-center gap-1">
        <span className="mr-1 text-[11px] text-text-muted">Reduce</span>
        {CLOSE_PERCENTS.map((p) => (
          <button
            key={p}
            onClick={() => handleReduceOnlyClose(p)}
            disabled={reducingPct !== null || closing || reversing}
            className="rounded-xs border border-border-default px-1.5 py-0.5 text-[11px] text-text-muted transition-colors hover:border-gold/40 hover:text-gold disabled:opacity-50"
          >
            {reducingPct === p ? "…" : `${p}%`}
          </button>
        ))}
      </div>

      {actionError && <p className="mt-1.5 text-xs text-danger">{actionError}</p>}

      {editingTpSl && (
        <div className="mt-2 space-y-1.5 rounded border border-border-default p-2">
          <div className="flex items-center gap-1.5">
            <span className="w-10 shrink-0 text-xs text-text-muted">TP</span>
            <input
              type="number"
              value={tpValue}
              onChange={(e) => setTpValue(e.target.value)}
              placeholder={mark.toFixed(4)}
              className={cn(
                "min-w-0 flex-1 rounded border px-1.5 py-0.5 text-xs font-medium placeholder:font-normal placeholder:text-text-muted/60",
                tpValue ? "border-gold bg-gold/10 text-text-primary" : "border-border-default bg-bg-input text-text-primary"
              )}
            />
            {tpValue && (
              <button
                type="button"
                onClick={() => setTpValue("")}
                className="shrink-0 text-xs text-text-muted hover:text-danger"
                aria-label="clear TP"
              >
                ×
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-10 shrink-0 text-xs text-text-muted">SL</span>
            <input
              type="number"
              value={slValue}
              onChange={(e) => setSlValue(e.target.value)}
              placeholder={mark.toFixed(4)}
              className={cn(
                "min-w-0 flex-1 rounded border px-1.5 py-0.5 text-xs font-medium placeholder:font-normal placeholder:text-text-muted/60",
                slValue ? "border-gold bg-gold/10 text-text-primary" : "border-border-default bg-bg-input text-text-primary"
              )}
            />
            {slValue && (
              <button
                type="button"
                onClick={() => setSlValue("")}
                className="shrink-0 text-xs text-text-muted hover:text-danger"
                aria-label="clear SL"
              >
                ×
              </button>
            )}
          </div>
          {tpSlError && <p className="text-xs text-danger">{tpSlError}</p>}
          <button
            onClick={saveTpSl}
            disabled={savingTpSl}
            className="w-full rounded bg-gold py-1 text-xs font-medium text-black disabled:opacity-50"
          >
            {savingTpSl ? "..." : t("trading.set_tp_sl")}
          </button>
        </div>
      )}

      {reverseConfirmOpen && (
        <div className="mt-2 space-y-1.5 rounded border border-gold/40 bg-gold/5 p-2">
          <p className="text-xs text-text-secondary">
            Reverse position: this is two separate orders (market close, then market open the opposite side at the same size). Price may move between the two — the reopened size could differ slightly. Continue?
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setReverseConfirmOpen(false)} className="text-xs text-text-muted hover:text-text-primary">
              Cancel
            </button>
            <button
              onClick={handleReverse}
              disabled={closing || reducingPct !== null || reversing}
              className="rounded bg-gold px-2 py-1 text-xs font-medium text-black disabled:opacity-50"
            >
              {reversing ? "..." : "Confirm Reverse"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
