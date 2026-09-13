import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 早报链接补投的收敛条件。
 *
 * 这段逻辑跑在每 10 分钟一次的 tick 上，错一点就是两种糟糕结局之一：
 * 要么频道里每 10 分钟多一条重复链接，要么补投永远不触发、和没写一样。
 *
 * 线上出现过的是前者（一天十几条同样的链接），根因是判据「读得到旧值」这件事
 * 本身不可靠：查询失败时旧的实现把 null 当成「没发过」，于是又发一条。所以这里
 * 除了三条收敛条件，还必须钉住 **查询失败时不发**——闸门要 fail closed。
 */

interface Row {
  key: string;
  value: Record<string, unknown>;
  description?: string;
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
const KEY_TODAY = `daily_briefing_telegram_delivery:${TODAY}`;
const LEGACY_KEY = "daily_briefing_telegram_delivery";

/** PostgREST 里 JSON 字段过滤长这样：value->>attempts=eq.2 */
function fieldOf(column: string): string | null {
  const m = /^value->>(\w+)$/.exec(column);
  return m ? m[1] : null;
}

/**
 * admin_settings 的替身。
 *
 * 必须真的按 key 唯一：整套「一天只发一条」现在就架在这条约束上，替身要是
 * 允许重复 insert，最关键的那几条断言全是假的。
 */
const db = {
  rows: [] as Row[],
  publishState: null as { slug: string; degraded: boolean; attempts: number } | null,
  articles: {} as Record<string, { slug: string; title: Record<string, string> }>,
  /** >0 时接下来这么多次 select 直接报错，用来模拟线上那种偶发读失败 */
  failSelects: 0,

  reset() {
    db.rows = [];
    db.publishState = null;
    db.articles = {};
    db.failSelects = 0;
  },

  row(key: string): Row | undefined {
    return db.rows.find((r) => r.key === key);
  },

  client() {
    const settings = () => {
      // eq/neq/is 三种过滤器，够覆盖这个模块发出的所有查询
      const filters: ((r: Row) => boolean)[] = [];
      let orMatch: ((r: Row) => boolean) | null = null;

      const match = (r: Row) =>
        filters.every((f) => f(r)) && (orMatch === null || orMatch(r));

      const chain = {
        eq(column: string, value: unknown) {
          const field = fieldOf(column);
          filters.push((r) =>
            field === null
              ? (r as unknown as Record<string, unknown>)[column] === value
              : String(r.value[field] ?? "") === String(value)
          );
          return chain;
        },
        neq(column: string, value: unknown) {
          filters.push((r) => (r as unknown as Record<string, unknown>)[column] !== value);
          return chain;
        },
        is(column: string, value: unknown) {
          const field = fieldOf(column);
          filters.push((r) =>
            value === null && field !== null
              ? r.value[field] === null || r.value[field] === undefined
              : r.value[field as string] === value
          );
          return chain;
        },
        or(expr: string) {
          // 只支持模块真正用的那条：前缀 like + 旧单行 key
          const [likeClause, eqClause] = expr.split(",");
          const prefix = likeClause.replace("key.like.", "").replace("*", "");
          const legacy = eqClause.replace("key.eq.", "");
          orMatch = (r) => r.key.startsWith(prefix) || r.key === legacy;
          return chain;
        },
      };
      return { chain, match };
    };

    return {
      from(table: string) {
        if (table === "admin_settings") {
          return {
            select(_cols: string) {
              const { chain, match } = settings();
              return Object.assign(chain, {
                maybeSingle: async () => {
                  if (db.failSelects > 0) {
                    db.failSelects -= 1;
                    return { data: null, error: { code: "57014", message: "read failed" } };
                  }
                  const found = db.rows.filter(match);
                  return { data: found[0] ?? null, error: null };
                },
              });
            },
            insert: async (row: Row) => {
              if (db.row(row.key)) {
                return { error: { code: "23505", message: "duplicate key" } };
              }
              db.rows.push({ ...row, value: { ...row.value } });
              return { error: null };
            },
            upsert: async (row: Row) => {
              const existing = db.row(row.key);
              if (existing) existing.value = { ...row.value };
              else db.rows.push({ ...row, value: { ...row.value } });
              return { error: null };
            },
            update(patch: { value: Record<string, unknown> }) {
              const { chain, match } = settings();
              const apply = () => {
                const hit = db.rows.filter(match);
                hit.forEach((r) => (r.value = { ...patch.value }));
                return hit;
              };
              return Object.assign(chain, {
                select: (_cols: string) => ({
                  then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
                    Promise.resolve({ data: apply(), error: null }).then(resolve),
                }),
                then: (resolve: (v: { error: null }) => unknown) => {
                  apply();
                  return Promise.resolve({ error: null }).then(resolve);
                },
              });
            },
            delete() {
              const { chain, match } = settings();
              return Object.assign(chain, {
                then: (resolve: (v: { error: null }) => unknown) => {
                  db.rows = db.rows.filter((r) => !match(r));
                  return Promise.resolve({ error: null }).then(resolve);
                },
              });
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

/** 当天那一行的当前内容 */
function record(): Record<string, unknown> | undefined {
  return db.row(KEY_TODAY)?.value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db.reset();
  // publish-state 也读 admin_settings，默认「没有记录」= 已定稿
  alertBriefing.mockClear();
  deliverToTargets.mockReset().mockResolvedValue([{ label: "News", ok: true }]);
  listTargetsFor.mockReset().mockResolvedValue([{ botToken: null }]);
  getTelegramPushSettings.mockReset().mockResolvedValue({ enabled: true, botToken: "tok" });
});

afterEach(() => {
  vi.useRealTimers();
});

/** publish-state 与投递记录共用 admin_settings，这里直接摆好那一行 */
function setPublishState(state: { slug: string; degraded: boolean; attempts: number }) {
  db.rows.push({ key: "daily_briefing_publish_state", value: state as never });
}

describe("retryUndeliveredBriefingLink", () => {
  it("今天有稿、还没发过时补投，并记下已投递", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报", "en-US": "Briefing" } };

    const r = await retryUndeliveredBriefingLink();

    expect(r.delivered).toBe(true);
    expect(r.slug).toBe(TODAY);
    expect(deliverToTargets).toHaveBeenCalledTimes(1);
    expect(record()?.deliveredAt).not.toBeNull();
  });

  // 不重复：这是整个机制里最贵的错误——频道每 10 分钟多一条同样的链接
  it("已经发成功过就不再发", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    db.rows.push({
      key: KEY_TODAY,
      value: { slug: TODAY, deliveredAt: NOW.toISOString(), attempts: 1, claimedAt: NOW.toISOString() },
    });

    const r = await retryUndeliveredBriefingLink();

    expect(r.skipped).toBe("already_delivered");
    expect(deliverToTargets).not.toHaveBeenCalled();
  });

  // 线上一天推十几条的根因：判据那次查询失败，旧实现把它当成「没发过」。
  // 现在预检读不到只是少了一次早退，认领仍然会撞上已存在的那一行。
  it("预检查询失败时，认领仍然挡住重复推送", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    db.rows.push({
      key: KEY_TODAY,
      value: { slug: TODAY, deliveredAt: NOW.toISOString(), attempts: 1, claimedAt: NOW.toISOString() },
    });
    db.failSelects = 1;

    const r = await retryUndeliveredBriefingLink();

    expect(r.skipped).toBe("already_delivered");
    expect(deliverToTargets).not.toHaveBeenCalled();
  });

  // 连认领后的复查都读不出来时，只剩一个安全选择：不发。少发一轮下一跳还能补，
  // 多发一条永远收不回来。
  it("查询一直失败时宁可不发", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    db.rows.push({
      key: KEY_TODAY,
      value: { slug: TODAY, deliveredAt: NOW.toISOString(), attempts: 1, claimedAt: NOW.toISOString() },
    });
    db.failSelects = 99;

    const r = await retryUndeliveredBriefingLink();

    expect(r.skipped).toBe("claim_failed");
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
    expect(record()?.deliveredAt).toBeNull();
    expect(record()?.attempts).toBe(1);
  });

  // 认领带租期：上一跳发到一半被平台掐断时，两分钟内不许别人接手，
  // 否则「掐断」会变成「重复」。
  it("另一个 tick 刚认领走时不重复发", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    deliverToTargets.mockResolvedValue([{ label: "News", ok: false, error: "timeout" }]);

    await retryUndeliveredBriefingLink();
    deliverToTargets.mockClear();

    vi.setSystemTime(new Date(NOW.getTime() + 30_000));
    const second = await retryUndeliveredBriefingLink();

    expect(second.skipped).toBe("in_flight");
    expect(deliverToTargets).not.toHaveBeenCalled();
  });

  it("租期过后可以接手，次数接着上一次往下数", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    deliverToTargets.mockResolvedValue([{ label: "News", ok: false, error: "timeout" }]);

    await retryUndeliveredBriefingLink();

    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
    deliverToTargets.mockResolvedValue([{ label: "News", ok: true }]);
    const second = await retryUndeliveredBriefingLink();

    expect(second.delivered).toBe(true);
    expect(record()?.attempts).toBe(2);
  });

  // 封顶：话题被关闭这类改不好就一直错的问题，不该每 10 分钟重试到天荒地老
  it("失败次数达到上限后彻底停手，并告警一次", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    db.rows.push({
      key: KEY_TODAY,
      // 租期早过，允许接手；这一跳正好是第 6 次
      value: { slug: TODAY, deliveredAt: null, attempts: 5, claimedAt: new Date(0).toISOString() },
    });
    deliverToTargets.mockResolvedValue([{ label: "News", ok: false, error: "TOPIC_CLOSED" }]);

    const sixth = await retryUndeliveredBriefingLink();
    expect(sixth.delivered).toBe(false);
    expect(alertBriefing).toHaveBeenCalledTimes(1);
    expect(String(alertBriefing.mock.calls[0][0])).toContain("TOPIC_CLOSED");

    // 第 7 次连投递都不发起了——静默放弃前，上面那条告警是最后的交代
    deliverToTargets.mockClear();
    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
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
    expect(record()).toBeUndefined();
  });

  // 与升级重试的交接点：兜底稿还能变好时先别推，读者点开的会是待会儿就被
  // 替换掉的那篇；而链接只能发一次，发早了没有第二次机会。
  it("兜底稿还在升级重试中时不推送", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    setPublishState({ slug: TODAY, degraded: true, attempts: 1 });

    const r = await retryUndeliveredBriefingLink();

    expect(r.skipped).toBe("not_final");
    expect(deliverToTargets).not.toHaveBeenCalled();
  });

