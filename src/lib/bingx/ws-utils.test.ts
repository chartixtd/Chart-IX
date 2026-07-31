import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { gunzipWsMessage } from "./ws-utils";

describe("gunzipWsMessage", () => {
  it("decompresses a gzip-compressed ArrayBuffer back to its original text", async () => {
    const original = JSON.stringify({ dataType: "BTC-USDT@ticker", data: { c: "63000" } });
    const compressed = gzipSync(Buffer.from(original));
    const arrayBuffer = compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);

    const result = await gunzipWsMessage(arrayBuffer as ArrayBuffer);
    expect(result).toBe(original);
  });
});
