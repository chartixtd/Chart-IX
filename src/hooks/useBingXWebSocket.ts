"use client";

import { useEffect, useRef } from "react";
import { useMarketStore } from "@/stores/market";
import type { BingXTicker } from "@/types/bingx";

const WS_URL = "wss://open-api-ws.bingx.com/market";
const RECONNECT_DELAY = 3_000;

/** Map raw WebSocket ticker data to BingXTicker */
function mapTicker(raw: Record<string, string>): BingXTicker {
  return {
    symbol: raw.s || raw.symbol || "",
    openPrice: raw.o || raw.openPrice || "0",
    highPrice: raw.h || raw.highPrice || "0",
    lowPrice: raw.l || raw.lowPrice || "0",
    lastPrice: raw.c || raw.lastPrice || "0",
    volume: raw.v || raw.volume || "0",
    quoteVolume: raw.q || raw.quoteVolume || "0",
    priceChange: raw.p || raw.priceChange || "0",
    priceChangePercent: raw.P || raw.priceChangePercent || "0",
  };
}

/** GZIP decompress an ArrayBuffer to text */
async function gunzip(buf: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buf));
  writer.close();
  return new Response(ds.readable).text();
}

export function useBingXWebSocket(symbols: string[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const { setTicker, setWsConnected } = useMarketStore();

  useEffect(() => {
    if (symbols.length === 0) return;

    let destroyed = false;
    let tickerCount = 0;
    let msgCount = 0;

    function connect() {
      if (destroyed) return;

      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) { ws.close(); return; }
        setWsConnected(true);
        console.log("[WS] connected, subscribing...");

        for (const sym of symbolsRef.current) {
          ws.send(JSON.stringify({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            reqType: "sub",
            dataType: `${sym}@ticker`,
          }));
        }
      };

      ws.onmessage = async (event) => {
        if (destroyed) return;

        let text: string;
        try {
          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            const buf = event.data as ArrayBuffer;
            if (buf.byteLength === 0) return;
            const raw = new TextDecoder().decode(buf);
            text = raw.startsWith("{") || raw.startsWith("[") ? raw : await gunzip(buf);
          } else {
            return;
          }
        } catch {
          return;
        }

        if (text === "Ping" || text.trim() === "Ping") { ws.send("Pong"); return; }

        let msg: { code?: number; dataType?: string; data?: unknown };
        try {
          msg = JSON.parse(text);
        } catch {
          if (event.data instanceof ArrayBuffer) {
            try {
              msg = JSON.parse(await gunzip(event.data as ArrayBuffer));
            } catch { return; }
          } else { return; }
        }

        if (msg.code === 0 && !msg.dataType) {
          msgCount++;
          return;
        }

        if (msg.code !== 0) return;
        if (!msg.dataType || !(msg.dataType as string).endsWith("@ticker")) return;

        const raw = msg.data;
        if (!raw) return;

        msgCount++;
        const items = Array.isArray(raw) ? raw : [raw];
        for (const item of items) {
          const ticker = mapTicker(item as Record<string, string>);
          if (ticker.symbol) {
            setTicker(ticker.symbol, ticker);
            tickerCount++;
          }
        }

        // Log first few for monitoring
        if (tickerCount <= 3 || tickerCount % 100 === 0) {
          const last = Array.isArray(raw) ? (raw[raw.length - 1] as Record<string,string>) : raw as Record<string,string>;
          console.log("[WS] ticker #" + tickerCount + ":", last.s, last.c);
        }
      };

      ws.onerror = () => {};
      ws.onclose = (evt) => {
        if (destroyed) return;
        console.log("[WS] closed, reconnecting in", RECONNECT_DELAY, "ms");
        setWsConnected(false);
        wsRef.current = null;
        reconnectRef.current = setTimeout(connect, RECONNECT_DELAY);
      };
    }

    connect();

    return () => {
      destroyed = true;
      setWsConnected(false);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; }
    };
  }, [symbols.join(",")]);
}
