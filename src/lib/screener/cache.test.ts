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
