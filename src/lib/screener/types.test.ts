import { describe, it, expect } from "vitest";
import { RATE_LIMIT_PER_MIN } from "@/lib/coinglass/client";
import { DEEP_SCAN_LIMIT } from "./types";

describe("DEEP_SCAN_LIMIT 与 RATE_LIMIT_PER_MIN 的配额不等式", () => {
  it("2（批量层）+ 5 × DEEP_SCAN_LIMIT（明细层）必须不超过限流器的真实配额", () => {
    // 这条不等式就是这次要修的 bug 本身：T19 第一版按 CoinGlass 文档的 80
    // 算出 DEEP_SCAN_LIMIT=15（2+15×5=77），却忘了限流器自己留了 5 次余量、
    // 真正生效的窗口是 RATE_LIMIT_PER_MIN=75——77 > 75，最后两次调用会撞上
    // 限流器等待，一轮跑到 60.7 秒，撞破 Vercel Hobby 的 60 秒上限。
    // 断言写死这条不等式，而不是断言具体数字，是为了在两个常量任何一边
    // 改动时都能第一时间炸出矛盾，不需要靠人记得去重算。
    expect(2 + 5 * DEEP_SCAN_LIMIT).toBeLessThanOrEqual(RATE_LIMIT_PER_MIN);
  });

  it("当前配额（75/分钟）下 DEEP_SCAN_LIMIT 推导为 14", () => {
    expect(DEEP_SCAN_LIMIT).toBe(14);
  });
});
