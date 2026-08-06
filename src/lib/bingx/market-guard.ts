import { NextRequest, NextResponse } from "next/server";

/**
 * Shared guardrails for the public (unauthenticated) BingX market-data
 * proxy routes under src/app/api/bingx/market/*. These endpoints exist so
 * the browser doesn't call BingX directly, but with no auth in front of
 * them they were previously an open, unlimited proxy — anyone could point
 * a script at them and burn our BingX rate-limit budget on our behalf.
 *
 * In-memory only: like the fallback in src/lib/trading/rate-limit.ts, this
 * only catches requests landing on the same serverless instance, not a
 * global guarantee. That's an acceptable trade-off here — a per-instance
 * cap still blocks the common case (one client hammering one edge node)
 * without adding a DB round trip to routes polled every 2-10 seconds by
 * every open tab.
 */

const IP_WINDOW_MS = 10_000;
const IP_MAX_REQUESTS = 150; // generous: a single trade-page tab legitimately fires ~15-20 req/10s across depth/trades/ticker/klines
const hits = new Map<string, number[]>();

// Bound memory in long-lived instances — sweep old IPs out occasionally
// instead of letting the map grow forever.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < IP_WINDOW_MS) return;
  lastSweep = now;
  for (const [ip, times] of hits) {
    if (times.every((t) => now - t > IP_WINDOW_MS)) hits.delete(ip);
  }
}

export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function checkMarketRateLimit(request: NextRequest): boolean {
  const ip = getClientIp(request);
  const now = Date.now();
  sweep(now);

  const cutoff = now - IP_WINDOW_MS;
  const recent = (hits.get(ip) ?? []).filter((t) => t > cutoff);

  if (recent.length >= IP_MAX_REQUESTS) {
    hits.set(ip, recent);
    return false;
  }

  recent.push(now);
  hits.set(ip, recent);
  return true;
}

export function rateLimitedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } },
    { status: 429, headers: { "Retry-After": "10" } }
  );
}

/** Clamp a client-supplied limit into a safe range instead of trusting it outright. */
export function clampLimit(raw: string | null, def: number, max: number): number {
  const n = raw === null ? def : parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

// BingX spot/futures symbols are always BASE-QUOTE, e.g. "BTC-USDT".
const SYMBOL_RE = /^[A-Z0-9]{1,20}-[A-Z0-9]{1,20}$/;

export function isValidSymbol(symbol: string): boolean {
  return SYMBOL_RE.test(symbol);
}

export function invalidSymbolResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid symbol format" } },
    { status: 400 }
  );
}

const VALID_INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m",
  "1h", "2h", "4h", "6h", "8h", "12h",
  "1d", "3d", "1w", "1M",
]);

export function isValidInterval(interval: string): boolean {
  return VALID_INTERVALS.has(interval);
}

export function invalidIntervalResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid interval" } },
    { status: 400 }
  );
}

/** Attaches a short edge/CDN cache window so concurrent pollers across many users share one upstream hit. */
export function withMarketCache<T>(body: T, maxAgeSeconds: number, staleWhileRevalidateSeconds: number): NextResponse {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
    },
  });
}
