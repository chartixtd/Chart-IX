import { describe, it, expect } from "vitest";
import { parseBingXError, bingxErrorI18nKey, describeBingXError } from "./errors";

describe("parseBingXError", () => {
  it("extracts the numeric code from a signedRequest error", () => {
    const r = parseBingXError(new Error("BingX error 101204: insufficient margin"));
    expect(r.code).toBe(101204);
    expect(r.rawMessage).toBe("insufficient margin");
  });

  it("handles an error with an empty message body", () => {
    const r = parseBingXError(new Error("BingX error 100001: "));
    expect(r.code).toBe(100001);
    expect(r.rawMessage).toBe("");
  });

  it("returns a null code for a plain network error", () => {
    const r = parseBingXError(new Error("fetch failed"));
    expect(r.code).toBeNull();
    expect(r.rawMessage).toBe("fetch failed");
  });

  it("handles a non-Error value", () => {
    expect(parseBingXError("boom").code).toBeNull();
    expect(parseBingXError("boom").rawMessage).toBe("boom");
    expect(parseBingXError(undefined).rawMessage).toBe("");
  });
});

describe("bingxErrorI18nKey", () => {
  it("maps known codes to specific keys", () => {
    expect(bingxErrorI18nKey(100001)).toBe("bingx_error.signature");
    expect(bingxErrorI18nKey(100004)).toBe("bingx_error.no_permission");
    expect(bingxErrorI18nKey(100413)).toBe("bingx_error.invalid_key");
    expect(bingxErrorI18nKey(101204)).toBe("bingx_error.insufficient_margin");
    expect(bingxErrorI18nKey(109400)).toBe("bingx_error.invalid_params");
    expect(bingxErrorI18nKey(80014)).toBe("bingx_error.invalid_params");
  });

  it("falls back to the generic key for unknown codes", () => {
    expect(bingxErrorI18nKey(999999)).toBe("bingx_error.unknown");
  });

  it("falls back to the network key when there is no code", () => {
    expect(bingxErrorI18nKey(null)).toBe("bingx_error.network");
  });
});

describe("describeBingXError", () => {
  it("keeps the raw message alongside the i18n key so nothing is swallowed", () => {
    const d = describeBingXError(new Error("BingX error 101204: insufficient margin"));
    expect(d).toEqual({
      i18nKey: "bingx_error.insufficient_margin",
      code: 101204,
      rawMessage: "insufficient margin",
    });
  });
});
