import { describe, it, expect, vi, beforeEach } from "vitest";
import webpush from "web-push";
import { sendToSubscriptions, type SubscriptionRow } from "./send";

/**
 * sendToSubscriptions 是一台状态机：每一行按发送结果落到「成功」「删掉」
 * 「失败计数 +1」「计数归零」四个格子之一，而这四个格子决定了一台设备
 * 还能不能收到推送。此前它零测试——`removed` 计数错一位、恢复的行没归零，
 * 都是要等到用户报「我怎么收不到了」才会被发现的那种 bug。
 *
 * 真实实现会打 Supabase 和推送服务，两个都 mock 掉。
 */
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

/** 这一轮里 DB 上真的发生了什么。断言直接看它。 */
const db = {
  updates: [] as { ids: string[]; patch: Record<string, unknown> }[],
  deleted: [] as string[],
};

/** 设成某个 id 时，针对那一行的 update 会 reject——用来测 catch 里的 DB 写 */
let updateRejectsForId: string | null = null;

vi.mock("@/lib/supabase/middleware", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          if (updateRejectsForId === id) throw new Error("db down");
          db.updates.push({ ids: [id], patch });
          return { error: null };
        },
        in: async (_col: string, ids: string[]) => {
          db.updates.push({ ids: [...ids].sort(), patch });
          return { error: null };
        },
      }),
      delete: () => ({
        in: async (_col: string, ids: string[]) => {
          db.deleted.push(...ids);
          return { error: null };
        },
      }),
    }),
  }),
}));

function row(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "row-1",
    endpoint: "https://push.example/ep1",
    p256dh: "p",
    auth: "a",
    locale: "en-US",
    failed_count: 0,
    ...overrides,
  };
}

/** 带 statusCode 的错误，就是 web-push 抛出来的那个形状 */
function httpError(statusCode: number) {
  return Object.assign(new Error(`status ${statusCode}`), { statusCode });
}

const sendNotification = vi.mocked(webpush.sendNotification);

const payload = { title: "t", body: "b", url: "/en-US/screener", tag: "screener" };

beforeEach(() => {
  db.updates = [];
  db.deleted = [];
  updateRejectsForId = null;
  vi.clearAllMocks();
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:x@example.com";
});

