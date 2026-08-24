"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatPrice, formatNumber, cn } from "@/lib/utils";

/** 超过这个杠杆时显示更醒目的警示 */
const HIGH_LEVERAGE_THRESHOLD = 20;

interface OrderConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  market: "spot" | "futures" | "paper";
  /** 现货用 BUY/SELL 语义，合约与模拟盘用 LONG/SHORT */
  direction: "LONG" | "SHORT";
  symbol: string;
  baseAsset: string;
  orderTypeLabel: string;
  /** 仓位名义额（USDT） */
  notionalUsdt: number;
  /** 换算出的币数量 */
  estQty: number;
  /** 参考价 */
  price: number;
  leverage: number;
  requiredMarginUsdt: number;
  estLiquidationPrice?: number | null;
  /** 可用余额；未知时隐藏占比行 */
  availableUsdt?: number;
}

export function OrderConfirmModal({
  open, onClose, onConfirm, loading = false,
  market, direction, symbol, baseAsset, orderTypeLabel,
  notionalUsdt, estQty, price, leverage, requiredMarginUsdt,
  estLiquidationPrice, availableUsdt,
}: OrderConfirmModalProps) {
  const t = useTranslations();
  const isLong = direction === "LONG";
  const isFutures = market === "futures" || market === "paper";
  const isPaper = market === "paper";
  const highLeverage = isFutures && leverage > HIGH_LEVERAGE_THRESHOLD;

  const pctOfBalance =
    availableUsdt && availableUsdt > 0 ? (requiredMarginUsdt / availableUsdt) * 100 : null;

  return (
    <Modal open={open} onClose={loading ? () => {} : onClose} title={t("trading.confirm_title")} size="sm" surface="panel">
      <div className="space-y-4">
        {isPaper && (
          <div className="rounded-xs bg-gold/10 px-3 py-1.5 text-center text-xs font-medium text-gold">
            {t("trading.paper_banner")}
          </div>
        )}

        <p className="text-sm text-text-secondary">
          {t.rich("trading.confirm_summary", {
            dir: () => (
              <span className={cn("mx-1 font-semibold", isLong ? "text-success" : "text-danger")}>
                {t(isFutures
                  ? isLong ? "trading.side.long" : "trading.side.short"
                  : isLong ? "trading.side.buy" : "trading.side.sell")}
              </span>
            ),
            qty: () => (
              <span className="font-semibold text-text-primary">
                {formatNumber(estQty, 8)} {baseAsset}
              </span>
            ),
            notional: () => (
              <span className="font-semibold text-text-primary">
                {formatPrice(notionalUsdt)} USDT
              </span>
            ),
          })}
        </p>

        <div className="rounded-xs border border-border-default bg-bg-tertiary p-3 text-xs">
          <Row label={t("trading.symbol")} value={symbol} />
          <Row label={t("trading.order_type")} value={orderTypeLabel} />
          <Row label={t("trading.est_price")} value={formatPrice(price)} />
          <Row label={t("trading.notional")} value={`${formatPrice(notionalUsdt)} USDT`} />
          {isFutures && <Row label={t("trading.leverage")} value={`${leverage}x`} danger={highLeverage} />}
          {/* 名义额与保证金必须同屏出现：这是新手最容易混淆的一步 */}
          {isFutures && (
            <Row
              label={t("trading.required_margin")}
              value={`${formatPrice(requiredMarginUsdt)} USDT`}
              emphasis
            />
          )}
          {isFutures && estLiquidationPrice != null && leverage > 1 && (
            <Row label={t("trading.est_liq_price")} value={`≈ ${formatPrice(estLiquidationPrice)}`} />
          )}
          {pctOfBalance !== null && (
            <Row label={t("trading.pct_of_balance")} value={`${pctOfBalance.toFixed(1)}%`} />
          )}
        </div>

        {highLeverage && (
          <div className="rounded-xs border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {t("trading.high_leverage_warning", { leverage })}
          </div>
        )}

        <p className="text-xs text-text-muted">{t("trading.risk_note")}</p>

        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button variant={isLong ? "green" : "red"} size="sm" onClick={onConfirm} loading={loading}>
            {t("trading.confirm_button")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({
  label, value, emphasis, danger,
}: { label: string; value: string; emphasis?: boolean; danger?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-text-muted">{label}</span>
      <span
        className={cn(
          "font-mono tabular-nums",
          danger ? "font-semibold text-danger" : emphasis ? "font-semibold text-gold" : "text-text-primary"
        )}
      >
        {value}
      </span>
    </div>
  );
}
