import { NextResponse } from "next/server";
import { getFuturesTickers } from "@/lib/bingx/market";
import { createTtlCache } from "@/lib/ttl-cache";
import { buildPriceMap, LIVE_PRICE_TTL_MS, type LivePricePayload } from "@/lib/screener/live-prices";

export const dynamic = "force-dynamic";

// 全站共用一份：警报栏最多 20 张卡，但页面上可能有很多个访客同时在轮询，
// 没有这层缓存就是每个访客每 15 秒打一次 BingX。
const cache = createTtlCache<LivePricePayload>({
  ttlMs: LIVE_PRICE_TTL_MS,
  compute: async () => buildPriceMap(await getFuturesTickers(), Date.now()),
});

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await cache.get() });
  } catch (error) {
    console.error("[screener/prices]", error);
    // 502 而不是空对象：前端拿到失败会保留上一次的价格并继续用扫描价兜底，
    // 返回 {} 会让它误以为「所有币都查不到价」而整片回落。
    return NextResponse.json(
      { success: false, error: { code: "PRICES_UNAVAILABLE", message: "Live prices unavailable" } },
      { status: 502 }
    );
  }
}
