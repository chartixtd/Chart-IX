import { describe, it, expect, vi, beforeEach } from "vitest";
import { compressionRatio, volumeRatio, BARS_24H, BARS_6H, VOLUME_RATIO_MIN } from "./pool-metrics";
import { fetchPoolMetrics, fetchReviewBars, REVIEW_BARS } from "./pool-metrics";
import { getFuturesKlines } from "@/lib/bingx/market";

vi.mock("@/lib/bingx/market", () => ({ getFuturesKlines: vi.fn() }));
const klines = vi.mocked(getFuturesKlines);

/** n 根 [high, low] 都一样的 K 线 */
const flat = (n: number, high: number, low: number, quoteVolume = 100) =>
  Array.from({ length: n }, () => ({ high, low, quoteVolume }));

describe("compressionRatio", () => {
  it("最近 6 小时缩得越窄，比值越小", () => {
    // 前 36 根在 [100,130]（振幅 30%），最后 12 根缩在 [100,103]（振幅 3%）
    const bars = [
      ...flat(BARS_24H - BARS_6H, 130, 100),
      ...flat(BARS_6H, 103, 100),
    ];
    // 24h 振幅仍是 30%（包含前面那段），6h 是 3% → 0.1
    expect(compressionRatio(bars)!).toBeCloseTo(0.1, 6);
  });

  it("全程一个区间 = 比值 1", () => {
    expect(compressionRatio(flat(BARS_24H, 110, 100))!).toBeCloseTo(1, 6);
  });

  it("24h 振幅只由最后 48 根决定，更早的不算", () => {
    // 前面塞一段巨大振幅，它在 24h 窗口之外，不该影响结果
    const bars = [...flat(50, 1000, 100), ...flat(BARS_24H, 110, 100)];
    expect(compressionRatio(bars)!).toBeCloseTo(1, 6);
  });

  it("根数不足 48 返回 null——凑不出 24 小时就没有分母", () => {
    expect(compressionRatio(flat(BARS_24H - 1, 110, 100))).toBeNull();
  });

  it("24h 一动不动返回 null，不是 0", () => {
    // 「压缩到极致」和「这个标的根本没交易」必须分开：后者排到榜首是错的。
    expect(compressionRatio(flat(BARS_24H, 100, 100))).toBeNull();
  });

  it("价格非法不误算", () => {
    const bars = flat(BARS_24H, NaN, NaN);
    expect(compressionRatio(bars)).toBeNull();
  });

  it("最低价为 0 时返回 null 而不是 Infinity", () => {
    expect(compressionRatio(flat(BARS_24H, 100, 0))).toBeNull();
  });
});

describe("volumeRatio", () => {
  /** days 天的 K 线，最后一天每根的成交额换成 recent */
  const series = (days: number, base: number, recent: number) => {
    const n = days * BARS_24H;
    return Array.from({ length: n }, (_, i) => ({
      high: 110,
      low: 100,
      quoteVolume: i >= n - BARS_24H ? recent : base,
    }));
  };

  it("每天量都一样时比值是 1", () => {
    expect(volumeRatio(series(14, 100, 100))!).toBeCloseTo(1, 6);
  });

  it("最近 24 小时萎缩 = 比值 < 门槛，这正是要挡的那种币", () => {
    // 平时每根 500、今天只有 50
    expect(volumeRatio(series(14, 500, 50))!).toBeLessThan(VOLUME_RATIO_MIN);
  });

  it("最近 24 小时放量 = 比值 > 1", () => {
    expect(volumeRatio(series(14, 100, 400))!).toBeGreaterThan(1);
  });

  it("日均按实际根数折算，序列长短不该把比值算成另一个东西", () => {
    const a = volumeRatio(series(7, 100, 400))!;
    const b = volumeRatio(series(14, 100, 400))!;
    expect(Math.abs(a - b)).toBeLessThan(1);
  });

  it("不足两天的样本返回 null", () => {
    expect(volumeRatio(series(1, 100, 100))).toBeNull();
  });

  it("有一根坏数据就返回 null，不用残缺的和去除", () => {
    const s = series(14, 100, 100);
    s[10] = { ...s[10], quoteVolume: NaN };
    expect(volumeRatio(s)).toBeNull();
  });

  it("总量为 0 时返回 null 而不是 Infinity", () => {
    expect(volumeRatio(series(14, 0, 0))).toBeNull();
  });
});

