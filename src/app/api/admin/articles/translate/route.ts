import { NextRequest, NextResponse } from "next/server";
import type { Locale } from "@/types";

// ---------------------------------------------------------------------------
// Free translation via Google Translate's public endpoint
// ---------------------------------------------------------------------------

interface TranslateRequest {
  text: string;
  from: Locale;
  to: Locale;
}

interface TranslateResponse {
  translated: string;
}

/** Extract the language code (e.g. "en" from "en-US") */
function extractLang(locale: Locale): string {
  return locale.split("-")[0] ?? "en";
}

/**
 * Try Google Translate's free endpoint (used by the browser extension).
 * Returns translated text, or null on failure.
 */
async function tryGoogleTranslate(
  text: string,
  fromLang: string,
  toLang: string
): Promise<string | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);

    if (!res.ok) return null;

    const data = await res.json();
    // data is an array: data[0] is an array of segments, each segment is [translated, original, ...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0]
        .map((seg: unknown[]) => (seg && typeof seg[0] === "string" ? seg[0] : ""))
        .join("");
      if (translated) return translated;
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/articles/translate
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TranslateRequest;

    // --- Validate ---

    if (
      !body.text ||
      typeof body.text !== "string" ||
      body.text.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "text is required (non-empty string)" },
        { status: 400 }
      );
    }

    const validLocales: Locale[] = ["zh-CN", "en-US", "ms-MY"];
    if (!body.from || !validLocales.includes(body.from)) {
      return NextResponse.json(
        {
          error: `from must be one of: ${validLocales.join(", ")}`,
        },
        { status: 400 }
      );
    }
    if (!body.to || !validLocales.includes(body.to)) {
      return NextResponse.json(
        {
          error: `to must be one of: ${validLocales.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // If source and target are the same language family, just return the text
    const fromLang = extractLang(body.from);
    const toLang = extractLang(body.to);

    if (fromLang === toLang) {
      return NextResponse.json({
        translated: body.text,
      } satisfies TranslateResponse);
    }

    // --- Translate ---

    const translated = await tryGoogleTranslate(body.text, fromLang, toLang);

    if (translated) {
      return NextResponse.json({
        translated,
      } satisfies TranslateResponse);
    }

    // --- Fallback: return original text ---

    return NextResponse.json({
      translated: body.text,
    } satisfies TranslateResponse);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
