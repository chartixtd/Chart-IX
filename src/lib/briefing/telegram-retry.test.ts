import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 早报链接补投的收敛条件。
 *
 * 这段逻辑跑在每 10 分钟一次的 tick 上，错一点就是两种糟糕结局之一：
 * 要么频道里每 10 分钟多一条重复链接，要么补投永远不触发、和没写一样。
 * 三个收敛条件（只补今天那篇 / 发成功过就不再发 / 次数封顶）各自都得有断言。
 */

interface DeliveryState {
  slug: string;
  deliveredAt: string | null;
  attempts: number;
}
interface Result {
  label: string;
  ok: boolean;
  error?: string;
}

const alertBriefing = vi.fn<(m: string) => Promise<void>>(async () => {});
const listTargetsFor = vi.fn<(kind: string) => Promise<{ botToken: string | null }[]>>(async () => [
  { botToken: null },
]);
const getTelegramPushSettings = vi.fn(async () => ({ enabled: true, botToken: "tok" }));
const deliverToTargets = vi.fn<() => Promise<Result[]>>(async () => [{ label: "News", ok: true }]);

vi.mock("@/lib/supabase/middleware", () => ({
  createServiceRoleClient: () => db.client(),
}));
vi.mock("@/lib/briefing/alert", () => ({
  alertBriefing: (m: string) => alertBriefing(m),
}));
// 只桩掉这个模块对外的四个入口。escapeHtml 是纯函数，原样给一个等价实现，
// 免得为了一个字符串替换把 crypto 与 screener-server 整条栈拖进单元测试。
vi.mock("@/lib/telegram-push", () => ({
  escapeHtml: (s: string) => s,
  getTelegramPushSettings: () => getTelegramPushSettings(),
  listTargetsFor: (kind: string) => listTargetsFor(kind),
  deliverToTargets: () => deliverToTargets(),
}));

const { retryUndeliveredBriefingLink } = await import("./telegram");

/** UTC 01:00 = UTC+8 09:00，当天是 2026-08-14 */
const NOW = new Date("2026-08-14T01:00:00Z");
const TODAY = "daily-briefing-2026-08-14";
const YESTERDAY = "daily-briefing-2026-08-13";

const db = {
  state: null as DeliveryState | null,
  /** 库里存在的已发布早报，按 slug 索引 */
  articles: {} as Record<string, { slug: string; title: Record<string, string> }>,
  writes: [] as DeliveryState[],

  reset() {
    db.state = null;
    db.articles = {};
    db.writes = [];
  },

  client() {
    return {
      from(table: string) {
        if (table === "admin_settings") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.state ? { value: db.state } : null }) }) }),
            upsert: async (row: { value: DeliveryState }) => {
              db.state = row.value;
              db.writes.push(row.value);
              return { error: null };
            },
          };
        }
        if (table === "articles") {
          // 查询是 .eq("slug", x).eq("is_published", true).maybeSingle()，
          // 替身必须真的按 slug 过滤——否则「只补今天那篇」这条断言是假的
          let wanted = "";
          const chain = {
            eq: (col: string, value: unknown) => {
              if (col === "slug") wanted = String(value);
              return chain;
            },
            maybeSingle: async () => ({ data: db.articles[wanted] ?? null }),
          };
          return { select: () => chain };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as never;
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db.reset();
  alertBriefing.mockClear();
  deliverToTargets.mockReset().mockResolvedValue([{ label: "News", ok: true }]);
  listTargetsFor.mockReset().mockResolvedValue([{ botToken: null }]);
  getTelegramPushSettings.mockReset().mockResolvedValue({ enabled: true, botToken: "tok" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("retryUndeliveredBriefingLink", () => {
  it("今天有稿、还没发过时补投，并记下已投递", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报", "en-US": "Briefing" } };

    const r = await retryUndeliveredBriefingLink();

    expect(r.delivered).toBe(true);
    expect(r.slug).toBe(TODAY);
    expect(deliverToTargets).toHaveBeenCalledTimes(1);
    expect(db.state?.deliveredAt).not.toBeNull();
  });

  // 不重复：这是整个机制里最贵的错误——频道每 10 分钟多一条同样的链接
  it("已经发成功过就不再发", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    db.state = { slug: TODAY, deliveredAt: NOW.toISOString(), attempts: 1 };

    const r = await retryUndeliveredBriefingLink();

    expect(r.skipped).toBe("already_delivered");
    expect(deliverToTargets).not.toHaveBeenCalled();
  });

  // 只补今天那篇：否则首次部署时会把昨天的链接当新消息推出去
  it("今天还没出稿时什么都不做，绝不拿昨天那篇顶上", async () => {
    db.articles[YESTERDAY] = { slug: YESTERDAY, title: { "zh-CN": "昨天的早报" } };

    const r = await retryUndeliveredBriefingLink();

    expect(r.skipped).toBe("no_article_today");
    expect(deliverToTargets).not.toHaveBeenCalled();
  });

  it("投递失败时不记已投递，好让下一个 tick 继续补", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    deliverToTargets.mockResolvedValue([{ label: "News", ok: false, error: "TOPIC_CLOSED" }]);

    const r = await retryUndeliveredBriefingLink();

    expect(r.delivered).toBe(false);
    expect(db.state?.deliveredAt).toBeNull();
    expect(db.state?.attempts).toBe(1);
  });

  // 封顶：话题被关闭这类改不好就一直错的问题，不该每 10 分钟重试到天荒地老
  it("失败次数达到上限后彻底停手，并告警一次", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    db.state = { slug: TODAY, deliveredAt: null, attempts: 5 };
    deliverToTargets.mockResolvedValue([{ label: "News", ok: false, error: "TOPIC_CLOSED" }]);

    const sixth = await retryUndeliveredBriefingLink();
    expect(sixth.delivered).toBe(false);
    expect(alertBriefing).toHaveBeenCalledTimes(1);
    expect(String(alertBriefing.mock.calls[0][0])).toContain("TOPIC_CLOSED");

    // 第 7 次连投递都不发起了——静默放弃前，上面那条告警是最后的交代
    deliverToTargets.mockClear();
    const seventh = await retryUndeliveredBriefingLink();
    expect(seventh.skipped).toBe("attempts_exhausted");
    expect(deliverToTargets).not.toHaveBeenCalled();
    expect(alertBriefing).toHaveBeenCalledTimes(1);
  });

  // 没勾选目标是管理员的选择，不是故障：既不该告警，也不该把补投次数耗光
  it("没有配置早报目标时不消耗补投次数", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    listTargetsFor.mockResolvedValue([]);

    const r = await retryUndeliveredBriefingLink();

    expect(r.skipped).toBe("not_configured");
    expect(alertBriefing).not.toHaveBeenCalled();
    expect(db.state).toBeNull();
  });

  it("跨天之后重新开始计数，昨天用光的次数不影响今天", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    db.state = { slug: YESTERDAY, deliveredAt: null, attempts: 6 };

    const r = await retryUndeliveredBriefingLink();

    expect(r.delivered).toBe(true);
    expect(db.state?.slug).toBe(TODAY);
    expect(db.state?.attempts).toBe(1);
  });
});
