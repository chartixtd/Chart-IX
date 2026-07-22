"use client";

import { useEffect, useRef } from "react";
import { useMarketStore } from "@/stores/market";
import type { BingXTicker, BingXKline } from "@/types/bingx";

const WS_URL = "wss://open-api-ws.bingx.com/market";
const RECONNECT_DELAY = 3_000;
const PING_INTERVAL = 30_000;

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
  // BingX kline push: { t, T, o, h, l, c, v, q }  or nested in K object
  const d = (raw.K || raw) as Record<string, unknown>;
  const openTime = Number(d.t ?? 0);
  const closeTime = Number(d.T ?? 0);
  const open = parseFloat(String(d.o ?? "0"));
  const high = parseFloat(String(d.h ?? "0"));
  const low = parseFloat(String(d.l ?? "0"));
  const close = parseFloat(String(d.c ?? "0"));
  const volume = parseFloat(String(d.v ?? "0"));
  const quoteVolume = parseFloat(String(d.q ?? "0"));

  if (!openTime || isNaN(open)) return null;

  return { openTime, open, high, low, close, volume, closeTime, quoteVolume };
}

interface KlineSub {
  symbol: string;
  interval: string;
}

/**
 * Connect to BingX WebSocket for real-time market data.
 * @param symbols - ticker symbols to subscribe (e.g. ["BTC-USDT", "ETH-USDT"])
 * @param klineSubs - kline subscriptions (e.g. [{ symbol: "BTC-USDT", interval: "1h" }])
 */
export function useBingXWebSocket(symbols: string[], klineSubs?: KlineSub[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) {
          ws.close();
          return;
        }
        setWsConnected(true);

        // Subscribe to ticker streams
        for (const sym of symbolsRef.current) {
          ws.send(JSON.stringify({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            reqType: "sub",
            dataType: `${sym}@ticker`,
          }));
        }

        // Subscribe to kline streams
        for (const ks of klineSubsRef.current) {
          ws.send(JSON.stringify({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            reqType: "sub",
            dataType: `${ks.symbol}@kline_${ks.interval}`,
          }));
        }
      };

      ws.onmessage = (event) => {
        if (destroyed) return;
        try {
          const msg = JSON.parse(event.data);
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

          // Handle kline push: dataType like "BTC-USDT@kline_1h"
          if (dataType.includes("@kline_")) {
            const match = dataType.match(/^(.+)@kline_(.+)$/);
            if (match) {
              const [, sym, interval] = match;
              const kline = mapKline(msg.data);
              if (kline) {
                setKline(sym, interval, kline);
              }
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        // will trigger onclose
      };

      ws.onclose = () => {
        if (destroyed) return;
        setWsConnected(false);
        wsRef.current = null;
        reconnectRef.current = setTimeout(connect, RECONNECT_DELAY);
      };
    }

    // Start ping loop
    pingRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send("Ping");
      }
    }, PING_INTERVAL);

    connect();

    return () => {
      destroyed = true;
      setWsConnected(false);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbols.join(","), JSON.stringify(klineSubs)]); // re-connect when subscriptions change
}
