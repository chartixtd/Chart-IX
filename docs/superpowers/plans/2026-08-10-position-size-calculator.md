# 仓位计算器 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个公开可访问的仓位计算器页面，算法与外部参照计算器逐位一致，并接入桌面与手机导航。

**Architecture:** 全部算法集中在一个纯函数模块 `src/lib/position-size.ts` 里——这样「逻辑一模一样」是可被单元测试证明的，而不是靠肉眼比对界面。页面只负责收集输入、调用这个函数、展示结果。四类资产（股票/加密/外汇/期货）通过两个「换算率」统一到同一套公式，不写四份分支。

**Tech Stack:** Next.js 15 App Router、next-intl（zh-CN / en-US / ms-MY）、Tailwind、vitest。无新依赖，无外部 API。

**设计文档：** `docs/superpowers/specs/2026-08-10-position-size-calculator-design.md`

## Global Constraints

- **不复制外部站点的界面、文案或代码。** 只实现公开的标准算法（对方自己把主公式印在页面上），页面用站内既有设计语言重做。
- **只支持美元账户。** 外汇只开含美元的币对（点值可从入场价直接推出，零外部依赖）；**交叉盘刻意不做**——它需要外部汇率源，无法保证与参照一致。
- **不引入任何外部 API 或新依赖**：不做实时行情、不做汇率、不做保存/读取、不做快捷键。
- 算法基准是**实测反推值**，写在下面的测试里当断言。以 余额 10000 / 风险 2% / 入场 50 / 止损 48 / 杠杆 1:1 为例，参照计算器的实测输出是：100 股、仓位价值 $5,000、所需保证金 $5,000、风险额 $200、止损距离 $2.00 (4.0%)、账户风险 2.0%、持仓风险 4.0%、保证金占用 50.0%、最多亏损 50 次。**任何实现都必须复现这一组数字。**
- 风险档位阈值（实测扫描确定）：≤1% VERY CONSERVATIVE、≤2% CONSERVATIVE、≤3% MODERATE、≤5% HIGH、>5% VERY HIGH。
- 三个语言文件必须同步，缺一个会在该语言下抛缺失键错误。
- 页面**公开可访问**，不要求登录。
- 每个任务结束前跑 `npx tsc --noEmit`；最后一个任务跑全量 `npm run lint && npx vitest run && npm run build`。
- 提交信息用中文，沿用仓库前缀风格。

---

## File Structure

| 文件 | 责任 | 处置 |
|---|---|---|
| `src/lib/position-size.ts` | 全部算法：输入校验、四类资产的换算率、仓位/保证金/各项百分比/风险档位 | **新建**（Task 1） |
| `src/lib/position-size.test.ts` | 上述纯函数的单元测试 | **新建**（Task 1） |
| `src/app/[locale]/(app)/tools/position-size/page.tsx` | 计算器页面（客户端组件，表单 + 结果展示） | **新建**（Task 2） |
| `src/i18n/messages/{zh-CN,en-US,ms-MY}.json` | 文案 | 修改（Task 2 加 `calculator` 命名空间；Task 3 加 `nav.tools`） |
| `src/components/layout/Navbar.tsx` | 桌面导航 | 修改（Task 3） |
| `src/lib/nav/tabs.ts` | 移动导航归属与返回目标 | 修改（Task 3） |
| `src/lib/nav/tabs.test.ts` | 导航逻辑测试 | 修改（Task 3） |
| `src/app/[locale]/(app)/screener/page.tsx` | 筛选器页 | 修改（Task 3，加入口链接） |

---

### Task 1: 算法核心

