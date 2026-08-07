import { createServiceRoleClient } from "@/lib/supabase/middleware";
import { decrypt } from "@/lib/crypto";

interface CachedKeys { apiKey: string; secret: string; at: number }

const TTL_MS = 60_000;
const cache = new Map<string, CachedKeys>();

type Fetcher = (userId: string) => Promise<{ apiKey: string; secret: string } | null>;

async function defaultFetcher(userId: string) {
  // service-role：与原路由内查询同一张表同一过滤条件；用 service 客户端
  // 使查询不依赖调用方的 cookie 会话（readonly 路由已本地验签拿到 userId）
  const { data, error } = await createServiceRoleClient()
    .from("api_keys").select("api_key_encrypted, secret_encrypted")
    .eq("user_id", userId).eq("is_valid", true)
    .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
    .limit(1);
  if (error || !data?.length) return null;
  return { apiKey: decrypt(data[0].api_key_encrypted), secret: decrypt(data[0].secret_encrypted) };
}

let deps: { fetcher: Fetcher; now: () => number } = { fetcher: defaultFetcher, now: Date.now };

/** 60s per-user cache of decrypted BingX credentials. Poll routes hit this
 * every 5-30s — without it every poll pays a DB read + AES decrypt. Key
 * rotation: the api-keys mutation routes call invalidateApiKeys() (instant
 * within this instance); other instances converge within TTL_MS. */
export async function getDecryptedApiKeys(userId: string) {
  const hit = cache.get(userId);
  if (hit && deps.now() - hit.at < TTL_MS) return { apiKey: hit.apiKey, secret: hit.secret };
  const fresh = await deps.fetcher(userId);
  if (fresh) cache.set(userId, { ...fresh, at: deps.now() });
  else cache.delete(userId);
  return fresh;
}

export function invalidateApiKeys(userId: string): void {
  cache.delete(userId);
}

export function __setDepsForTest(next: Partial<typeof deps>): void {
  deps = { ...deps, ...next };
  cache.clear();
}
