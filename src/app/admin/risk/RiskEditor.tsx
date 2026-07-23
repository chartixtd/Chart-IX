"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
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
}

function createInitialState(config: RiskConfig | undefined): TierFormState {
  return {
    max_order_amount: config?.max_order_amount?.toString() ?? "",
    max_daily_orders: config?.max_daily_orders?.toString() ?? "",
    max_leverage: config?.max_leverage?.toString() ?? "",
    allowed_symbols: config?.allowed_symbols?.join(", ") ?? "",
    saving: false,
  };
}

function isTierDirty(current: TierFormState, initial: TierFormState): boolean {
  return (
    current.max_order_amount !== initial.max_order_amount ||
    current.max_daily_orders !== initial.max_daily_orders ||
    current.max_leverage !== initial.max_leverage ||
    current.allowed_symbols !== initial.allowed_symbols
  );
}

export function RiskEditor({ configs }: RiskEditorProps) {
  const router = useRouter();
  const t = useTranslations("admin");
  const { toast } = useToast();

  const freeConfig = configs.find((c) => c.tier === "free");
  const proConfig = configs.find((c) => c.tier === "pro");

  const initialFree = useRef(createInitialState(freeConfig));
  const initialPro = useRef(createInitialState(proConfig));

  const [free, setFreeState] = useState<TierFormState>(() => createInitialState(freeConfig));
  const [pro, setProState] = useState<TierFormState>(() => createInitialState(proConfig));

  const freeDirty = isTierDirty(free, initialFree.current);
  const proDirty = isTierDirty(pro, initialPro.current);

  const updateFree = useCallback((partial: Partial<TierFormState>) => {
    setFreeState((prev) => ({ ...prev, ...partial }));
  }, []);

  const updatePro = useCallback((partial: Partial<TierFormState>) => {
    setProState((prev) => ({ ...prev, ...partial }));
  }, []);

  const saveTier = async (tier: "free" | "pro", state: TierFormState, setState: (s: TierFormState) => void) => {
    setState({ ...state, saving: true });

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
        toast(t("risk_list.saved_success"), "success");
        setState({ ...state, saving: false });
        router.refresh();
        // Update initial ref so the form resets to "not dirty"
        if (tier === "free") {
          initialFree.current = { ...state, saving: false };
        } else {
          initialPro.current = { ...state, saving: false };
        }
      } else {
        toast(json.error ?? t("risk_list.save_failed"), "error");
        setState({ ...state, saving: false });
      }
    } catch {
      toast(t("risk_list.network_error"), "error");
      setState({ ...state, saving: false });
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
            onChange={(e) => updateFree({ max_order_amount: e.target.value })}
          />
          <Input
            label={t("risk_list.max_daily_orders")}
            type="number"
            placeholder="e.g. 10"
            value={free.max_daily_orders}
            onChange={(e) => updateFree({ max_daily_orders: e.target.value })}
          />
          <Input
            label={t("risk_list.max_leverage")}
            type="number"
            placeholder="e.g. 5"
            value={free.max_leverage}
            onChange={(e) => updateFree({ max_leverage: e.target.value })}
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {t("risk_list.allowed_symbols")}
            </label>
            <textarea
              className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold hover:border-border-hover min-h-[80px] resize-y"
              placeholder="e.g. BTCUSDT, ETHUSDT, BNBUSDT"
              value={free.allowed_symbols}
              onChange={(e) => updateFree({ allowed_symbols: e.target.value })}
            />
            <p className="text-xs text-text-muted">{t("risk_list.symbols_hint")}</p>
          </div>

          <Button
            onClick={() => saveTier("free", free, setFreeState)}
            loading={free.saving}
            disabled={!freeDirty}
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
            onChange={(e) => updatePro({ max_order_amount: e.target.value })}
          />
          <Input
            label={t("risk_list.max_daily_orders")}
            type="number"
            placeholder="e.g. 100"
            value={pro.max_daily_orders}
            onChange={(e) => updatePro({ max_daily_orders: e.target.value })}
          />
          <Input
            label={t("risk_list.max_leverage")}
            type="number"
            hint={t("risk_list.pro_leverage_hint")}
            placeholder="e.g. 125"
            value={pro.max_leverage}
            onChange={(e) => updatePro({ max_leverage: e.target.value })}
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {t("risk_list.allowed_symbols")}
            </label>
            <textarea
              className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold hover:border-border-hover min-h-[80px] resize-y"
              placeholder="e.g. BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, DOGEUSDT"
              value={pro.allowed_symbols}
              onChange={(e) => updatePro({ allowed_symbols: e.target.value })}
            />
            <p className="text-xs text-text-muted">{t("risk_list.symbols_hint")}</p>
          </div>

          <Button
            onClick={() => saveTier("pro", pro, setProState)}
            loading={pro.saving}
            disabled={!proDirty}
            className="w-full"
          >
            {t("risk_list.save_pro")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
