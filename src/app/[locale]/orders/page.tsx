"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/utils";

interface Order {
  id: string;
  user_id: string;
  api_key_id: string | null;
  market_type: "spot" | "futures";
  symbol: string;
  side: "buy" | "sell";
  order_type: "market" | "limit" | "stop_loss" | "take_profit" | "stop_market";
  quantity: number;
  price: number | null;
  stop_price: number | null;
  leverage: number;
  status: "pending" | "filled" | "partially_filled" | "canceled" | "rejected" | "expired";
  bingx_order_id: string | null;
  executed_qty: number | null;
  executed_price: number | null;
  total_value: number | null;
  fee: number | null;
  fee_asset: string | null;
  error_message: string | null;
  risk_rejected: boolean;
  risk_reason: string | null;
  created_at: string;
  updated_at: string;
}

type FilterTab = "all" | "pending" | "filled" | "canceled" | "rejected";

const FILTER_TABS: FilterTab[] = ["all", "pending", "filled", "canceled", "rejected"];

const STATUS_VARIANT_MAP: Record<Order["status"], "orange" | "green" | "blue" | "gray" | "red"> = {
  pending: "orange",
  filled: "green",
  partially_filled: "blue",
  canceled: "gray",
  rejected: "red",
  expired: "gray",
};

const ORDER_TYPE_LABEL_MAP: Record<Order["order_type"], string> = {
  market: "Market",
  limit: "Limit",
  stop_loss: "Stop Loss",
  take_profit: "Take Profit",
  stop_market: "Stop Market",
};

export default function OrdersPage() {
  const t = useTranslations("trade.orders");
  const tCommon = useTranslations("common");
  const tSettings = useTranslations("settings");

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const supabase = createClient();

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotLoggedIn(false);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setNotLoggedIn(true);
      setLoading(false);
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
    } else {
      setOrders(data || []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const filteredOrders = useMemo(() => {
    if (activeTab === "all") return orders;
    if (activeTab === "filled") {
      return orders.filter((o) => o.status === "filled" || o.status === "partially_filled");
    }
    return orders.filter((o) => o.status === activeTab);
  }, [orders, activeTab]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <div className="mb-4 flex gap-2">
          {FILTER_TABS.map((tab) => (
            <Skeleton key={tab} className="h-9 w-20 rounded-sm" />
          ))}
        </div>
        <div className="rounded-md border border-border-default bg-bg-secondary">
          <div className="border-b border-border-default px-4 py-3">
            <div className="flex gap-4">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-bg-tertiary" style={{ width: `${60 + i * 15}px` }} />
              ))}
            </div>
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border-b border-border-default px-4 py-4 last:border-0">
              <div className="flex gap-4">
                {[...Array(9)].map((_, j) => (
                  <div key={j} className="h-4 animate-pulse rounded bg-bg-tertiary" style={{ width: `${50 + j * 20}px` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (notLoggedIn) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <EmptyState
          title={tSettings("please_login")}
          description={tSettings("api_keys_desc")}
        />
      </div>
    );
  }

  if (error && !orders.length) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="text-center py-24">
          <p className="text-danger">{error}</p>
          <Button variant="outline" className="mt-4" onClick={fetchOrders}>
            {tCommon("error")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-text-primary">{t("title")}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t("no_orders")}</p>
      </div>

      {error && (
        <div className="mb-4 rounded-sm border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-sm px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-gold text-black"
                : "bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-border-default"
            }`}
          >
            {t(tab)}
          </button>
        ))}
      </div>

      {filteredOrders.length === 0 ? (
        <EmptyState
          title={t("no_orders")}
          description={activeTab !== "all" ? t(activeTab) : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-default bg-bg-secondary">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default bg-bg-tertiary">
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-text-secondary">
                  {t("time")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-text-secondary">
                  {t("market_type") || "Market"}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-text-secondary">
                  {t("symbol")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-text-secondary">
                  {t("side")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-text-secondary">
                  {t("type")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-text-secondary">
                  {t("quantity")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-text-secondary">
                  {t("price")}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-center font-medium text-text-secondary">
                  {t("status") || "Status"}
                </th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-medium text-text-secondary">
                  {t("total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  className="border-b border-border-default last:border-0 hover:bg-bg-tertiary/50 transition-colors"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-text-secondary font-mono text-xs">
                    {formatDate(order.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge
                      variant={order.market_type === "futures" ? "gold" : "blue"}
                      size="sm"
                    >
                      {order.market_type === "futures" ? "Futures" : "Spot"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-primary font-medium">
                    {order.symbol}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge
                      variant={order.side === "buy" ? "green" : "red"}
                      size="sm"
                    >
                      {order.side === "buy" ? "Buy" : "Sell"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-text-secondary">
                    {ORDER_TYPE_LABEL_MAP[order.order_type] || order.order_type}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-text-primary">
                    {order.quantity}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-text-primary">
                    {order.order_type === "market"
                      ? "-"
                      : order.price !== null
                        ? formatPrice(order.price)
                        : "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-center">
                    <Badge variant={STATUS_VARIANT_MAP[order.status]} size="sm">
                      {order.status === "partially_filled"
                        ? "Partial"
                        : order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-text-primary">
                    {order.total_value !== null
                      ? `$${formatPrice(order.total_value)}`
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
