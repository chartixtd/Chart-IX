import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDecryptedApiKeys } from "@/lib/trading/api-key-cache";
import { createListenKey, extendListenKey, deleteListenKey } from "@/lib/bingx/user-stream";
import { describeBingXError } from "@/lib/trading/errors";

type ApiKeyResolution =
  | { ok: true; apiKey: string; secret: string }
  | { ok: false; error: NextResponse };

async function resolveApiKey(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ApiKeyResolution> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return { ok: false, error: NextResponse.json({ success: false, error: { message: "Unauthorized" } }, { status: 401 }) };
  }

  const keys = await getDecryptedApiKeys(authData.user.id);
  if (!keys) {
    return { ok: false, error: NextResponse.json({ success: false, error: { message: "No valid API key found" } }, { status: 400 }) };
  }

  return { ok: true, apiKey: keys.apiKey, secret: keys.secret };
}

export async function POST() {
  try {
    const supabase = await createClient();
    const resolved = await resolveApiKey(supabase);
    if (!resolved.ok) return resolved.error;

    const listenKey = await createListenKey(resolved.apiKey, resolved.secret);
    return NextResponse.json({ success: true, data: { listenKey } });
  } catch (error) {
    console.error("[bingx/user-stream POST]", error);
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
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
    console.error("[bingx/user-stream PUT]", error);
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
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
    console.error("[bingx/user-stream DELETE]", error);
    const described = describeBingXError(error);
    return NextResponse.json(
      { success: false, error: { message: described.rawMessage, i18nKey: described.i18nKey, code: described.code } },
      { status: 502 }
    );
  }
}