/**
 * 复核用的 K 线为什么要从这一趟里带出来：判「有没有碰到失效线」只要价格
 * K 线，而全池这 250 个币的 K 线本来就要拉一遍。不复用它，复核就只能走
 * CoinGlass 明细层，那里每轮只够扫 24 个币——活卡一旦掉出那 24 个就再也
 * 没人复核，只能一直挂着。
 */
describe("fetchPoolMetrics 顺带留下的复核 K 线", () => {
  /** i 递增的 30 分钟 K 线，价格全一样 */
  const series = (n: number, close = 100) =>
    Array.from({ length: n }, (_, i) => ({
      openTime: i * 1_800_000,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1,
      closeTime: i * 1_800_000 + 1_799_999,
      quoteVolume: 100,
    }));

  beforeEach(() => {
    klines.mockReset();
    klines.mockImplementation(async () => series(BARS_24H * 3));
  });

  it("只留点名的那几个币，其余一根都不留", async () => {
    const out = await fetchPoolMetrics(["A-USDT", "B-USDT"], new Set(["A-USDT"]));
    expect([...out.bars.keys()]).toEqual(["A-USDT"]);
  });

  it("最多留最近 REVIEW_BARS 根，且转成了流水线通用的形状", async () => {
    const out = await fetchPoolMetrics(["A-USDT"], new Set(["A-USDT"]));
    const bars = out.bars.get("A-USDT")!;
    expect(bars).toHaveLength(REVIEW_BARS);
    // 留的是最近的那一段，不是最早的
    expect(bars[bars.length - 1].time).toBe((BARS_24H * 3 - 1) * 1_800_000);
    expect(bars[0].high).toBe("101");
  });

  it("压缩度算不出来的币，K 线照样留——那是两件事", async () => {
    // 只有 10 根，凑不出 24 小时，compressionRatio 返回 null；但这个币可能
    // 正有一张活卡等着复核。
    klines.mockImplementation(async () => series(10));
    const out = await fetchPoolMetrics(["A-USDT"], new Set(["A-USDT"]));
    expect(out.metrics.has("A-USDT")).toBe(false);
    expect(out.bars.get("A-USDT")).toHaveLength(10);
  });

  it("不点名时不留任何 K 线，行为跟以前一样", async () => {
    const out = await fetchPoolMetrics(["A-USDT"]);
    expect(out.bars.size).toBe(0);
    expect(out.metrics.has("A-USDT")).toBe(true);
  });

  it("单个币拉失败只丢它自己", async () => {
    klines.mockImplementation(async (symbol: string) => {
      if (symbol === "A-USDT") throw new Error("boom");
      return series(BARS_24H * 3);
    });
    const out = await fetchPoolMetrics(["A-USDT", "B-USDT"], new Set(["A-USDT", "B-USDT"]));
    expect(out.bars.has("A-USDT")).toBe(false);
    expect(out.bars.has("B-USDT")).toBe(true);
  });
});

describe("fetchReviewBars", () => {
  const series = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      openTime: i * 1_800_000,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1,
      closeTime: i * 1_800_000 + 1_799_999,
      quoteVolume: 100,
    }));

  beforeEach(() => {
    klines.mockReset();
    klines.mockImplementation(async () => series(REVIEW_BARS));
  });

  it("补拉有活卡却没进候选池的币", async () => {
    const out = await fetchReviewBars(["A-USDT"]);
    expect(out.get("A-USDT")).toHaveLength(REVIEW_BARS);
  });

  it("拉不到就是这一轮复核不了，不抛错", async () => {
    klines.mockImplementation(async () => {
      throw new Error("boom");
    });
    await expect(fetchReviewBars(["A-USDT"])).resolves.toEqual(new Map());
  });

  it("空序列不进结果——空的等于没复核成", async () => {
    klines.mockImplementation(async () => []);
    const out = await fetchReviewBars(["A-USDT"]);
    expect(out.size).toBe(0);
  });
});
