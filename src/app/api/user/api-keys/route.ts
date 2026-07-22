import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { verifyApiKey } from "@/lib/bingx/trade";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { label, apiKey, secret } = await request.json();
    if (!label?.trim() || !apiKey?.trim() || !secret?.trim()) {
      return NextResponse.json(
        { success: false, error: { message: "label, apiKey, and secret are required" } },
        { status: 400 }
      );
    }

    // Verify the API key works before saving
    const isValid = await verifyApiKey(apiKey.trim(), secret.trim());

    // Encrypt before storing
    const encryptedKey = encrypt(apiKey.trim());
    const encryptedSecret = encrypt(secret.trim());

    const { data, error: insertError } = await supabase
      .from("api_keys")
      .insert({
        user_id: authData.user.id,
        label: label.trim(),
        api_key_encrypted: encryptedKey,
        secret_encrypted: encryptedSecret,
        encryption_version: 1,
        is_valid: isValid,
        last_verified_at: isValid ? new Date().toISOString() : null,
      })
      .select("id, label, is_valid, last_verified_at, created_at")
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: { message: insertError.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: String(error) } },
      { status: 502 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const keyId = searchParams.get("id");
    if (!keyId) {
      return NextResponse.json({ success: false, error: { message: "id is required" } }, { status: 400 });
    }

    const { error: deleteError } = await supabase
      .from("api_keys")
      .delete()
      .eq("id", keyId)
      .eq("user_id", authData.user.id);

    if (deleteError) {
      return NextResponse.json(
        { success: false, error: { message: deleteError.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: String(error) } },
      { status: 502 }
    );
  }
}
