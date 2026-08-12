import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RecordColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  /** 手机卡片上作为标题行显示（通常是交易对 / 名称） */
  primary?: boolean;
  /** 手机上完全不显示这一列 */
  hideOnMobile?: boolean;
}

interface RecordListProps<T> {
  rows: T[];
  columns: RecordColumn<T>[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}

export function RecordList<T>({ rows, columns, rowKey, empty, onRowClick }: RecordListProps<T>) {
  if (rows.length === 0) {
    return <div className="py-12 text-center text-sm text-text-muted">{empty ?? "—"}</div>;
  }

  const primary = columns.find((c) => c.primary);
  const details = columns.filter((c) => !c.primary && !c.hideOnMobile);

  // 可点击的行必须能用键盘到达并触发，否则整张表对键盘用户是死的。
  const interactiveProps = (row: T) =>
    onRowClick
      ? {
          onClick: () => onRowClick(row),
          tabIndex: 0,
          role: "button" as const,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onRowClick(row);
            }
          },
        }
      : {};

  return (
    <>
      {/* 手机：每行一张卡。不做横向滚动的表格——那在手机上是伪适配 */}
      <ul className="divide-y divide-border-default border-y border-border-default lg:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            {...interactiveProps(row)}
            className={cn(
              "px-1 py-3.5",
              onRowClick &&
                "cursor-pointer transition-colors active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/60"
            )}
          >
            {primary && (
              <div className="mb-2 text-sm text-text-primary">{primary.render(row)}</div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {details.map((col) => (
                <div key={col.key} className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-text-muted">{col.header}</dt>
                  <dd className="tnum text-xs text-text-secondary">{col.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* 桌面：常规表格。列多的时候（比如 screener 的 12 列）表格实际宽度会超出容器，
          必须包一层横向滚动，否则容器上的 overflow-hidden 会直接把超出部分裁掉，
          连拖动条都不会出现——这里就是之前从纯 <table> 重构成 RecordList 时漏掉的那层。 */}
      <div className="custom-scrollbar hidden overflow-x-auto lg:block">
        <table className="w-full">
          <thead>
            {/* 表头用发丝金而不是普通灰线：这是数据面上金唯一被允许出现的结构位置 */}
            <tr className="border-b border-gold/25">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-[11px] font-medium uppercase tracking-wider text-text-muted",
                    col.align === "right" ? "text-right" : "text-left"
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                {...interactiveProps(row)}
                className={cn(
                  "border-b border-border-default/60",
                  onRowClick &&
                    "cursor-pointer transition-colors hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-gold/60"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-3 py-2.5 text-sm text-text-secondary",
                      col.align === "right" ? "text-right" : "text-left"
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
