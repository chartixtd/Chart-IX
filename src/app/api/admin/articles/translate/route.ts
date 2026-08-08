import { NextRequest, NextResponse } from "next/server";
import type { Locale } from "@/types";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { translateText } from "@/lib/translate";

// ---------------------------------------------------------------------------
// Plain-text translation via Google Translate's public endpoint
// No HTML processing – the client handles all HTML structure preservation.
// ---------------------------------------------------------------------------

interface TranslateRequest {
  text: string;
  from: Locale;
  to: Locale;
}

function extractLang(locale: Locale): string {
  return locale.split("-")[0] ?? "en";
}

// ---------------------------------------------------------------------------
// POST /api/admin/articles/translate
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const body = (await request.json()) as TranslateRequest;

    if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json(
        { error: "text is required (non-empty string)" },
        { status: 400 }
      );
    }

    const validLocales: Locale[] = ["zh-CN", "en-US", "ms-MY"];
    if (!body.from || !validLocales.includes(body.from)) {
      return NextResponse.json(
        { error: `from must be one of: ${validLocales.join(", ")}` },
        { status: 400 }
      );
    }
    if (!body.to || !validLocales.includes(body.to)) {
      return NextResponse.json(
        { error: `to must be one of: ${validLocales.join(", ")}` },
        { status: 400 }
      );
    }

    const fromLang = extractLang(body.from);
    const toLang = extractLang(body.to);

    if (fromLang === toLang) {
      return NextResponse.json({ translated: body.text });
    }

    const translated = await translateText(body.text, fromLang, toLang);

    return NextResponse.json({
      translated: translated ?? body.text,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