**Files:**
- Create: `src/lib/position-size.ts`
- Create: `src/lib/position-size.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `computePositionSize(input: PositionSizeInput): PositionSizeResult`
  - 类型 `AssetClass`、`Direction`、`RiskMode`、`StopMode`、`ForexPairKey`、`PositionSizeInput`、`PositionSizeResult`、`RiskBand`
  - 常量 `FOREX_PAIRS`、`LOT_SIZE`
  - Task 2 的页面消费全部这些。

**背景（统一模型，务必按这个写，不要写四份分支）：**

四类资产的差别只体现在两个换算率上：

| 资产 | `quoteToUsd`（报价币→USD） | `baseToUsd`（基础币→USD） |
|---|---|---|
| 股票 / 加密 | `1` | `entryPrice` |
| 期货 | `contractMultiplier` | `entryPrice × contractMultiplier` |
| 外汇（报价币是 USD，如 EUR/USD） | `1` | `entryPrice` |
| 外汇（基础币是 USD，如 USD/JPY） | `1 / entryPrice` | `1` |

有了这两个率，主链路只有一条：

```
riskAmount   = riskMode==='percent' ? balance × riskPercent/100 : riskAmount
stopDistance = |entryPrice − stopPrice|
feePerUnit   = (entryPrice + stopPrice) × feePercent/100 × quoteToUsd
riskPerUnit  = (stopDistance + slippage) × quoteToUsd + feePerUnit
units        = riskAmount / riskPerUnit
positionValue= units × baseToUsd
margin       = positionValue / leverage
```

手续费按**单位摊算**而非「仓位价值的百分比」——后者会让方程自我引用（仓位价值依赖数量、数量依赖含费风险额），解不出来。取 `entryPrice + stopPrice` 是因为一次完整交易在这两处各收一次费。

`direction` 不参与数量计算（距离取绝对值），只用于从点数反推止损价的方向。

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/position-size.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { computePositionSize, FOREX_PAIRS, LOT_SIZE } from "./position-size";

/** 参照计算器的实测基准输入（见设计文档「已确认的现状事实」）。 */
const BASE = {
  assetClass: "stocks",
  direction: "long",
  accountBalance: 10000,
  riskMode: "percent",
  riskPercent: 2,
  entryPrice: 50,
  stopMode: "price",
  stopPrice: 48,
  leverage: 1,
} as const;

describe("computePositionSize — 参照计算器的实测基准", () => {
  it("复现实测的那一组数字，一个都不能差", () => {
    const r = computePositionSize(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toBeCloseTo(100, 6);
    expect(r.positionValue).toBeCloseTo(5000, 6);
    expect(r.requiredMargin).toBeCloseTo(5000, 6);
    expect(r.riskAmount).toBeCloseTo(200, 6);
    expect(r.stopDistance).toBeCloseTo(2, 6);
    expect(r.stopDistancePct).toBeCloseTo(4, 6);
    expect(r.accountRiskPct).toBeCloseTo(2, 6);
    expect(r.positionRiskPct).toBeCloseTo(4, 6);
    expect(r.marginUsedPct).toBeCloseTo(50, 6);
    expect(r.maxLosses).toBe(50);
  });

  it("杠杆 1:10 + 风险 6% → 保证金占用 15%（实测值）", () => {
    const r = computePositionSize({ ...BASE, riskPercent: 6, leverage: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.units).toBeCloseTo(300, 6);
    expect(r.positionValue).toBeCloseTo(15000, 6);
    expect(r.marginUsedPct).toBeCloseTo(15, 6);
    expect(r.maxLosses).toBe(16);
  });

  it("做空与做多得出相同数量——止损距离取绝对值", () => {
    const long = computePositionSize(BASE);
    const short = computePositionSize({
      ...BASE, direction: "short", entryPrice: 48, stopPrice: 50,
    });
    expect(long.ok && short.ok).toBe(true);
    if (!long.ok || !short.ok) return;
    expect(short.units).toBeCloseTo(long.units, 6);
  });

  it("风险按金额输入时忽略百分比", () => {
    const r = computePositionSize({
      ...BASE, riskMode: "amount", riskAmount: 500, riskPercent: 999,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.riskAmount).toBeCloseTo(500, 6);
    expect(r.units).toBeCloseTo(250, 6);
    expect(r.accountRiskPct).toBeCloseTo(5, 6);
  });
});

describe("风险档位（实测扫描确定的阈值）", () => {
  const bandAt = (riskPercent: number) => {
    const r = computePositionSize({ ...BASE, riskPercent });
    return r.ok ? r.riskBand : "invalid";
  };

  it("五档边界逐个对上", () => {
    expect(bandAt(0.5)).toBe("very-conservative");
    expect(bandAt(1)).toBe("very-conservative");
    expect(bandAt(1.01)).toBe("conservative");
    expect(bandAt(2)).toBe("conservative");
    expect(bandAt(2.01)).toBe("moderate");
    expect(bandAt(3)).toBe("moderate");
    expect(bandAt(3.01)).toBe("high");
    expect(bandAt(5)).toBe("high");
    expect(bandAt(5.01)).toBe("very-high");
    expect(bandAt(12)).toBe("very-high");
  });
});

describe("外汇", () => {
  it("EUR/USD：用参照页面自己的例子（$50 风险、50 点）得出 0.1 手", () => {
    const r = computePositionSize({
      assetClass: "forex", direction: "long", accountBalance: 5000,
      riskMode: "percent", riskPercent: 1,
      entryPrice: 1.0850, stopMode: "price", stopPrice: 1.0800,
      leverage: 1, forexPair: "EUR/USD",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.riskAmount).toBeCloseTo(50, 6);
    expect(r.units).toBeCloseTo(10000, 4);
    expect(r.lots).toBeCloseTo(0.1, 6);
    expect(r.positionValue).toBeCloseTo(10850, 4);
  });

  it("USD/JPY：报价币不是美元，点值随入场价变化", () => {
    const r = computePositionSize({
      assetClass: "forex", direction: "long", accountBalance: 10000,
      riskMode: "amount", riskAmount: 200,
      entryPrice: 150, stopMode: "price", stopPrice: 149.5,
      leverage: 1, forexPair: "USD/JPY",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 每单位风险 = 0.5 JPY × (1/150) = 0.003333 USD → 200/0.003333 = 60000 单位
    expect(r.units).toBeCloseTo(60000, 2);
    expect(r.lots).toBeCloseTo(0.6, 4);
    // 基础币就是美元，所以仓位价值等于单位数
    expect(r.positionValue).toBeCloseTo(60000, 2);
  });

  it("日元报价的币对点大小是 0.01，其余是 0.0001", () => {
    expect(FOREX_PAIRS["USD/JPY"].pipSize).toBe(0.01);
    expect(FOREX_PAIRS["EUR/USD"].pipSize).toBe(0.0001);
  });

  it("止损按点数输入，与按价格输入等价", () => {
    const byPrice = computePositionSize({
      assetClass: "forex", direction: "long", accountBalance: 5000,
      riskMode: "percent", riskPercent: 1,
      entryPrice: 1.0850, stopMode: "price", stopPrice: 1.0800,
      leverage: 1, forexPair: "EUR/USD",
    });
    const byPips = computePositionSize({
      assetClass: "forex", direction: "long", accountBalance: 5000,
      riskMode: "percent", riskPercent: 1,
      entryPrice: 1.0850, stopMode: "pips", stopPips: 50,
      leverage: 1, forexPair: "EUR/USD",
    });
    expect(byPrice.ok && byPips.ok).toBe(true);
    if (!byPrice.ok || !byPips.ok) return;
    expect(byPips.units).toBeCloseTo(byPrice.units, 4);
  });

  it("一标准手是 10 万单位", () => {
    expect(LOT_SIZE).toBe(100_000);
  });
});

describe("期货合约乘数", () => {
  it("乘数放大每点价值，因而压低合约数", () => {
    const r = computePositionSize({
      assetClass: "futures", direction: "long", accountBalance: 10000,
      riskMode: "amount", riskAmount: 500,
      entryPrice: 4500, stopMode: "price", stopPrice: 4490,
      leverage: 1, contractMultiplier: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 每单位风险 = 10 点 × 50 = $500 → 正好 1 张
    expect(r.units).toBeCloseTo(1, 6);
    expect(r.positionValue).toBeCloseTo(225000, 4);
  });
});

describe("高级项", () => {
  it("止盈给出盈亏比与预期盈利", () => {
    const r = computePositionSize({ ...BASE, takeProfitPrice: 56 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.riskRewardRatio).toBeCloseTo(3, 6);   // 6 / 2
    expect(r.expectedProfit).toBeCloseTo(600, 6);  // 100 股 × $6
  });

  it("不填止盈时不产生盈亏比", () => {
    const r = computePositionSize(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.riskRewardRatio).toBeNull();
    expect(r.expectedProfit).toBeNull();
  });

  it("手续费与滑点抬高每单位风险，压低数量", () => {
    const plain = computePositionSize(BASE);
    const withCost = computePositionSize({ ...BASE, feePercent: 0.1, slippage: 0.05 });
    expect(plain.ok && withCost.ok).toBe(true);
    if (!plain.ok || !withCost.ok) return;
    expect(withCost.units).toBeLessThan(plain.units);
    // 每单位风险 = (2 + 0.05) × 1 + (50+48) × 0.001 = 2.05 + 0.098 = 2.148
    expect(withCost.units).toBeCloseTo(200 / 2.148, 4);
  });

  it("两项都为 0 时与不填完全一致", () => {
    const plain = computePositionSize(BASE);
    const zero = computePositionSize({ ...BASE, feePercent: 0, slippage: 0 });
    expect(plain.ok && zero.ok).toBe(true);
    if (!plain.ok || !zero.ok) return;
    expect(zero.units).toBeCloseTo(plain.units, 10);
  });
});

describe("无效输入", () => {
  it("入场价与止损价相同 → 拒绝，不产生 Infinity", () => {
    const r = computePositionSize({ ...BASE, stopPrice: 50 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("stop-distance-zero");
  });

  it("余额为 0 或负 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, accountBalance: 0 }).ok).toBe(false);
    expect(computePositionSize({ ...BASE, accountBalance: -1 }).ok).toBe(false);
  });

  it("入场价为 0 或负 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, entryPrice: 0 }).ok).toBe(false);
  });

  it("风险为 0 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, riskPercent: 0 }).ok).toBe(false);
  });

  it("杠杆小于 1 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, leverage: 0 }).ok).toBe(false);
  });

  it("非有限数 → 拒绝", () => {
    expect(computePositionSize({ ...BASE, entryPrice: NaN }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/lib/position-size.test.ts
```

