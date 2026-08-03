import { NextResponse } from "next/server";
import { getScreenerPayload } from "@/lib/screener-server";

// 结果由模块内的 TTL 缓存托管，路由本身必须每次执行才能读到它
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getScreenerPayload();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "SCREENER_UNAVAILABLE", message: String(error) } },
      { status: 502 }
    );
  }
}
