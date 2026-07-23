"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { RiskConfig } from "@/types";

interface RiskEditorProps {
  configs: RiskConfig[];
}

interface TierFormState {
  max_order_amount: string;
  max_daily_orders: string;
  max_leverage: string;
  allowed_symbols: string;
  saving: boolean;
  message: { type: "success" | "error"; text: string } | null;
}

function createInitialState(config: RiskConfig | undefined): TierFormState {
  return {
    max_order_amount: config?.max_order_amount?.toString() ?? "",
    max_daily_orders: config?.max_daily_orders?.toString() ?? "",
    max_leverage: config?.max_leverage?.toString() ?? "",
    allowed_symbols: config?.allowed_symbols?.join(", ") ?? "",
    saving: false,
    message: null,
  };
}

export function RiskEditor({ configs }: RiskEditorProps) {
  const router = useRouter();
  const t = useTranslations("admin");
  const freeConfig = configs.find((c) => c.tier === "free");
  const proConfig = configs.find((c) => c.tier === "pro");

  const [free, setFree] = useState<TierFormState>(() => createInitialState(freeConfig));
  const [pro, setPro] = useState<TierFormState>(() => createInitialState(proConfig));

  const saveTier = async (tier: "free" | "pro", state: TierFormState, setState: (s: TierFormState) => void) => {
    setState({ ...state, saving: true, message: null });

    try {
      const body: Record<string, unknown> = { tier };
      const maxOrderAmount = parseFloat(state.max_order_amount);
      const maxDailyOrders = parseInt(state.max_daily_orders, 10);
      const maxLeverage = parseInt(state.max_leverage, 10);

      if (!isNaN(maxOrderAmount)) body.max_order_amount = maxOrderAmount;
      if (!isNaN(maxDailyOrders)) body.max_daily_orders = maxDailyOrders;
      if (!isNaN(maxLeverage)) body.max_leverage = maxLeverage;
      body.allowed_symbols = state.allowed_symbols
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      const res = await fetch("/api/admin/risk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (res.ok) {
        setState({ ...state, saving: false, message: { type: "success", text: t("risk_list.saved_success") } });
        router.refresh();
      } else {
        setState({ ...state, saving: false, message: { type: "error", text: json.error ?? t("risk_list.save_failed") } });
      }
    } catch {
      setState({ ...state, saving: false, message: { type: "error", text: t("risk_list.network_error") } });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Free Tier Card */}
      <Card padding="lg">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{t("risk_list.free_tier")}</h2>
            <p className="text-sm text-text-muted">{t("risk_list.free_tier_desc")}</p>
          </div>
          <span className="rounded-sm border border-border-default bg-bg-tertiary px-2 py-0.5 text-xs text-text-muted">
            free
          </span>
        </div>

        <div className="space-y-4">
          <Input
            label={t("risk_list.max_order_amount")}
            type="number"
            step="any"
            placeholder="e.g. 5000"
            value={free.max_order_amount}
            onChange={(e) => setFree({ ...free, max_order_amount: e.target.value, message: null })}
          />
          <Input
            label={t("risk_list.max_daily_orders")}
            type="number"
            placeholder="e.g. 10"
            value={free.max_daily_orders}
            onChange={(e) => setFree({ ...free, max_daily_orders: e.target.value, message: null })}
          />
          <Input
            label={t("risk_list.max_leverage")}
            type="number"
            placeholder="e.g. 5"
            value={free.max_leverage}
            onChange={(e) => setFree({ ...free, max_leverage: e.target.value, message: null })}
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {t("risk_list.allowed_symbols")}
            </label>
            <textarea
              className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold hover:border-border-hover min-h-[80px] resize-y"
              placeholder="e.g. BTCUSDT, ETHUSDT, BNBUSDT"
              value={free.allowed_symbols}
              onChange={(e) => setFree({ ...free, allowed_symbols: e.target.value, message: null })}
            />
            <p className="text-xs text-text-muted">{t("risk_list.symbols_hint")}</p>
          </div>

          {free.message && (
            <p
              className={`rounded-sm px-3 py-2 text-sm ${
                free.message.type === "success"
                  ? "bg-success-bg text-success"
                  : "bg-danger-bg text-danger"
              }`}
            >
              {free.message.text}
            </p>
          )}

          <Button
            onClick={() => saveTier("free", free, setFree)}
            loading={free.saving}
            className="w-full"
          >
            {t("risk_list.save_free")}
          </Button>
        </div>
      </Card>

      {/* Pro Tier Card */}
      <Card padding="lg">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gold">{t("risk_list.pro_tier")}</h2>
            <p className="text-sm text-text-muted">{t("risk_list.pro_tier_desc")}</p>
          </div>
          <span className="rounded-sm border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
            pro
          </span>
        </div>

        <div className="space-y-4">
          <Input
            label={t("risk_list.max_order_amount")}
            type="number"
            step="any"
            placeholder="e.g. 50000"
            value={pro.max_order_amount}
            onChange={(e) => setPro({ ...pro, max_order_amount: e.target.value, message: null })}
          />
          <Input
            label={t("risk_list.max_daily_orders")}
            type="number"
            placeholder="e.g. 100"
            value={pro.max_daily_orders}
            onChange={(e) => setPro({ ...pro, max_daily_orders: e.target.value, message: null })}
          />
          <Input
            label={t("risk_list.max_leverage")}
            type="number"
            hint={t("risk_list.pro_leverage_hint")}
            placeholder="e.g. 125"
            value={pro.max_leverage}
            onChange={(e) => setPro({ ...pro, max_leverage: e.target.value, message: null })}
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {t("risk_list.allowed_symbols")}
            </label>
            <textarea
              className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold hover:border-border-hover min-h-[80px] resize-y"
              placeholder="e.g. BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, DOGEUSDT"
              value={pro.allowed_symbols}
              onChange={(e) => setPro({ ...pro, allowed_symbols: e.target.value, message: null })}
            />
            <p className="text-xs text-text-muted">{t("risk_list.symbols_hint")}</p>
          </div>

          {pro.message && (
            <p
              className={`rounded-sm px-3 py-2 text-sm ${
                pro.message.type === "success"
                  ? "bg-success-bg text-success"
                  : "bg-danger-bg text-danger"
              }`}
            >
              {pro.message.text}
            </p>
          )}

          <Button
            onClick={() => saveTier("pro", pro, setPro)}
            loading={pro.saving}
            className="w-full"
          >
            {t("risk_list.save_pro")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
