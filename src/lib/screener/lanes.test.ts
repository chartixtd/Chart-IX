import { describe, it, expect } from "vitest";
import { LANE_ORDER, DEFAULT_LANE, isLaneKey, laneOfSymbol, rowsInLane, cardsInLane } from "./lanes";
import type { ScannerRow } from "./types";
import type { AlertCardData } from "./cards";

const row = (symbol: string, assetClass: ScannerRow["assetClass"]): ScannerRow =>
  ({ symbol, assetClass }) as ScannerRow;

const card = (symbol: string): AlertCardData => ({ symbol }) as AlertCardData;

describe("isLaneKey", () => {
  // 路由段是用户能随手改的。`/screener/foo` 必须 404，而不是渲染一张空表
  // ——空表看起来跟「这一栏这一轮没有达标的标的」一模一样。
  it("只认三个分栏，别的一律不认", () => {
    expect(isLaneKey("crypto")).toBe(true);
    expect(isLaneKey("commodity")).toBe(true);
    expect(isLaneKey("stock")).toBe(true);
    expect(isLaneKey("foo")).toBe(false);
    expect(isLaneKey("")).toBe(false);
  });

  it("不认 alerts —— 它是静态路由段，不是分栏", () => {
    // `/screener/alerts` 靠静态段优先命中它自己的 page，永远不会走到
    // `[assetClass]`；这条断言防止有人以后把 alerts 当成第四个分栏。
    expect(isLaneKey("alerts")).toBe(false);
  });

  it("默认分栏是三个里的一个", () => {
    expect(LANE_ORDER).toContain(DEFAULT_LANE);
  });
});

/*
 * 卡片的分栏是**从 symbol 的前缀推**的，不是存在 AlertCardData 上的字段。
 * 存字段要把 SCANNER_PAYLOAD_VERSION 再 +1（会丢弃线上缓存、空一轮），
 * 而且一张卡能活 6 小时、跨得过好几轮部署——存了之后旧卡反而分不了类。
 */
describe("laneOfSymbol", () => {
  it("按 BingX 的前缀分：NCCO 商品、NCSK/NCSI 美股、其余加密", () => {
    expect(laneOfSymbol("NCCOGOLD2USD-USDT")).toBe("commodity");
    expect(laneOfSymbol("NCSKNVDA2USD-USDT")).toBe("stock");
    expect(laneOfSymbol("NCSISP5002USD-USDT")).toBe("stock");
    expect(laneOfSymbol("BTC-USDT")).toBe("crypto");
    expect(laneOfSymbol("1000PEPE-USDT")).toBe("crypto");
  });

  it("不误伤 NCASH 这类真实币种", () => {
    expect(laneOfSymbol("NCASH-USDT")).toBe("crypto");
  });

  it("外汇不属于任何一栏，三个页面都不显示它", () => {
    // 外汇在 preselect 阶段就被排除了，正常不会有卡；真出现一张也不该被
    // 硬塞进某一栏。
    expect(laneOfSymbol("NCFXEURUSD2USD-USDT")).toBeNull();
  });
});

describe("rowsInLane / cardsInLane", () => {
  it("行按自己带的 assetClass 分", () => {
    const rows = [row("BTC-USDT", "crypto"), row("NCCOGOLD2USD-USDT", "commodity"), row("NCSKNVDA2USD-USDT", "stock")];
    expect(rowsInLane(rows, "crypto").map((r) => r.symbol)).toEqual(["BTC-USDT"]);
    expect(rowsInLane(rows, "commodity").map((r) => r.symbol)).toEqual(["NCCOGOLD2USD-USDT"]);
    expect(rowsInLane(rows, "stock").map((r) => r.symbol)).toEqual(["NCSKNVDA2USD-USDT"]);
  });

  it("卡按 symbol 推出来的分栏分", () => {
    const cards = [card("BTC-USDT"), card("NCSKAAPL2USD-USDT"), card("NCCO1OILWTI2USD-USDT")];
    expect(cardsInLane(cards, "crypto").map((c) => c.symbol)).toEqual(["BTC-USDT"]);
    expect(cardsInLane(cards, "stock").map((c) => c.symbol)).toEqual(["NCSKAAPL2USD-USDT"]);
    expect(cardsInLane(cards, "commodity").map((c) => c.symbol)).toEqual(["NCCO1OILWTI2USD-USDT"]);
  });

  it("三栏加起来不重不漏", () => {
    const cards = [card("BTC-USDT"), card("NCSKAAPL2USD-USDT"), card("NCCOGOLD2USD-USDT"), card("ETH-USDT")];
    const total = LANE_ORDER.reduce((n, lane) => n + cardsInLane(cards, lane).length, 0);
    expect(total).toBe(cards.length);
  });
});
