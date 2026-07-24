"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { formatPrice, formatNumber, cn } from "@/lib/utils";

interface OrderConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
  side: "BUY" | "SELL";
  symbol: string;
  orderTypeLabel: string;
  /** Amount in quote currency (USDT) being spent (buy) or received (sell) */
  amountUsdt: number;
  /** Reference price used for the plain-language estimate */
  price: number;
  /** Available balance in USDT, if known — omit to hide the "% of balance" line */
  balanceUsdt?: number;
  isPaper?: boolean;
}

export function OrderConfirmModal({
  open,
  onClose,
  onConfirm,
  loading = false,
  side,
  symbol,
  orderTypeLabel,
  amountUsdt,
  price,
  balanceUsdt,
  isPaper = false,
}: OrderConfirmModalProps) {
  const base = symbol.split("-")[0] ?? symbol;
  const estQty = price > 0 ? amountUsdt / price : 0;
  const pctOfBalance = balanceUsdt && balanceUsdt > 0 ? (amountUsdt / balanceUsdt) * 100 : null;
  const isBuy = side === "BUY";

  return (
    <Modal open={open} onClose={loading ? () => {} : onClose} title="确认订单 / Confirm Order" size="sm">
      <div className="space-y-4">
        {isPaper && (
          <div className="rounded-xs bg-gold/10 px-3 py-1.5 text-center text-xs font-medium text-gold">
            模拟盘 · 不涉及真实资金 / Paper Trading — no real funds
          </div>
        )}

        <p className="text-sm text-text-secondary">
          你将
          <span className={cn("mx-1 font-semibold", isBuy ? "text-success" : "text-danger")}>
            {isBuy ? "买入" : "卖出"}
          </span>
          约 <span className="font-semibold text-text-primary">{formatNumber(estQty, 6)} {base}</span>
          ，使用 <span className="font-semibold text-text-primary">{formatPrice(amountUsdt)} USDT</span>
          {pctOfBalance !== null && (
            <>
              ，约占可用余额的
              <span className="mx-1 font-semibold text-text-primary">{pctOfBalance.toFixed(1)}%</span>
            </>
          )}
          。
        </p>

        <div className="rounded-xs border border-border-default bg-bg-tertiary p-3 text-xs">
          <div className="flex justify-between py-0.5">
            <span className="text-text-muted">Symbol</span>
            <span className="text-text-primary">{symbol}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-text-muted">Type</span>
            <span className="text-text-primary">{orderTypeLabel}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-text-muted">Est. Price</span>
            <span className="text-text-primary">{formatPrice(price)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-text-muted">Amount</span>
            <span className="text-text-primary">{formatPrice(amountUsdt)} USDT</span>
          </div>
        </div>

        <p className="text-xs text-text-muted">
          交易涉及风险，价格可能在下单后发生变化，实际成交价以最终结果为准。
        </p>

        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            取消 / Cancel
          </Button>
          <Button
            variant={isBuy ? "green" : "red"}
            size="sm"
            onClick={onConfirm}
            loading={loading}
          >
            确认{isBuy ? "买入" : "卖出"} / Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}
