"use client";

import { useEffect, useRef } from "react";
import { useMarketStore } from "@/stores/market";
import type { BingXTicker, BingXKline } from "@/types/bingx";

const WS_URL = "wss://open-api-ws.bingx.com/market";
const RECONNECT_DELAY = 3_000;

/** BingX WebSocket spot kline uses "min" suffix, not "m" */
function toWsInterval(interval: string): string {
  if (interval.endsWith("m") && !interval.endsWith("min")) {
    return interval.replace(/m$/, "min");
  }
  return interval;
}

/** Convert WS interval back to internal format (e.g., "1min" → "1m") */
function fromWsInterval(wsIntv: string): string {
  if (wsIntv.endsWith("min")) {
    return wsIntv.replace(/min$/, "m");
  }
  return wsIntv;
}

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

/** Map raw WebSocket kline data to BingXKline */
function mapKline(raw: Record<string, unknown>): BingXKline | null {
  if (!raw || typeof raw !== "object") return null;

  // BingX kline push: data.K.{t,T,o,h,l,c,v} (nested) or flat data.{t,T,o,h,l,c,v}
  const d = (raw.K || raw) as Record<string, unknown>;
  if (!d || typeof d !== "object") return null;

  let rawTime = d.t;
  if (rawTime === undefined || rawTime === null) return null;

  // Auto-detect time unit: if < 1e10, it's probably seconds → convert to ms
  let openTime = Number(rawTime);
  if (isNaN(openTime) || openTime <= 0) return null;
  if (openTime < 1e10) openTime *= 1000;

  const closeTime = Number(d.T ?? (openTime + 60000));
  const open = parseFloat(String(d.o ?? "0"));
  const high = parseFloat(String(d.h ?? "0"));
  const low = parseFloat(String(d.l ?? "0"));
  const close = parseFloat(String(d.c ?? "0"));
  const volume = parseFloat(String(d.v ?? "0"));
  const quoteVolume = parseFloat(String(d.q ?? "0"));

  if (isNaN(open)) return null;

  return { openTime, open, high, low, close, volume, closeTime, quoteVolume };
}

/** GZIP decompress an ArrayBuffer to text */
async function gunzip(buf: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buf));
  writer.close();
  return new Response(ds.readable).text();
}

interface KlineSub {
  symbol: string;
  interval: string;
}

export function useBingXWebSocket(symbols: string[], klineSubs?: KlineSub[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symbolsRef = useRef(symbols);
  const klineSubsRef = useRef(klineSubs ?? []);
  symbolsRef.current = symbols;
  klineSubsRef.current = klineSubs ?? [];

  const { setTicker, setKline, setWsConnected } = useMarketStore();

  useEffect(() => {
    if (symbols.length === 0 && klineSubsRef.current.length === 0) return;

    let destroyed = false;
    let tickerCount = 0;
    let klineCount = 0;
    let msgCount = 0;

    function connect() {
      if (destroyed) return;

      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) {
          ws.close();
          return;
        }
        setWsConnected(true);
        console.log("[WS] connected, subscribing...");

        for (const sym of symbolsRef.current) {
          console.log("[WS] subscribing ticker:", `${sym}@ticker`);
          ws.send(JSON.stringify({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            reqType: "sub",
            dataType: `${sym}@ticker`,
          }));
        }

        for (const ks of klineSubsRef.current) {
          const dt = `${ks.symbol}@kline_${toWsInterval(ks.interval)}`;
          console.log("[WS] subscribing kline:", dt);
          ws.send(JSON.stringify({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            reqType: "sub",
            dataType: dt,
          }));
        }
      };

      ws.onmessage = async (event) => {
        if (destroyed) return;

        // Get text: try raw first, decompress if needed
        let text: string;
        try {
          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            const buf = event.data as ArrayBuffer;
            if (buf.byteLength === 0) return;

            // Try raw decode first (some WS may not actually compress)
            const raw = new TextDecoder().decode(buf);
            // Check if it looks like JSON
            if (raw.startsWith("{") || raw.startsWith("[")) {
              text = raw;
            } else {
              // It's binary — decompress
              text = await gunzip(buf);
            }
          } else {
            return; // unknown type
          }
        } catch {
          return;
        }

        // Handle text Ping from server
        if (text === "Ping" || text.trim() === "Ping") {
          ws.send("Pong");
          return;
        }

        // Parse JSON
        let msg: { code?: number; dataType?: string; data?: unknown };
        try {
          msg = JSON.parse(text);
        } catch {
          // Try GZIP decompress as fallback (text might still be binary)
          if (event.data instanceof ArrayBuffer) {
            try {
              text = await gunzip(event.data as ArrayBuffer);
              msg = JSON.parse(text);
            } catch {
              return;
            }
          } else {
            return;
          }
        }

        // Log subscription confirmations (no dataType)
        if (msg.code === 0 && !msg.dataType) {
          console.log("[WS] subscription ok, id:", (msg as Record<string,unknown>).id);
          msgCount++;
          return;
        }

        // Log error responses (subscription rejected, etc.)
        if (msg.code !== 0) {
          console.log("[WS] error response:", msg);
          return;
        }

        if (!msg.dataType) return;

        const dataType = msg.dataType as string;
        const raw = msg.data;

        // Log every dataType received (first 20, then every 20th)
        msgCount++;
        if (msgCount <= 20 || msgCount % 50 === 0) {
          console.log("[WS] msg #" + msgCount + " dataType:", dataType);
        }

        // --- Ticker push ---
        if (dataType.endsWith("@ticker") && raw) {
          const items = Array.isArray(raw) ? raw : [raw];
          for (const item of items) {
            const ticker = mapTicker(item as Record<string, string>);
            if (ticker.symbol) {
              setTicker(ticker.symbol, ticker);
              tickerCount++;
              if (tickerCount <= 3 || tickerCount % 20 === 0) {
                console.log("[WS] ticker:", ticker.symbol, ticker.lastPrice);
              }
            }
          }
        }

        // --- Kline push ---
        if (dataType.includes("@kline_") && raw) {
          const match = dataType.match(/^(.+)@kline_(.+)$/);
          if (match) {
            const [, sym, wsIntv] = match;
            const kline = mapKline(raw as Record<string, unknown>);
            if (kline) {
              klineCount++;
              if (klineCount <= 3 || klineCount % 20 === 0) {
                console.log("[WS] kline #" + klineCount + ":", sym, wsIntv, kline.close);
              }
              setKline(sym, fromWsInterval(wsIntv), kline);
            }
          }
        }
      };

      ws.onerror = () => {
        // will trigger onclose
      };

      ws.onclose = (evt) => {
        if (destroyed) return;
        console.log("[WS] closed (code:", evt.code, "), reconnecting in", RECONNECT_DELAY, "ms");
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
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbols.join(","), JSON.stringify(klineSubs)]);
}
