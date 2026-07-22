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
  if (openTime < 1e10) openTime *= 1000; // seconds → milliseconds

  const closeTime = Number(d.T ?? (openTime + 60000));
  const open = parseFloat(String(d.o ?? "0"));
  const high = parseFloat(String(d.h ?? "0"));
  const low = parseFloat(String(d.l ?? "0"));
  const close = parseFloat(String(d.c ?? "0"));
  const volume = parseFloat(String(d.v ?? "0"));
  const quoteVolume = parseFloat(String(d.q ?? "0"));

  if (isNaN(open)) return null;

  console.debug("[WS] kline:", { sym: raw.s || (raw as Record<string,unknown>).s, openTime, open, high, low, close, volume });

  return { openTime, open, high, low, close, volume, closeTime, quoteVolume };
}

/** GZIP decompress a binary WebSocket message to text */
async function decompress(data: Blob | ArrayBuffer): Promise<string> {
  const stream = data instanceof Blob
    ? data.stream()
    : new Blob([data]).stream();

  const ds = new DecompressionStream("gzip");
  const decompressed = stream.pipeThrough(ds);
  return new Response(decompressed).text();
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

    function connect() {
      if (destroyed) return;

      const ws = new WebSocket(WS_URL);
      // Receive binary for GZIP decompression
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) {
          ws.close();
          return;
        }
        setWsConnected(true);
        console.debug("[WS] connected, subscribing...");

        // Subscribe to ticker streams
        for (const sym of symbolsRef.current) {
          const msg = JSON.stringify({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            reqType: "sub",
            dataType: `${sym}@ticker`,
          });
          console.debug("[WS] sub ticker:", `${sym}@ticker`);
          ws.send(msg);
        }

        // Subscribe to kline streams
        for (const ks of klineSubsRef.current) {
          const dt = `${ks.symbol}@kline_${toWsInterval(ks.interval)}`;
          const msg = JSON.stringify({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            reqType: "sub",
            dataType: dt,
          });
          console.debug("[WS] sub kline:", dt);
          ws.send(msg);
        }
      };

      ws.onmessage = async (event) => {
        if (destroyed) return;
        try {
          // BingX sends GZIP-compressed messages — decompress before parsing
          let text: string;
          if (event.data instanceof ArrayBuffer && (event.data as ArrayBuffer).byteLength > 0) {
            text = await decompress(event.data as ArrayBuffer);
          } else if (typeof event.data === "string") {
            text = event.data;
          } else {
            // Blob or other binary
            text = await decompress(event.data as Blob);
          }

          // Handle text Ping from server
          if (text === "Ping" || text.trim() === "Ping") {
            console.debug("[WS] received Ping, sending Pong");
            ws.send("Pong");
            return;
          }

          const msg = JSON.parse(text);
          if (msg.code !== 0 || !msg.dataType) return;

          const dataType = msg.dataType as string;

          // Handle ticker push
          if (dataType.endsWith("@ticker")) {
            const raw = msg.data;
            if (raw) {
              const items = Array.isArray(raw) ? raw : [raw];
              for (const item of items) {
                const ticker = mapTicker(item);
                if (ticker.symbol) {
                  setTicker(ticker.symbol, ticker);
                }
              }
            }
          }

          // Handle kline push: dataType like "BTC-USDT@kline_1min"
          if (dataType.includes("@kline_")) {
            const match = dataType.match(/^(.+)@kline_(.+)$/);
            if (match) {
              const [, sym, wsIntv] = match;
              const kline = mapKline(msg.data);
              if (kline) {
                // Store with internal interval format (e.g., "1m") so KlineChart can read it
                setKline(sym, fromWsInterval(wsIntv), kline);
              }
            }
          }
        } catch (err) {
          console.debug("[WS] message parse error:", err);
        }
      };

      ws.onerror = (err) => {
        console.debug("[WS] error:", err);
      };

      ws.onclose = (evt) => {
        if (destroyed) return;
        console.debug("[WS] closed, reconnecting in", RECONNECT_DELAY, "ms");
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
