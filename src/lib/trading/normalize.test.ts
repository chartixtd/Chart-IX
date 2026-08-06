import { describe, it, expect } from "vitest";
import { normalizeSpotSymbol, normalizeFuturesContract, precisionFromStep } from "./normalize";
import type { BingXSymbol, BingXContract } from "@/types/bingx";

const spotRaw: BingXSymbol = {
  symbol: "BTC-USDT",
  minQty: 0.0001,
  maxQty: 100,
  minNotional: 5,
  maxNotional: 1000000,
  tickSize: 0.1,
  stepSize: 0.000001,
  status: 1,
};

const futuresRaw: BingXContract = {
  symbol: "BTC-USDT",
  asset: "BTC",
  currency: "USDT",
  size: "1",
  pricePrecision: 1,
  quantityPrecision: 4,
  tradeMinQuantity: 0.0001,
  tradeMinUSDT: 2,
  maxLongLeverage: 125,
  maxShortLeverage: 100,
  makerFeeRate: 0.0002,
  takerFeeRate: 0.0005,
  status: 1,
  apiStateOpen: "true",
  apiStateClose: "true",
};

describe("normalizeSpotSymbol", () => {
  it("derives precision from tickSize and stepSize", () => {
    const spec = normalizeSpotSymbol(spotRaw);
    expect(spec.pricePrecision).toBe(1);
    expect(spec.quantityPrecision).toBe(6);
  });

  it("carries min quantity and min notional through", () => {
    const spec = normalizeSpotSymbol(spotRaw);
    expect(spec.minQty).toBe(0.0001);
    expect(spec.minNotional).toBe(5);
    expect(spec.market).toBe("spot");
  });

  it("marks status other than 1 as not tradable", () => {
    expect(normalizeSpotSymbol({ ...spotRaw, status: 0 }).tradable).toBe(false);
    expect(normalizeSpotSymbol(spotRaw).tradable).toBe(true);
  });

  it("handles integer tickSize as zero precision", () => {
    const spec = normalizeSpotSymbol({ ...spotRaw, tickSize: 1, stepSize: 1 });
    expect(spec.pricePrecision).toBe(0);
    expect(spec.quantityPrecision).toBe(0);
  });

  it("leaves maxLeverage undefined for spot", () => {
    expect(normalizeSpotSymbol(spotRaw).maxLeverage).toBeUndefined();
  });
});

describe("normalizeFuturesContract", () => {
  it("uses the long leverage cap for LONG", () => {
    expect(normalizeFuturesContract(futuresRaw, "LONG").maxLeverage).toBe(125);
  });

  it("uses the short leverage cap for SHORT", () => {
    expect(normalizeFuturesContract(futuresRaw, "SHORT").maxLeverage).toBe(100);
  });

  it("maps tradeMinUSDT to minNotional and tradeMinQuantity to minQty", () => {
    const spec = normalizeFuturesContract(futuresRaw, "LONG");
    expect(spec.minNotional).toBe(2);
    expect(spec.minQty).toBe(0.0001);
    expect(spec.market).toBe("futures");
  });

  it("is not tradable when the API open state is false", () => {
    const spec = normalizeFuturesContract({ ...futuresRaw, apiStateOpen: "false" }, "LONG");
    expect(spec.tradable).toBe(false);
  });

  it("is not tradable when status is 0 even if apiStateOpen is true", () => {
    const spec = normalizeFuturesContract({ ...futuresRaw, status: 0 }, "LONG");
    expect(spec.tradable).toBe(false);
  });

  it("carries the taker fee rate for preview estimates", () => {
    expect(normalizeFuturesContract(futuresRaw, "LONG").takerFeeRate).toBe(0.0005);
  });

  it("leaves maxLeverage undefined when the contract omits the leverage caps", () => {
    // BingX 的 live 公开接口不返回 maxLongLeverage / maxShortLeverage
    // （2026-07-29 实测 944 个合约中 0 次），这是生产环境的真实形状
    const { maxLongLeverage: _maxLongLeverage, maxShortLeverage: _maxShortLeverage, ...withoutCaps } = futuresRaw;
    expect(normalizeFuturesContract(withoutCaps, "LONG").maxLeverage).toBeUndefined();
    expect(normalizeFuturesContract(withoutCaps, "SHORT").maxLeverage).toBeUndefined();
  });

  it("still normalizes every other field when the leverage caps are absent", () => {
    const { maxLongLeverage: _maxLongLeverage, maxShortLeverage: _maxShortLeverage, ...withoutCaps } = futuresRaw;
    const spec = normalizeFuturesContract(withoutCaps, "LONG");
    expect(spec.quantityPrecision).toBe(4);
    expect(spec.pricePrecision).toBe(1);
    expect(spec.minQty).toBe(0.0001);
    expect(spec.minNotional).toBe(2);
    expect(spec.takerFeeRate).toBe(0.0005);
    expect(spec.tradable).toBe(true);
  });
});

describe("precisionFromStep", () => {
  it.each([
    [1, 0],
    [0.1, 1],
    [0.01, 2],
    [0.001, 3],
    [0.0001, 4],
    [0.00001, 5],
    [0.000001, 6],
    [0.0000001, 7],
    [0.00000001, 8],
  ])("treats %p (a power of ten) as precision %p", (step, expected) => {
    expect(precisionFromStep(step)).toBe(expected);
  });

  it.each([
    [0.25, 2],
    [0.5, 1],
    [0.05, 2],
  ])("derives the true decimal-digit count for non-power-of-ten step %p", (step, expected) => {
    expect(precisionFromStep(step)).toBe(expected);
  });

  it.each([0, -1, NaN, Infinity])("returns 0 for the guard case %p", (step) => {
    expect(precisionFromStep(step)).toBe(0);
  });
});
