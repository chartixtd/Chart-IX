import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyApiKey } from "@/lib/bingx/trade";

/** Verify that provided BingX API credentials are valid */
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

    const isValid = await verifyApiKey(apiKey.trim(), secret.trim());

    return NextResponse.json({ success: true, data: { isValid } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: String(error) } },
      { status: 502 }
    );
  }
}
