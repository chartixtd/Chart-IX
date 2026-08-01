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

  return (
    <div className={cn("px-3 py-2 hover:bg-bg-hover/50", highlighted && "bg-gold/5")}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-text-primary">{pos.symbol}</span>
          <span className={cn("text-xs font-semibold", isLong ? "text-success" : "text-danger")}>
            {isLong ? "LONG" : "SHORT"}
          </span>
          <span className="text-xs text-text-muted">{pos.isolated ? "isolated" : "cross"} · {pos.leverage}x</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => (editingTpSl ? setEditingTpSl(false) : startTpSl())} className="text-xs text-text-muted hover:text-gold">
            {editingTpSl ? t("common.cancel") : "TP/SL"}
          </button>
          <button
            onClick={() => setReverseConfirmOpen(true)}
            disabled={closing || reducingPct !== null || reversing}
            className="text-xs text-text-muted hover:text-gold disabled:opacity-50"
          >
            {reversing ? "..." : "Reverse"}
          </button>
          <button
            onClick={handleClose}
            disabled={closing || reducingPct !== null || reversing}
            className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
          >
            {closing ? "..." : "Close"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-2 text-xs">
        <span className="text-text-muted">Size</span><span className="text-text-primary text-right">{formatBySpec(parseFloat(pos.positionAmt), spec?.quantityPrecision)}</span>
        <span className="text-text-muted">Entry</span><span className="text-text-primary text-right">{formatBySpec(parseFloat(pos.avgPrice), spec?.pricePrecision)}</span>
        <span className="text-text-muted">Mark</span><span className="text-text-primary text-right">{formatBySpec(parseFloat(pos.markPrice), spec?.pricePrecision)}</span>
        <span className="text-text-muted">Liq</span><span className="text-text-primary text-right">{formatBySpec(parseFloat(pos.liquidationPrice), spec?.pricePrecision)}</span>
        <span className="text-text-muted">Margin</span><span className="text-text-primary text-right">{margin.toFixed(2)} USDT</span>
        <span className="text-text-muted">Value</span><span className="text-text-primary text-right">{notional.toFixed(2)} USDT</span>
        <span className="text-text-muted">PnL</span>
        <span className={cn("text-right font-medium", pnl >= 0 ? "text-success" : "text-danger")}>
          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} USDT
        </span>
        <span className="text-text-muted">ROI</span>
        <span className={cn("text-right font-medium", roi >= 0 ? "text-success" : "text-danger")}>
          {roi >= 0 ? "+" : ""}{roi.toFixed(2)}%
        </span>
        <span className="text-text-muted">TP / SL</span>
        <span className="text-right text-text-primary">
          {currentTp ? formatBySpec(parseFloat(currentTp), spec?.pricePrecision) : "-"}
          {" / "}
          {currentSl ? formatBySpec(parseFloat(currentSl), spec?.pricePrecision) : "-"}
        </span>
      </div>

      {/* 部分平仓：按比例快捷按钮，点了直接下市价只减仓单，不需要额外输入数量 */}
      <div className="mt-1.5 flex items-center gap-1">
        <span className="text-xs text-text-muted mr-1">Reduce</span>
        {CLOSE_PERCENTS.map((p) => (
          <button
            key={p}
            onClick={() => handleReduceOnlyClose(p)}
            disabled={reducingPct !== null || closing || reversing}
            className="rounded-xs border border-border-default px-1.5 py-0.5 text-xs text-text-muted hover:border-gold hover:text-gold disabled:opacity-50"
          >
            {reducingPct === p ? "..." : `${p}%`}
          </button>
        ))}
      </div>

      {actionError && <p className="mt-1 text-xs text-danger">{actionError}</p>}

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
