"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gunzipWsMessage } from "@/lib/bingx/ws-utils";
import {
  parseFuturesStreamEvent,
  parseSpotStreamEvent,
  isListenKeyExpired,
  type StreamInvalidation,
} from "@/lib/bingx/user-stream-events";

const SPOT_WS_URL = "wss://open-api-ws.bingx.com/market";
const SWAP_WS_URL = "wss://open-api-swap.bingx.com/swap-market";
const KEEPALIVE_INTERVAL_MS = 30 * 60 * 1000; // BingX: 1h 有效期，每 30 分钟续期
const RECONNECT_DELAY_MS = 3_000;

interface UseUserDataStreamOptions {
  market: "spot" | "futures";
  /** false 时（未登录 / 未绑定 API Key / 当前不是这个市场）整体不建立连接 */
  enabled: boolean;
}

async function postJson<T>(url: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Request failed");
  return json.data as T;
}

/**
 * 打开一条 BingX 用户数据流连接（现货或合约二选一，取决于 market），收到
 * ORDER_TRADE_UPDATE / ACCOUNT_UPDATE / executionReport 时让对应的 React Query
 * 缓存立即失效重取，而不是等 30 秒的兜底轮询。
 *
 * 只应该在"这个市场当前对用户可见"时挂载（例如 FuturesInfoPanel 只在
 * market === "futures" 时渲染），不需要跨面板去重——同一时刻只有一个面板可见。
 */
export function useUserDataStream({ market, enabled }: UseUserDataStreamOptions): void {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const listenKeyRef = useRef<string | null>(null);
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    function invalidate(target: StreamInvalidation) {
      if (market === "futures") {
        if (target.orders) queryClient.invalidateQueries({ queryKey: ["trading", "futures-open-orders"] });
        if (target.positions) queryClient.invalidateQueries({ queryKey: ["trading", "futures-positions"] });
        if (target.balance) queryClient.invalidateQueries({ queryKey: ["trading", "futures-balance"] });
      } else {
        // 一笔成交既改变挂单状态也产生新的成交记录，两个缓存一起刷新
        if (target.orders) {
          queryClient.invalidateQueries({ queryKey: ["trading", "spot-open-orders"] });
          queryClient.invalidateQueries({ queryKey: ["trading", "spot-my-trades"] });
        }
        if (target.balance) queryClient.invalidateQueries({ queryKey: ["trading", "spot-balances"] });
      }
    }

    async function connect() {
      if (cancelled) return;
      let listenKey: string;
      try {
        const data = await postJson<{ listenKey: string }>("/api/bingx/user-stream");
        listenKey = data.listenKey;
      } catch {
        if (!cancelled) reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      if (cancelled) return;
      listenKeyRef.current = listenKey;

      const baseUrl = market === "spot" ? SPOT_WS_URL : SWAP_WS_URL;
      const ws = new WebSocket(`${baseUrl}?listenKey=${listenKey}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (market === "spot") {
          // 合约连接后自动推送，不需要订阅；现货需要显式订阅这两个频道
          ws.send(JSON.stringify({ id: `${Date.now()}-orders`, reqType: "sub", dataType: "spot.executionReport" }));
          ws.send(JSON.stringify({ id: `${Date.now()}-balance`, reqType: "sub", dataType: "ACCOUNT_UPDATE" }));
        }
      };

      ws.onmessage = async (event) => {
        let text: string;
        try {
          if (typeof event.data === "string") {
            text = event.data;
          } else if (event.data instanceof ArrayBuffer) {
            if (event.data.byteLength === 0) return;
            const raw = new TextDecoder().decode(event.data);
            text = raw.startsWith("{") || raw.startsWith("[") ? raw : await gunzipWsMessage(event.data);
          } else {
            return;
          }
        } catch {
          return;
        }

        if (text === "Ping" || text.trim() === "Ping") { ws.send("Pong"); return; }

        let msg: unknown;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }

        if (isListenKeyExpired(msg)) {
          ws.close();
          return;
        }

        const invalidation = market === "spot" ? parseSpotStreamEvent(msg) : parseFuturesStreamEvent(msg);
        if (invalidation) invalidate(invalidation);
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        if (wsRef.current !== ws) return; // 已经被更新的连接替代
        wsRef.current = null;
        if (!cancelled) reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      keepaliveTimerRef.current = setInterval(async () => {
        const key = listenKeyRef.current;
        if (!key) return;
        try {
          await fetch("/api/bingx/user-stream", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listenKey: key }),
          });
        } catch {
          // 续期失败：等 listenKeyExpired 推送或者下一次 onclose 触发重连即可，不需要在这里特殊处理
        }
      }, KEEPALIVE_INTERVAL_MS);
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (keepaliveTimerRef.current) clearInterval(keepaliveTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      const key = listenKeyRef.current;
      if (key) {
        fetch("/api/bingx/user-stream", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listenKey: key }),
        }).catch(() => {});
      }
    };
    // market 变化或 enabled 从 false→true 才需要重新建连接；queryClient 引用稳定不需要作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, enabled]);
}
