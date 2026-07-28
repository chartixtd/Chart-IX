import { getPositionSideDual } from "@/lib/bingx/futures";

/**
 * 把用户在 UI 上选的方向翻译成 BingX 需要的 side + positionSide。
 *
 * 对冲模式（dualSidePosition=true）：positionSide 用 LONG / SHORT
 * 单向模式（dualSidePosition=false）：positionSide 必须是 BOTH，
 *   否则 BingX 返回 109400 "PositionSide must be BOTH in one-way mode"
 */
export function resolveOrderDirection(
  requested: "LONG" | "SHORT",
  dualSide: boolean
): { side: "BUY" | "SELL"; positionSide: "LONG" | "SHORT" | "BOTH" } {
  const side = requested === "LONG" ? "BUY" : "SELL";
  return { side, positionSide: dualSide ? requested : "BOTH" };
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { dualSide: boolean; expiresAt: number }>();
// In-flight requests per user, so concurrent callers on a cache miss share
// one upstream call instead of each firing their own (thundering herd).
const inFlight = new Map<string, Promise<boolean>>();

export function invalidateDualSideMode(userId: string): void {
  cache.delete(userId);
  inFlight.delete(userId);
}

/** 读取账户持仓模式，按用户缓存 5 分钟。用户可能随时在 BingX App 里改，故 TTL 不宜过长 */
export async function getDualSideMode(
  userId: string,
  apiKey: string,
  secret: string
): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.dualSide;

  const pending = inFlight.get(userId);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await getPositionSideDual(apiKey, secret);
      // BingX documents this field as bool, but the paired POST takes the string
      // "true"/"false", and signedRequest casts the response without runtime
      // validation. Accept both shapes: misreading hedge mode as one-way makes
      // every order fail with 109400. Do not widen further — 1/"yes"/objects
      // must NOT count as hedge mode.
      const raw = res?.dualSidePosition as unknown;
      const dualSide = raw === true || raw === "true";
      cache.set(userId, { dualSide, expiresAt: Date.now() + TTL_MS });
      return dualSide;
    } finally {
      inFlight.delete(userId);
    }
  })();

  inFlight.set(userId, request);
  return request;
}
