import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { runWithConcurrency } from "@/lib/coinglass/client";
import { getPairsMarkets } from "@/lib/coinglass/market";

/**
 * 一次轮转刷新几个币。
 *
 * 上限是限流器的 75 次/分钟，这里留出余量：刷新跑在「本轮不该扫描」的
 * cron tick 上，那一跳除了这些 pairs-markets 调用之外不花别的配额，
 * 但真实世界里 pg_cron 的触发时刻会漂，两跳挨得近时不该把配额顶满。
 *
 * 60 个/次 × 每 15 分钟两次空转 tick = 每 15 分钟 120 个，
 * 250 多个候选约半小时刷一遍。
 */
export const VOLUME_REFRESH_BATCH = 60;

export interface CachedVolume {
  volumeUsd: number;
  updatedAt: number;
}

export interface VolumeUpsert {
  coin: string;
  volumeUsd: number;
}

/**
 * 读取整张缓存表。
 *
 * 整表读而不是按 coin 过滤：表最多两三百行，一次全取比拼一个长 in() 更简单，
 * 也让调用方能直接判断「哪些币还没被刷过」——那是轮转调度的输入。
 *
 * 读失败返回空 Map 而不是抛错：这一层挂掉的正确降级是「所有币都当作
 * 未验证成交量」，由调用方决定怎么处理，绝不能让整轮扫描失败。
 */
export async function readVolumeCache(): Promise<Map<string, CachedVolume>> {
  const out = new Map<string, CachedVolume>();
  try {
    const client = createServiceRoleClient();
    const { data, error } = await client
      .from("screener_volume_cache")
      .select("coin, volume_usd, updated_at");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const r = row as {
        coin: string;
        volume_usd: number | string;
        updated_at: string;
      };
      const v = typeof r.volume_usd === "number" ? r.volume_usd : parseFloat(r.volume_usd);
      if (!Number.isFinite(v)) continue;
      out.set(r.coin, { volumeUsd: v, updatedAt: new Date(r.updated_at).getTime() });
    }
  } catch (err) {
    console.error("[screener] volume cache read failed, treating all coins as unverified", err);
  }
  return out;
}

/** 写失败只记录不抛出：这一批没刷上，下一跳会因为它们仍然最旧而被重新选中。 */
export async function upsertVolumes(rows: VolumeUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const client = createServiceRoleClient();
    const now = new Date().toISOString();
    await client.from("screener_volume_cache").upsert(
      rows.map((r) => ({
        coin: r.coin,
        volume_usd: r.volumeUsd,
        updated_at: now,
      })),
      { onConflict: "coin" }
    );
  } catch (err) {
    console.error("[screener] volume cache upsert failed", err);
  }
}

/**
 * 从候选池里挑出这一跳该刷的 N 个：**没刷过的优先，其次是最旧的**。
 *
 * 纯函数，与 DB 无关，因为轮转调度的正确性完全在这条规则上——
 * 它必须保证「每个候选最终都会被刷到」，不能让某些币永远排不上队。
 * 未缓存的排最前是必需的：新上市的币在缓存里没有记录，如果按
 * updatedAt 排序而把它们当成「时间戳为 0 = 最旧」以外的任何处理，
 * 它们就会一直进不了榜单（成交量无从证明达标 = 一直被门槛挡掉）。
 *
 * 同样时间戳时按币名排序，只是为了让结果稳定可复现，便于排查。
 */
export function pickStaleCoins(
  coins: string[],
  cache: Map<string, CachedVolume>,
  limit: number
): string[] {
  return [...coins]
    .sort((a, b) => {
      const ta = cache.get(a)?.updatedAt ?? 0;
      const tb = cache.get(b)?.updatedAt ?? 0;
      return ta - tb || a.localeCompare(b);
    })
    .slice(0, Math.max(0, limit));
}

/**
 * 轮转刷新一批：挑最旧的 `VOLUME_REFRESH_BATCH` 个候选，逐个调 pairs-markets
 * 取全交易所成交额之和，写回缓存。
 *
 * 跑在「本轮不该扫描」的 cron tick 上——cron 每 5 分钟打一次而扫描间隔是
 * 15 分钟，三次里有两次此前直接 skipped 走人。这件事放在那两跳里做，
 * 对扫描那一跳的配额零影响。
 *
 * 单个币失败写成 null 后跳过（runWithConcurrency 的语义）：它的 updated_at
 * 不会被刷新，所以下一跳它仍然排在最旧的那一批里，会被自动重试。
 * 这就是为什么这里不需要任何重试逻辑。
 */
export async function refreshVolumeBatch(coins: string[]): Promise<number> {
  if (coins.length === 0) return 0;
  const rows = await runWithConcurrency(coins.map((coin) => () => getPairsMarkets(coin)));

  const updates: VolumeUpsert[] = [];
  for (let i = 0; i < coins.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const volumeUsd = r.reduce((a, x) => a + (Number.isFinite(x.volume_usd) ? x.volume_usd : 0), 0);
    // 0 也要写：它是「这个币在全市场确实没有成交」这个事实，
    // 跳过不写会让它永远排在「最旧」队首，把轮转名额一直占着。
    if (!Number.isFinite(volumeUsd)) continue;
    updates.push({ coin: coins[i], volumeUsd });
  }

  await upsertVolumes(updates);
  return updates.length;
}