  // 反面同样重要：升级次数用完就是定稿了，这条链接必须发出去。
  // 「兜底稿不推」不能演变成「兜底的那天干脆没有链接」。
  it("升级次数用完后，兜底稿的链接照样推出去", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    setPublishState({ slug: TODAY, degraded: true, attempts: 3 });

    const r = await retryUndeliveredBriefingLink();

    expect(r.delivered).toBe(true);
  });

  it("升级成功之后立刻可推", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    setPublishState({ slug: TODAY, degraded: false, attempts: 1 });

    const r = await retryUndeliveredBriefingLink();

    expect(r.delivered).toBe(true);
  });

  it("跨天之后重新开始计数，昨天用光的次数不影响今天", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    db.rows.push({
      key: `daily_briefing_telegram_delivery:${YESTERDAY}`,
      value: { slug: YESTERDAY, deliveredAt: null, attempts: 6, claimedAt: NOW.toISOString() },
    });

    const r = await retryUndeliveredBriefingLink();

    expect(r.delivered).toBe(true);
    expect(record()?.attempts).toBe(1);
    // 昨天那一行顺手清掉，admin_settings 不会一天长一行
    expect(db.row(`daily_briefing_telegram_delivery:${YESTERDAY}`)).toBeUndefined();
  });

  // 改动上线那一刻，当天的状态还在旧的单行 key 里。不认它就会再推一遍——
  // 正好是这次要修的毛病，不能在升级当天自己犯一次。
  it("认旧的单行记录：改动上线当天不会再推一条", async () => {
    db.articles[TODAY] = { slug: TODAY, title: { "zh-CN": "早报" } };
    db.rows.push({
      key: LEGACY_KEY,
      value: { slug: TODAY, deliveredAt: NOW.toISOString(), attempts: 2 },
    });

    const r = await retryUndeliveredBriefingLink();

    expect(r.skipped).toBe("already_delivered");
    expect(deliverToTargets).not.toHaveBeenCalled();
    // 结论搬进了新的一行，明天起就不用再看旧 key 了
    expect(record()?.deliveredAt).toBe(NOW.toISOString());
  });
});
