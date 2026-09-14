import { describe, it, expect } from "vitest";
import { RATE_LIMIT_PER_MIN } from "@/lib/coinglass/limits";
import {
  DEEP_SCAN_LIMIT,
  QUIET_RANK_TAKE,
  CLASS_TABLE_TAKE,
  TABLE_TAKE_TOTAL,
  CARD_RESERVE_SLOTS,
} from "./types";

/** 批量层的固定调用数：liquidation/coin-list + funding-rate/exchange-list */
const BATCH_LAYER_CALLS = 2;
/** 每个标的在明细层的调用数：OI 聚合历史 + 聚合主动买卖 */
const DETAIL_CALLS_PER_COIN = 2;

describe("配额不等式", () => {
  it("批量层 + 每标的调用数 × DEEP_SCAN_LIMIT 必须不超过限流器的真实配额", () => {
    // 这条不等式最初是 T19 要修的 bug 本身：第一版按 CoinGlass 文档的 80
    // 算出 DEEP_SCAN_LIMIT=15（当时 DETAIL_CALLS_PER_COIN=5，2+15×5=77），
    // 却忘了限流器自己留了 5 次余量、真正生效的窗口是 RATE_LIMIT_PER_MIN=75
    // ——77 > 75，最后两次调用会撞上限流器等待，一轮跑到 60.7 秒，撞破
    // Vercel Hobby 的 60 秒上限。
    //
    // 系数随架构变过三次：T21 退役 Sweep，每币 5→4；T24 用成交量缓存取代
    // 行情层的 pairs-markets，每币 4→3；这一版删掉 price/history（同一份
    // BingX K 线全池那趟本来就拉了），每币 3→2。断言写死这条不等式而不是
    // 具体数字，是为了在任何一边改动时立刻炸出矛盾，不指望有人记得回来重算。
    expect(BATCH_LAYER_CALLS + DETAIL_CALLS_PER_COIN * DEEP_SCAN_LIMIT).toBeLessThanOrEqual(
      RATE_LIMIT_PER_MIN
    );
  });

  it("当前配额（75/分钟）下 DEEP_SCAN_LIMIT 推导为 36", () => {
    // (75 - 2) / 2 = 36.5 → 36
    expect(DEEP_SCAN_LIMIT).toBe(36);
  });

  it("三栏名额之和 + 卡片复核名额，正好用满配额允许的上限", () => {
    // 三个数各自会因为完全不同的理由被改动：CLASS_TABLE_TAKE 因为「某一栏
    // 想多看/少看几行」，CARD_RESERVE_SLOTS 因为「活卡被挤掉了」，
    // DEEP_SCAN_LIMIT 因为「配额变了」或「每个标的的调用次数变了」。
    // 它们之间唯一的约束就是这一条，而它不写下来就没人会记得——把某一栏
    // 调到 20 不会报错，只会让最后几个标的的调用撞上限流器等待，
    // 一轮跑过 60 秒被 Vercel 掐断，症状是「扫描偶尔失败」，
    // 离真正的原因隔着好几层。
    expect(TABLE_TAKE_TOTAL + CARD_RESERVE_SLOTS).toBe(DEEP_SCAN_LIMIT);
  });

  it("加密那一栏的名额没有因为新增两栏而缩水", () => {
    // 分栏是**加**了两栏，不是把原来的 20 行切三份。这条断言把它钉死。
    expect(CLASS_TABLE_TAKE.crypto).toBe(QUIET_RANK_TAKE);
    expect(QUIET_RANK_TAKE).toBe(20);
  });

  it("卡片复核名额不能被三栏吃光", () => {
    // 归零的话，任何掉出名额的活卡都不再被复核，它的分数会停在出卡那一刻，
    // 而这个退化是完全静默的。
    expect(CARD_RESERVE_SLOTS).toBeGreaterThan(0);
  });
});
