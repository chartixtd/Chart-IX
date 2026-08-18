import { createTtlCache } from "@/lib/ttl-cache";
import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { runScan } from "./pipeline";
import { SCAN_INTERVAL_MS } from "./types";
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
    return data.payload as ScannerPayload;
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
