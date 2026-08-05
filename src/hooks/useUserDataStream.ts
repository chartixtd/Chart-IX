"use client";

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
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
const RECONNECT_BASE_DELAY_MS = 3_000;
const RECONNECT_MAX_DELAY_MS = 60_000;

interface UseUserDataStreamOptions {
  market: "spot" | "futures";
  /** false 时（未登录 / 未绑定 API Key / 当前不是这个市场）整体不建立连接 */
  enabled: boolean;
}

/**
 * Single shared listenKey/WebSocket connection per market ("spot" or
 * "futures"), ref-counted across however many mounted components currently
 * want it. This exists because `trade/page.tsx` mounts both a desktop and a
 * mobile layout simultaneously (only CSS display toggles which is visible),
 * so both `FuturesInfoPanel`/`OrdersPanel` instances call `useUserDataStream`
 * for the same market at the same time — without ref-counting, that means
 * two independent listenKeys and two independent WebSockets, and closing one
 * component's connection could tear down state the other still depends on.
 *
 * Modeled after `BingXWebSocketManager` in useBingXWebSocket.ts.
 *
 * `generation` is bumped every time the manager tears down (refCount hits
 * zero). Any in-flight async work (the create-listenKey fetch, its JSON
 * parse) captures the generation it started with and re-checks it after each
 * await; if the generation has moved on, that work discards its result
 * (releasing a listenKey it just created rather than writing it into fields
 * a newer connection attempt may already be using). This replaces the old
 * per-hook-instance "ownership token" from earlier revisions of this file —
 * that token existed because two separate *effect instances* could race to
 * own the same refs; now the manager instance is the single owner of its own
 * connection lifecycle regardless of how many hook calls are subscribed, so
 * the only race left to guard is "stale async work from a previous
 * connection attempt", which the generation counter covers.
 */
class UserDataStreamManager {
  private readonly market: "spot" | "futures";
  private ws: WebSocket | null = null;
  private listenKey: string | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private refCount = 0;
  private generation = 0;
  private queryClient: QueryClient | null = null;

  constructor(market: "spot" | "futures") {
    this.market = market;
  }

  subscribe(queryClient: QueryClient): () => void {
    const wasZero = this.refCount === 0;
    this.refCount++;
    if (wasZero) {
      this.queryClient = queryClient;
      this.connect(this.generation);
    }

    let released = false;
    return () => {
      if (released) return; // defense-in-depth: cleanup should only ever run once per subscribe()
      released = true;
      this.refCount = Math.max(0, this.refCount - 1);
      if (this.refCount === 0) this.teardown();
    };
  }

  private invalidate(target: StreamInvalidation) {
    const queryClient = this.queryClient;
    if (!queryClient) return;
    if (this.market === "futures") {
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

  private scheduleReconnect(gen: number) {
    if (gen !== this.generation) return;
    // 持续失败（比如 BingX 一直 5xx）时用指数退避封顶重试间隔，避免固定 3s
    // 死循环刷屏控制台、反复冲击一个已经在失败的接口
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_DELAY_MS
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connect(gen), delay);
  }

  private async connect(gen: number) {
    if (gen !== this.generation) return;

    let res: Response;
    try {
      res = await fetch("/api/bingx/user-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      // Network-level failure (no HTTP response at all) — transient, worth retrying.
      this.scheduleReconnect(gen);
      return;
    }
    if (gen !== this.generation) return; // torn down / superseded while awaiting the response

    // 401 (not logged in) / 400 (no valid API key on file) are auth-class
    // failures that will never succeed by simply retrying — give up instead
    // of looping forever. Anything else (network error above, or a 5xx from
    // the route wrapping a BingX API failure) is presumed transient and
    // still gets retried.
    if (res.status === 401 || res.status === 400) {
      return;
    }
    if (!res.ok) {
      // 只在第一次失败时打一条 warn：具体原因（比如 BingX 侧的错误信息）在
      // 响应体里，控制台默认只看得到 "502" 这一行，不打出来的话完全没法
      // 从浏览器端诊断是签名问题、key 失效还是 BingX 那边的问题
      if (this.reconnectAttempt === 0) {
        res
          .json()
          .then((body) => console.warn(`[user-stream:${this.market}] ${res.status}`, body))
          .catch(() => console.warn(`[user-stream:${this.market}] ${res.status} (no JSON body)`));
      }
      this.scheduleReconnect(gen);
      return;
    }

    let json: { success?: boolean; data?: { listenKey: string } };
    try {
      json = await res.json();
    } catch {
      this.scheduleReconnect(gen);
      return;
    }
    if (gen !== this.generation) return; // torn down / superseded while awaiting the JSON body

    if (!json.success || !json.data?.listenKey) {
      this.scheduleReconnect(gen);
      return;
    }
    const listenKey = json.data.listenKey;

    // 成功拿到 listenKey 说明这一轮失败已经结束，退避计数清零，下次真正断线
    // 重连时重新从 3s 起步，而不是延续之前失败累积的长间隔
    this.reconnectAttempt = 0;
    this.listenKey = listenKey;

    const baseUrl = this.market === "spot" ? SPOT_WS_URL : SWAP_WS_URL;
    const ws = new WebSocket(`${baseUrl}?listenKey=${listenKey}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      if (this.market === "spot") {
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

      const invalidation = this.market === "spot" ? parseSpotStreamEvent(msg) : parseFuturesStreamEvent(msg);
      if (invalidation) this.invalidate(invalidation);
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return; // 已经被更新的连接替代
      this.ws = null;
      this.scheduleReconnect(gen);
    };

    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.keepaliveTimer = setInterval(async () => {
      const key = this.listenKey;
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

  private teardown() {
    this.generation++; // invalidate any in-flight connect() from this point on
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    const key = this.listenKey;
    if (key) {
      this.listenKey = null;
      fetch("/api/bingx/user-stream", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listenKey: key }),
      }).catch(() => {});
    }
  }
}

const spotManager = typeof window !== "undefined" ? new UserDataStreamManager("spot") : null;
const futuresManager = typeof window !== "undefined" ? new UserDataStreamManager("futures") : null;

function getManager(market: "spot" | "futures"): UserDataStreamManager | null {
  return market === "spot" ? spotManager : futuresManager;
}

/**
 * 打开（或加入一个已有的）BingX 用户数据流连接（现货或合约二选一，取决于
 * market），收到 ORDER_TRADE_UPDATE / ACCOUNT_UPDATE / executionReport 时让
 * 对应的 React Query 缓存立即失效重取，而不是等 30 秒的兜底轮询。
 *
 * 同一个 market 可能同时有多个组件挂载（例如 trade 页面的桌面/移动两套布局
 * 都会渲染同一个面板），这些调用共享同一条底层连接——由模块级单例
 * UserDataStreamManager 做引用计数，只有最后一个订阅者卸载时才真正断开。
 */
export function useUserDataStream({ market, enabled }: UseUserDataStreamOptions): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const manager = getManager(market);
    if (!manager) return;
    return manager.subscribe(queryClient);
    // market 变化或 enabled 从 false→true 才需要重新订阅；queryClient 引用稳定不需要作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, enabled]);
}
