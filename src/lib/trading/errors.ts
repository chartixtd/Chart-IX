/**
 * signedRequest 抛出的形如 "BingX error 101204: msg"。
 * 用 [\s\S] 而非 dotAll 的 s 标志——tsconfig 的 target 是 ES2017，
 * s 标志需要 ES2018（TS1501）。两者在这里行为等价：都能跨换行匹配。
 */
const BINGX_ERROR_PATTERN = /^BingX error (-?\d+):\s?([\s\S]*)$/;

const CODE_TO_KEY: Record<number, string> = {
  100001: "bingx_error.signature",
  100004: "bingx_error.no_permission",
  100413: "bingx_error.invalid_key",
  101204: "bingx_error.insufficient_margin",
  109400: "bingx_error.invalid_params",
  100400: "bingx_error.invalid_params",
  80014: "bingx_error.invalid_params",
  80012: "bingx_error.service_busy",
  80013: "bingx_error.service_busy",
};

export function parseBingXError(raw: unknown): { code: number | null; rawMessage: string } {
  const text =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : raw == null
          ? ""
          : String(raw);
  const match = BINGX_ERROR_PATTERN.exec(text);
  if (!match) return { code: null, rawMessage: text };
  return { code: Number(match[1]), rawMessage: match[2] ?? "" };
}

export function bingxErrorI18nKey(code: number | null): string {
  if (code === null) return "bingx_error.network";
  return CODE_TO_KEY[code] ?? "bingx_error.unknown";
}

/** 同时给出可翻译的 key 与原始信息——原文永远保留，便于排查未覆盖的错误码 */
export function describeBingXError(raw: unknown): {
  i18nKey: string;
  code: number | null;
  rawMessage: string;
} {
  const { code, rawMessage } = parseBingXError(raw);
  return { i18nKey: bingxErrorI18nKey(code), code, rawMessage };
}
