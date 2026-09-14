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
 * 60 个/次 × 每 15 分钟两次空转 tick = 每 15 分钟 120 个。
 *
 * **一轮刷完要多久，取决于候选池有多大，而池子刚变大了一倍多。** 加代币化
 * 标的之前是 250 多个（约半小时一遍）；现在 `listVolumeRefreshCoins` 走的
 * `preselect` 会同时吐出加密 + 代币化商品 + 代币化美股，实测 672 个
 * （305 / 28 / 339），一遍要约 85 分钟。
 *
 * 没有跟着调大这个批次，理由是刷新跑在空转 tick 上、那一跳的配额虽然空着，
 * 但 pg_cron 的触发时刻会漂，两跳挨得近时把配额顶满会挤到真正的扫描。
 * 慢的代价是可承受的：这是 **24 小时**成交量，本身就是慢变量，而新上市的
 * 标的因为「未缓存的排在刷新队列最前」（见下面 pickStaleCoins），
 * 不会被这个变长的周期拖住。
 */
export const VOLUME_REFRESH_BATCH = 60;

export interface CachedVolume {
  volumeUsd: number;
  /**
   * CoinGlass 那边这个币名的参考价（各交易所 current_price 的中位数）。
   *
   * 唯一的用途是识别**代号撞车**：BingX 的 `NCSKCVX2USD-USDT` 是雪佛龙
   * （$212），而 CoinGlass 的 `CVX` 是 Convex Finance（$2.13）——两边报价
   * 差一个数量级就说明映射错了，这一轮该把它整个排除，而不是拿另一个标的
   * 的持仓量和资金流去填这一行。判据与阈值见 universe.ts 的 sameInstrument。
   *
   * null = 还没刷到过 / 上游没给价，此时**不做**这道校验（缺证据不等于
   * 有问题，跟成交量那条「必须证明达标」刻意相反：那是流动性门槛，
   * 这是错配探测，把「没探测过」当成「探测到了」会无故删行）。
   */
  price: number | null;
  updatedAt: number;
}

export interface VolumeUpsert {
  coin: string;
  volumeUsd: number;
  price: number | null;
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
      .select("coin, volume_usd, price, updated_at");
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const r = row as {
        coin: string;
        volume_usd: number | string;
        price: number | string | null;
        updated_at: string;
      };
      const v = typeof r.volume_usd === "number" ? r.volume_usd : parseFloat(r.volume_usd);
      if (!Number.isFinite(v)) continue;
      const rawPrice = typeof r.price === "string" ? parseFloat(r.price) : r.price;
      const price = typeof rawPrice === "number" && Number.isFinite(rawPrice) ? rawPrice : null;
      out.set(r.coin, { volumeUsd: v, price, updatedAt: new Date(r.updated_at).getTime() });
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
        price: r.price,
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
/**
 * 各交易所 current_price 的中位数。取中位数而不是均值或某一家：
 * 一行报了个离谱的价（下架的合约、刚上市还没成交）会把均值整个带偏，
 * 而挑某一家就得维护「挑哪家」这条规则，还会因为那家没上这个币而落空。
 *
 * 一个能用的价都没有时返回 null —— 调用方对 null 的处理是「不做这道校验」。
 */
function medianPrice(rows: Array<{ current_price: number }>): number | null {
  const prices = rows
    .map((x) => x.current_price)
    .filter((p) => typeof p === "number" && Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
}

export async function refreshVolumeBatch(coins: string[]): Promise<number> {
  if (coins.length === 0) return 0;
  const rows = await runWithConcurrency(coins.map((coin) => () => getPairsMarkets(coin)));

  const updates: VolumeUpsert[] = [];
  for (let i = 0; i < coins.length; i++) {
    const r = rows[i];
    // 请求失败（null）才跳过——那是暂时的，下一跳会因为它仍然最旧而重试。
    if (!r) continue;
    // 空数组不是失败，是「CoinGlass 查不到这个币的任何合约」。写 0 而不是
    // 跳过：跳过的话它永远排在「最旧」队首，每一跳都白占一个刷新名额而且
    // 每一跳都会再失败一次。线上实测有 3 个币这样卡了 11 小时。
    // 写 0 的结果是它被成交量门槛挡掉——那本来就是「查不到成交量」的正确
    // 归宿，而且它会正常参与轮转，哪天 CoinGlass 收录了就自动恢复。
    const volumeUsd = r.reduce((a, x) => a + (Number.isFinite(x.volume_usd) ? x.volume_usd : 0), 0);
    if (!Number.isFinite(volumeUsd)) continue;
    updates.push({ coin: coins[i], volumeUsd, price: medianPrice(r) });
  }

  await upsertVolumes(updates);
  return updates.length;
}
