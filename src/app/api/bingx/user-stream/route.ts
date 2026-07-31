import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { createListenKey, extendListenKey, deleteListenKey } from "@/lib/bingx/user-stream";

type ApiKeyResolution =
  | { ok: true; apiKey: string; secret: string }
  | { ok: false; error: NextResponse };

async function resolveApiKey(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ApiKeyResolution> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return { ok: false, error: NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 }) };
  }

  const { data: apiKeys, error: keyError } = await supabase
    .from("api_keys").select("api_key_encrypted, secret_encrypted")
    .eq("user_id", authData.user.id).eq("is_valid", true)
    .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
    .limit(1);

  if (keyError || !apiKeys?.length) {
    return { ok: false, error: NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 }) };
  }

  return { ok: true, apiKey: decrypt(apiKeys[0].api_key_encrypted), secret: decrypt(apiKeys[0].secret_encrypted) };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const resolved = await resolveApiKey(supabase);
    if (!resolved.ok) return resolved.error;

    const listenKey = await createListenKey(resolved.apiKey, resolved.secret);
    return NextResponse.json({ success: true, data: { listenKey } });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const resolved = await resolveApiKey(supabase);
    if (!resolved.ok) return resolved.error;

    const { listenKey } = await request.json();
    if (!listenKey) {
      return NextResponse.json({ success: false, error: { message: "listenKey is required" } }, { status: 400 });
    }

    await extendListenKey(resolved.apiKey, resolved.secret, listenKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const resolved = await resolveApiKey(supabase);
    if (!resolved.ok) return resolved.error;

    const { listenKey } = await request.json();
    if (!listenKey) {
      return NextResponse.json({ success: false, error: { message: "listenKey is required" } }, { status: 400 });
    }

    await deleteListenKey(resolved.apiKey, resolved.secret, listenKey);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: { message: String(error) } }, { status: 502 });
  }
}
