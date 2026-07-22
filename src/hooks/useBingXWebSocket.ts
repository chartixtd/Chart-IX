"use client";

import { useEffect, useRef } from "react";
import { useMarketStore } from "@/stores/market";
import type { BingXTicker } from "@/types/bingx";

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

/**
 * Connect to BingX WebSocket for real-time market data.
 * @param symbols - list of symbols to subscribe (e.g. ["BTC-USDT", "ETH-USDT"])
 */
export function useBingXWebSocket(symbols: string[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;

  const { setTicker, setWsConnected } = useMarketStore();

  useEffect(() => {
    if (symbols.length === 0) return;

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

        // Subscribe to each symbol's ticker stream
        const currentSymbols = symbolsRef.current;
        for (const sym of currentSymbols) {
          ws.send(JSON.stringify({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            reqType: "sub",
            dataType: `${sym}@ticker`,
          }));
        }
      };

      ws.onmessage = (event) => {
        if (destroyed) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.code !== 0 || !msg.dataType) return;

          // Handle individual ticker push
          if (msg.dataType.endsWith("@ticker")) {
            const raw = msg.data;
            if (raw) {
              // Could be single object or array
              const items = Array.isArray(raw) ? raw : [raw];
              for (const item of items) {
                const ticker = mapTicker(item);
                if (ticker.symbol) {
                  setTicker(ticker.symbol, ticker);
                }
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
  }, [symbols.join(",")]); // re-connect when symbols list changes
}
