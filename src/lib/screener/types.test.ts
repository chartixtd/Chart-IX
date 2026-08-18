import { describe, it, expect } from "vitest";
import { RATE_LIMIT_PER_MIN } from "@/lib/coinglass/limits";
import { DEEP_SCAN_LIMIT } from "./types";

describe("DEEP_SCAN_LIMIT 与 RATE_LIMIT_PER_MIN 的配额不等式", () => {
  it("2（批量层）+ 4 × DEEP_SCAN_LIMIT（明细层）必须不超过限流器的真实配额", () => {
    // 这条不等式最初是 T19 要修的 bug 本身：第一版按 CoinGlass 文档的 80
    // 算出 DEEP_SCAN_LIMIT=15（当时 DETAIL_CALLS_PER_COIN=5，2+15×5=77），
    // 却忘了限流器自己留了 5 次余量、真正生效的窗口是 RATE_LIMIT_PER_MIN=75
    // ——77 > 75，最后两次调用会撞上限流器等待，一轮跑到 60.7 秒，撞破
    // Vercel Hobby 的 60 秒上限。T21 退役 Zone/Sweep 后每个币少打一次
    // liquidation/history，DETAIL_CALLS_PER_COIN 从 5 降到 4，这里的系数
    // 跟着变。断言写死这条不等式，而不是断言具体数字，是为了在两个常量
    // 任何一边改动时都能第一时间炸出矛盾，不需要靠人记得去重算。
    expect(2 + 4 * DEEP_SCAN_LIMIT).toBeLessThanOrEqual(RATE_LIMIT_PER_MIN);
  });

  it("当前配额（75/分钟）下 DEEP_SCAN_LIMIT 推导为 18", () => {
    // (75 - 2) / 4 = 18.25 → 18（原 (75-2)/5=14.6 → 14；T21 分母从 5 降到 4
    // 之后同一条配额能塞进更多币）。
    expect(DEEP_SCAN_LIMIT).toBe(18);
  });
});
