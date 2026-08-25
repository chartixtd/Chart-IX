import { describe, it, expect } from "vitest";
import { isPushDue } from "./telegram-push";

const MIN = 60_000;
const NOW = new Date("2026-08-06T12:00:00Z").getTime();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("isPushDue", () => {
  it("is due when nothing has ever been pushed", () => {
    expect(isPushDue(null, 240, NOW)).toBe(true);
  });

  it("is not due before the interval has elapsed", () => {
    expect(isPushDue(iso(239 * MIN), 240, NOW)).toBe(false);
  });

  it("is due exactly at the interval", () => {
    expect(isPushDue(iso(240 * MIN), 240, NOW)).toBe(true);
  });

  it("is due once overdue", () => {
    expect(isPushDue(iso(600 * MIN), 240, NOW)).toBe(true);
  });

  it("stays due after a missed run, so the next tick recovers it", () => {
    // This is the fallback that matters: the cron ticks far more often than the
    // interval, so a tick lost to a timeout or cold start doesn't cost a whole
    // interval — the following tick still sees an overdue push and sends it.
    const lastPushed = iso(250 * MIN);
    expect(isPushDue(lastPushed, 240, NOW)).toBe(true);
    expect(isPushDue(lastPushed, 240, NOW + 15 * MIN)).toBe(true);
  });

  it("treats a future timestamp as due rather than wedging shut", () => {
    // Clock skew between the app server and Postgres shouldn't be able to
    // block pushes indefinitely.
    expect(isPushDue(new Date(NOW + 60 * MIN).toISOString(), 240, NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as due", () => {
    expect(isPushDue("not-a-date", 240, NOW)).toBe(true);
  });

  it("honours a short interval", () => {
    expect(isPushDue(iso(14 * MIN), 15, NOW)).toBe(false);
    expect(isPushDue(iso(15 * MIN), 15, NOW)).toBe(true);
  });
});

/**
 * T25：这个函数的**调用方**变了，判据本身没变。
 *
 * 它原先回答「离上次发榜单够不够 N 分钟」——一个定时器。榜单推送删掉之后，
 * scanner 改成「扫到新警报卡就推」，它降级成一道节流闸：不够久就把新卡片攒
 * 起来（见 screener/alert-push.ts），下一轮一起发。
 *
 * 于是 0 这个入参第一次有了意义——「不节流」是新的默认值，而在定时器语义下
 * 它等于「每个 tick 都发」，从来没被允许过（下限曾经硬编码成 15）。
 */
describe("isPushDue — 0 间隔（警报默认不节流）", () => {
  it("间隔为 0 时永远放行，哪怕上一条是同一毫秒发的", () => {
    expect(isPushDue(iso(0), 0, NOW)).toBe(true);
  });

  it("间隔为 0 时也不受「从未推送过」以外的状态影响", () => {
    expect(isPushDue(iso(1), 0, NOW)).toBe(true);
    expect(isPushDue(null, 0, NOW)).toBe(true);
  });
});
