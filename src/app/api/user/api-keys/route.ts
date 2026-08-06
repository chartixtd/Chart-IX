import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/crypto";
import { verifyApiKey } from "@/lib/bingx/trade";
import { verifyFuturesApiKey } from "@/lib/bingx/futures";
import { maskApiKey } from "@/lib/utils";

/**
 * 若该用户当前没有任何 is_primary=true 的 key，补选最早创建的有效密钥顶上。
 * DELETE（删掉的可能是主密钥）和 reverify（重新验证后主密钥可能变为无效）共用此逻辑，
 * 避免下单路由 (.order("is_primary", ...)) 长期无主密钥可用。
 */
async function promoteNextValidPrimaryIfNoneSet(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_primary", true);

  if ((count ?? 0) === 0) {
    const { data: next } = await supabase
      .from("api_keys")
      .select("id")
      .eq("user_id", userId)
      .eq("is_valid", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) {
      await supabase.from("api_keys").update({ is_primary: true }).eq("id", next.id);
    }
  }
}

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
      console.error("[user/api-keys POST]", insertError);
      return NextResponse.json(
        { success: false, error: { message: "Failed to save API key" } },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[user/api-keys POST]", error);
    return NextResponse.json(
      { success: false, error: { message: "Unexpected error" } },
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
      console.error("[user/api-keys DELETE]", deleteError);
      return NextResponse.json(
        { success: false, error: { message: "Failed to delete API key" } },
        { status: 500 }
      );
    }

    // 删掉的可能正是主密钥；补选最早创建的有效密钥顶上，避免下单时无 key 可选
    await promoteNextValidPrimaryIfNoneSet(supabase, authData.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[user/api-keys DELETE]", error);
    return NextResponse.json(
      { success: false, error: { message: "Unexpected error" } },
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
      // 先确认目标 key 存在、属于该用户、且是可用的，再清后设 —
      // 否则一个陈旧/错误/属于别人的 id 会让第二步 update 命中 0 行但不报错，
      // 造成「清空了所有 primary，却没有真正设上」的假成功。
      const { data: target } = await supabase
        .from("api_keys")
        .select("id, is_valid")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!target) {
        return NextResponse.json({ success: false, error: { message: "Key not found" } }, { status: 404 });
      }
      if (!target.is_valid) {
        return NextResponse.json(
          { success: false, error: { message: "Cannot set an invalid key as primary" } },
          { status: 400 }
        );
      }

      // 唯一索引限制每用户至多一个 primary，必须先清后设
      await supabase.from("api_keys").update({ is_primary: false }).eq("user_id", userId);
      const { error } = await supabase
        .from("api_keys").update({ is_primary: true }).eq("id", id).eq("user_id", userId);
      if (error) {
        console.error("[user/api-keys PATCH setPrimary]", error);
        return NextResponse.json({ success: false, error: { message: "Failed to set primary key" } }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "reverify") {
      const { data: row } = await supabase
        .from("api_keys")
        .select("api_key_encrypted, secret_encrypted, is_primary")
        .eq("id", id).eq("user_id", userId).single();
      if (!row) {
        return NextResponse.json({ success: false, error: { message: "Key not found" } }, { status: 404 });
      }

      const k = decrypt(row.api_key_encrypted);
      const s = decrypt(row.secret_encrypted);
      const [spotOk, futuresOk] = await Promise.all([verifyApiKey(k, s), verifyFuturesApiKey(k, s)]);
      const isValid = spotOk || futuresOk;

      // 重新验证后如果一把原本是主密钥的 key 变为失效，不能让它继续挂着 primary 标记 ——
      // 下单路由按 is_valid 过滤，会悄悄跳过它改用别的 key，界面却仍显示它是「主密钥」。
      const wasPrimaryAndNowInvalid = row.is_primary && !isValid;

      const { data, error } = await supabase
        .from("api_keys")
        .update({
          spot_ok: spotOk,
          futures_ok: futuresOk,
          is_valid: isValid,
          api_key_masked: maskApiKey(k),
          last_verified_at: isValid ? new Date().toISOString() : null,
          ...(wasPrimaryAndNowInvalid ? { is_primary: false } : {}),
        })
        .eq("id", id).eq("user_id", userId)
        .select("id, label, api_key_masked, is_valid, spot_ok, futures_ok, is_primary, last_verified_at, created_at")
        .single();

      if (error) {
        console.error("[user/api-keys PATCH reverify]", error);
        return NextResponse.json({ success: false, error: { message: "Failed to update key" } }, { status: 500 });
      }

      if (wasPrimaryAndNowInvalid) {
        await promoteNextValidPrimaryIfNoneSet(supabase, userId);
        // data.is_primary 上面已经被更新为 false 并返回；补选发生在其后，
        // 若调用方需要拿到新主密钥的状态，需重新拉取列表 —— 这里保持响应即时返回本次操作结果。
      }

      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ success: false, error: { message: "Invalid action" } }, { status: 400 });
  } catch (error) {
    console.error("[user/api-keys PATCH]", error);
    return NextResponse.json({ success: false, error: { message: "Unexpected error" } }, { status: 502 });
  }
}
