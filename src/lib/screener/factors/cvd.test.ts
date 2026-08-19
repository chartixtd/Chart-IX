import { describe, it, expect } from "vitest";
import { cvdNorm, cvdScore, CVD_WINDOW_BARS } from "./cvd";
import type { CoinGlassTakerBar, CoinGlassPriceBar } from "@/lib/coinglass/types";

function taker(deltas: number[], gross = 1000): CoinGlassTakerBar[] {
  // 每根总成交额固定为 gross，买卖按 delta 拆开
  return deltas.map((d, i) => ({
    time: i * 1_800_000,
    aggregated_buy_volume_usd: (gross + d) / 2,
    aggregated_sell_volume_usd: (gross - d) / 2,
  }));
}

function priceBars(closes: number[]): CoinGlassPriceBar[] {
  return closes.map((c, i) => ({
    time: i * 1_800_000,
    open: String(c),
    high: String(c),
    low: String(c),
    close: String(c),
    volume_usd: "1000",
  }));
}

const FLAT_PRICE = priceBars(Array.from({ length: 20 }, () => 100));
const RISING_PRICE = priceBars(Array.from({ length: 20 }, (_, i) => 100 + i));
const FALLING_PRICE = priceBars(Array.from({ length: 20 }, (_, i) => 100 - i));

