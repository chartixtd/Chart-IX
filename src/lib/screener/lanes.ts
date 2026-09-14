import { assetClassOf } from "./universe";
import type { AssetClass } from "./universe";
import type { ScannerRow } from "./types";
import type { AlertCardData } from "./cards";

/**
 * 三个分栏，同时是三条真实路由的末段
 * （`/screener/<key>` 与 `/screener/alerts/<key>`）。
 *
 * 顺序写死，不按行数排——栏的位置跟着数据动，读者每次都要重新找自己
 * 要看的那一栏。
 */
export const LANE_ORDER = ["crypto", "commodity", "stock"] as const;

export type LaneKey = (typeof LANE_ORDER)[number];

/** 默认落在哪一栏。`/screener` 与 `/screener/alerts` 都跳到这里。 */
export const DEFAULT_LANE: LaneKey = "crypto";

/**
 * URL 里那一段是不是合法的分栏。
 *
 * 路由段是用户能随手改的，`/screener/foo` 必须走 404 而不是渲染一张空表
 * ——空表看起来跟「这一栏这一轮没有达标的标的」一模一样，而那是两件
 * 完全不同的事。
 */
export function isLaneKey(value: string): value is LaneKey {
  return (LANE_ORDER as readonly string[]).includes(value);
}

/**
 * 一张卡属于哪一栏。
 *
 * **从 symbol 推，而不是给 AlertCardData 加一个 assetClass 字段。** 两个理由：
 *
 *   · 加字段就要把 `SCANNER_PAYLOAD_VERSION` 再 +1，而那会丢弃线上缓存、
 *     让榜单空一轮（这一版已经因为 12→13 空过一次）。
 *   · 分类完全由 symbol 的前缀决定（见 universe.ts 的 assetClassOf），
 *     是个纯函数。存一份等于把同一个事实写两处，还让**旧卡片**分不了类
 *     ——一张卡能活 6 小时，跨得过好几轮部署。
 *
 * 外汇（NCFX）在 preselect 阶段就被排除了，正常不会有卡；真出现一张
 * 就当它不属于任何一栏，三个页面都不显示它，而不是硬塞进某一栏。
 */
export function laneOfSymbol(symbol: string): LaneKey | null {
  const cls: AssetClass | null = assetClassOf(symbol);
  return cls !== null && isLaneKey(cls) ? cls : null;
}

/** 主扫描表：这一栏的行。 */
export function rowsInLane(rows: ScannerRow[], lane: LaneKey): ScannerRow[] {
  return rows.filter((r) => r.assetClass === lane);
}

/** 警报卡片：这一栏的卡（含已失效的灰卡，它们是对照上下文，不是信号）。 */
export function cardsInLane(cards: AlertCardData[], lane: LaneKey): AlertCardData[] {
  return cards.filter((c) => laneOfSymbol(c.symbol) === lane);
}
