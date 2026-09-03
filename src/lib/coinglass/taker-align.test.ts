import { describe, it, expect } from "vitest";
import { alignTakerToPrice } from "./taker-volume";
import type { CoinGlassTakerBar } from "./types";

const B = 1_800_000;
const bar = (t: number, buy: number, sell: number): CoinGlassTakerBar => ({
  time: t,
  aggregated_buy_volume_usd: buy,
  aggregated_sell_volume_usd: sell,
});
const price = (times: number[]) => times.map((time) => ({ time }));

/**
 * taker 序列现在是 14 天，价格/OI 是 7 天。六场景判定拿价格摆动点的下标去取
 * buys[i]/sells[i]，长度不一致时同一个下标会指到 7 天前——**而且不报错**，
 * 只会把每个币的场景悄悄算错。这组用例守的就是这件事。
 */
describe("alignTakerToPrice", () => {
  it("长序列裁到与价格等长，且逐根同时刻", () => {
    const taker = Array.from({ length: 10 }, (_, i) => bar(i * B, i, 0));
    const out = alignTakerToPrice(taker, price([7 * B, 8 * B, 9 * B]));
    expect(out).toHaveLength(3);
    expect(out.map((b) => b.time)).toEqual([7 * B, 8 * B, 9 * B]);
    expect(out.map((b) => b.aggregated_buy_volume_usd)).toEqual([7, 8, 9]);
  });

  it("按时间戳配对，不是「取最后 N 根」", () => {
    // taker 比价格多走了一根（上游两条序列的末根不同步）。取最后 3 根会
    // 整体错位一格；按时间戳配则每一根都对得上。
    const taker = [bar(5 * B, 5, 0), bar(6 * B, 6, 0), bar(7 * B, 7, 0), bar(8 * B, 8, 0)];
    const out = alignTakerToPrice(taker, price([5 * B, 6 * B, 7 * B]));
    expect(out.map((b) => b.aggregated_buy_volume_usd)).toEqual([5, 6, 7]);
  });

  it("中间缺一根时补 0/0，而不是拿相邻那根顶上", () => {
    // 补 0 会让 classifySide 因为 gross ≤ 0 判不出场景，也就是「这段没数据」
    // ——这比拿邻近一根冒充要诚实。
    const taker = [bar(1 * B, 1, 1), bar(3 * B, 3, 3)];
    const out = alignTakerToPrice(taker, price([1 * B, 2 * B, 3 * B]));
    expect(out.map((b) => b.aggregated_buy_volume_usd)).toEqual([1, 0, 3]);
    expect(out[1].time).toBe(2 * B);
  });

  it("taker 全空时返回等长的 0 序列，不是空数组", () => {
    // 长度必须等于价格，否则下游按下标取值会越界成 undefined。
    const out = alignTakerToPrice([], price([1 * B, 2 * B]));
    expect(out).toHaveLength(2);
    expect(out.every((b) => b.aggregated_buy_volume_usd === 0)).toBe(true);
  });
});
