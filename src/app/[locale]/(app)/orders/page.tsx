"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordList, type RecordColumn } from "@/components/ui/RecordList";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentTabs, StatRow } from "@/components/ui/Section";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOrderHistory } from "@/hooks/useOrderHistory";
import type { Order } from "@/types";

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

  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  const auth = useAuth();
  const query = useOrderHistory(auth.userId);

  // `query.data ?? []` 每次渲染都产生一个新数组引用，下面两个 useMemo 的
  // 依赖因此每次都变，等于白包。用 useMemo 稳住引用。
  const orders = useMemo(() => query.data ?? [], [query.data]);

  // 表格之前的那条统计带。filled 把部分成交也算进来，与下面的筛选口径一致。
  const summary = useMemo(() => {
    const filled = orders.filter((o) => o.status === "filled" || o.status === "partially_filled");
    return {
      filled: filled.length,
      pending: orders.filter((o) => o.status === "pending").length,
      volume: filled.reduce((sum, o) => sum + (o.total_value ?? 0), 0),
    };
  }, [orders]);

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

  const columns: RecordColumn<Order>[] = useMemo(
    () => [
      {
        key: "symbol",
        header: t("symbol"),
        primary: true,
        render: (order) => <span className="text-text-primary font-medium">{order.symbol}</span>,
      },
      {
        key: "side",
        header: t("side"),
        render: (order) => (
          <Badge variant={order.side === "buy" ? "green" : "red"} size="sm">
            {order.side === "buy" ? "Buy" : "Sell"}
          </Badge>
        ),
      },
      {
        key: "market_type",
        header: t("market_type"),
        // 不再 hideOnMobile：现货单和合约单的风险完全不是一回事，
        // 一份分不出这两者的成交记录读起来是危险的。徽章本身很小，
        // 手机卡片的两列网格放得下。
        render: (order) => (
          <Badge variant={order.market_type === "futures" ? "gold" : "blue"} size="sm">
            {order.market_type === "futures" ? "Futures" : "Spot"}
          </Badge>
        ),
      },
      {
        key: "order_type",
        header: t("type"),
        render: (order) => ORDER_TYPE_LABEL_MAP[order.order_type] || order.order_type,
      },
      {
        key: "quantity",
        header: t("quantity"),
        align: "right",
        render: (order) => <span className="font-mono">{order.quantity}</span>,
      },
      {
        key: "price",
        header: t("price"),
        align: "right",
        render: (order) => (
          <span className="font-mono">
            {order.order_type === "market"
              ? "-"
              : order.price !== null
                ? formatPrice(order.price)
                : "-"}
          </span>
        ),
      },
      {
        key: "status",
        header: t("status"),
        render: (order) => (
          <Badge variant={STATUS_VARIANT_MAP[order.status]} size="sm">
            {order.status === "partially_filled"
              ? "Partial"
              : order.status.charAt(0).toUpperCase() + order.status.slice(1)}
          </Badge>
        ),
      },
      {
        key: "total",
        header: t("total"),
        align: "right",
        render: (order) => (
          <span className="font-mono">
            {order.total_value !== null ? `$${formatPrice(order.total_value)}` : "-"}
          </span>
        ),
      },
      {
        key: "time",
        header: t("time"),
        // 手机上作为交易对旁边的副行显示，而不是砍掉。一份没有时间的成交
        // 记录没法对账——而完整时间戳塞进两列键值网格会被挤成三行，
        // 所以给它 secondary 这个整行角色。
        secondary: true,
        render: (order) => (
          <span className="text-text-secondary font-mono text-xs">
            {formatDate(order.created_at)}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  const exportCSV = useCallback(() => {
    const BOM = "\uFEFF";
    const headers = ["时间", "市场类型", "交易对", "方向", "类型", "数量", "价格", "状态", "总金额", "手续费"];
    const rows = filteredOrders.map((o) => [
      formatDate(o.created_at),
      o.market_type === "futures" ? "Futures" : "Spot",
      o.symbol,
      o.side === "buy" ? "Buy" : "Sell",
      ORDER_TYPE_LABEL_MAP[o.order_type] || o.order_type,
      String(o.quantity),
      o.price !== null ? String(o.price) : "-",
      o.status,
      o.total_value !== null ? String(o.total_value) : "-",
      o.fee !== null ? String(o.fee) : "-",
    ]);
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => {
        const escaped = String(cell).replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(","))
      .join("\n");
    const today = new Date().toISOString().slice(0, 10);
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chart-ix-orders-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filteredOrders]);

  if (auth.loading || (auth.userId && query.isPending)) {
    return (
      <div className="mx-auto max-w-page px-6 py-10 lg:py-16">
        {/* 骨架照着内容态的形状摆：标题 → 四格统计带 → 下划线标签 → 表格。
            少了统计带那一段，数据到位时整个表格会往下跳一整块。 */}
        <Skeleton className="h-10 w-56" />
        <Skeleton className="mt-4 h-4 w-72" />
        <div className="mt-10 grid grid-cols-2 gap-px border-y border-border-default bg-border-default sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-bg-primary px-1 py-5 sm:px-5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-3 h-5 w-24" />
            </div>
          ))}
        </div>
        <div className="mt-10 mb-6 flex gap-4 border-b border-border-default pb-3">
          {FILTER_TABS.map((tab) => (
            <Skeleton key={tab} className="h-4 w-14" />
          ))}
        </div>
        <div className="rounded-md">
          <div className="border-b border-border-default px-4 py-3">
            <div className="flex gap-4">
              {[...Array(9)].map((_, i) => (
                <div key={i} style={{ width: `${60 + i * 15}px` }}>
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border-b border-border-default px-4 py-4 last:border-0">
              <div className="flex gap-4">
                {[...Array(9)].map((_, j) => (
                  <div key={j} style={{ width: `${50 + j * 20}px` }}>
                    <Skeleton className="h-4 w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!auth.loading && !auth.userId) {
    return (
      <div className="mx-auto max-w-page px-6 py-10 lg:py-16">
        <EmptyState
          title={tSettings("please_login")}
          description={tSettings("api_keys_desc")}
        />
      </div>
    );
  }

  if (query.error && !query.data?.length) {
    return (
      <div className="mx-auto max-w-page px-6 py-10 lg:py-16">
        <div className="text-center py-24">
          <p className="text-danger">{(query.error as Error).message}</p>
          <Button variant="outline" className="mt-4" onClick={() => query.refetch()}>
            {tCommon("retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-6 py-10 lg:py-16">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        className="border-b-0 pb-0"
        actions={
          filteredOrders.length > 0 ? (
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t("export_csv")}
            </Button>
          ) : undefined
        }
      />

      {/* 表格之前先给一句结论：这段时间一共做了多少、成了多少、成交额多大 */}
      <StatRow
        className="mt-10"
        items={[
          { label: t("all"), value: orders.length },
          { label: t("filled"), value: summary.filled },
          { label: t("pending"), value: summary.pending },
          { label: t("total"), value: formatPrice(summary.volume), tone: "gold" },
        ]}
      />

      {query.error && !!query.data?.length && (
        <p className="mt-6 rounded-md border-l-2 border-danger bg-danger/10 px-4 py-3 text-sm text-danger">
          {(query.error as Error).message}
        </p>
      )}

      <div className="mt-10 border-b border-border-default">
        <SegmentTabs
          value={activeTab}
          onChange={(k) => setActiveTab(k as FilterTab)}
          options={FILTER_TABS.map((tab) => ({ key: tab, label: t(tab) }))}
        />
      </div>

      {filteredOrders.length === 0 ? (
        <EmptyState
          title={t("no_orders")}
          description={t(`empty_${activeTab}_desc`)}
        />
      ) : (
        <RecordList rows={filteredOrders} columns={columns} rowKey={(order) => order.id} />
      )}
    </div>
  );
}
