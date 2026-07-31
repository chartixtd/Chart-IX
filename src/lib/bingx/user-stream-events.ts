/**
 * 把 BingX 用户数据流推送的原始消息翻译成"该刷新哪些前端缓存"，不做网络 I/O，
 * 纯函数方便单测。现货和合约的消息形状不同：
 * - 合约（swap）：连接后自动推送，消息顶层直接带 `e` 字段，没有 dataType 包装
 *   （见 BingX swap-ws-account 文档：ORDER_TRADE_UPDATE / ACCOUNT_UPDATE /
 *   listenKeyExpired 都是顶层 `e`）。
 * - 现货（spot）：文档里 executionReport 的字段表写的是 `data.e` 前缀（暗示走
 *   ticker 那种 `{dataType, data}` 包装），但 ACCOUNT_UPDATE 那节的字段表又直接
 *   写顶层 `e`，两节自相矛盾。这里两种形状都识别，实现联调时应对照真实连接抓包
 *   确认实际形状，但无论哪种形状，下面的解析都能正确分派。
 */

export interface StreamInvalidation {
  orders: boolean;
  positions: boolean;
  balance: boolean;
}

interface FuturesRawEvent {
  e?: string;
}

export function isListenKeyExpired(raw: unknown): boolean {
  return (raw as FuturesRawEvent | null)?.e === "listenKeyExpired";
}

export function parseFuturesStreamEvent(raw: unknown): StreamInvalidation | null {
  const e = (raw as FuturesRawEvent | null)?.e;
  if (e === "ORDER_TRADE_UPDATE") return { orders: true, positions: true, balance: false };
  if (e === "ACCOUNT_UPDATE") return { orders: false, positions: true, balance: true };
  return null;
}

interface SpotRawEvent {
  dataType?: string;
  data?: { e?: string };
  e?: string;
}

export function parseSpotStreamEvent(raw: unknown): StreamInvalidation | null {
  const msg = raw as SpotRawEvent | null;
  if (!msg) return null;

  const dataType = msg.dataType;
  const innerEvent = msg.data?.e ?? msg.e;

  if (dataType === "ACCOUNT_UPDATE" || innerEvent === "ACCOUNT_UPDATE") {
    return { orders: false, positions: false, balance: true };
  }
  if (dataType === "spot.executionReport" || innerEvent === "executionReport") {
    return { orders: true, positions: false, balance: false };
  }
  return null;
}
