import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { verifyApiKey } from "@/lib/bingx/trade";
import { verifyFuturesApiKey } from "@/lib/bingx/futures";
import { maskApiKey } from "@/lib/utils";

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

    const trimmedKey = apiKey.trim();
    const trimmedSecret = secret.trim();

    // 分别验证：只有合约权限的 Key 不应被判为无效
    const [spotOk, futuresOk] = await Promise.all([
      verifyApiKey(trimmedKey, trimmedSecret),
      verifyFuturesApiKey(trimmedKey, trimmedSecret),
    ]);
    const isValid = spotOk || futuresOk;

    const encryptedKey = encrypt(trimmedKey);
    const encryptedSecret = encrypt(trimmedSecret);

    // 该用户还没有主密钥时，新加的这把自动成为主密钥
    const { count: primaryCount } = await supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authData.user.id)
      .eq("is_primary", true);

    const { data, error: insertError } = await supabase
      .from("api_keys")
      .insert({
        user_id: authData.user.id,
        label: label.trim(),
        api_key_encrypted: encryptedKey,
        secret_encrypted: encryptedSecret,
        api_key_masked: maskApiKey(trimmedKey),
        encryption_version: 1,
        is_valid: isValid,
        spot_ok: spotOk,
        futures_ok: futuresOk,
        is_primary: (primaryCount ?? 0) === 0 && isValid,
        last_verified_at: isValid ? new Date().toISOString() : null,
      })
      .select("id, label, api_key_masked, is_valid, spot_ok, futures_ok, is_primary, last_verified_at, created_at")
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

    // 删掉的可能正是主密钥；补选最早创建的有效密钥顶上，避免下单时无 key 可选
    const { count } = await supabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authData.user.id)
      .eq("is_primary", true);

    if ((count ?? 0) === 0) {
      const { data: next } = await supabase
        .from("api_keys")
        .select("id")
        .eq("user_id", authData.user.id)
        .eq("is_valid", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (next) {
        await supabase.from("api_keys").update({ is_primary: true }).eq("id", next.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { message: String(error) } },
      { status: 502 }
    );
  }
}

/** 设为主密钥 / 重新验证 */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      return NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 });
    }
    const userId = authData.user.id;
    const { id, action } = await request.json();
    if (!id || !action) {
      return NextResponse.json(
        { success: false, error: { message: "id and action are required" } },
        { status: 400 }
      );
    }

    if (action === "setPrimary") {
      // 唯一索引限制每用户至多一个 primary，必须先清后设
      await supabase.from("api_keys").update({ is_primary: false }).eq("user_id", userId);
      const { error } = await supabase
        .from("api_keys").update({ is_primary: true }).eq("id", id).eq("user_id", userId);
      if (error) {
        return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "reverify") {
      const { data: row } = await supabase
        .from("api_keys")
        .select("api_key_encrypted, secret_encrypted")
        .eq("id", id).eq("user_id", userId).single();
      if (!row) {
        return NextResponse.json({ success: false, error: { message: "Key not found" } }, { status: 404 });
      }

      const k = decrypt(row.api_key_encrypted);
      const s = decrypt(row.secret_encrypted);
      const [spotOk, futuresOk] = await Promise.all([verifyApiKey(k, s), verifyFuturesApiKey(k, s)]);
      const isValid = spotOk || futuresOk;

      const { data, error } = await supabase
        .from("api_keys")
        .update({
          spot_ok: spotOk,
          futures_ok: futuresOk,
          is_valid: isValid,
          api_key_masked: maskApiKey(k),
          last_verified_at: isValid ? new Date().toISOString() : null,
        })
        .eq("id", id).eq("user_id", userId)
        .select("id, label, api_key_masked, is_valid, spot_ok, futures_ok, is_primary, last_verified_at, created_at")
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
      }
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
