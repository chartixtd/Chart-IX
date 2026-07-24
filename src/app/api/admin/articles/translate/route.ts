import { NextRequest, NextResponse } from "next/server";
import type { Locale } from "@/types";

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

/**
 * Google Translate free endpoint. Returns translated text or null on failure.
 * Handles newlines by temporarily replacing them so they survive translation.
 */
async function translateText(
  text: string,
  fromLang: string,
  toLang: string
): Promise<string | null> {
  // Protect newlines: replace \n with a marker Google Translate won't strip.
  // Using full-width brackets + "NL" – treated as a non-translatable token.
  const NL_MARKER = "\uFF3B" + "NL" + "\uFF3D"; // 【NL】using full-width brackets
  const prepared = text.replace(/\n/g, NL_MARKER);

  try {
    const url =
      `https://translate.googleapis.com/translate_a/single` +
      `?client=gtx&sl=${fromLang}&tl=${toLang}&dt=t` +
      `&q=${encodeURIComponent(prepared)}`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();

    // Response format: [[["translated","original",...],...],...]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0]
        .map((seg: unknown[]) =>
          seg && typeof seg[0] === "string" ? seg[0] : ""
        )
        .join("");

      if (translated) {
        // Restore newlines
        return translated.replace(new RegExp(NL_MARKER.replace(/[\[\]]/g, "\\$&"), "g"), "\n");
      }
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
