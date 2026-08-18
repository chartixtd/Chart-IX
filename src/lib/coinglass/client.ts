import type { CoinGlassEnvelope } from "./types";

const BASE_URL = "https://open-api-v4.coinglass.com";
const TIMEOUT_MS = 20_000;

/**
 * 2026-08-18 用真实 key 跑 dryrun 才发现：设计阶段「120 并发全部 200、
 * 2.48 秒跑完，上游不是瓶颈」这个结论是错的。CoinGlass 的响应头写着
 * `API-KEY-MAX-LIMIT: 80`——真实约束是**每分钟 80 次请求**，不是并发数。
 * 那次压测只打了一轮 120 个请求，单次爆发没触发速率限制，所以看着像
 * 「并发随便开」，但流水线一轮要打几百次时，无论并发数多少，
 * 速率限制都会在几秒内命中并把之后的请求全部 429。
 *
 * 重构后一轮只有 72 次调用（`DEEP_SCAN_LIMIT` 由下面的 `RATE_LIMIT_PER_MIN`
 * 推导得出，见 screener/types.ts 与 screener/pipeline.ts 顶部注释），
 * 120 并发会把这 72 次挤进不到 1 秒内全部打出去，直接撞上限流。
 * 改成 12：72 次调用分 5–7 批、3–5 秒跑完，足够快，又给下面的滚动窗口
 * 限流器留出观察配额余量的时间，不会一次性把 75 个名额全占满。
 */
export const COINGLASS_CONCURRENCY = 12;

/**
 * CoinGlass 的真实配额，来自响应头 `API-KEY-MAX-LIMIT: 80`。
 * 留 5 次余量给「cron 刚扫完、用户马上点了刷新」这类重叠调用。
 */
export const RATE_LIMIT_PER_MIN = 75;
export const RATE_WINDOW_MS = 60_000;

/**
 * 滚动窗口限流器。撞上配额时**等待**而不是抛错——扫描流水线宁可慢几秒
 * 也不该因为限流丢掉一个币的数据（丢了就是四因子全走缺失分支，
 * 那正是这次重构要修的病）。
 *
 * 写成类而不是模块级函数/数组，是为了让测试能造一个用小窗口的独立实例，
 * 不用去碰 `coinglassGet` 内部那个贯穿整个进程生命周期的单例状态——
 * 模块级数组在测试之间不会自动重置，多个用例共用会互相污染调用计数。
 * `coinglassGet` 本身仍然只用下面这一个真实单例，限流对它是真的生效的。
 */
export class RollingWindowLimiter {
  private readonly calls: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.calls.length > 0 && now - this.calls[0] >= this.windowMs) this.calls.shift();
      if (this.calls.length < this.limit) {
        this.calls.push(now);
        return;
      }
      // 等到最早那次调用滑出窗口为止，多等 50ms 避免边界抖动
      await new Promise((r) => setTimeout(r, this.windowMs - (now - this.calls[0]) + 50));
    }
  }
}

const rateLimiter = new RollingWindowLimiter(RATE_LIMIT_PER_MIN, RATE_WINDOW_MS);

/** code:"429" 后等待多久重试。只重试一次，见下方 coinglassGet 里的说明。 */
const RETRY_DELAY_MS = 2_000;

export class CoinGlassError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = "CoinGlassError";
  }
}

/**
 * CoinGlass 用 HTTP 200 + 信封里的 code 表达业务失败（套餐不够是 "401"、
 * 缺参数是 "400"、被限流是 **"429"**——注意是信封里的字符串 code，
 * 不是 HTTP 状态码，`res.ok` 在被限流时也是 true），所以只看 res.ok
 * 会把这些情况都当成一次成功的空响应一路带进打分逻辑。这里统一归一成异常，
 * 让调用方的降级分支真的能触发。
 *
 * 429 只重试一次、等 2 秒：滚动窗口限流器（见上）已经是主防线，正常情况下
 * 不该走到这里。真走到这里，多半是同一把 key 被别的进程同时占用
 * （比如上一轮扫描还没退出限流窗口），重试一次给它让路；仍然 429
 * 说明问题不是「稍等一下」能解决的，再重试没有意义，直接抛错交给
 * 上层的降级分支（单币端点走 runWithConcurrency 的 null 兜底）。
 */
export async function coinglassGet<T>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const key = process.env.COINGLASS_API_KEY;
  if (!key) throw new Error("COINGLASS_API_KEY is not configured");

  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const doFetch = async (): Promise<CoinGlassEnvelope<T>> => {
    await rateLimiter.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        // key 只走请求头。放查询串会被 Vercel 的访问日志与任何中间代理原样记下来。
        headers: { "CG-API-KEY": key, accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        throw new CoinGlassError(`CoinGlass ${path} HTTP ${res.status}`, String(res.status), res.status);
      }
      return (await res.json()) as CoinGlassEnvelope<T>;
    } finally {
      clearTimeout(timer);
    }
  };

  let json = await doFetch();
  if (json.code === "429") {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    json = await doFetch();
  }

  if (json.code !== "0") {
    throw new CoinGlassError(
      `CoinGlass ${path} returned code ${json.code}: ${json.msg ?? "unknown"}`,
      json.code,
      200
    );
  }
  if (json.data === undefined) {
    throw new CoinGlassError(`CoinGlass ${path} returned no data`, "empty", 200);
  }
  return json.data;
}

/**
 * 固定 limit 个 worker 轮流从队列取活，而不是「切成 limit 大小的批、批间等齐」。
 * 分批会被批内最慢的那个请求拖住整批；worker 池里谁先空出来谁接下一个。
 *
 * 单个任务失败写成 null 而不是 reject 整体：一个币的一个端点挂掉不该让
 * 另外 149 个币的数据全部作废——调用方按 null 走各自因子的缺失分支。
 * 返回顺序与入参顺序一致，调用方可以按下标对回 symbol。
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number = COINGLASS_CONCURRENCY
): Promise<Array<T | null>> {
  const results: Array<T | null> = new Array(tasks.length).fill(null);
  let cursor = 0;

  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      try {
        results[index] = await tasks[index]();
      } catch {
        results[index] = null;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
