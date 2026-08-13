import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { logAdminAction } from "@/lib/supabase/admin-log";
import {
  listTelegramTargets,
  createTelegramTarget,
  updateTelegramTarget,
  deleteTelegramTarget,
  type TelegramTarget,
} from "@/lib/telegram-push";

/** Never let a decrypted per-target token reach the client. */
function toPublicShape(t: TelegramTarget) {
  const { botToken: _botToken, ...rest } = t;
  return rest;
}

function validateLang(v: unknown): "en" | "zh" | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (v === "en" || v === "zh") return v;
  throw new Error("messageLang must be 'en', 'zh' or null");
}

/**
 * Topic ids are positive integers. An empty string means "no topic" (post to
 * the chat's General topic) — that's what the form sends when the field is left
 * blank, and it must clear a previously set topic rather than be ignored.
 */
function validateThreadId(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n <= 0) throw new Error("invalid_thread_id");
  return n;
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const targets = await listTelegramTargets();
    return NextResponse.json({ data: targets.map(toPublicShape) });
  } catch (err) {
    console.error("[admin/telegram-push/targets GET]", err);
    return NextResponse.json({ error: "Failed to load targets" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
    if (!label || !chatId) {
      return NextResponse.json({ error: "label and chatId are required" }, { status: 400 });
    }

    const target = await createTelegramTarget({
      label,
      chatId,
      messageThreadId: validateThreadId(body.messageThreadId),
      botToken: typeof body.botToken === "string" ? body.botToken : undefined,
      messageLang: validateLang(body.messageLang),
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
      pushScreener: typeof body.pushScreener === "boolean" ? body.pushScreener : undefined,
      pushBriefing: typeof body.pushBriefing === "boolean" ? body.pushBriefing : undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
    });

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "create_telegram_target",
        targetType: "setting",
        targetId: target.id,
        oldValue: null,
        // Never log the token itself
        newValue: { label, chatId, botToken: body.botToken ? "[redacted]" : undefined },
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true, data: toPublicShape(target) });
  } catch (err) {
    if (err instanceof Error && err.message === "duplicate_chat_id") {
      return NextResponse.json({ error: "duplicate_chat_id" }, { status: 409 });
    }
    if (err instanceof Error && err.message === "invalid_thread_id") {
      return NextResponse.json({ error: "invalid_thread_id" }, { status: 400 });
    }
    console.error("[admin/telegram-push/targets POST]", err);
    return NextResponse.json({ error: "Failed to create target" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const target = await updateTelegramTarget(id, {
      label: typeof body.label === "string" ? body.label : undefined,
      chatId: typeof body.chatId === "string" ? body.chatId : undefined,
      messageThreadId: validateThreadId(body.messageThreadId),
      botToken: typeof body.botToken === "string" ? body.botToken : undefined,
      messageLang: validateLang(body.messageLang),
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      pushScreener: typeof body.pushScreener === "boolean" ? body.pushScreener : undefined,
      pushBriefing: typeof body.pushBriefing === "boolean" ? body.pushBriefing : undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
    });

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "update_telegram_target",
        targetType: "setting",
        targetId: id,
        oldValue: null,
        newValue: { ...body, botToken: body.botToken !== undefined ? "[redacted]" : undefined },
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true, data: toPublicShape(target) });
  } catch (err) {
    if (err instanceof Error && err.message === "duplicate_chat_id") {
      return NextResponse.json({ error: "duplicate_chat_id" }, { status: 409 });
    }
    if (err instanceof Error && err.message === "invalid_thread_id") {
      return NextResponse.json({ error: "invalid_thread_id" }, { status: 400 });
    }
    if (err instanceof Error && err.message === "target_not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[admin/telegram-push/targets PATCH]", err);
    return NextResponse.json({ error: "Failed to update target" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    await deleteTelegramTarget(id);

    try {
      await logAdminAction({
        adminId: auth.user.id,
        action: "delete_telegram_target",
        targetType: "setting",
        targetId: id,
        oldValue: null,
        newValue: null,
      });
    } catch {
      // Logging failure should never break the response
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[admin/telegram-push/targets DELETE]", err);
    return NextResponse.json({ error: "Failed to delete target" }, { status: 500 });
  }
}
