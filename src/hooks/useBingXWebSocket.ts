"use client";

import { useEffect } from "react";
import { useMarketStore } from "@/stores/market";
import type { BingXTicker } from "@/types/bingx";
import { gunzipWsMessage } from "@/lib/bingx/ws-utils";
import { symbolFromDepthChannel } from "@/lib/bingx/depth";

const WS_URL = "wss://open-api-ws.bingx.com/market";
const RECONNECT_DELAY = 3_000;
const isDev = process.env.NODE_ENV !== "production";

// 实测：现货 WS 只接受 `SYMBOL@depth20` 这种不带间隔后缀的订阅；
// `@depth20@500ms` 之类的间隔后缀会被服务端拒绝（code 100400）。
const DEPTH_CHANNEL = "depth20";
const DEPTH_CHANNEL_SUFFIX = "@" + DEPTH_CHANNEL;

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
    // WS pushes are live ticks with no separate snapshot timestamp in the
    // payload we read here, so "now" (receipt time) is the accurate value —
    // this is display-only data, not the REST-sourced price used for risk
    // valuation in preflight.ts, which does its own closeTime freshness check.
    closeTime: Date.now(),
  };
}

function subMsg(reqType: "sub" | "unsub", dataType: string) {
  return JSON.stringify({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    reqType,
    dataType,
  });
}

/**
 * Single shared WebSocket connection for the whole app, ref-counted per symbol.
 * Multiple components can call useBingXWebSocket() with overlapping symbol sets
 * without opening extra connections or tearing the connection down on reorder —
 * only the actual symbol set (not array identity/order) matters.
 */
class BingXWebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refCounts = new Map<string, number>();
  private tickerCount = 0;

  subscribe(dataTypes: string[]): () => void {
    const added: string[] = [];
    for (const dt of dataTypes) {
      const count = this.refCounts.get(dt) ?? 0;
      this.refCounts.set(dt, count + 1);
      if (count === 0) added.push(dt);
    }

    if (!this.ws) {
      this.connect();
    } else if (this.ws.readyState === WebSocket.OPEN && added.length > 0) {
      for (const dt of added) this.ws.send(subMsg("sub", dt));
    }

    return () => {
      const removed: string[] = [];
      for (const dt of dataTypes) {
        const count = (this.refCounts.get(dt) ?? 1) - 1;
        if (count <= 0) {
          this.refCounts.delete(dt);
          removed.push(dt);
        } else {
          this.refCounts.set(dt, count);
        }
      }

      for (const dt of removed) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(subMsg("unsub", dt));
        // 退订后不再有数据流入，留着会让"是否有行情"判断永久为真、并展示陈旧盘口
        const depthSym = symbolFromDepthChannel(dt, DEPTH_CHANNEL_SUFFIX);
        if (depthSym) {
          useMarketStore.getState().removeDepth(depthSym);
          continue;
        }
        if (dt.endsWith("@ticker")) {
          const sym = dt.slice(0, dt.length - "@ticker".length);
          if (sym) useMarketStore.getState().removeTicker(sym);
        }
      }

      if (this.refCounts.size === 0) this.disconnect();
    };
  }

  private connect() {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      useMarketStore.getState().setWsConnected(true);
      if (isDev) console.log("[WS] connected, subscribing...");
      for (const dt of this.refCounts.keys()) ws.send(subMsg("sub", dt));
    };

    ws.onmessage = async (event) => {
      let text: string;
      try {
        if (typeof event.data === "string") {
          text = event.data;
        } else if (event.data instanceof ArrayBuffer) {
          const buf = event.data as ArrayBuffer;
          if (buf.byteLength === 0) return;
          const raw = new TextDecoder().decode(buf);
          text = raw.startsWith("{") || raw.startsWith("[") ? raw : await gunzipWsMessage(buf);
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
            msg = JSON.parse(await gunzipWsMessage(event.data as ArrayBuffer));
          } catch { return; }
        } else { return; }
      }

      if (msg.code === 0 && !msg.dataType) return;
      if (msg.code !== 0) return;
      const dt = msg.dataType as string | undefined;
      if (!dt) return;

      const depthSym = symbolFromDepthChannel(dt, DEPTH_CHANNEL_SUFFIX);
      if (depthSym) {
        const d = msg.data as { asks?: [string, string][]; bids?: [string, string][] } | undefined;
        if (!d?.asks || !d?.bids) return;
        useMarketStore.getState().setDepth(depthSym, { asks: d.asks, bids: d.bids });
        return;
      }

      if (!dt.endsWith("@ticker")) return;

      const raw = msg.data;
      if (!raw) return;

      const items = Array.isArray(raw) ? raw : [raw];
      const { setTicker } = useMarketStore.getState();
      for (const item of items) {
        const ticker = mapTicker(item as Record<string, string>);
        if (ticker.symbol) {
          setTicker(ticker.symbol, ticker);
          this.tickerCount++;
        }
      }

      if (isDev && (this.tickerCount <= 3 || this.tickerCount % 500 === 0)) {
        const last = Array.isArray(raw) ? (raw[raw.length - 1] as Record<string, string>) : raw as Record<string, string>;
        console.log("[WS] ticker #" + this.tickerCount + ":", last.s, last.c);
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      useMarketStore.getState().setWsConnected(false);
      if (this.ws !== ws) return; // already superseded by a newer connection
      // 断线瞬间 depths 里全是旧快照；不清空的话 useOrderBook 会在 wsConnected
      // 重新变 true 之前的这段时间里继续把它们当"有效数据"展示（陈旧盘口）。
      // ticker 不清：价格显示保留最后已知值是既有行为，且 useSpotTicker 有 REST 兜底。
      useMarketStore.getState().clearDepths();
      this.ws = null;
      if (this.refCounts.size > 0) {
        if (isDev) console.log("[WS] closed, reconnecting in", RECONNECT_DELAY, "ms");
        this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY);
      }
    };
  }

  private disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    useMarketStore.getState().setWsConnected(false);
  }
}

const manager = typeof window !== "undefined" ? new BingXWebSocketManager() : null;

export function useBingXWebSocket(symbols: string[]) {
  const key = symbols.slice().sort().join(",");

  useEffect(() => {
    if (!manager || symbols.length === 0) return;
    return manager.subscribe(symbols.map((s) => s + "@ticker"));
    // Re-subscribe only when the actual symbol SET changes, not on reorder —
    // `key` (sorted) is the real dependency; `symbols` array identity is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** 订阅单个交易对的盘口推送；数据进 useMarketStore.depths。 */
export function useBingXDepth(symbol: string | null) {
  useEffect(() => {
    if (!manager || !symbol) return;
    return manager.subscribe([`${symbol}${DEPTH_CHANNEL_SUFFIX}`]);
  }, [symbol]);
}