预期：FAIL，找不到模块 `./position-size`。

- [ ] **Step 3: 写实现**

创建 `src/lib/position-size.ts`：

```ts
/**
 * 仓位计算器的全部算法。
 *
 * 刻意做成一个不依赖 React、不碰网络的纯函数：这样「算法与参照计算器一致」
 * 是可以被单元测试证明的，而不是靠肉眼比对界面。页面只负责收集输入与展示。
 *
 * 四类资产不写四份分支——它们的差别全部收敛到 quoteToUsd / baseToUsd 两个
 * 换算率上（见 resolveRates），主链路只有一条。
 */

export type AssetClass = "stocks" | "crypto" | "forex" | "futures";
export type Direction = "long" | "short";
export type RiskMode = "percent" | "amount";
export type StopMode = "price" | "pips";
export type RiskBand = "very-conservative" | "conservative" | "moderate" | "high" | "very-high";

/** 一标准手的基础币单位数。 */
export const LOT_SIZE = 100_000;

/**
 * 只收录含美元的币对。美元账户下，这类币对的两个换算率都能从入场价推出，
 * 不需要任何行情或汇率数据；交叉盘（如 EUR/GBP）需要外部汇率，刻意不做。
 */
export const FOREX_PAIRS = {
  "EUR/USD": { pipSize: 0.0001, usdSide: "quote" },
  "GBP/USD": { pipSize: 0.0001, usdSide: "quote" },
  "AUD/USD": { pipSize: 0.0001, usdSide: "quote" },
  "NZD/USD": { pipSize: 0.0001, usdSide: "quote" },
  "USD/JPY": { pipSize: 0.01, usdSide: "base" },
  "USD/CHF": { pipSize: 0.0001, usdSide: "base" },
  "USD/CAD": { pipSize: 0.0001, usdSide: "base" },
} as const;

export type ForexPairKey = keyof typeof FOREX_PAIRS;

export interface PositionSizeInput {
  assetClass: AssetClass;
  direction: Direction;
  accountBalance: number;
  riskMode: RiskMode;
  riskPercent?: number;
  riskAmount?: number;
  entryPrice: number;
  stopMode: StopMode;
  stopPrice?: number;
  stopPips?: number;
  leverage: number;
  forexPair?: ForexPairKey;
  contractMultiplier?: number;
  takeProfitPrice?: number | null;
  feePercent?: number;
  slippage?: number;
}

export type InvalidReason =
  | "balance-invalid"
  | "entry-invalid"
  | "risk-invalid"
  | "leverage-invalid"
  | "stop-invalid"
  | "stop-distance-zero";

export type PositionSizeResult =
  | { ok: false; reason: InvalidReason }
  | {
      ok: true;
      units: number;
      /** 仅外汇有意义：units / LOT_SIZE。其余资产为 null。 */
      lots: number | null;
      positionValue: number;
      requiredMargin: number;
      riskAmount: number;
      stopDistance: number;
      stopDistancePct: number;
      accountRiskPct: number;
      positionRiskPct: number;
      marginUsedPct: number;
      maxLosses: number;
      riskBand: RiskBand;
      riskRewardRatio: number | null;
      expectedProfit: number | null;
    };

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * 风险档位。阈值是在参照计算器上逐点扫描实测出来的
 * （0.5/1/1.5/2/2.5/3/3.5/4/4.9/5/5.5/8/12），不是估的。
 */
function resolveRiskBand(accountRiskPct: number): RiskBand {
  if (accountRiskPct <= 1) return "very-conservative";
  if (accountRiskPct <= 2) return "conservative";
  if (accountRiskPct <= 3) return "moderate";
  if (accountRiskPct <= 5) return "high";
  return "very-high";
}

/**
 * 把四类资产收敛成两个换算率：
 *  · quoteToUsd —— 价格每变动 1 个单位，每 1 单位标的对应多少美元
 *  · baseToUsd  —— 每 1 单位标的值多少美元（用来算仓位价值）
 */
function resolveRates(input: PositionSizeInput): { quoteToUsd: number; baseToUsd: number } {
  const { assetClass, entryPrice } = input;

  if (assetClass === "futures") {
    const m = isPositive(input.contractMultiplier) ? input.contractMultiplier : 1;
    return { quoteToUsd: m, baseToUsd: entryPrice * m };
  }

  if (assetClass === "forex") {
    const pair = input.forexPair ? FOREX_PAIRS[input.forexPair] : undefined;
    // 基础币是美元（USD/JPY 这类）：价格是「1 美元换多少报价币」，所以报价币
    // 换回美元要除以价格；而 1 单位标的本身就是 1 美元。
    if (pair?.usdSide === "base") {
      return { quoteToUsd: 1 / entryPrice, baseToUsd: 1 };
    }
    // 报价币是美元（EUR/USD 这类）：价格已经是美元计价。
    return { quoteToUsd: 1, baseToUsd: entryPrice };
  }

  // 股票与加密：一手就是一股/一枚，价格就是美元。
  return { quoteToUsd: 1, baseToUsd: entryPrice };
}

/** 止损价：按价格输入就直接用；按点数输入则依方向从入场价推。 */
function resolveStopPrice(input: PositionSizeInput): number | null {
  if (input.stopMode === "price") {
    return typeof input.stopPrice === "number" && Number.isFinite(input.stopPrice)
      ? input.stopPrice
      : null;
  }
  if (!isPositive(input.stopPips)) return null;
  const pipSize = input.forexPair ? FOREX_PAIRS[input.forexPair].pipSize : 0.0001;
  const offset = input.stopPips * pipSize;
  return input.direction === "long" ? input.entryPrice - offset : input.entryPrice + offset;
}

export function computePositionSize(input: PositionSizeInput): PositionSizeResult {
  if (!isPositive(input.accountBalance)) return { ok: false, reason: "balance-invalid" };
  if (!isPositive(input.entryPrice)) return { ok: false, reason: "entry-invalid" };
  if (!isPositive(input.leverage) || input.leverage < 1) {
    return { ok: false, reason: "leverage-invalid" };
  }

  const riskAmount =
    input.riskMode === "percent"
      ? (isPositive(input.riskPercent) ? input.accountBalance * (input.riskPercent / 100) : 0)
      : (isPositive(input.riskAmount) ? input.riskAmount : 0);
  if (!isPositive(riskAmount)) return { ok: false, reason: "risk-invalid" };

  const stopPrice = resolveStopPrice(input);
  if (stopPrice === null || !Number.isFinite(stopPrice)) {
    return { ok: false, reason: "stop-invalid" };
  }

  const stopDistance = Math.abs(input.entryPrice - stopPrice);
  const slippage = isPositive(input.slippage) ? input.slippage : 0;
  if (stopDistance + slippage <= 0) return { ok: false, reason: "stop-distance-zero" };

  const { quoteToUsd, baseToUsd } = resolveRates(input);

  // 手续费按单位摊算，不按仓位价值的百分比——后者会让方程自我引用（仓位价值
  // 依赖数量、数量又依赖含费风险额），解不出来。入场与止损各收一次。
  const feePercent = isPositive(input.feePercent) ? input.feePercent : 0;
  const feePerUnit = (input.entryPrice + stopPrice) * (feePercent / 100) * quoteToUsd;

  const riskPerUnit = (stopDistance + slippage) * quoteToUsd + feePerUnit;
  if (!isPositive(riskPerUnit)) return { ok: false, reason: "stop-distance-zero" };

  const units = riskAmount / riskPerUnit;
  const positionValue = units * baseToUsd;
  const requiredMargin = positionValue / input.leverage;
  const accountRiskPct = (riskAmount / input.accountBalance) * 100;

  const tp = input.takeProfitPrice;
  const hasTp = typeof tp === "number" && Number.isFinite(tp) && tp > 0 && stopDistance > 0;

  return {
    ok: true,
    units,
    lots: input.assetClass === "forex" ? units / LOT_SIZE : null,
    positionValue,
    requiredMargin,
    riskAmount,
    stopDistance,
    stopDistancePct: (stopDistance / input.entryPrice) * 100,
    accountRiskPct,
    positionRiskPct: positionValue > 0 ? (riskAmount / positionValue) * 100 : 0,
    marginUsedPct: (requiredMargin / input.accountBalance) * 100,
    maxLosses: Math.floor(input.accountBalance / riskAmount),
    riskBand: resolveRiskBand(accountRiskPct),
    riskRewardRatio: hasTp ? Math.abs(tp - input.entryPrice) / stopDistance : null,
    expectedProfit: hasTp ? units * Math.abs(tp - input.entryPrice) * quoteToUsd : null,
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run src/lib/position-size.test.ts
npx tsc --noEmit
```

