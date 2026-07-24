import { createHmac } from "crypto";
import JSONBig from "json-bigint";

const JSONBigParse = JSONBig({ storeAsString: true });

// Domain priority: .com primary; .pro fallback for network/timeout errors ONLY
const BASE_URLS: Record<string, [string, string]> = {
  "prod-live": ["https://open-api.bingx.com", "https://open-api.bingx.pro"],
  "prod-vst": ["https://open-api-vst.bingx.com", "https://open-api-vst.bingx.pro"],
};

function isNetworkOrTimeout(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (e instanceof Error && e.name === "TimeoutError") return true;
  return false;
}

function validateParams(params: Record<string, unknown>): void {
  const FORBIDDEN = /[&=?#\r\n]/;
  for (const [k, v] of Object.entries(params)) {
    const s = String(v);
    if (FORBIDDEN.test(s)) {
      throw new Error(`Parameter "${k}" contains forbidden character: "${s}"`);
    }
  }
}

function buildCanonical(params: Record<string, unknown>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
}

function encodeQueryValues(params: Record<string, unknown>, signature: string): string {
  const pairs = Object.keys(params)
    .sort()
    .map((k) => {
      const v = String(params[k]);
      const needsEncoding = v.includes("[") || v.includes("{");
      return `${k}=${needsEncoding ? encodeURIComponent(v) : v}`;
    });
  pairs.push(`signature=${signature}`);
  return pairs.join("&");
}

export type BingXEnv = "prod-live" | "prod-vst";

/**
 * Make a signed BingX REST request.
 * Follows BingX official authentication spec:
 * - Sorted params (ASCII), no URL encoding in signing string
 * - HMAC-SHA256 signature of canonical string
 * - POST: body = canonical&signature=<hex>, Content-Type: application/x-www-form-urlencoded
 * - GET/DELETE: URL query string = canonical&signature=<hex>
 */
export async function signedRequest<T>(
  apiKey: string,
  secret: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number> = {},
  env: BingXEnv = "prod-live"
): Promise<T> {
  const baseUrls = BASE_URLS[env] ?? BASE_URLS["prod-live"];
  const timestamp = Date.now();
  const allParams: Record<string, unknown> = { ...params, timestamp };
  validateParams(allParams);

  const canonical = buildCanonical(allParams);
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  const needsValueEncoding = canonical.includes("[") || canonical.includes("{");

  for (let i = 0; i < baseUrls.length; i++) {
    const base = baseUrls[i];
    try {
      let url: string;
      let body: string | undefined;

      if (method === "POST") {
        url = `${base}${path}`;
        body = `${canonical}&signature=${signature}`;
      } else {
        const query = needsValueEncoding
          ? encodeQueryValues(allParams, signature)
          : `${canonical}&signature=${signature}`;
        url = `${base}${path}?${query}`;
      }

      const res = await fetch(url, {
        method,
        headers: {
          "X-BX-APIKEY": apiKey,
          "X-SOURCE-KEY": "BX-AI-SKILL",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      const text = await res.text();
      const json = JSONBigParse.parse(text);

      if (json.code !== 0) {
        throw new Error(`BingX error ${json.code}: ${json.msg || "Unknown"}`);
      }

      return json.data as T;
    } catch (e) {
      if (!isNetworkOrTimeout(e) || i === baseUrls.length - 1) throw e;
      // Otherwise try fallback (.pro)
    }
  }

  throw new Error("BingX request failed: all base URLs exhausted");
}
