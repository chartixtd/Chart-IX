import { BINGX_API_BASE } from "@/lib/constants";

export class BingXClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = BINGX_API_BASE;
  }

  /**
   * 公开 API 请求 (无需签名)
   */
  async publicRequest<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(path, this.baseUrl);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-SOURCE-KEY": "BX-AI-SKILL",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`BingX API error (${response.status}): ${errorText}`);
    }

    const json = await response.json();

    // BingX 响应格式: { code: 0, data: ... }
    if (json.code !== undefined && json.code !== 0) {
      throw new Error(`BingX API error: ${json.msg || "Unknown error"}`);
    }

    return json.data ?? json;
  }
}

export const bingxClient = new BingXClient();