预期：全部通过。**任何一条基准断言对不上都不要改断言去迁就实现**——那些数字是参照计算器的实测输出，是本任务的验收标准；对不上说明实现有问题。

- [ ] **Step 5: 提交**

```bash
git add src/lib/position-size.ts src/lib/position-size.test.ts
git commit -m "feat(tools): 仓位计算器算法核心（四类资产统一模型，基准取自实测）"
```

---

### Task 2: 计算器页面

**Files:**
- Create: `src/app/[locale]/(app)/tools/position-size/page.tsx`
- Modify: `src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`

**Interfaces:**
- Consumes: Task 1 的 `computePositionSize`、`FOREX_PAIRS`、`LOT_SIZE` 及其类型
- Produces: 路由 `/{locale}/tools/position-size`。Task 3 的导航指向它。

**背景：**
页面是客户端组件（表单交互），用 `useState` 存输入、每次渲染直接调
`computePositionSize` 得结果——不需要 `useMemo`，这个函数是纯算术，开销可忽略。

**不要把任何算法写进页面。** 页面只做三件事：收集输入、调用 Task 1 的函数、
把结果格式化展示。任何「顺手在 UI 里算一下」都会让 Task 1 的测试失去意义。

**页面公开可访问**，不加登录判断。

- [ ] **Step 1: 加三语文案**

在每个语言文件顶层新增 `calculator` 命名空间。

`src/i18n/messages/zh-CN.json`：
```json
  "calculator": {
    "title": "仓位计算器",
    "subtitle": "按你能承受的风险，算出该开多大仓",
    "asset_class": "资产类别",
    "stocks": "股票",
    "crypto": "加密货币",
    "forex": "外汇",
    "futures": "期货",
    "forex_pair": "货币对",
    "direction": "方向",
    "long": "做多",
    "short": "做空",
    "account_balance": "账户余额",
    "risk_per_trade": "每笔风险",
    "risk_percent": "百分比",
    "risk_amount": "金额",
    "entry_price": "入场价",
    "stop_loss": "止损",
    "stop_by_price": "按价格",
    "stop_by_pips": "按点数",
    "leverage": "杠杆",
    "advanced": "高级选项",
    "take_profit": "止盈价（选填）",
    "fee_percent": "手续费 %（选填）",
    "slippage": "滑点（选填）",
    "contract_multiplier": "合约乘数",
    "results": "计算结果",
    "position_size": "仓位大小",
    "units_shares": "股",
    "units_coins": "枚",
    "units_lots": "手",
    "units_contracts": "张",
    "position_value": "仓位价值",
    "required_margin": "所需保证金",
    "risk_amount_label": "风险金额",
    "stop_distance": "止损距离",
    "risk_breakdown": "风险明细",
    "account_risk": "账户风险",
    "position_risk": "持仓风险",
    "margin_used": "保证金占用",
    "max_losses": "最多可连亏",
    "max_losses_unit": "次",
    "risk_reward": "盈亏比",
    "expected_profit": "预期盈利",
    "risk_assessment": "风险评估",
    "band_very_conservative": "非常保守",
    "band_conservative": "保守",
    "band_moderate": "中等风险",
    "band_high": "高风险",
    "band_very_high": "极高风险",
    "enter_values": "填入余额、风险、入场价与止损价即可计算",
    "err_balance": "账户余额必须大于 0",
    "err_entry": "入场价必须大于 0",
    "err_risk": "每笔风险必须大于 0",
    "err_leverage": "杠杆不能小于 1",
    "err_stop": "请填写有效的止损",
    "err_stop_zero": "止损价不能与入场价相同",
    "disclaimer": "本工具仅供风险管理参考，不构成投资建议。"
  },
```

