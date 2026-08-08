/**
 * DeepSeek 客户端（OpenAI 兼容格式）。
 *
 * 模型名不硬编码：2026-08 官方模型线已换代为 deepseek-v4-flash / v4-pro，
 * deepseek-chat 与 deepseek-reasoner 已不在文档中，且官方公告称近期将上调价格。
 * 模型由调用方从环境变量传入，换代时改一个环境变量即可。
 *
 * 空内容是 DeepSeek 文档明示的已知问题（"The API may occasionally return
 * empty content"），这里归一成失败结果，由调用方重试或换模型。
 */

const API_URL = "https://api.deepseek.com/chat/completions";
const DEFAULT_MAX_TOKENS = 3000;
const DEFAULT_TIMEOUT_MS = 45_000;

export type DeepSeekResult =
  | { ok: true; content: string; finishReason: string | null }
  | { ok: false; error: string };

export async function callDeepSeek(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** 注入 fetch 便于测试 */
  fetchImpl?: typeof fetch;
}): Promise<DeepSeekResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await doFetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "user", content: opts.prompt }],
        response_format: { type: "json_object" },
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";

    if (!content.trim()) {
      return { ok: false, error: "DeepSeek 返回空内容" };
    }

    return { ok: true, content, finishReason: choice?.finish_reason ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
