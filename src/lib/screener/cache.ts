import { createTtlCache } from "@/lib/ttl-cache";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { runScan } from "./pipeline";
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

async function computeWithDbCache(): Promise<ScannerPayload> {
  const cached = await readScannerCache();
  if (cached) return cached;
  const payload = await runScan();
  await writeScannerCache(payload);
  return payload;
}

// 全站共用一份结果：TTL 到期前所有请求读同一份，冷缓存时并发请求
// 只触发一次上游计算。compute 内部还有一层 DB 缓存，兜住
// 「这个实例是冷的，但别的实例不是」。
const scannerCache = createTtlCache<ScannerPayload>({
  ttlMs: SCAN_INTERVAL_MS,
  compute: computeWithDbCache,
});

export function getScannerPayload(): Promise<ScannerPayload> {
  return scannerCache.get();
}
