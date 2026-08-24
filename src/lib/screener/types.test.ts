import { describe, it, expect } from "vitest";
import { RATE_LIMIT_PER_MIN } from "@/lib/coinglass/limits";
import { DEEP_SCAN_LIMIT, QUIET_RANK_TAKE } from "./types";

describe("配额不等式", () => {
  it("1（批量层）+ 3 × DEEP_SCAN_LIMIT（明细层）必须不超过限流器的真实配额", () => {
    // 这条不等式最初是 T19 要修的 bug 本身：第一版按 CoinGlass 文档的 80
    // 算出 DEEP_SCAN_LIMIT=15（当时 DETAIL_CALLS_PER_COIN=5，2+15×5=77），
    // 却忘了限流器自己留了 5 次余量、真正生效的窗口是 RATE_LIMIT_PER_MIN=75
    // ——77 > 75，最后两次调用会撞上限流器等待，一轮跑到 60.7 秒，撞破
    // Vercel Hobby 的 60 秒上限。
    //
    // 系数随架构变过两次：T21 退役 Sweep，每币 5→4；T24 用成交量缓存取代
    // 行情层的 pairs-markets，每币 4→3，同时预排序退役、不再拉
    // liquidation/coin-list，批量层 2→1。断言写死这条不等式而不是具体数字，
    // 是为了在任何一边改动时立刻炸出矛盾，不指望有人记得回来重算。
    expect(1 + 3 * DEEP_SCAN_LIMIT).toBeLessThanOrEqual(RATE_LIMIT_PER_MIN);
  });

  it("当前配额（75/分钟）下 DEEP_SCAN_LIMIT 推导为 24", () => {
    // (75 - 1) / 3 = 24.67 → 24
    expect(DEEP_SCAN_LIMIT).toBe(24);
  });

  it("实际取的行数不能超过配额允许的上限", () => {
    // QUIET_RANK_TAKE 是产品选择（想看几行），DEEP_SCAN_LIMIT 是配额上限，
    // 两个数各自会因为完全不同的理由被改动：前者因为「想多看/少看几行」，
    // 后者因为「配额变了」或「每个币的调用次数变了」。它们之间唯一的
    // 约束就是这一条，而它不写下来就没人会记得——把 take 调到 30 不会报错，
    // 只会让最后几个币的调用撞上限流器等待，一轮跑过 60 秒被 Vercel 掐断，
    // 症状是「扫描偶尔失败」，离真正的原因隔着好几层。
    expect(QUIET_RANK_TAKE).toBeLessThanOrEqual(DEEP_SCAN_LIMIT);
  });
});