`src/i18n/messages/en-US.json`：
```json
  "calculator": {
    "title": "Position Size Calculator",
    "subtitle": "Size your trade from the risk you can afford",
    "asset_class": "Asset class",
    "stocks": "Stocks",
    "crypto": "Crypto",
    "forex": "Forex",
    "futures": "Futures",
    "forex_pair": "Currency pair",
    "direction": "Direction",
    "long": "Long",
    "short": "Short",
    "account_balance": "Account balance",
    "risk_per_trade": "Risk per trade",
    "risk_percent": "Percent",
    "risk_amount": "Amount",
    "entry_price": "Entry price",
    "stop_loss": "Stop loss",
    "stop_by_price": "By price",
    "stop_by_pips": "By pips",
    "leverage": "Leverage",
    "advanced": "Advanced options",
    "take_profit": "Take profit (optional)",
    "fee_percent": "Fee % (optional)",
    "slippage": "Slippage (optional)",
    "contract_multiplier": "Contract multiplier",
    "results": "Results",
    "position_size": "Position size",
    "units_shares": "shares",
    "units_coins": "coins",
    "units_lots": "lots",
    "units_contracts": "contracts",
    "position_value": "Position value",
    "required_margin": "Required margin",
    "risk_amount_label": "Risk amount",
    "stop_distance": "Stop distance",
    "risk_breakdown": "Risk breakdown",
    "account_risk": "Account risk",
    "position_risk": "Position risk",
    "margin_used": "Margin used",
    "max_losses": "Max consecutive losses",
    "max_losses_unit": "",
    "risk_reward": "Risk/reward",
    "expected_profit": "Expected profit",
    "risk_assessment": "Risk assessment",
    "band_very_conservative": "Very conservative",
    "band_conservative": "Conservative",
    "band_moderate": "Moderate risk",
    "band_high": "High risk",
    "band_very_high": "Very high risk",
    "enter_values": "Enter balance, risk, entry and stop to calculate",
    "err_balance": "Account balance must be greater than 0",
    "err_entry": "Entry price must be greater than 0",
    "err_risk": "Risk per trade must be greater than 0",
    "err_leverage": "Leverage cannot be below 1",
    "err_stop": "Enter a valid stop loss",
    "err_stop_zero": "Stop loss cannot equal the entry price",
    "disclaimer": "This tool is for risk-management reference only and is not investment advice."
  },
```

`src/i18n/messages/ms-MY.json`：
```json
  "calculator": {
    "title": "Kalkulator Saiz Posisi",
    "subtitle": "Tentukan saiz dagangan berdasarkan risiko yang anda mampu",
    "asset_class": "Kelas aset",
    "stocks": "Saham",
    "crypto": "Kripto",
    "forex": "Forex",
    "futures": "Niaga hadapan",
    "forex_pair": "Pasangan mata wang",
    "direction": "Arah",
    "long": "Long",
    "short": "Short",
    "account_balance": "Baki akaun",
    "risk_per_trade": "Risiko setiap dagangan",
    "risk_percent": "Peratus",
    "risk_amount": "Jumlah",
    "entry_price": "Harga masuk",
    "stop_loss": "Stop loss",
    "stop_by_price": "Ikut harga",
    "stop_by_pips": "Ikut pip",
    "leverage": "Leveraj",
    "advanced": "Pilihan lanjutan",
    "take_profit": "Take profit (pilihan)",
    "fee_percent": "Yuran % (pilihan)",
    "slippage": "Slippage (pilihan)",
    "contract_multiplier": "Pendarab kontrak",
    "results": "Keputusan",
    "position_size": "Saiz posisi",
    "units_shares": "saham",
    "units_coins": "unit",
    "units_lots": "lot",
    "units_contracts": "kontrak",
    "position_value": "Nilai posisi",
    "required_margin": "Margin diperlukan",
    "risk_amount_label": "Jumlah risiko",
    "stop_distance": "Jarak stop",
    "risk_breakdown": "Pecahan risiko",
    "account_risk": "Risiko akaun",
    "position_risk": "Risiko posisi",
    "margin_used": "Margin digunakan",
    "max_losses": "Kekalahan berturut maksimum",
    "max_losses_unit": "",
    "risk_reward": "Risiko/ganjaran",
    "expected_profit": "Jangkaan untung",
    "risk_assessment": "Penilaian risiko",
    "band_very_conservative": "Sangat konservatif",
    "band_conservative": "Konservatif",
    "band_moderate": "Risiko sederhana",
    "band_high": "Risiko tinggi",
    "band_very_high": "Risiko sangat tinggi",
    "enter_values": "Masukkan baki, risiko, harga masuk dan stop untuk mengira",
    "err_balance": "Baki akaun mesti lebih daripada 0",
    "err_entry": "Harga masuk mesti lebih daripada 0",
    "err_risk": "Risiko setiap dagangan mesti lebih daripada 0",
    "err_leverage": "Leveraj tidak boleh kurang daripada 1",
    "err_stop": "Masukkan stop loss yang sah",
    "err_stop_zero": "Stop loss tidak boleh sama dengan harga masuk",
    "disclaimer": "Alat ini untuk rujukan pengurusan risiko sahaja dan bukan nasihat pelaburan."
  },
```

把 `calculator` 放在顶层（与 `community`、`screener` 同级），缩进对齐该层级既有的键。

- [ ] **Step 2: 校验 JSON**

```bash
node -e "for (const f of ['zh-CN','en-US','ms-MY']) JSON.parse(require('fs').readFileSync('src/i18n/messages/'+f+'.json','utf8')); console.log('all valid JSON')"
```

预期：输出 `all valid JSON`。

- [ ] **Step 3: 写页面**

创建 `src/app/[locale]/(app)/tools/position-size/page.tsx`：

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import {
  computePositionSize,
  FOREX_PAIRS,
  type AssetClass,
  type Direction,
  type ForexPairKey,
  type PositionSizeInput,
  type RiskMode,
  type StopMode,
} from "@/lib/position-size";

const ASSET_CLASSES: AssetClass[] = ["stocks", "crypto", "forex", "futures"];
const LEVERAGES = [1, 2, 5, 10, 20, 30, 50, 100, 200, 500];

/** 空字符串要保留成空（而不是 0），否则用户清空输入框会立刻变成 0。 */
function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const BAND_KEY = {
  "very-conservative": "band_very_conservative",
  conservative: "band_conservative",
  moderate: "band_moderate",
  high: "band_high",
  "very-high": "band_very_high",
} as const;

const BAND_COLOR = {
  "very-conservative": "text-success",
  conservative: "text-success",
  moderate: "text-warning",
  high: "text-danger",
  "very-high": "text-danger",
} as const;

const ERR_KEY = {
  "balance-invalid": "err_balance",
  "entry-invalid": "err_entry",
  "risk-invalid": "err_risk",
  "leverage-invalid": "err_leverage",
  "stop-invalid": "err_stop",
  "stop-distance-zero": "err_stop_zero",
} as const;

