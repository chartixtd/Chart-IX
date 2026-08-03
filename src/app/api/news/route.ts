import { NextResponse } from "next/server";
import { getNewsPayload } from "@/lib/news-server";
import type { NewsLang } from "@/types";

// 结果由模块内的 TTL 缓存托管，路由本身必须每次执行才能读到它
export const dynamic = "force-dynamic";

function parseLang(value: string | null): NewsLang | undefined {
  return value === "zh" || value === "en" ? value : undefined;
}

export async function GET(request: Request) {
  try {
    const lang = parseLang(new URL(request.url).searchParams.get("lang"));
    const data = await getNewsPayload(lang);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "NEWS_UNAVAILABLE", message: String(error) } },
      { status: 502 }
    );
  }
}
