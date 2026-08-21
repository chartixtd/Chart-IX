import { NextResponse } from "next/server";
import { getScannerPayload } from "@/lib/screener/cache";

// 结果由模块内的 TTL 缓存托管，路由本身必须每次执行才能读到它
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 卡片现在是扫描结果的一部分（payload.cards），不再单独查一张警报表。
    // 旧版这里是 Promise.allSettled([扫描, 查警报表])——两个数据源意味着
    // 表格和卡片可能来自不同时刻，而卡片本该就是「这一轮扫出来的东西」。
    const data = await getScannerPayload();
    return NextResponse.json(
      { success: true, data },
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