describe("sendToSubscriptions", () => {
  it("空数组直接返回，不碰推送服务也不碰 DB", async () => {
    const result = await sendToSubscriptions([], payload);
    expect(result).toEqual({ sent: 0, removed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("410 的行进 doomed 被删掉，removed 计数跟着走", async () => {
    sendNotification.mockRejectedValue(httpError(410));
    const result = await sendToSubscriptions([row({ id: "gone" })], payload);

    expect(result).toEqual({ sent: 0, removed: 1 });
    expect(db.deleted).toEqual(["gone"]);
    // 410 是终局，不该再去写它的 failed_count
    expect(db.updates).toEqual([]);
  });

  it("404 跟 410 一样是终局", async () => {
    sendNotification.mockRejectedValue(httpError(404));
    const result = await sendToSubscriptions([row({ id: "gone" })], payload);
    expect(result.removed).toBe(1);
    expect(db.deleted).toEqual(["gone"]);
  });

  it("failed_count=2 再吃一个 5xx 就到 MAX_FAILURES，进 doomed", async () => {
    sendNotification.mockRejectedValue(httpError(500));
    const result = await sendToSubscriptions([row({ id: "third", failed_count: 2 })], payload);

    expect(result).toEqual({ sent: 0, removed: 1 });
    expect(db.deleted).toEqual(["third"]);
    // 已经要删了，就不必再更新计数
    expect(db.updates).toEqual([]);
  });

  it("failed_count=0 吃一个 5xx 只把计数加到 1，行留着", async () => {
    sendNotification.mockRejectedValue(httpError(503));
    const result = await sendToSubscriptions([row({ id: "first", failed_count: 0 })], payload);

    expect(result).toEqual({ sent: 0, removed: 0 });
    expect(db.deleted).toEqual([]);
    expect(db.updates).toEqual([{ ids: ["first"], patch: { failed_count: 1 } }]);
  });

  it("没有 statusCode 的错误（网络层）走 5xx 那一支，不当作端点失效", async () => {
    sendNotification.mockRejectedValue(new Error("ECONNRESET"));
    const result = await sendToSubscriptions([row({ id: "net" })], payload);

    expect(result.removed).toBe(0);
    expect(db.updates).toEqual([{ ids: ["net"], patch: { failed_count: 1 } }]);
  });

  it("发送成功且此前失败过，failed_count 归零", async () => {
    sendNotification.mockResolvedValue(undefined as never);
    const result = await sendToSubscriptions([row({ id: "back", failed_count: 2 })], payload);

    expect(result).toEqual({ sent: 1, removed: 0 });
    expect(db.updates).toEqual([{ ids: ["back"], patch: { failed_count: 0 } }]);
  });

  it("发送成功且从没失败过，不写 DB——没什么可归零的", async () => {
    sendNotification.mockResolvedValue(undefined as never);
    const result = await sendToSubscriptions([row({ id: "clean", failed_count: 0 })], payload);

    expect(result).toEqual({ sent: 1, removed: 0 });
    expect(db.updates).toEqual([]);
  });

  it("混合一批：成功 / 410 / 计数+1 / 恢复归零 各走各的", async () => {
    sendNotification.mockImplementation(async (sub) => {
      const endpoint = (sub as { endpoint: string }).endpoint;
      if (endpoint.endsWith("gone")) throw httpError(410);
      if (endpoint.endsWith("flaky")) throw httpError(500);
      return undefined as never;
    });

    const result = await sendToSubscriptions(
      [
        row({ id: "ok", endpoint: "https://push.example/ok" }),
        row({ id: "gone", endpoint: "https://push.example/gone" }),
        row({ id: "flaky", endpoint: "https://push.example/flaky", failed_count: 1 }),
        row({ id: "back", endpoint: "https://push.example/back", failed_count: 2 }),
      ],
      payload
    );

    expect(result).toEqual({ sent: 2, removed: 1 });
    expect(db.deleted).toEqual(["gone"]);
    expect(db.updates).toContainEqual({ ids: ["flaky"], patch: { failed_count: 2 } });
    expect(db.updates).toContainEqual({ ids: ["back"], patch: { failed_count: 0 } });
  });

  /**
   * 这一条是 I7 的核心。catch 块里的 update 裸着写时，它一 reject 就从
   * map 的回调抛出去，Promise.all 立刻整体 reject——doomed 的删除、recovered
   * 的归零、sent 计数全部作废，而且原始 DB 错误会经 /api/push/test 回显到
   * 设置页上给用户看。
   */
  it("failed_count 的 update reject 时，其余行的结果不受影响，函数也不向外抛", async () => {
    updateRejectsForId = "flaky";
    sendNotification.mockImplementation(async (sub) => {
      const endpoint = (sub as { endpoint: string }).endpoint;
      if (endpoint.endsWith("gone")) throw httpError(410);
      if (endpoint.endsWith("flaky")) throw httpError(500);
      return undefined as never;
    });

    const result = await sendToSubscriptions(
      [
        row({ id: "ok", endpoint: "https://push.example/ok" }),
        row({ id: "gone", endpoint: "https://push.example/gone" }),
        row({ id: "flaky", endpoint: "https://push.example/flaky", failed_count: 0 }),
        row({ id: "back", endpoint: "https://push.example/back", failed_count: 2 }),
      ],
      payload
    );

    // 发成功的两条照样计数，失效的那条照样被删，恢复的那条照样归零
    expect(result).toEqual({ sent: 2, removed: 1 });
    expect(db.deleted).toEqual(["gone"]);
    expect(db.updates).toContainEqual({ ids: ["back"], patch: { failed_count: 0 } });
    // 唯一的损失是 flaky 这一次的失败计数没记上
    expect(db.updates.some((u) => u.ids.includes("flaky"))).toBe(false);
  });

  it("发送时声明 high urgency 与 1 小时 TTL", async () => {
    sendNotification.mockResolvedValue(undefined as never);
    await sendToSubscriptions([row()], payload);

    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push.example/ep1", keys: { p256dh: "p", auth: "a" } },
      JSON.stringify(payload),
      { urgency: "high", TTL: 3600 }
    );
  });
});
