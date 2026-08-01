"use client";

import { useFuturesBalance } from "@/hooks/useTradingAccount";

/**
 * 合约账户权益/可用保证金——挂在下单表单下方而不是持仓面板里，
 * 因为它是"我还能开多大仓位"的决策依据，跟下单表单同屏比跟持仓列表同屏更有用。
 */
export function FuturesWalletSummary() {
  const { data: balance = null } = useFuturesBalance();

  return (
    <div className="border-t border-gold/20 px-3 py-2.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">合约钱包</span>
      {balance ? (
        <div className="mt-1.5 flex items-baseline justify-between">
          <div>
            <div className="text-[11px] text-text-muted">权益</div>
            <div className="font-mono text-sm font-medium tabular-nums text-text-primary">
              {parseFloat(balance.equity).toFixed(2)} <span className="text-[11px] font-sans text-text-muted">USDT</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-text-muted">可用保证金</div>
            <div className="font-mono text-sm font-medium tabular-nums text-text-primary">
              {parseFloat(balance.availableMargin).toFixed(2)} <span className="text-[11px] font-sans text-text-muted">USDT</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-xs text-text-muted">—</p>
      )}
    </div>
  );
}
