export type OrderFormMarket = "spot" | "futures" | "paper";

export interface OrderTypeOption {
  key: string;
  label: string;
  descKey: string;
}

export interface MarketConfig {
  /** 是否显示杠杆选择 */
  hasLeverage: boolean;
  /** 是否走真实资金 */
  isLive: boolean;
  /** 方向按钮文案的 i18n key */
  longLabelKey: string;
  shortLabelKey: string;
  /** 简单模式下可选的订单类型 */
  simpleTypes: string[];
  /** 专业模式下可选的订单类型 */
  proTypes: string[];
}

const SPOT_TYPES = [
  "MARKET", "LIMIT",
  "TAKE_STOP_MARKET", "TAKE_STOP_LIMIT",
  "TRIGGER_MARKET", "TRIGGER_LIMIT",
];

const FUTURES_TYPES = [
  "MARKET", "LIMIT",
  "STOP_MARKET", "STOP",
  "TAKE_PROFIT_MARKET", "TAKE_PROFIT",
  "TRAILING_STOP_MARKET", "TRAILING_TP_SL",
];

export const MARKET_CONFIG: Record<OrderFormMarket, MarketConfig> = {
  spot: {
    hasLeverage: false,
    isLive: true,
    longLabelKey: "trading.side.buy",
    shortLabelKey: "trading.side.sell",
    simpleTypes: ["MARKET", "LIMIT"],
    proTypes: SPOT_TYPES,
  },
  futures: {
    hasLeverage: true,
    isLive: true,
    longLabelKey: "trading.side.long",
    shortLabelKey: "trading.side.short",
    simpleTypes: ["MARKET", "LIMIT"],
    proTypes: FUTURES_TYPES,
  },
  paper: {
    hasLeverage: true,
    isLive: false,
    longLabelKey: "trading.side.long",
    shortLabelKey: "trading.side.short",
    simpleTypes: ["MARKET", "LIMIT"],
    proTypes: ["MARKET", "LIMIT"],
  },
};

export const LIMIT_TYPES = new Set([
  "LIMIT", "TAKE_STOP_LIMIT", "TRIGGER_LIMIT", "STOP", "TAKE_PROFIT",
]);
export const STOP_TYPES = new Set([
  "TAKE_STOP_MARKET", "TAKE_STOP_LIMIT", "TRIGGER_MARKET", "TRIGGER_LIMIT",
  "STOP_MARKET", "STOP", "TAKE_PROFIT_MARKET", "TAKE_PROFIT",
]);
export const TRAILING_TYPES = new Set(["TRAILING_STOP_MARKET", "TRAILING_TP_SL"]);
/** 只有市价/限价单能附带止盈止损对象（BingX 限制） */
export const TPSL_ATTACHABLE = new Set(["MARKET", "LIMIT"]);
