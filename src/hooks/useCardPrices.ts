"use client";

import { useEffect, useRef, useState } from "react";
import { gunzipWsMessage } from "@/lib/bingx/ws-utils";
import { useLivePrices } from "./useLivePrices";

const SWAP_WS_URL = "wss://open-api-swap.bingx.com/swap-market";
const RECONNECT_DELAY_MS = 3_000;

/**
 * 警报卡的价格：BingX 永续行情推送，**亚秒级**。
 *
 * 为什么值得单独接 WebSocket 而不是继续 15 秒轮询：卡片上有一条失效价
 * （见 invalidation.ts），价格一穿就意味着这个信号被市场证伪、该停手了。
 * 轮询的话最坏要 15 秒才知道，而穿线那一刻往往正是行情最快的时候。
 * 实测 12 秒内单个 symbol 收到 30 条推送（约每 0.4 秒一跳）。
 *
 * 零成本：不占 CoinGlass 配额、不占扫描名额。交易页的订单簿和成交列表
 * 早就在用同一套 BingX 推送，只是警报栏此前没接上。
 *
 * **不复用 useBingXWebSocket**：那个连的是现货（open-api-ws/market），
 * 而这里要的是永续价格。现货和永续的 symbol 长得一模一样（BTC-USDT），
 * 拿错了不会报错、只会显示一个差之毫厘的错价——这种 bug 很难被发现，
 * 所以宁可各连各的，也不去改那个交易页正在依赖的共享连接。
 *
 * REST 轮询（useLivePrices）保留当兜底：断线重连的几秒里价格不至于冻住，
 * 页面刚打开、WS 还没推第一条时也靠它先把价格填上。
 */
export function useCardPrices(symbols: string[]): Record<string, number> {
  const rest = useLivePrices();
  const [live, setLive] = useState<Record<string, number>>({});

  // 用 ref 传递订阅集合，避免 symbols 数组每次渲染都是新引用而反复重连。
  // 真正决定要不要重连的是「集合内容变了没有」，不是数组身份。
  const key = [...symbols].sort().join(",");
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (list.length === 0) return;

    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(SWAP_WS_URL);

      ws.onopen = () => {
        for (const s of list) {
          ws?.send(JSON.stringify({ id: `${s}@lastPrice`, reqType: "sub", dataType: `${s}@lastPrice` }));
        }
      };

      ws.onmessage = async (ev) => {
        let text: string;
        if (typeof ev.data === "string") text = ev.data;
        else if (ev.data instanceof Blob) text = await gunzipWsMessage(await ev.data.arrayBuffer());
        else text = await gunzipWsMessage(ev.data as ArrayBuffer);

        // BingX 用明文 Ping/Pong 保活，不是 WS 协议层的 ping 帧——
        // 不回 Pong 会被服务端在一分钟内断开。
        if (text === "Ping") {
          ws?.send("Pong");
          return;
        }

        let msg: { dataType?: string; data?: { s?: string; c?: string } };
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        const sym = msg.data?.s;
        const price = msg.data?.c;
        if (!sym || price === undefined) return;
        const n = parseFloat(price);
        // 非法价格整条丢掉而不是落成 0：0 会让涨跌幅算出 -100%，
        // 在卡片上是一个刺眼且完全错误的数字。
        if (!Number.isFinite(n) || n <= 0) return;
        setLive((prev) => (prev[sym] === n ? prev : { ...prev, [sym]: n }));
      };

      ws.onclose = () => {
        if (closed) return;
        // 只有订阅集合没变时才重连——变了的话这个 effect 本来就要重跑，
        // 重连会白建一条随即被清理掉的连接。
        retry = setTimeout(() => {
          if (keyRef.current === key) connect();
        }, RECONNECT_DELAY_MS);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [key]);

  // WS 优先，缺的用 REST 兜底。合并方向不能反过来：REST 每 15 秒才刷一次，
  // 让它覆盖 WS 会把亚秒级的价格按回到十几秒前。
  return { ...rest.prices, ...live };
}
