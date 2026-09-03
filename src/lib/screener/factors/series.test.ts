import { describe, it, expect } from "vitest";
import { cvdLine, findSweep, madeNewExtreme, oiState, cvdNetPct, OI_SURGE_PCT } from "./series";
import type { CoinGlassPriceBar, CoinGlassTakerBar } from "@/lib/coinglass/types";

/** [high, low, close] → K 线。open 不参与任何判定，随便填。 */
function bars(specs: Array<[number, number, number]>): CoinGlassPriceBar[] {
  return specs.map(([high, low, close], i) => ({
    time: i * 1_800_000,
    open: String(close),
    high: String(high),
    low: String(low),
    close: String(close),
    volume_usd: "1",
  }));
}

/** 每根给定净流 delta，总换手固定 1000。 */
function taker(deltas: number[], gross = 1000): CoinGlassTakerBar[] {
  return deltas.map((d, i) => ({
    time: i * 1_800_000,
    aggregated_buy_volume_usd: String((gross + d) / 2),
    aggregated_sell_volume_usd: String((gross - d) / 2),
  }));
}

describe("cvdLine", () => {
  it("是累积线，不是逐根净流", () => {
    // 规格要求「用 swing 比较，不用单根颜色」——没有累积线就无从谈 swing。
    expect(cvdLine(taker([100, 100, -50]))).toEqual([100, 200, 150]);
  });

  it("有一根坏数据就整条返回 null", () => {
    // 累积线中间断一根，后面每一根都带着这个缺口，swing 全是错的。
    const t = taker([100, 100]);
    t[0] = { ...t[0], aggregated_buy_volume_usd: "abc" };
    expect(cvdLine(t)).toBeNull();
  });
});

describe("madeNewExtreme", () => {
  // 摆动点要左右各 5 根都不更极端，所以每个极值前后都要留够空间。
  const dip = (depth: number) => [10, 10, 10, 10, 10, depth, 10, 10, 10, 10, 10];

  it("后一个低点更低 = 创了新低", () => {
    expect(madeNewExtreme([...dip(5), ...dip(3)], "low")).toBe(true);
  });

  it("后一个低点更高 = 没创新低", () => {
    expect(madeNewExtreme([...dip(3), ...dip(5)], "low")).toBe(false);
  });

  it("摆动点不足两个返回 null，而不是 false", () => {
    // null 和 false 在调用方是两件事：null = 判不了，false = 判了、没创。
    // 混为一谈会让「数据不够」被当成「背离成立」。
    expect(madeNewExtreme(dip(5), "low")).toBeNull();
  });
});

describe("findSweep", () => {
  /**
   * 前 11 根造一个 100 的 swing low，然后接一根扫破并收回的 K 线。
   * 中间要隔开足够根数，findSweep 才认这个结构位「成形于这根之前」。
   */
  const withSsl = (last: [number, number, number]) =>
    bars([
      [120, 110, 115],
      [120, 110, 115],
      [120, 110, 115],
      [120, 110, 115],
      [120, 110, 115],
      [115, 100, 108], // ← swing low = 100
      [120, 110, 115],
      [120, 110, 115],
      [120, 110, 115],
      [120, 110, 115],
      [120, 110, 115],
      [120, 110, 115],
      last,
    ]);

  it("扫破前低又收回 = sweep 成立", () => {
    const s = findSweep(withSsl([112, 96, 108]), "low", 48)!;
    expect(s.level).toBe(100);
    expect(s.at).toBe(12);
  });

  it("实体跌破没收回 = 不是 sweep", () => {
    // 规格原话：「仅实体跌破未收回→不是 sweep，场景不成立」。
    // 这一条写错的话，所有下跌途中的普通阴线都会被当成扫盘信号。
    expect(findSweep(withSsl([112, 96, 97]), "low", 48)).toBeNull();
  });

  it("没碰到前低 = 不是 sweep", () => {
    expect(findSweep(withSsl([112, 103, 108]), "low", 48)).toBeNull();
  });

  it("恰好收在结构位上不算收回——要严格越过", () => {
    expect(findSweep(withSsl([112, 96, 100]), "low", 48)).toBeNull();
  });

  it("高点侧镜像成立", () => {
    const b = bars([
      [110, 100, 105],
      [110, 100, 105],
      [110, 100, 105],
      [110, 100, 105],
      [110, 100, 105],
      [130, 105, 120], // ← swing high = 130
      [110, 100, 105],
      [110, 100, 105],
      [110, 100, 105],
      [110, 100, 105],
      [110, 100, 105],
      [110, 100, 105],
      [134, 108, 120],
    ]);
    const s = findSweep(b, "high", 48)!;
    expect(s.level).toBe(130);
    expect(s.at).toBe(12);
  });
});

describe("oiState", () => {
  it("暴增有明确门槛——「暴增」是陷阱判定的入口条件，不能是形容词", () => {
    expect(oiState([100, 100 * (1 + OI_SURGE_PCT / 100)], 0, 1)).toBe("surge");
    expect(oiState([100, 103], 0, 1)).toBe("up");
    expect(oiState([100, 100.5], 0, 1)).toBe("flat");
    expect(oiState([100, 97], 0, 1)).toBe("down");
    expect(oiState([100, 90], 0, 1)).toBe("plunge");
  });

  it("起点非正时返回 null 而不是 Infinity", () => {
    expect(oiState([0, 100], 0, 1)).toBeNull();
  });
});

describe("cvdNetPct", () => {
  it("不含起点那一根——它属于更早一段行情", () => {
    // (0,2] 只累加下标 1、2 两根：净流 200、换手 2000 → 10%
    expect(cvdNetPct(taker([9999, 100, 100]), 0, 2)!).toBeCloseTo(10, 6);
  });

  it("换手为 0 时返回 null 而不是 Infinity", () => {
    expect(cvdNetPct(taker([0, 0], 0), 0, 1)).toBeNull();
  });
});
