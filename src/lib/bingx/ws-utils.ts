/** GZIP decompress an ArrayBuffer to text. Shared by every BingX WebSocket
 *  connection (market ticker stream, user data stream) — BingX compresses
 *  every binary WS frame regardless of channel. */
export async function gunzipWsMessage(buf: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buf));
  writer.close();
  return new Response(ds.readable).text();
}
