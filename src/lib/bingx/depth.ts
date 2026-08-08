import type { BingXDepth } from "@/types/bingx";

/**
 * WS 的 `@depth20` 恒回 20 档，而 REST 的 `limit=N` 只回 N 档最优档位；
 * OrderBook 组件的 slice(0, N) 切片假设输入恰好是 N 档。
 *
 * 实测排序（生产端点，REST 与 WS 一致）：
 *   asks 降序——最优（最低）卖价在**末尾**
 *   bids 降序——最优（最高）买价在**开头**
 * 因此"最优 N 档"= asks 取末尾 N 条 + bids 取开头 N 条。
 * 若照搬 bids 的取法对 asks 做 slice(0, N)，会得到最差的 N 档卖单。
 */
export function trimDepth(book: BingXDepth, limit: number): BingXDepth {
  if (limit <= 0) return { asks: [], bids: [] };
  const asks = book.asks.length > limit ? book.asks.slice(book.asks.length - limit) : book.asks;
  const bids = book.bids.length > limit ? book.bids.slice(0, limit) : book.bids;
  return { asks, bids };
}
