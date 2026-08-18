import { describe, it, expect } from "vitest";
import { applyFilters, sortRows, DEFAULT_FILTERS } from "./filter";
import type { ScannerRow } from "./types";

function row(o: Partial<ScannerRow> = {}): ScannerRow {
  return {
    symbol: "TIA-USDT",
    coin: "TIA",
    direction: "long",
    total: 85,
    factors: { zone: 28, sweep: 18, oi: 25, cvd: 14 },
    price: 1,
    change24h: 1,
    amplitude: 4,
    volumeUsd: 20_000_000,
    marketCap: 300_000_000,
    marketCapRank: 120,
    fundingRate: 0,
    sourceExchange: "Binance",
    ...o,
  };
}

describe("applyFilters", () => {
  it("默认滑块下放行一个典型候选", () => {
    expect(applyFilters([row()], DEFAULT_FILTERS)).toHaveLength(1);
  });

  it("成交量滑块按百万美元换算后比较", () => {
    const f = { ...DEFAULT_FILTERS, volume: 25 };
    expect(applyFilters([row({ volumeUsd: 20_000_000 })], f)).toHaveLength(0);
    expect(applyFilters([row({ volumeUsd: 26_000_000 })], f)).toHaveLength(1);
  });

  it("振幅滑块过滤", () => {
    expect(applyFilters([row({ amplitude: 2 })], DEFAULT_FILTERS)).toHaveLength(0);
  });

  it("市值下限过滤，上限固定 500M", () => {
    expect(applyFilters([row({ marketCap: 20_000_000 })], DEFAULT_FILTERS)).toHaveLength(0);
    expect(applyFilters([row({ marketCap: 600_000_000 })], DEFAULT_FILTERS)).toHaveLength(0);
  });

  it("方向筛选", () => {
    const rows = [row({ direction: "long" }), row({ symbol: "X-USDT", direction: "short" })];
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, direction: "long" })).toHaveLength(1);
    expect(applyFilters(rows, { ...DEFAULT_FILTERS, direction: "short" })).toHaveLength(1);
    expect(applyFilters(rows, DEFAULT_FILTERS)).toHaveLength(2);
  });
});

describe("sortRows", () => {
  const rows = [row({ symbol: "A-USDT", total: 70 }), row({ symbol: "B-USDT", total: 90 })];

  it("降序把大的排前面", () => {
    expect(sortRows(rows, "total", -1)[0].symbol).toBe("B-USDT");
  });

  it("升序反过来", () => {
    expect(sortRows(rows, "total", 1)[0].symbol).toBe("A-USDT");
  });

  it("不修改入参数组", () => {
    const copy = [...rows];
    sortRows(rows, "total", -1);
    expect(rows).toEqual(copy);
  });

  it("symbol 按字典序而不是数值比较", () => {
    expect(sortRows(rows, "symbol", 1)[0].symbol).toBe("A-USDT");
  });

  describe("change24h 为 null 时", () => {
    const withNull = [
      row({ symbol: "UP-USDT", change24h: 5 }),
      row({ symbol: "NONE-USDT", change24h: null }),
      row({ symbol: "DOWN-USDT", change24h: -5 }),
    ];

    it("降序时沉到最后", () => {
      expect(sortRows(withNull, "change24h", -1).map((r) => r.symbol)).toEqual([
        "UP-USDT",
        "DOWN-USDT",
        "NONE-USDT",
      ]);
    });

    it("升序时同样沉到最后，不冒充涨跌为 0 排到下跌的币前面", () => {
      // Number(null) === 0，所以「没数据」很容易被当成 0% 混进中间。
      // 升序是这个 bug 最明显的地方：null 会排在所有下跌的币之前。
      expect(sortRows(withNull, "change24h", 1).map((r) => r.symbol)).toEqual([
        "DOWN-USDT",
        "UP-USDT",
        "NONE-USDT",
      ]);
    });
  });
});