describe("cvdNorm", () => {
  it("持续净买入是正数、持续净卖出是负数", () => {
    expect(cvdNorm(taker(Array(20).fill(200)), CVD_WINDOW_BARS)!).toBeGreaterThan(0);
    expect(cvdNorm(taker(Array(20).fill(-200)), CVD_WINDOW_BARS)!).toBeLessThan(0);
  });

  it("字段逐根在 string / number 之间摇摆时，结果与全 number 完全一致", () => {
    // CoinGlassTakerBar 把两个金额字段声明成 string | number 是防御性的
    // （实测 4704 根全是 number，但同系列的 OI 端点确实会逐根摇摆）。
    // 这条测试是那个声明唯一的验证：把奇数根改成字符串，结果必须不变。
    // 换回 parseFloat 会让 number 那半变成 NaN，换成 Number() 也能过——
    // 真正要挡的是「直接读字段当数字用」这类改动。
    const deltas = Array.from({ length: 20 }, (_, i) => (i % 3) * 150 - 150);
    const clean = taker(deltas);
    const mixed: CoinGlassTakerBar[] = clean.map((b, i) =>
      i % 2 === 1
        ? {
            time: b.time,
            aggregated_buy_volume_usd: String(b.aggregated_buy_volume_usd),
            aggregated_sell_volume_usd: String(b.aggregated_sell_volume_usd),
          }
        : b
    );
    const expected = cvdNorm(clean, CVD_WINDOW_BARS);
    expect(expected).not.toBeNull();
    // 不是 0 才有判别力——恒等于 0 的话任何实现都能通过
    expect(Math.abs(expected!)).toBeGreaterThan(0.01);
    expect(cvdNorm(mixed, CVD_WINDOW_BARS)).toBe(expected);
  });

  it("买卖持平时接近 0", () => {
    expect(Math.abs(cvdNorm(taker(Array(20).fill(0)), CVD_WINDOW_BARS)!)).toBeLessThan(0.05);
  });

  it("恒在 [-1, 1]——分母是同期换手总量，不受币的绝对体量影响", () => {
    for (const d of [1000, -1000, 999999, -999999]) {
      const v = cvdNorm(taker(Array(20).fill(d), 1000), CVD_WINDOW_BARS)!;
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("样本不足返回 null", () => {
    expect(cvdNorm(taker([100, 100]), CVD_WINDOW_BARS)).toBeNull();
    expect(cvdNorm([], CVD_WINDOW_BARS)).toBeNull();
  });
});

describe("cvdScore", () => {
  it("真实量级的资金流落在量程中段——既不贴中性分，也不提前顶满", () => {
    // 输入取 2026-08-19 复测的真实分布（14 币 × 336 根 × 两组独立样本）：
    // |净买入/总成交额| 中位 ≈0.05、95% 分位 ≈0.20、99% 分位 ≈0.32。
    // taker() 每根 delta 恒定时，cvdRawRatio 恰好等于 delta/gross，
    // 所以下面三个输入就是这三个分位数本身。
    //
    // **两侧都要断言，缺一侧这条用例就形同虚设。**
    // 只断言下限（原来的写法）挡不住饱和点定得过低：0.15 时 95% 分位的
    // 输入会被 clamp 到满分，`> 17` 照样通过，而那正是要防的失效模式
    // ——量程上半段被压平，强弱资金流打出同一个分。
    const median = cvdScore(taker(Array(20).fill(0.05 * 1000)), FLAT_PRICE, "long");
    const p95 = cvdScore(taker(Array(20).fill(0.2 * 1000)), FLAT_PRICE, "long");
    const p99 = cvdScore(taker(Array(20).fill(0.32 * 1000)), FLAT_PRICE, "long");

    // 下限：中位量级的资金流要推得动分数，不能贴在中性 10 分
    expect(median).toBeGreaterThan(11);
    // 上限：95% 分位还没到顶，量程留得住 95→99 这一段的区分度
    expect(p95).toBeLessThan(19);
    expect(p99 - p95).toBeGreaterThan(2);
    // 而且要拉得开：95% 分位必须明显强过中位数
    expect(p95 - median).toBeGreaterThan(4);
  });

  it("数据缺失给方向分中性 10、背离分 0，合计 10", () => {
    expect(cvdScore([], FLAT_PRICE, "long")).toBe(10);
    expect(cvdScore(taker(Array(20).fill(100)), [], "long")).toBe(10);
  });

  it("价格下跌但 CVD 上行 = 跌中承接，背离分在方向分之上再叠一大块", () => {
    const flow = taker(Array(20).fill(800));
    // 同一份资金流，只改价格走势：逆行时才拿得到背离分，走平时拿不到。
    // 用差值而不是绝对阈值断言，测的才是「背离分真的在加分」这条性质本身。
    const diverging = cvdScore(flow, FALLING_PRICE, "long");
    const flat = cvdScore(flow, FLAT_PRICE, "long");
    expect(diverging).toBeGreaterThan(flat + 10);
    // delta=800 相对每根 1000 的总成交额是 0.8，远超饱和点 0.15，norm 被夹到 1：
    // 方向分 20（满）+ 背离分 20（priceLeg 与 flowLeg 都封顶）= 40
    expect(diverging).toBeCloseTo(40, 5);
  });

  it("价格上涨但 CVD 下行 = 拉高出货，做空同样叠上背离分", () => {
    const flow = taker(Array(20).fill(-800));
    const diverging = cvdScore(flow, RISING_PRICE, "short");
    const flat = cvdScore(flow, FLAT_PRICE, "short");
    expect(diverging).toBeGreaterThan(flat + 10);
    expect(diverging).toBeCloseTo(40, 5);
  });

  it("同向时背离分给 0 而不是负分——同向的价值已经在方向分里算过一次", () => {
    // 价涨 + CVD 涨，做多：方向分接近满分 20，背离分 0
    const score = cvdScore(taker(Array(20).fill(800)), RISING_PRICE, "long");
    expect(score).toBeLessThanOrEqual(20.01);
    expect(score).toBeGreaterThan(16);
  });

  it("背离幅度越大分越高", () => {
    const shallow = priceBars(Array.from({ length: 20 }, (_, i) => 100 - i * 0.02));
    const deep = priceBars(Array.from({ length: 20 }, (_, i) => 100 - i * 0.5));
    const a = cvdScore(taker(Array(20).fill(800)), shallow, "long");
    const b = cvdScore(taker(Array(20).fill(800)), deep, "long");
    expect(b).toBeGreaterThan(a);
  });

  it("分数恒在 [0, 40]", () => {
    const cases: Array<[number[], CoinGlassPriceBar[]]> = [
      [Array(20).fill(999), RISING_PRICE],
      [Array(20).fill(-999), FALLING_PRICE],
      [Array(20).fill(0), FLAT_PRICE],
    ];
    for (const [d, p] of cases) {
      for (const dir of ["long", "short"] as const) {
        const v = cvdScore(taker(d), p, dir);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(40);
      }
    }
  });
});
