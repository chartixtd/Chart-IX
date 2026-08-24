import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";

export interface RecordColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  /** 手机卡片上作为标题行显示（通常是交易对 / 名称） */
  primary?: boolean;
  /**
   * 手机卡片上作为标题下方的副行整行显示，不带表头标签。
   * 给「时间戳」这类值本身就自解释、但塞进两列键值网格会被挤到换行的列用。
   */
  secondary?: boolean;
  /**
   * 手机卡片上作为底部整宽的操作区显示。按钮在两列网格的格子里只有半格宽，
   * 既够不到 44px 的舒适命中区，也读不出「这是这张卡的主操作」。
   */
  action?: boolean;
  /** 手机上完全不显示这一列 */
  hideOnMobile?: boolean;
  /** 设了这个键，表头就可点排序；不设的列（如"因子构成"）表头不可点 */
  sortable?: boolean;
}

interface RecordListProps<T> {
  rows: T[];
  columns: RecordColumn<T>[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** 当前排序状态。不传就不显示排序箭头，表头也不可点。 */
  sort?: { key: string; dir: 1 | -1 };
  onSortChange?: (key: string) => void;
  /** 逐行追加的类名，用于把达标行高亮出来 */
  rowClassName?: (row: T) => string;
}

export function RecordList<T>({
  rows,
  columns,
  rowKey,
  empty,
  onRowClick,
  sort,
  onSortChange,
  rowClassName,
}: RecordListProps<T>) {
  if (rows.length === 0) {
    return <div className="py-12 text-center text-sm text-text-muted">{empty ?? "—"}</div>;
  }

  const primary = columns.find((c) => c.primary);
  const secondary = columns.find((c) => c.secondary);
  const action = columns.find((c) => c.action);
  const details = columns.filter(
    (c) => !c.primary && !c.secondary && !c.action && !c.hideOnMobile
  );

  // 可点击的行必须能用键盘到达并触发，否则整张表对键盘用户是死的。
  // 只用于桌面表格的 <tr>；手机卡片的键盘可达改由卡片内的显式 <button>
  // 承载（见下），不再给整个 <li> 挂 role="button"——action 列里通常有
  // <Link>，button 里嵌 link 是非法嵌套，读屏会把整张卡读成一个按钮。
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
            // 整卡点击只是给指针用户的放大命中区；语义与键盘可达由下面
            // primary 位置的 <button> 承载，这里不挂 role / tabIndex。
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              "px-1 py-3.5",
              onRowClick && "cursor-pointer transition-colors active:bg-bg-tertiary",
              rowClassName?.(row)
            )}
          >
            {(primary || secondary) && (
              <div className="mb-2 flex items-baseline justify-between gap-3">
                {primary &&
                  (onRowClick ? (
                    // 行点击的显式可聚焦载体：真 <button> 原生响应 Enter/Space。
                    // stopPropagation 防止冒泡到 <li> 的 onClick 触发两次。
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRowClick(row);
                      }}
                      className="min-w-0 text-left text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/60"
                    >
                      {primary.render(row)}
                    </button>
                  ) : (
                    <div className="min-w-0 text-sm text-text-primary">{primary.render(row)}</div>
                  ))}
                {secondary && (
                  <div className="tnum shrink-0 text-[11px] text-text-muted">{secondary.render(row)}</div>
                )}
              </div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {details.map((col) => (
                <div key={col.key} className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-text-muted">{col.header}</dt>
                  <dd className="tnum text-xs text-text-secondary">{col.render(row)}</dd>
                </div>
              ))}
            </dl>
            {/* action 区里是 <Link>/<Button>，点击必须只触发它自己，
                不能同时触发整卡的行点击。 */}
            {action && (
              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                {action.render(row)}
              </div>
            )}
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
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(col.key)}
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-gold"
                    >
                      {col.header}
                      {sort?.key === col.key && (
                        <Icon
                          name={sort.dir === -1 ? "chevronDown" : "chevronUp"}
                          className="h-3 w-3"
                        />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
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
                    "cursor-pointer transition-colors hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-gold/60",
                  rowClassName?.(row)
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    // 桌面表格的 action 单元格同样要拦下冒泡：
                    // 点「做多/做空」不该顺带触发行点击。
                    onClick={onRowClick && col.action ? (e) => e.stopPropagation() : undefined}
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
