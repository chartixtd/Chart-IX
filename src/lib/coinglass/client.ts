import type { CoinGlassEnvelope } from "./types";

const BASE_URL = "https://open-api-v4.coinglass.com";
const TIMEOUT_MS = 20_000;

/**
 * 实测（2026-08-18）：120 个并发 pairs-markets 请求全部 200，总耗时 2.48 秒。
 * 上游不是瓶颈，Vercel Hobby 的 60 秒函数上限才是——所以这个数是按
 * 「明细层 600 次调用要在 13 秒内跑完」倒推的，不是照 CoinGlass 文档抄的。
 * 往下调会让明细层线性变慢并逼近 60 秒上限，往上调收益已经很小。
 */
export const COINGLASS_CONCURRENCY = 120;

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
 * 缺参数是 "400"），所以只看 res.ok 会把「Upgrade plan」当成一次成功的空响应
 * 一路带进打分逻辑。这里统一归一成异常，让调用方的降级分支真的能触发。
 */
export async function coinglassGet<T>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const key = process.env.COINGLASS_API_KEY;
  if (!key) throw new Error("COINGLASS_API_KEY is not configured");

  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

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
    const json = (await res.json()) as CoinGlassEnvelope<T>;
    if (json.code !== "0") {
      throw new CoinGlassError(
        `CoinGlass ${path} returned code ${json.code}: ${json.msg ?? "unknown"}`,
        json.code,
        res.status
      );
    }
    if (json.data === undefined) {
      throw new CoinGlassError(`CoinGlass ${path} returned no data`, "empty", res.status);
    }
    return json.data;
  } finally {
    clearTimeout(timer);
  }
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
