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

  return (
    <>
      {/* 手机：每行一张卡。不做横向滚动的表格——那在手机上是伪适配 */}
      <ul className="divide-y divide-border-default border-y border-border-default lg:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn("px-1 py-3.5", onRowClick && "cursor-pointer active:bg-bg-tertiary")}
          >
            {primary && (
              <div className="mb-2 text-sm text-text-primary">{primary.render(row)}</div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {details.map((col) => (
                <div key={col.key} className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-text-muted">{col.header}</dt>
                  <dd className="text-xs text-text-secondary">{col.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* 桌面：常规表格 */}
      <table className="hidden w-full lg:table">
        <thead>
          <tr className="border-b border-border-default">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-3 py-2 text-xs font-normal text-text-muted",
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
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-border-default/60",
                onRowClick && "cursor-pointer hover:bg-bg-tertiary"
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
    </>
  );
}