export default function PositionSizeCalculatorPage() {
  const t = useTranslations("calculator");

  const [assetClass, setAssetClass] = useState<AssetClass>("stocks");
  const [direction, setDirection] = useState<Direction>("long");
  const [forexPair, setForexPair] = useState<ForexPairKey>("EUR/USD");
  const [balance, setBalance] = useState("10000");
  const [riskMode, setRiskMode] = useState<RiskMode>("percent");
  const [riskPercent, setRiskPercent] = useState("2");
  const [riskAmount, setRiskAmount] = useState("");
  const [entry, setEntry] = useState("");
  const [stopMode, setStopMode] = useState<StopMode>("price");
  const [stopPrice, setStopPrice] = useState("");
  const [stopPips, setStopPips] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [takeProfit, setTakeProfit] = useState("");
  const [feePercent, setFeePercent] = useState("");
  const [slippage, setSlippage] = useState("");
  const [multiplier, setMultiplier] = useState("");

  const input: PositionSizeInput = {
    assetClass,
    direction,
    accountBalance: num(balance) ?? 0,
    riskMode,
    riskPercent: num(riskPercent),
    riskAmount: num(riskAmount),
    entryPrice: num(entry) ?? 0,
    stopMode,
    stopPrice: num(stopPrice),
    stopPips: num(stopPips),
    leverage: num(leverage) ?? 1,
    forexPair: assetClass === "forex" ? forexPair : undefined,
    contractMultiplier: assetClass === "futures" ? num(multiplier) : undefined,
    takeProfitPrice: showAdvanced ? num(takeProfit) ?? null : null,
    feePercent: showAdvanced ? num(feePercent) : undefined,
    slippage: showAdvanced ? num(slippage) : undefined,
  };

  const result = computePositionSize(input);

  // 用户还没填完时不该看到红色报错——只有动过入场价才提示
  const touched = entry.trim() !== "";

  const unitLabel =
    assetClass === "forex" ? t("units_lots")
    : assetClass === "futures" ? t("units_contracts")
    : assetClass === "crypto" ? t("units_coins")
    : t("units_shares");

  const field = "w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none focus:border-gold/60";
  const label = "mb-1 block text-xs text-text-muted";
  const seg = (active: boolean) =>
    cn(
      "flex-1 rounded-sm px-3 py-2 text-sm transition-colors",
      active ? "bg-gold/15 text-gold" : "text-text-secondary hover:text-text-primary"
    );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:py-10">
      <h1 className="font-display text-2xl tracking-tighter text-text-primary lg:text-3xl">
        {t("title")}
      </h1>
      <p className="mt-2 text-sm text-text-secondary">{t("subtitle")}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ── 输入 ── */}
        <Card className="space-y-4">
          <div>
            <span className={label}>{t("asset_class")}</span>
            <div className="flex gap-1 rounded-sm border border-border-default p-1">
              {ASSET_CLASSES.map((a) => (
                <button key={a} type="button" onClick={() => setAssetClass(a)} className={seg(assetClass === a)}>
                  {t(a)}
                </button>
              ))}
            </div>
          </div>

          {assetClass === "forex" && (
            <div>
              <label className={label} htmlFor="pair">{t("forex_pair")}</label>
              <select id="pair" className={field} value={forexPair}
                onChange={(e) => setForexPair(e.target.value as ForexPairKey)}>
                {(Object.keys(FOREX_PAIRS) as ForexPairKey[]).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <span className={label}>{t("direction")}</span>
            <div className="flex gap-1 rounded-sm border border-border-default p-1">
              <button type="button" onClick={() => setDirection("long")} className={seg(direction === "long")}>
                {t("long")}
              </button>
              <button type="button" onClick={() => setDirection("short")} className={seg(direction === "short")}>
                {t("short")}
              </button>
            </div>
          </div>

          <div>
            <label className={label} htmlFor="balance">{t("account_balance")} (USD)</label>
            <input id="balance" type="number" inputMode="decimal" className={field}
              value={balance} onChange={(e) => setBalance(e.target.value)} />
          </div>

          <div>
            <span className={label}>{t("risk_per_trade")}</span>
            <div className="mb-2 flex gap-1 rounded-sm border border-border-default p-1">
              <button type="button" onClick={() => setRiskMode("percent")} className={seg(riskMode === "percent")}>
                {t("risk_percent")}
              </button>
              <button type="button" onClick={() => setRiskMode("amount")} className={seg(riskMode === "amount")}>
                {t("risk_amount")}
              </button>
            </div>
            {riskMode === "percent" ? (
              <input type="number" inputMode="decimal" className={field} placeholder="2"
                value={riskPercent} onChange={(e) => setRiskPercent(e.target.value)} />
            ) : (
              <input type="number" inputMode="decimal" className={field} placeholder="200"
                value={riskAmount} onChange={(e) => setRiskAmount(e.target.value)} />
            )}
          </div>

          <div>
            <label className={label} htmlFor="entry">{t("entry_price")}</label>
            <input id="entry" type="number" inputMode="decimal" className={field}
              value={entry} onChange={(e) => setEntry(e.target.value)} />
          </div>

          <div>
            <span className={label}>{t("stop_loss")}</span>
            {assetClass === "forex" && (
              <div className="mb-2 flex gap-1 rounded-sm border border-border-default p-1">
                <button type="button" onClick={() => setStopMode("price")} className={seg(stopMode === "price")}>
                  {t("stop_by_price")}
                </button>
                <button type="button" onClick={() => setStopMode("pips")} className={seg(stopMode === "pips")}>
                  {t("stop_by_pips")}
                </button>
              </div>
            )}
            {stopMode === "price" || assetClass !== "forex" ? (
              <input type="number" inputMode="decimal" className={field}
                value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} />
            ) : (
              <input type="number" inputMode="decimal" className={field} placeholder="50"
                value={stopPips} onChange={(e) => setStopPips(e.target.value)} />
            )}
          </div>

          {assetClass === "futures" && (
            <div>
              <label className={label} htmlFor="mult">{t("contract_multiplier")}</label>
              <input id="mult" type="number" inputMode="decimal" className={field} placeholder="50"
                value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
            </div>
          )}

          <div>
            <label className={label} htmlFor="lev">{t("leverage")}</label>
            <select id="lev" className={field} value={leverage} onChange={(e) => setLeverage(e.target.value)}>
              {LEVERAGES.map((l) => <option key={l} value={l}>1:{l}</option>)}
            </select>
          </div>

          <button type="button" onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-text-muted transition-colors hover:text-gold">
            {showAdvanced ? "− " : "+ "}{t("advanced")}
          </button>

          {showAdvanced && (
            <div className="space-y-3 border-t border-border-default pt-3">
              <div>
                <label className={label} htmlFor="tp">{t("take_profit")}</label>
                <input id="tp" type="number" inputMode="decimal" className={field}
                  value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="fee">{t("fee_percent")}</label>
                <input id="fee" type="number" inputMode="decimal" className={field} placeholder="0.1"
                  value={feePercent} onChange={(e) => setFeePercent(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="slip">{t("slippage")}</label>
                <input id="slip" type="number" inputMode="decimal" className={field}
                  value={slippage} onChange={(e) => setSlippage(e.target.value)} />
              </div>
            </div>
          )}
        </Card>

        {/* ── 结果 ── */}
        <Card className="space-y-4">
          <h2 className="text-sm font-medium text-text-primary">{t("results")}</h2>

          {!result.ok ? (
            <p className={cn("text-sm", touched ? "text-danger" : "text-text-muted")}>
              {touched ? t(ERR_KEY[result.reason]) : t("enter_values")}
            </p>
          ) : (
            <>
              <div className="border-b border-border-default pb-4">
                <p className="text-xs text-text-muted">{t("position_size")}</p>
                <p className="mt-1 font-display text-3xl tracking-tighter text-gold">
                  {fmt(result.lots ?? result.units, result.lots !== null ? 3 : 2)}{" "}
                  <span className="text-base text-text-secondary">{unitLabel}</span>
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  ${fmt(result.positionValue)} {t("position_value")}
                </p>
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t("risk_amount_label")}</dt>
                  <dd className="tabular-nums text-text-primary">${fmt(result.riskAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t("stop_distance")}</dt>
                  <dd className="tabular-nums text-text-primary">
                    {fmt(result.stopDistance, 4)} ({fmt(result.stopDistancePct)}%)
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t("required_margin")}</dt>
                  <dd className="tabular-nums text-text-primary">${fmt(result.requiredMargin)}</dd>
                </div>
              </dl>

              <div className="border-t border-border-default pt-4">
                <p className="mb-2 text-xs text-text-muted">{t("risk_breakdown")}</p>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t("account_risk")}</dt>
                    <dd className="tabular-nums text-text-primary">{fmt(result.accountRiskPct, 1)}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t("position_risk")}</dt>
                    <dd className="tabular-nums text-text-primary">{fmt(result.positionRiskPct, 1)}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t("margin_used")}</dt>
                    <dd className="tabular-nums text-text-primary">{fmt(result.marginUsedPct, 1)}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-muted">{t("max_losses")}</dt>
                    <dd className="tabular-nums text-text-primary">
                      {result.maxLosses} {t("max_losses_unit")}
                    </dd>
                  </div>
                </dl>
              </div>

              {result.riskRewardRatio !== null && (
                <div className="border-t border-border-default pt-4">
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-text-muted">{t("risk_reward")}</dt>
                      <dd className="tabular-nums text-text-primary">1:{fmt(result.riskRewardRatio)}</dd>
                    </div>
                    {result.expectedProfit !== null && (
                      <div className="flex justify-between">
                        <dt className="text-text-muted">{t("expected_profit")}</dt>
                        <dd className="tabular-nums text-success">${fmt(result.expectedProfit)}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              <div className="border-t border-border-default pt-4">
                <p className="mb-1 text-xs text-text-muted">{t("risk_assessment")}</p>
                <p className={cn("text-lg font-medium", BAND_COLOR[result.riskBand])}>
                  {fmt(result.accountRiskPct, 1)}% · {t(BAND_KEY[result.riskBand])}
                </p>
              </div>
            </>
          )}
        </Card>
      </div>

      <p className="mt-6 text-xs text-text-muted">{t("disclaimer")}</p>
    </div>
  );
}
```

- [ ] **Step 4: 校验**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
git add "src/app/[locale]/(app)/tools" src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(tools): 仓位计算器页面（三语，公开可访问）"
```

---

### Task 3: 导航接入

**Files:**
- Modify: `src/components/layout/Navbar.tsx:17-18` 与其 `navLinks` 构造
- Modify: `src/lib/nav/tabs.ts`
- Modify: `src/lib/nav/tabs.test.ts`
- Modify: `src/app/[locale]/(app)/screener/page.tsx`
- Modify: `src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`

**Interfaces:**
- Consumes: Task 2 的路由 `/{locale}/tools/position-size`
- Produces: 无新导出。`TAB_SEGMENTS.screener` 增加 `"tools"`；`resolveBackTarget` 增加 `tools` 分支。

**背景（两处 spec 没定、必须在这里定死的事）：**

1. **`Navbar` 的链接是 `/${locale}/${item}` 拼出来的。** 直接把 `"tools"` 加进
   `USER_NAV_ITEMS` 会生成 `/{locale}/tools` —— 而页面在
   `/{locale}/tools/position-size`，那个路径**不存在，会 404**。所以必须给它一个
   href 覆盖（`home` 已经是这么特殊处理的，照着做）。**不要**为此新建一个
   `/tools` 索引页——目前只有一个工具，建索引页是凭空多一层。

2. **导航要不要对未登录用户显示。** `GUEST_NAV_ITEMS` 目前只有 `home`，注释写明
   理由是「产品导航都在登录墙后，不该向未登录用户画饼」。但计算器**未登录也完全
   可用**，不是画饼，而且设计文档明确把它定位成拉新入口——只对已登录用户显示
   等于让「公开可访问」这个决定失去意义。所以 `tools` **两个数组都要加**。

`BACK_HIDDEN_SEGMENTS` **不加** `tools`：它不是 tab 落地页，应当显示返回按钮。

- [ ] **Step 1: 加三语导航文案**

在每个语言文件的 `nav` 对象里新增一个键（放在 `screener` 之后）：

`zh-CN`：`"tools": "工具",`
`en-US`：`"tools": "Tools",`
`ms-MY`：`"tools": "Alatan",`

- [ ] **Step 2: 改 `tabs.ts`**

把 `TAB_SEGMENTS` 的 `screener` 一行

```ts
  screener: ["screener"],
```

改为

```ts
  // 计算器等交易辅助工具归筛选器 tab——两者同属「开仓前的准备」，
  // 且手机底部 5 个 tab 位置已满，不值得为一个工具再开一个
  screener: ["screener", "tools"],
```

在 `resolveBackTarget` 的 switch 里，`case "learn":` 之前插入：

```ts
    case "tools":
      return `/${locale}/screener`;
```

- [ ] **Step 3: 改 `tabs.test.ts`**

在 `describe("resolveActiveTab")` 内新增：

```ts
  it("工具页归筛选器 tab", () => {
    expect(resolveActiveTab("/zh-CN/tools/position-size", "zh-CN")).toBe("screener");
  });
```

在 `describe("resolveBackTarget")` 内新增：

```ts
  it("工具页退回筛选器", () => {
    expect(resolveBackTarget("/zh-CN/tools/position-size", "zh-CN")).toBe("/zh-CN/screener");
  });
```

在 `describe("shouldShowBackButton")` 内新增：

```ts
  it("工具页要显示返回——它不是 tab 落地页", () => {
    expect(shouldShowBackButton("/zh-CN/tools/position-size", "zh-CN")).toBe(true);
  });
```

- [ ] **Step 4: 改 `Navbar.tsx`**

把这两行

```ts
const GUEST_NAV_ITEMS = ["home"] as const;
const USER_NAV_ITEMS = ["dashboard", "videos", "articles", "news", "trade", "screener"] as const;
```

改为

```ts
// 计算器未登录也完全可用（不是登录墙后的画饼），且它是拉新入口，
// 所以 tools 在登录与未登录两种导航里都出现。
const GUEST_NAV_ITEMS = ["home", "tools"] as const;
const USER_NAV_ITEMS = ["dashboard", "videos", "articles", "news", "trade", "screener", "tools"] as const;

// 导航项默认按 /{locale}/{item} 拼链接；这里放例外。tools 的落地页是具体的
// 计算器，站内没有 /tools 索引页，直接拼会 404。
const NAV_HREF_OVERRIDES: Record<string, string> = {
  tools: "/tools/position-size",
};
```

然后把 `navLinks` 里的 `href` 表达式

```tsx
          href={`/${locale}${item === "home" ? "" : `/${item}`}`}
```

改为

```tsx
          href={`/${locale}${
            item === "home" ? "" : NAV_HREF_OVERRIDES[item] ?? `/${item}`
          }`}
```

`active` 的判断（`segments.includes(item)`）不用改：`/zh-CN/tools/position-size`
的分段里含 `"tools"`，会正确高亮。

- [ ] **Step 5: 在筛选器页加入口**

在 `src/app/[locale]/(app)/screener/page.tsx` 的页面标题区下方（首个内容块之前）
插入一个链接。先读该文件确认标题区的实际结构，再把下面这段放在标题与表格之间：

```tsx
      <Link
        href={`/${locale}/tools/position-size`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-gold"
      >
        {tCalc("title")} →
      </Link>
```

该文件需要 `import Link from "next/link";`、`useLocale`（若尚未引入）以及
`const tCalc = useTranslations("calculator");`。若文件已引入其中某些，不要重复引入。

- [ ] **Step 6: 校验**

```bash
node -e "for (const f of ['zh-CN','en-US','ms-MY']) JSON.parse(require('fs').readFileSync('src/i18n/messages/'+f+'.json','utf8')); console.log('all valid JSON')"
npx vitest run src/lib/nav/tabs.test.ts
npx tsc --noEmit
npm run lint
```

预期：全部通过。

- [ ] **Step 7: 提交**

```bash
git add src/components/layout/Navbar.tsx src/lib/nav/tabs.ts src/lib/nav/tabs.test.ts "src/app/[locale]/(app)/screener/page.tsx" src/i18n/messages
git commit -m "feat(nav): 工具入口接入桌面导航与筛选器 tab"
```

---

### Task 4: 全量校验与浏览器验收

**Files:** 无代码改动（纯验证任务）

**Interfaces:**
- Consumes: Task 1–3 的全部产出
- Produces: 无

**背景：**
算法由 Task 1 的单测保证；页面与导航是组件与布局，项目 vitest（node 环境、
`include` 只有 `src/lib/**` 与 `src/stores/**`）覆盖不到，靠本任务人工验收。

**dev server 的坑（本项目已踩过两次）：** 若在 git worktree 里执行本计划，
`preview_start` 按会话工作目录解析 `.claude/launch.json`，起的可能是主仓库而不是
worktree；且 Tailwind 的 content 是相对路径，按进程 cwd 解析。验收前先确认服务的
确实是本次改动的代码（例如导航里能看到「工具」）。

- [ ] **Step 1: 全量校验**

```bash
npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```

预期：四项全过。

- [ ] **Step 2: 用参照基准核对页面**

打开 `/zh-CN/tools/position-size`，填入：余额 10000、风险 2%、入场 50、止损 48、
杠杆 1:1。页面必须显示：

- 仓位大小 **100.00 股**，仓位价值 **$5,000.00**
- 风险金额 **$200.00**，止损距离 **2.0000 (4.00%)**，所需保证金 **$5,000.00**
- 账户风险 **2.0%**、持仓风险 **4.0%**、保证金占用 **50.0%**、最多可连亏 **50**
- 风险评估 **2.0% · 保守**

- [ ] **Step 3: 核对杠杆与风险档位**

把杠杆改成 1:10、风险改成 6%：保证金占用应为 **15.0%**，风险评估应为
**6.0% · 极高风险**，最多可连亏 **16**。

- [ ] **Step 4: 核对外汇**

资产类别切到外汇、币对 EUR/USD、余额 5000、风险 1%、入场 1.0850、止损 1.0800：
仓位应为 **0.100 手**，仓位价值约 **$10,850**。再把止损切到「按点数」填 50，
结果应当不变。

- [ ] **Step 5: 核对高级项**

展开高级选项，填止盈 56（回到 Step 2 的股票输入）：盈亏比应为 **1:3.00**，
预期盈利 **$600.00**。再填手续费 0.1 与滑点 0.05，仓位数量应当**变小**。

- [ ] **Step 6: 核对错误提示**

把止损改成与入场价相同：应显示「止损价不能与入场价相同」，而不是出现
`Infinity` 或 `NaN`。清空入场价：应回到「填入余额、风险、入场价与止损价即可
计算」的中性提示，而不是红色报错。

- [ ] **Step 7: 核对导航**

- 桌面已登录：顶部导航有「工具」，点击进入计算器页，该项高亮
- 桌面**未登录**：顶部导航同样有「工具」，点击可直接使用（这是本次刻意的决定）
- 手机：进入计算器页后底部高亮**筛选器** tab；顶部返回按钮点击后退到 `/screener`
- 筛选器页上有进入计算器的入口

- [ ] **Step 8: 三语抽查**

`/en-US/tools/position-size` 与 `/ms-MY/tools/position-size` 各打开一次，
确认无缺失文案键报错，导航项分别显示 `Tools` / `Alatan`。

- [ ] **Step 9: 控制台检查**

上述各页控制台无报错。

- [ ] **Step 10: 关闭开发服务器**

---

## 自检记录

- **设计文档逐节覆盖：** ①纯计算核心 → Task 1；②外汇点值 → Task 1（`resolveRates` 的 forex 两支 + `FOREX_PAIRS`）与其四条外汇测试；③高级项 → Task 1（止盈/手续费/滑点/合约乘数）+ Task 2 的高级选项面板；④页面与导航 → Task 2、Task 3；⑤测试与验收 → Task 1 的单测 + Task 4 的十步验收。
- **两处设计文档没定、计划中定死的事**（都在 Task 3 的背景里写明了理由）：
  1. `Navbar` 按 `/{locale}/{item}` 拼链接，直接加 `tools` 会指向不存在的 `/tools` 而 404 —— 加 `NAV_HREF_OVERRIDES`，且不为此新建索引页。
  2. 设计文档说页面「公开可访问」，但 `GUEST_NAV_ITEMS` 只有 `home`，未登录用户根本看不到入口 —— 那样「公开」就白设了。因此 `tools` 加进**两个**导航数组。
- **顺序依赖：** Task 1 必须早于 Task 2（页面调用它）；Task 2 必须早于 Task 3（导航指向它的路由）。
- **类型一致性：** Task 1 导出 `computePositionSize`、`FOREX_PAIRS`、`LOT_SIZE`、`AssetClass`、`Direction`、`RiskMode`、`StopMode`、`ForexPairKey`、`PositionSizeInput`、`PositionSizeResult`、`RiskBand`；Task 2 按这些名字导入，`result.ok` 判别后再取字段，与 `PositionSizeResult` 的联合类型一致。
- **算法基准可追溯：** Task 1 的第一条测试直接断言参照计算器的实测输出，Task 4 Step 2 用同一组数字核对页面 —— 单测与人工验收共用一个基准，不会各说各话。
- **占位符扫描：** 无 TBD / TODO / 「类似 Task N」/ 无代码的步骤。
