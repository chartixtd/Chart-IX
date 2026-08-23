import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { fetchExternalSeries } from "./chart-series";
import {
  externalRequestKey,
  externalSeriesTtlMs,
  type ExternalSeriesBars,
  type ExternalSeriesRequest,
} from "@/lib/chart/external-series";

/**
 * 图表序列的双层缓存：进程内存 + Supabase `coinglass_series_cache`。
 *
 * 为什么要两层：CoinGlass 每分钟 75 次的配额和选币器共用，而 Vercel 每个
 * lambda 的内存互不可见——只靠内存，冷启动的实例会各自再打一次上游，
 * 多几个用户同时看图就能把选币器那一轮的配额挤掉（文档里记录过的后果：
 * 四因子全部退化成缺数据默认分）。DB 层让所有实例共享同一份「上次拉到的
 * 数据 + 时间」，TTL 内无论多少实例多少用户，每个 request（键是
 * externalRequestKey：kind/币/周期/市场/保证金/单位/交易所组合）只打一次上游。
 *
 * 降级顺序（任何一层失败都不能把图表接口打成 5xx，除非真的一根都没有）：
 *   内存新鲜 → 直接返回
 *   DB 新鲜   → 返回并回填内存
 *   上游成功  → 返回、写内存、异步写 DB（写失败只记录）
 *   上游失败  → 有旧数据（DB 或内存）就标 stale 返回，没有才抛错
 *
 * DB 表不存在（迁移还没跑）时 readDb/writeDb 走 catch 返回 null/静默，
 * 行为退化成纯内存缓存，功能照常可用。
 */

export interface CachedExternalSeries {
  bars: ExternalSeriesBars;
  /** 毫秒时间戳，上游数据真正拉到的时刻（不是本次请求的时刻） */
  fetchedAt: number;
  /** true = 上游这次没拉到，给的是过期的旧数据 */
  stale: boolean;
}

interface Entry {
  bars: ExternalSeriesBars;
  fetchedAt: number;
}

export interface ExternalSeriesCacheDeps {
  now: () => number;
  fetchUpstream: (request: ExternalSeriesRequest) => Promise<ExternalSeriesBars>;
  readDb: (key: string) => Promise<Entry | null>;
  writeDb: (key: string, entry: Entry) => Promise<void>;
}

export const cacheKey = externalRequestKey;

/** 内存层最多记多少个组合；超过就淘汰最早拉到的那个。一个组合约 60KB。 */
const MEMORY_MAX_ENTRIES = 200;

export function createExternalSeriesCache(deps: ExternalSeriesCacheDeps) {
  const memory = new Map<string, Entry>();
  const inflight = new Map<string, Promise<CachedExternalSeries>>();

  function remember(key: string, entry: Entry) {
    memory.set(key, entry);
    if (memory.size > MEMORY_MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [k, e] of memory) {
        if (e.fetchedAt < oldestAt) { oldestAt = e.fetchedAt; oldestKey = k; }
      }
      if (oldestKey !== null) memory.delete(oldestKey);
    }
  }

  async function load(key: string, request: ExternalSeriesRequest, ttlMs: number): Promise<CachedExternalSeries> {
    const mem = memory.get(key) ?? null;
    const db = await deps.readDb(key);
    if (db && deps.now() - db.fetchedAt < ttlMs) {
      remember(key, db);
      return { ...db, stale: false };
    }

    try {
      const bars = await deps.fetchUpstream(request);
      const entry: Entry = { bars, fetchedAt: deps.now() };
      remember(key, entry);
      void deps.writeDb(key, entry).catch((err) => {
        console.error("[coinglass/series] cache write failed", err);
      });
      return { ...entry, stale: false };
    } catch (err) {
      // 两份旧数据里挑较新的那份顶上
      const fallback =
        db && mem ? (db.fetchedAt >= mem.fetchedAt ? db : mem) : (db ?? mem);
      if (fallback) {
        console.warn(`[coinglass/series] upstream failed for ${key}, serving stale`, err);
        return { ...fallback, stale: true };
      }
      throw err;
    }
  }

  return {
    async get(request: ExternalSeriesRequest): Promise<CachedExternalSeries> {
      const key = cacheKey(request);
      const ttlMs = externalSeriesTtlMs(request.interval);

      const mem = memory.get(key);
      if (mem && deps.now() - mem.fetchedAt < ttlMs) return { ...mem, stale: false };

      const pending = inflight.get(key);
      if (pending) return pending;

      const p = load(key, request, ttlMs).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    /** 测试用 */
    _memorySize: () => memory.size,
  };
}

// ---- 真实依赖 ----

interface CacheRow {
  payload: ExternalSeriesBars;
  fetched_at: string;
}

async function readDb(key: string): Promise<Entry | null> {
  try {
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("coinglass_series_cache")
      .select("payload, fetched_at")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as CacheRow;
    const fetchedAt = new Date(row.fetched_at).getTime();
    if (!Array.isArray(row.payload) || !Number.isFinite(fetchedAt)) return null;
    return { bars: row.payload, fetchedAt };
  } catch {
    return null;
  }
}

async function writeDb(key: string, entry: Entry): Promise<void> {
  const client = createServiceRoleClient();
  const { error } = await client.from("coinglass_series_cache").upsert(
    { key, payload: entry.bars, fetched_at: new Date(entry.fetchedAt).toISOString() },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
}

let singleton: ReturnType<typeof createExternalSeriesCache> | null = null;

export function getExternalSeriesCached(request: ExternalSeriesRequest): Promise<CachedExternalSeries> {
  if (!singleton) {
    singleton = createExternalSeriesCache({
      now: Date.now,
      fetchUpstream: fetchExternalSeries,
      readDb,
      writeDb,
    });
  }
  return singleton.get(request);
}
