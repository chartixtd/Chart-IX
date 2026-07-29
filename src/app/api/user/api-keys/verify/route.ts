import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyApiKey } from "@/lib/bingx/trade";
import { verifyFuturesApiKey } from "@/lib/bingx/futures";

/** 分别验证现货与合约权限。任一通过即视为可用密钥 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { apiKey, secret } = await request.json();
    if (!apiKey?.trim() || !secret?.trim()) {
      return NextResponse.json(
        { success: false, error: { message: "apiKey and secret are required" } },
        { status: 400 }
      );
    }

    const [spotOk, futuresOk] = await Promise.all([
      verifyApiKey(apiKey.trim(), secret.trim()),
      verifyFuturesApiKey(apiKey.trim(), secret.trim()),
    ]);

    return NextResponse.json({
      success: true,
      data: { spotOk, futuresOk, isValid: spotOk || futuresOk },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: String(error) } },
      { status: 502 }
    );
  }
}
