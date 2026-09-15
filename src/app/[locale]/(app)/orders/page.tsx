"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordList, type RecordColumn } from "@/components/ui/RecordList";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentTabs, StatRow } from "@/components/ui/Section";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { useOrderHistory, useOrderSync, ORDER_PAGE_SIZE } from "@/hooks/useOrderHistory";
import { orderTypeLabel, displayPrice, type OrderRow } from "@/lib/orders/row";
import type { OrderStatus } from "@/types";

type FilterTab = "all" | "pending" | "filled" | "canceled" | "rejected";
type SourceTab = "all" | "live" | "paper";

const FILTER_TABS: FilterTab[] = ["all", "pending", "filled", "canceled", "rejected"];
const SOURCE_TABS: SourceTab[] = ["all", "live", "paper"];

const STATUS_VARIANT_MAP: Record<OrderStatus, "orange" | "green" | "blue" | "gray" | "red"> = {
  pending: "orange",
  filled: "green",
  partially_filled: "blue",
  canceled: "gray",
  rejected: "red",
  expired: "gray",
};

export default function OrdersPage() {
  const t = useTranslations("trade.orders");
  const tCommon = useTranslations("common");
  const tSettings = useTranslations("settings");

  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [source, setSource] = useState<SourceTab>("all");
  const [limit, setLimit] = useState(ORDER_PAGE_SIZE);
  const [detail, setDetail] = useState<OrderRow | null>(null);

  const auth = useAuth();
  const query = useOrderHistory(auth.userId, limit);
  // 进页面先跟交易所对一次账：本地只记了「单已发出」，成没成、成交均价
  // 与手续费都要回查才知道。见 src/lib/trading/reconcile.ts。
  const { syncing, sync } = useOrderSync(auth.userId);

  // `query.data ?? []` 每次渲染都产生一个新数组引用，下面几个 useMemo 的
  // 依赖因此每次都变，等于白包。用 useMemo 稳住引用。
  const allRows = useMemo(() => query.data ?? [], [query.data]);

  const rows = useMemo(
    () => (source === "all" ? allRows : allRows.filter((o) => o.source === source)),
    [allRows, source]
  );

  // 表格之前的那条统计带。filled 把部分成交也算进来，与下面的筛选口径一致。
  const summary = useMemo(() => {
    const filled = rows.filter((o) => o.status === "filled" || o.status === "partially_filled");
    return {
      filled: filled.length,
      pending: rows.filter((o) => o.status === "pending").length,
      volume: filled.reduce((sum, o) => sum + (o.totalValue ?? 0), 0),
    };
  }, [rows]);

  const filteredOrders = useMemo(() => {
    if (activeTab === "all") return rows;
    if (activeTab === "filled") {
      return rows.filter((o) => o.status === "filled" || o.status === "partially_filled");
    }
    return rows.filter((o) => o.status === activeTab);
  }, [rows, activeTab]);

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

  const statusLabel = useCallback(
    (s: OrderStatus) => {
      if (s === "partially_filled") return t("partially_filled");
      if (s === "expired") return t("expired");
      return t(s);
    },
    [t]
  );

  const priceKindLabel = useCallback(
    (kind: ReturnType<typeof displayPrice>["kind"]) => {
      if (kind === "executed") return t("avg_price");
      if (kind === "trigger") return t("trigger_price");
      if (kind === "limit") return t("limit_price");
      return t("market_price");
    },
    [t]
  );

  const columns: RecordColumn<OrderRow>[] = useMemo(
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
        //
        // 杠杆挂在同一枚徽章上而不是单开一列：20 倍和 1 倍是同一件事的
        // 两个刻度，拆成两列反而要左右比对才能读出一行的风险。
        render: (order) => (
          <span className="inline-flex flex-wrap items-center gap-1">
            <Badge variant={order.market === "futures" ? "gold" : "blue"} size="sm">
              {order.market === "futures" ? "Futures" : "Spot"}
              {order.leverage > 1 ? ` ${order.leverage}x` : ""}
            </Badge>
            {order.source === "paper" && (
              <Badge variant="gray" size="sm">
                {t("paper")}
              </Badge>
            )}
          </span>
        ),
      },
      {
        key: "order_type",
        header: t("type"),
        render: (order) => orderTypeLabel(order.orderType),
      },
      {
        key: "quantity",
        header: t("quantity"),
        align: "right",
        // 部分成交的单，只报委托量是误导——把已成交那部分标在下面。
        render: (order) => (
          <span className="font-mono">
            {order.quantity}
            {order.status === "partially_filled" && order.executedQty !== null && (
              <span className="block text-[10px] text-text-muted">
                {t("executed")} {order.executedQty}
              </span>
            )}
          </span>
        ),
      },
      {
        key: "price",
        header: t("price"),
        align: "right",
        // 一行里其实有三个价：委托价、触发价、成交均价。这一列显示当下
        // 最该被核对的那一个，并在下面标出它是哪一个——否则相邻两行的数
        // 根本没法比较。三个价的全貌在详情弹窗里。
        render: (order) => {
          const { value, kind } = displayPrice(order);
          return (
            <span className="font-mono">
              {value !== null ? formatPrice(value) : "-"}
              {kind !== "none" && (
                <span className="block text-[10px] uppercase tracking-wider text-text-muted">
                  {priceKindLabel(kind)}
                </span>
              )}
            </span>
          );
        },
      },
      {
        key: "status",
        header: t("status"),
        // 被拒绝的单此前只有一枚红徽章，为什么被拒一个字都没有——
        // 原因早就落库了（error_message / risk_reason），这里把它显出来。
        render: (order) => (
          <span className="inline-flex flex-col items-start gap-1">
            <Badge variant={STATUS_VARIANT_MAP[order.status]} size="sm">
              {statusLabel(order.status)}
            </Badge>
            {order.reason && (
              <span
                className="line-clamp-2 max-w-[18ch] text-[10px] leading-tight text-danger"
                title={order.reason}
              >
                {order.riskRejected ? `${t("risk_rejected")}: ` : ""}
                {order.reason}
              </span>
            )}
          </span>
        ),
      },
      {
        key: "total",
        header: t("total"),
        align: "right",
        render: (order) => (
          <span className="font-mono">
            {order.totalValue !== null ? `$${formatPrice(order.totalValue)}` : "-"}
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
            {formatDate(order.createdAt)}
          </span>
        ),
      },
    ],
    [t, statusLabel, priceKindLabel]
  );

  const exportCSV = useCallback(() => {
    const BOM = "﻿";
    const headers = [
      "时间", "账户", "市场类型", "杠杆", "交易对", "方向", "类型",
      "委托数量", "已成交数量", "委托价", "触发价", "成交均价",
      "状态", "总金额", "手续费", "手续费币种", "原因", "交易所订单号",
    ];
    const rowsCsv = filteredOrders.map((o) => [
      formatDate(o.createdAt),
      o.source === "paper" ? "Paper" : "Live",
      o.market === "futures" ? "Futures" : "Spot",
      String(o.leverage),
      o.symbol,
      o.side === "buy" ? "Buy" : "Sell",
      orderTypeLabel(o.orderType),
      String(o.quantity),
      o.executedQty !== null ? String(o.executedQty) : "-",
      o.price !== null ? String(o.price) : "-",
      o.stopPrice !== null ? String(o.stopPrice) : "-",
      o.executedPrice !== null ? String(o.executedPrice) : "-",
      o.status,
      o.totalValue !== null ? String(o.totalValue) : "-",
      o.fee !== null ? String(o.fee) : "-",
      o.feeAsset ?? "-",
      o.reason ?? "-",
      o.exchangeOrderId ?? "-",
    ]);
    const csvContent = [headers, ...rowsCsv]
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

  // 三张来源表各取 limit 条，任何一张取满都说明后面还有
  const hasMore = allRows.length >= limit;

  return (
    <div className="mx-auto max-w-page px-6 py-10 lg:py-16">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        className="border-b-0 pb-0"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sync({ always: true })}
              disabled={syncing}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}>
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              {syncing ? t("syncing") : t("refresh")}
            </Button>
            {filteredOrders.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                {t("export_csv")}
              </Button>
            )}
          </div>
        }
      />

      {/* 表格之前先给一句结论：这段时间一共做了多少、成了多少、成交额多大 */}
      <StatRow
        className="mt-10"
        items={[
          { label: t("all"), value: rows.length },
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

      {/* 两层筛选：先选账户（实盘 / 模拟），再选状态。实盘和模拟混在
          一张表里读不出结论——两者的盈亏不能相加。 */}
      <div className="mt-10 border-b border-border-default">
        <SegmentTabs
          value={source}
          onChange={(k) => setSource(k as SourceTab)}
          options={SOURCE_TABS.map((k) => ({ key: k, label: t(`source_${k}`) }))}
        />
      </div>
      <div className="border-b border-border-default">
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
        <>
          <RecordList
            rows={filteredOrders}
            columns={columns}
            rowKey={(order) => order.id}
            onRowClick={(order) => setDetail(order)}
          />
          {hasMore && (
            <div className="mt-8 text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit((n) => n + ORDER_PAGE_SIZE)}
                disabled={query.isFetching}
              >
                {query.isFetching ? tCommon("loading") : tCommon("show_more")}
              </Button>
            </div>
          )}
        </>
      )}

      <OrderDetailModal order={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/**
 * 单笔订单的全貌。
 *
 * 表格一行放不下的那些字段——触发价、成交均价、手续费、交易所订单号、
 * 被拒原因——都在这里。没有这个面板，这些列要么挤进表格把它压垮，
 * 要么像之前那样落了库却永远没人看得到。
 */
function OrderDetailModal({ order, onClose }: { order: OrderRow | null; onClose: () => void }) {
  const t = useTranslations("trade.orders");

  if (!order) return null;

  const fmt = (v: number | null) => (v !== null ? formatPrice(v) : "—");
  const items: { label: string; value: string; tone?: "danger" | "up" | "down" }[] = [
    { label: t("symbol"), value: order.symbol },
    { label: t("side"), value: order.side === "buy" ? "Buy" : "Sell" },
    {
      label: t("market_type"),
      value: `${order.market === "futures" ? "Futures" : "Spot"}${order.source === "paper" ? ` · ${t("paper")}` : ""}`,
    },
    { label: t("leverage"), value: order.leverage > 1 ? `${order.leverage}x` : "1x" },
    { label: t("type"), value: orderTypeLabel(order.orderType) },
    { label: t("quantity"), value: String(order.quantity) },
    { label: t("executed"), value: order.executedQty !== null ? String(order.executedQty) : "—" },
    { label: t("limit_price"), value: fmt(order.price) },
    { label: t("trigger_price"), value: fmt(order.stopPrice) },
    { label: t("avg_price"), value: fmt(order.executedPrice) },
    { label: t("total"), value: order.totalValue !== null ? `$${formatPrice(order.totalValue)}` : "—" },
    {
      label: t("fee"),
      value: order.fee !== null ? `${formatPrice(order.fee)} ${order.feeAsset ?? ""}`.trim() : "—",
    },
    { label: t("time"), value: new Date(order.createdAt).toLocaleString() },
  ];

  if (order.realizedPnl !== null) {
    items.push({
      label: t("realized_pnl"),
      value: `${order.realizedPnl >= 0 ? "+" : ""}${formatPrice(order.realizedPnl)}`,
      tone: order.realizedPnl >= 0 ? "up" : "down",
    });
  }
  if (order.exchangeOrderId) {
    items.push({ label: t("exchange_order_id"), value: order.exchangeOrderId });
  }
  if (order.reason) {
    items.push({
      label: order.riskRejected ? t("risk_rejected") : t("reason"),
      value: order.reason,
      tone: "danger",
    });
  }

  return (
    <Modal open={!!order} onClose={onClose} title={t("detail")} size="lg" variant="sheet">
      <dl className="grid grid-cols-1 gap-px bg-border-default sm:grid-cols-2">
        {items.map((it) => (
          <div key={it.label} className="bg-bg-primary px-4 py-3">
            <dt className="eyebrow">{it.label}</dt>
            <dd
              className={`mt-1.5 break-words font-mono text-sm ${
                it.tone === "danger"
                  ? "text-danger"
                  : it.tone === "up"
                    ? "text-success"
                    : it.tone === "down"
                      ? "text-danger"
                      : "text-text-primary"
              }`}
            >
              {it.value}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
