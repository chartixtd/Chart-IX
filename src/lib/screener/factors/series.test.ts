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
  /**
   * 一个 V 形：两侧单调远离极值，中间是要找的低点。
   *
   * **背景不能是平的。** findPivots 用严格不等号判「更极端」，所以一串完全
   * 相等的值里每一根都算摆动点（平台区 → 一堆伪摆动点）。半窗越窄这个效应
   * 越明显，PIVOT_N 从 5 降到 2 之后，平背景的夹具已经测不出原本的意图了。
   */
  const dip = (depth: number) => [
    depth + 4,
    depth + 3,
    depth + 2,
    depth + 1,
    depth,
    depth + 1,
    depth + 2,
    depth + 3,
    depth + 4,
  ];

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
   * 造一个明确的 swing low = 100，两侧的低点单调抬高。
   *
   * 两侧刻意不设成同一个值：findPivots 用严格不等号，平台区里每根都会被
   * 认成摆动点，那样 findSweep 找到的「结构位」会是紧挨着的那根伪摆动点，
   * 而不是我们想测的 100。PIVOT_N 越小这个坑越容易踩。
   */
  const withSsl = (last: [number, number, number]) =>
    bars([
      [126, 116, 121],
      [125, 115, 120],
      [124, 114, 119],
      [123, 113, 118],
      [122, 112, 117],
      [115, 100, 108], // ← swing low = 100
      [122, 112, 117],
      [123, 113, 118],
      [124, 114, 119],
      [125, 115, 120],
      [126, 116, 121],
      [127, 117, 122],
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
      [106, 96, 101],
      [107, 97, 102],
      [108, 98, 103],
      [109, 99, 104],
      [110, 100, 105],
      [130, 105, 120], // ← swing high = 130
      [110, 100, 105],
      [109, 99, 104],
      [108, 98, 103],
      [107, 97, 102],
      [106, 96, 101],
      [105, 95, 100],
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
