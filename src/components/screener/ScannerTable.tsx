"use client";

import { memo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { RecordList, type RecordColumn } from "@/components/ui/RecordList";
import { formatPercent, cn } from "@/lib/utils";
import { formatCompactUsd } from "@/lib/market-cap";
import type { ScannerRow } from "@/lib/screener/types";
import type { SortKey } from "@/lib/screener/filter";
import { FactorStack } from "./FactorStack";
import { scenarioTone, TONE_CLASSES } from "./scenario-ui";

export const ScannerTable = memo(function ScannerTable({
  rows,
  isLoading,
  sort,
  onSortChange,
  onSelect,
  selectedSymbol,
}: {
  rows: ScannerRow[];
  isLoading: boolean;
  sort: { key: SortKey; dir: 1 | -1 };
  onSortChange: (key: string) => void;
  onSelect: (row: ScannerRow) => void;
  selectedSymbol: string | null;
}) {
  const t = useTranslations("screener");

  if (isLoading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const columns: RecordColumn<ScannerRow>[] = [
    {
      key: "symbol",
      header: t("columns.symbol"),
      primary: true,
      sortable: true,
      render: (r) => (
        <span className="inline-flex items-baseline gap-1.5">
          <span className="font-display text-sm font-semibold text-text-primary">{r.coin}</span>
          <span className="text-[10px] uppercase tracking-wider text-text-muted">
            {r.sourceExchange}
          </span>
        </span>
      ),
    },
    {
      key: "direction",
      header: t("columns.direction"),
      sortable: true,
      render: (r) => {
        // 表格 pill 显示的是"有效方向"：场景判成 manage 时（存量清算）
        // 不是一个可下单方向，灰色「观望」——r.direction 本身在这种情况下
        // 仍是分数兜底方向（用于排序与操作按钮），两者语义不同，
        // 完整说明见 types.ts ScannerRow.direction 的字段注释。
        const isManage = r.scenario?.direction === "manage";
        return (
          <span
            className={cn(
              "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
              isManage
                ? "bg-text-secondary/15 text-text-secondary"
                : r.direction === "long"
                  ? "bg-success/15 text-success"
                  : "bg-danger/15 text-danger"
            )}
          >
            {isManage ? t("scenarios.pill_manage") : r.direction === "long" ? "LONG" : "SHORT"}
          </span>
        );
      },
    },
    {
      key: "scenario",
      header: t("columns.scenario"),
      render: (r) => {
        if (!r.scenario) return <span className="text-text-muted">—</span>;
        const cls = TONE_CLASSES[scenarioTone(r.scenario.kind)];
        const name = t(`scenarios.${r.scenario.kind}.name`);
        return (
          <span
            className={cn(
              "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
              cls.badgeBg,
              cls.text
            )}
          >
            {/* 视觉上的 ⚠+名称对屏幕阅读器隐藏，换成一句连贯的 sr-only
                文案（陷阱信号+场景名），避免"⚠"被单独读成一个孤立符号。 */}
            <span aria-hidden>
              {r.scenario.trap ? "⚠ " : ""}
              {name}
            </span>
            <span className="sr-only">
              {r.scenario.trap ? `${t("scenarios.trap_label")} ${name}` : name}
            </span>
          </span>
        );
      },
    },
    {
      key: "total",
      header: t("columns.total"),
      sortable: true,
      render: (r) =>
        r.dataGaps.length > 0 ? (
          // 数据不全时显示「—」而不是分数：两个因子在缺数据时都会退回中性分
          // （OI 30 + CVD 10 = 40），显示成 40 会让「上游挂了」看起来像
          // 「信号平平」，而这两件事读者要做的反应完全不同。
          // 完整理由见 types.ts ScannerRow.dataGaps 的字段注释。
          <span className="tnum text-sm text-text-muted" title={t("columns.data_missing")}>
            —
          </span>
        ) : (
        <span
          className={cn(
            "tnum text-sm font-bold",
            // T22 把警报从「总分达标」改成「场景驱动」：达标行的判据
            // 跟着从 total >= ALERT_TRIGGER_SCORE（已删除）换成
            // scenario !== null——这是这一步在前端唯一允许的最小改动，
            // 完整的场景展示（场景名/操作文案/陷阱标注）留给 UI 任务。
            r.scenario !== null ? "text-gold" : "text-text-primary"
          )}
        >
          {r.total}
        </span>
        ),
    },
    {
      key: "factors",
      header: t("columns.factors"),
      hideOnMobile: true,
      render: (r) =>
        r.dataGaps.length > 0 ? (
          <span className="text-sm text-text-muted">—</span>
        ) : (
        // FactorStack 本身整个是 aria-hidden（它只是两根装饰柱），
        // 所以这里补一层文字说明，屏幕阅读器用户才能读到这两个数。
        // 警报卡不需要这个 —— 它每根柱子旁边已经有文字标签和分数。
        <span title={`OI ${r.factors.oi} / CVD ${r.factors.cvd}`}>
          <FactorStack factors={r.factors} />
          <span className="sr-only">
            {`OI ${r.factors.oi} / CVD ${r.factors.cvd}`}
          </span>
        </span>
        ),
    },
    {
      key: "volumeUsd",
      header: t("columns.volume"),
      sortable: true,
      render: (r) => (
        <span className="tnum text-sm">{(r.volumeUsd / 1_000_000).toFixed(1)}M</span>
      ),
    },
    {
      // 只显示 24h 涨跌，不并排显示振幅。振幅仍然在数据里（而且现在正是
      // 选币的排序依据），只是不占表格宽度——两个百分数并排时读者每次都要
      // 先分辨哪个是哪个，而真正要一眼看的是涨跌方向。
      // 想知道振幅门槛是什么，筛选栏上有只读说明「按排名取前 N」。
      key: "change24h",
      header: t("columns.change"),
      sortable: true,
      render: (r) => (
        <span
          className={cn(
            "tnum text-sm",
            r.change24h === null
              ? "text-text-secondary"
              : r.change24h >= 0
                ? "text-success"
                : "text-danger"
          )}
        >
          {r.change24h === null ? "—" : formatPercent(r.change24h)}
        </span>
      ),
    },
    {
      key: "marketCap",
      header: t("columns.market_cap"),
      sortable: true,
      hideOnMobile: true,
      render: (r) => (
        <span className="tnum whitespace-nowrap text-sm">{formatCompactUsd(r.marketCap)}</span>
      ),
    },
    {
      key: "actions",
      header: t("columns.actions"),
      render: (r) => {
        // manage 场景（存量清算）不是一个下单方向：ScannerRow.direction 在
        // 这种情况下仍是分数兜底的 long/short（见 types.ts 字段注释），
        // 但把它当成下单方向塞进链接会让按钮跳去一个场景刚判定为"该观望"
        // 的方向——按钮改成中性「查看」、链接不带 side，交易页自己决定
        // 默认方向。
        if (r.scenario?.direction === "manage") {
          return (
            <Link href={`/trade?symbol=${r.symbol}&market=futures`}>
              <Button variant="secondary" size="sm" className="min-h-[44px] px-2 text-xs lg:h-6">
                {t("action_view")}
              </Button>
            </Link>
          );
        }
        return (
          <Link href={`/trade?symbol=${r.symbol}&side=${r.direction}&market=futures`}>
            <Button
              variant={r.direction === "long" ? "green" : "red"}
              size="sm"
              className="min-h-[44px] px-2 text-xs lg:h-6"
            >
              {r.direction === "long" ? t("action_long") : t("action_short")}
            </Button>
          </Link>
        );
      },
    },
  ];

  return (
    <RecordList
      rows={rows}
      columns={columns}
      rowKey={(r) => r.symbol}
      sort={sort}
      onSortChange={onSortChange}
      onRowClick={onSelect}
      empty={t("no_results")}
      rowClassName={(r) =>
        cn(
          // 达标行用左边框而不是整行底色：整行染色会和 hover / selected
          // 三种状态叠在一起，最后哪个都读不出来。颜色跟着场景基调走
          // （四色系统，见 scenario-ui.ts）而不是统一金色——假背离陷阱
          // 用金色边框会跟真背离撞色，读者会把陷阱误当成可反手的真信号。
          r.scenario !== null && "border-l-2",
          r.scenario !== null && TONE_CLASSES[scenarioTone(r.scenario.kind)].border,
          r.symbol === selectedSymbol && "bg-bg-tertiary"
        )
      }
    />
  );
});
