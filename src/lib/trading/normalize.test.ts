import { describe, it, expect } from "vitest";
import { normalizeSpotSymbol, normalizeFuturesContract } from "./normalize";
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
});
