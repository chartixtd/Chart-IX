import { createTtlCache } from "@/lib/ttl-cache";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { SCAN_INTERVAL_MS, SCANNER_PAYLOAD_VERSION } from "./types";
import type { ScannerPayload } from "./types";

/**
 * DB 侧的跨实例缓存。查不到、已过期、或 DB 打不通一律返回 null 交给调用方，
 * 这一层的失败绝不能变成整个选币接口失败。
 */
export async function readScannerCache(): Promise<ScannerPayload | null> {
  try {
    const client = createServiceRoleClient();
    const { data } = await client
      .from("screener_cache")
      .select("payload, computed_at")
      .eq("id", 1)
      .maybeSingle();

    if (!data) return null;
    const age = Date.now() - new Date(data.computed_at).getTime();
    if (age < 0 || age >= SCAN_INTERVAL_MS) return null;

    // 形状版本对不上就当缓存不存在。**这不是洁癖，是修过的一次生产崩溃**：
    // 部署了带新字段的代码之后，缓存里还躺着上一版的 payload，那些行缺
    // 新字段、读出来是 undefined，前端直接白屏。见 SCANNER_PAYLOAD_VERSION。
    const payload = data.payload as Partial<ScannerPayload> | null;
    if (!payload || payload.version !== SCANNER_PAYLOAD_VERSION) {
      console.warn(
        `[screener] 缓存形状版本不符（缓存 ${payload?.version ?? "无"} / 当前 ${SCANNER_PAYLOAD_VERSION}），丢弃并重算`
      );
      return null;
    }
    return payload as ScannerPayload;
  } catch {
    return null;
  }
}

/**
 * 读上一轮的 payload，**无视 TTL**。
 *
 * readScannerCache 会把过期的当作不存在（那是它的职责：过期就该重算），
 * 但「把上一轮还没结束多久的卡片接着显示一会儿」恰恰需要那份过期数据。
 * 两个函数分开，是为了不让「续命」这件事污染缓存新鲜度的判断。
 *
 * 形状版本仍然要对得上——旧版本的卡片结构跟当前代码不一样，接过来只会
 * 在前端炸（这个坑修过一次，见 SCANNER_PAYLOAD_VERSION）。
 */
export async function readLastScannerPayload(): Promise<ScannerPayload | null> {
  try {
    const client = createServiceRoleClient();
    const { data } = await client
      .from("screener_cache")
      .select("payload")
      .eq("id", 1)
      .maybeSingle();
    const payload = (data as { payload?: unknown } | null)?.payload as Partial<ScannerPayload> | null;
    if (!payload || payload.version !== SCANNER_PAYLOAD_VERSION) return null;
    return payload as ScannerPayload;
  } catch {
    return null;
  }
}

/** 写入失败只记录、不抛出——一次算好的结果不能因为存不进 DB 就白算。 */
export async function writeScannerCache(payload: ScannerPayload): Promise<void> {
  try {
    const client = createServiceRoleClient();
    await client.from("screener_cache").upsert({
      id: 1,
      payload,
      computed_at: new Date(payload.computedAt).toISOString(),
    });
  } catch (err) {
    console.error("[screener] failed to persist DB cache", err);
  }
}

/** 距上次成功扫描是否已满 SCAN_INTERVAL_MS。cron 路由用它做门控。 */
export async function isScanDue(): Promise<boolean> {
  return (await readScannerCache()) === null;
}

/**
 * 读路径**只读缓存，绝不触发扫描**。
 *
 * 这里曾经是「缓存过期就自己跑一轮 runScan 并写回」。那让 runScan 有了
 * **两个生产者**：cron（扫完会推送）和**任何一次网页请求**（扫完不推送）。
 * 后果是 Telegram 和网页会各说各话：
 *
 *   · 缓存一过期，谁先打开网页谁就触发一轮扫描，那一轮的卡片**一条都不会
 *     推送**；而 cron 下一跳看到缓存是新的（isScanDue 为假）就跳过，
 *     于是那批卡永远没人推
 *   · 反过来，cron 刚推过的那批卡会被网页触发的扫描顶掉
 *
 * 这不是理论：线上抓到过一份 computedAt 15:35、newCards 有 10 张的 payload，
 * 而推送台账最后一条停在 15:15——那一轮正是被一次 API 请求触发的。
 *
 * 现在扫描只有 cron 一个生产者，读路径退化成「有什么给什么」：
 *   ① 缓存还新鲜 → 直接给
 *   ② 缓存过期了 → **仍然给**，并记一条警告。过期的榜单也比空榜单有用，
 *      而且页面本来就显示 computedAt，陈旧是看得见的
 *   ③ 一条都没有（冷库） → 给空 payload，等 cron 那一跳（最多 5 分钟）
 */
async function serveCachedPayload(): Promise<ScannerPayload> {
  const fresh = await readScannerCache();
  if (fresh) return fresh;

  const stale = await readLastScannerPayload();
  if (stale) {
    const ageMin = ((Date.now() - stale.computedAt) / 60000).toFixed(0);
    console.warn(
      `[screener] 缓存已过期 ${ageMin} 分钟仍在服务——扫描只由 cron 产出，` +
        `这说明 cron 那一路可能挂了，而不是读路径的问题`
    );
    return stale;
  }

  console.warn("[screener] 缓存里一份结果都没有，等 cron 首次扫描");
  return { version: SCANNER_PAYLOAD_VERSION, rows: [], cards: [], newCards: [], computedAt: 0 };
}

/**
 * 进程内再兜一层，纯粹是省掉重复的 DB 往返。
 *
 * TTL **刻意远短于扫描间隔**：读路径不再计算，所以这一层只要不让同一秒里的
 * 几十个请求各打一次 DB 就够了。设成一个扫描周期会有个很难查的后果——
 * cron 在第 5 分钟写了新结果，而某个实例还在用它 15 分钟前缓存的那份，
 * 于是不同用户看到的榜单不一样。
 */
const scannerCache = createTtlCache<ScannerPayload>({
  ttlMs: 30_000,
  compute: serveCachedPayload,
});

export function getScannerPayload(): Promise<ScannerPayload> {
  return scannerCache.get();
}
