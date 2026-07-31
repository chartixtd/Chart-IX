import { signedRequest } from "./signed-request";

/**
 * BingX 用户数据流（现货 spot.executionReport/ACCOUNT_UPDATE、合约
 * ORDER_TRADE_UPDATE/ACCOUNT_UPDATE）鉴权用的 listenKey 生命周期。
 * 现货与合约共用同一个 REST 端点，各自独立生成/续期/释放一把 key。
 */

interface ListenKeyResponse {
  listenKey: string;
}

export async function createListenKey(apiKey: string, secret: string): Promise<string> {
  const data = await signedRequest<ListenKeyResponse>(apiKey, secret, "POST", "/openApi/user/auth/userDataStream");
  return data.listenKey;
}

export async function extendListenKey(apiKey: string, secret: string, listenKey: string): Promise<void> {
  await signedRequest(apiKey, secret, "PUT", "/openApi/user/auth/userDataStream", { listenKey });
}

export async function deleteListenKey(apiKey: string, secret: string, listenKey: string): Promise<void> {
  await signedRequest(apiKey, secret, "DELETE", "/openApi/user/auth/userDataStream", { listenKey });
}
