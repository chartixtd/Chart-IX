import { NextResponse } from "next/server";
import { getScannerPayload } from "@/lib/screener/cache";
import { listAlertRecords } from "@/lib/screener/alerts-store";

// 结果由模块内的 TTL 缓存托管，路由本身必须每次执行才能读到它
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 警报读失败不该拖垮榜单——listAlertRecords 内部已经吞掉错误返回 []，
    // 这里用 allSettled 再兜一层，防止将来有人改成抛错。
    const [payloadSettled, alertsSettled] = await Promise.allSettled([
      getScannerPayload(),
      listAlertRecords(),
    ]);

    if (payloadSettled.status === "rejected") throw payloadSettled.reason;

    return NextResponse.json(
      {
        success: true,
        data: {
          ...payloadSettled.value,
          alerts: alertsSettled.status === "fulfilled" ? alertsSettled.value : [],
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=900" } }
    );
  } catch (error) {
    console.error("[screener]", error);
    return NextResponse.json(
      { success: false, error: { code: "SCREENER_UNAVAILABLE", message: "Screener data unavailable" } },
      { status: 502 }
    );
  }
}
