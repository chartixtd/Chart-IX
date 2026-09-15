import { describe, it, expect } from "vitest";
import {
  orderTypeLabel,
  isTriggerType,
  displayPrice,
  fromLiveOrder,
  fromPaperOrder,
  fromPaperLimitOrder,
  type OrderRow,
} from "./row";
import type { Order, PaperOrder } from "@/types";

function liveOrder(patch: Partial<Order> = {}): Order {
  return {
    id: "o1",
    user_id: "u1",
    market_type: "futures",
    symbol: "BTC-USDT",
    side: "buy",
    order_type: "MARKET",
    quantity: 1,
    price: null,
    stop_price: null,
    leverage: 10,
    status: "pending",
    bingx_order_id: "123",
    executed_qty: null,
    executed_price: null,
    total_value: 100,
    fee: null,
    fee_asset: null,
    error_message: null,
    risk_rejected: false,
    risk_reason: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...patch,
  } as Order;
}

describe("orderTypeLabel", () => {
  // 页面之前用的是一张小写键的映射表，而 020 迁移之后落库的一律是
  // BingX 的大写原始类型名，所以每一行都匹配不上，直接显示 STOP_MARKET。
  it("maps the uppercase BingX type names the DB actually stores", () => {
    expect(orderTypeLabel("STOP_MARKET")).toBe("Stop Market");
    expect(orderTypeLabel("TRAILING_TP_SL")).toBe("Trailing TP/SL");
    expect(orderTypeLabel("MARKET")).toBe("Market");
    expect(orderTypeLabel("OCO")).toBe("OCO");
  });

  it("still maps the lowercase values left over from migration 006", () => {
    expect(orderTypeLabel("stop_loss")).toBe("Stop Loss");
    expect(orderTypeLabel("limit")).toBe("Limit");
  });

  it("prettifies unknown types instead of showing a raw enum", () => {
    expect(orderTypeLabel("SOME_NEW_TYPE")).toBe("Some New Type");
  });
});

describe("displayPrice", () => {
  const base = fromLiveOrder(liveOrder());

  it("prefers the average fill price once there is one", () => {
    const row: OrderRow = { ...base, price: 100, executedPrice: 101.5 };
    expect(displayPrice(row)).toEqual({ value: 101.5, kind: "executed" });
  });

  it("falls back to the trigger price for stop orders, which have no limit price", () => {
    // 这正是之前价格列显示横杠的那一类：STOP_MARKET 的 price 落库为 null，
    // 真正的价在 stop_price 里。
    const row: OrderRow = { ...base, orderType: "STOP_MARKET", price: null, stopPrice: 27000 };
    expect(displayPrice(row)).toEqual({ value: 27000, kind: "trigger" });
  });

  it("uses the limit price for an unfilled limit order", () => {
    const row: OrderRow = { ...base, orderType: "LIMIT", price: 99 };
    expect(displayPrice(row)).toEqual({ value: 99, kind: "limit" });
  });

  it("reports market orders as having no price at all", () => {
    expect(displayPrice(base)).toEqual({ value: null, kind: "market" });
  });

  it("does not label a priceless stop order as a market order", () => {
    // 被风控或交易所拒掉的止损单三个价都是空的。标成「市价」是错的——
    // 它是一张止损单，只是从没拿到过价。
    const row: OrderRow = { ...base, orderType: "TRAILING_STOP_MARKET", price: null, stopPrice: null };
    expect(displayPrice(row)).toEqual({ value: null, kind: "none" });
  });

  it("treats every trigger-bearing type as a trigger type", () => {
    for (const t of ["STOP", "TAKE_PROFIT_MARKET", "TRIGGER_LIMIT", "TRAILING_STOP_MARKET"]) {
      expect(isTriggerType(t)).toBe(true);
    }
    expect(isTriggerType("LIMIT")).toBe(false);
  });
});

describe("fromLiveOrder", () => {
  it("surfaces the exchange error as the row's reason", () => {
    const row = fromLiveOrder(liveOrder({ status: "rejected", error_message: "80001: insufficient margin" }));
    expect(row.reason).toBe("80001: insufficient margin");
    expect(row.riskRejected).toBe(false);
  });

  it("surfaces the risk reason when the order never reached the exchange", () => {
    const row = fromLiveOrder(
      liveOrder({ status: "rejected", error_message: null, risk_rejected: true, risk_reason: "MAX_LEVERAGE" })
    );
    expect(row.reason).toBe("MAX_LEVERAGE");
    expect(row.riskRejected).toBe(true);
  });

  it("normalises side and type casing", () => {
    const row = fromLiveOrder(liveOrder({ side: "SELL" as Order["side"], order_type: "limit" as Order["order_type"] }));
    expect(row.side).toBe("sell");
    expect(row.orderType).toBe("LIMIT");
  });

  it("keeps the leverage that the table never used to show", () => {
    expect(fromLiveOrder(liveOrder({ leverage: 20 })).leverage).toBe(20);
  });
});

describe("paper rows", () => {
  it("treats a paper fill as a filled market order", () => {
    const paper: PaperOrder = {
      id: "p1",
      account_id: "a1",
      symbol: "ETH-USDT",
      side: "sell",
      quantity: 2,
      price: 2500,
      total_value: 5000,
      realized_pnl: 120,
      balance_after: 10120,
      leverage: 5,
      margin: 1000,
      created_at: "2026-09-02T00:00:00.000Z",
    };
    const row = fromPaperOrder(paper);
    expect(row.source).toBe("paper");
    expect(row.status).toBe("filled");
    expect(row.executedPrice).toBe(2500);
    expect(row.realizedPnl).toBe(120);
  });

  it("namespaces ids so a paper row can never collide with a live one", () => {
    const live = fromLiveOrder(liveOrder({ id: "same" }));
    const paperLimit = fromPaperLimitOrder({
      id: "same",
      symbol: "BTC-USDT",
      side: "buy",
      quantity: 1,
      price: 50000,
      status: "pending",
      created_at: "2026-09-02T00:00:00.000Z",
    });
    expect(paperLimit.id).not.toBe(live.id);
    expect(paperLimit.status).toBe("pending");
    expect(paperLimit.totalValue).toBe(50000);
  });
});
