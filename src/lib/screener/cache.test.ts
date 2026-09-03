import { describe, it, expect, vi, beforeEach } from "vitest";
import { SCANNER_PAYLOAD_VERSION, SCAN_INTERVAL_MS } from "./types";
import type { ScannerPayload } from "./types";

// pipeline 是纯网络编排，这组测试只关心「缓存读出来的东西要不要用」，
// 所以把它整个挡掉，避免测试去碰真实上游。
vi.mock("./pipeline", () => ({ runScan: vi.fn() }));

const row = { payload: null as unknown, computed_at: new Date().toISOString() };

vi.mock("@/lib/supabase/middleware", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
    }),
  }),
}));

const { readScannerCache } = await import("./cache");

const payload = (over: Partial<ScannerPayload> = {}): unknown => ({
  version: SCANNER_PAYLOAD_VERSION,
  rows: [],
  cards: [],
  newCards: [],
  computedAt: Date.now(),
  ...over,
});

describe("readScannerCache 的形状版本守卫", () => {
  beforeEach(() => {
    row.computed_at = new Date().toISOString();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("版本一致且未过期时正常返回", async () => {
    row.payload = payload();
    expect(await readScannerCache()).not.toBeNull();
  });

  it("版本号偏旧的缓存一律丢弃——这是修过的一次生产崩溃", async () => {
    // 真实事故：给 ScannerRow 加了 ignition 字段后部署，缓存里还是上一版
    // 算出来的行，前端读 r.ignition.direction 拿到 undefined，整页白屏。
    // 宁可多算一轮，也不能把上一版形状的数据喂给当前版本的前端。
    row.payload = payload({ version: SCANNER_PAYLOAD_VERSION - 1 });
    expect(await readScannerCache()).toBeNull();
  });

  it("完全没有 version 字段的缓存也丢弃——旧版本写进去的就是这种", async () => {
    const p = payload() as Record<string, unknown>;
    delete p.version;
    row.payload = p;
    expect(await readScannerCache()).toBeNull();
  });

  it("版本更新（回滚到旧代码）同样丢弃，不做单向比较", async () => {
    // 只判 < 会让回滚后的实例去用新版形状的缓存，那里可能有它不认识的
    // 字段、也可能缺它需要的字段。严格相等才是对的。
    row.payload = payload({ version: SCANNER_PAYLOAD_VERSION + 1 });
    expect(await readScannerCache()).toBeNull();
  });

  it("过期的缓存仍然按过期处理，版本对也不用", async () => {
    row.payload = payload();
    row.computed_at = new Date(Date.now() - SCAN_INTERVAL_MS - 1000).toISOString();
    expect(await readScannerCache()).toBeNull();
  });
});

/**
 * 读路径**绝不触发扫描**。
 *
 * 这一条是线上事故补的。此前 getScannerPayload 在缓存过期时会自己跑一轮
 * runScan 并写回，于是 runScan 有了**两个生产者**：cron（扫完会推送）和
 * 任何一次网页请求（扫完不推送）。后果是 Telegram 和网页各说各话——
 *
 *   · 缓存一过期，谁先打开网页谁就触发一轮扫描，那一轮的卡片一条都不会推；
 *     而 cron 下一跳看到缓存是新的就跳过，那批卡永远没人推
 *   · 反过来，cron 刚推过的那批卡会被网页触发的扫描顶掉
 *
 * 线上抓到过一份 computedAt 15:35、newCards 有 10 张的 payload，而推送台账
 * 最后一条停在 15:15——那一轮正是被一次 API 请求触发的。
 */
describe("读路径不产出扫描", () => {
  /**
   * 每条用例都重新加载模块。
   *
   * getScannerPayload 外面裹着一层 30 秒的进程内 TTL 缓存，不重置的话第一条
   * 用例算出来的结果会被后面几条原样拿到——三条断言全绿，而「过期」和
   * 「冷库」两条路径**一次都没跑到**。这种测试比没有测试更糟：它会让人以为
   * 那两条路是验过的。
   */
  async function freshModule() {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pipeline = await import("./pipeline");
    vi.mocked(pipeline.runScan).mockClear();
    const cache = await import("./cache");
    return { getScannerPayload: cache.getScannerPayload, runScan: pipeline.runScan };
  }

  it("缓存新鲜时给缓存，不扫描", async () => {
    row.payload = payload({ computedAt: Date.now() });
    row.computed_at = new Date().toISOString();
    const m = await freshModule();
    const p = await m.getScannerPayload();
    expect(p.version).toBe(SCANNER_PAYLOAD_VERSION);
    expect(m.runScan).not.toHaveBeenCalled();
  });

  it("**缓存过期也不扫描**——过期的榜单也比一次不会推送的扫描有用", async () => {
    const old = Date.now() - SCAN_INTERVAL_MS * 10;
    row.payload = payload({ computedAt: old });
    row.computed_at = new Date(old).toISOString();
    const m = await freshModule();
    const p = await m.getScannerPayload();
    expect(p.computedAt).toBe(old); // 真的是那份过期的，不是重算的
    expect(m.runScan).not.toHaveBeenCalled();
  });

  it("一份缓存都没有时给空 payload，仍然不扫描", async () => {
    row.payload = null;
    const m = await freshModule();
    const p = await m.getScannerPayload();
    expect(p.cards).toEqual([]);
    expect(p.rows).toEqual([]);
    expect(p.computedAt).toBe(0);
    expect(m.runScan).not.toHaveBeenCalled();
  });
});
