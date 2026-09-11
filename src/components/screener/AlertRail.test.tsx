import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import zh from "@/i18n/messages/zh-CN.json";
import { AlertRail } from "./AlertRail";
import type { AlertCardData } from "@/lib/screener/cards";

const HOUR = 3_600_000;

/**
 * 行情订阅换成可控的假数据。这组用例要验的是**排列顺序**，不是 WebSocket——
 * 而顺序恰恰依赖实时价（前端用它判碰线），所以这份价格表必须捏在手里。
 */
const prices: Record<string, number> = {};
vi.mock("@/hooks/useCardPrices", () => ({ useCardPrices: () => prices }));

function setPrices(next: Record<string, number>): void {
  for (const k of Object.keys(prices)) delete prices[k];
  Object.assign(prices, next);
}

/** 失效价一律 1、做多，所以「实时价 < 1」就是穿线。 */
const mk = (symbol: string, minutesAgo: number, o: Partial<AlertCardData> = {}): AlertCardData => ({
  key: `${symbol}|k`,
  symbol,
  coin: symbol.replace("-USDT", ""),
  trigger: {
    type: "scenario",
    scenario: {
      kind: "a3_e1_absorb",
      direction: "long",
      trap: false,
      strength: "strongest",
      triggeredAt: Date.now() - 3 * HOUR,
      invalidation: { price: 1, breach: "below" },
      structureLevel: 1,
      cvdPct: 3,
      oiPct: 2,
      oiState: "up",
    },
  },
  direction: "long",
  factors: { oi: 30, cvd: 10 },
  total: 40,
  firstSeenAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  firstPrice: 10,
  peakPct: 0,
  invalidation: { price: 1, breach: "below" },
  expired: false,
  ...o,
});

function render(cards: AlertCardData[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="zh-CN" messages={zh}>
        <AlertRail cards={cards} />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

/** 按币名在 HTML 里出现的先后，还原出实际渲染顺序。 */
function orderOf(html: string, coins: string[]): string[] {
  return coins
    .map((c) => ({ c, at: html.indexOf(`>${c}<`) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.c);
}

beforeEach(() => setPrices({}));

describe("警报栏的排列", () => {
  it("前端实时价判出失效的卡沉底，不夹在活卡中间", () => {
    // 线上截图的样子：BOME 两小时前出现、实时价已经穿了失效线，而它后面还
    // 跟着 ALLO（2 小时）和 FET（4 小时）两张活卡。服务端眼里 BOME 还活着，
    // 所以这个顺序只能在前端修。
    setPrices({ "BOME-USDT": 0.5, "VIRTUAL-USDT": 10, "ALLO-USDT": 10, "FET-USDT": 10 });
    const cards = [
      mk("VIRTUAL-USDT", 60),
      mk("BOME-USDT", 120),
      mk("ALLO-USDT", 121),
      mk("FET-USDT", 240),
    ];
    expect(orderOf(render(cards), ["VIRTUAL", "BOME", "ALLO", "FET"])).toEqual([
      "VIRTUAL",
      "ALLO",
      "FET",
      "BOME",
    ]);
  });

  it("服务端标的灰卡同样在最后", () => {
    setPrices({ "AAA-USDT": 10, "BBB-USDT": 10 });
    const cards = [
      mk("AAA-USDT", 200, {
        expired: true,
        expiredBy: "invalidation",
        expiredAt: new Date().toISOString(),
      }),
      mk("BBB-USDT", 300),
    ];
    expect(orderOf(render(cards), ["AAA", "BBB"])).toEqual(["BBB", "AAA"]);
  });

  it("超时的卡沉底，哪怕服务端还没确认", () => {
    setPrices({ "OLD-USDT": 10, "NEW-USDT": 10 });
    expect(orderOf(render([mk("OLD-USDT", 7 * 60), mk("NEW-USDT", 5)]), ["OLD", "NEW"])).toEqual([
      "NEW",
      "OLD",
    ]);
  });

  it("多张死卡之间保持服务端给的先后", () => {
    setPrices({ "AAA-USDT": 0.5, "BBB-USDT": 0.5, "CCC-USDT": 10 });
    const cards = [mk("AAA-USDT", 10), mk("BBB-USDT", 20), mk("CCC-USDT", 30)];
    expect(orderOf(render(cards), ["AAA", "BBB", "CCC"])).toEqual(["CCC", "AAA", "BBB"]);
  });

  it("全是活卡时一个都不动，保持服务端给的顺序", () => {
    setPrices({ "AAA-USDT": 10, "BBB-USDT": 10, "CCC-USDT": 10 });
    const cards = [mk("AAA-USDT", 5), mk("BBB-USDT", 30), mk("CCC-USDT", 90)];
    expect(orderOf(render(cards), ["AAA", "BBB", "CCC"])).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("死掉的卡显示红「已失效」，活的不显示", () => {
    setPrices({ "AAA-USDT": 0.5, "BBB-USDT": 10 });
    const html = render([mk("AAA-USDT", 10), mk("BBB-USDT", 20)]);
    expect(html).toContain("已失效");
    expect(html).toContain("价格已穿过失效价");
    // 两张卡里只有一张带标签
    expect(html.split("已失效").length - 1).toBe(1);
  });

  it("一张卡都没有时给空态", () => {
    expect(render([])).toContain("暂无活跃警报");
  });
});
