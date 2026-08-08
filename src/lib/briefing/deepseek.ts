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

/**
 * 单次调用超时。
 *
 * 曾经是 45 秒，而调用方最坏会串行打 3 次（同模型重试一次 + 换模型一次），
 * 合计 135 秒；承载它的路由 maxDuration=60，且本项目跑在 Vercel Hobby
 * ——60 秒是套餐上限、加钱以外无法调高。两次尝试就已经越界，被平台掐断时
 * 没有 insert、没有心跳、没有告警，整套降级阶梯（L3/L4/L5 都在生成步骤之后）
 * 被直接绕过。
 *
 * 后来降到 22 秒，配合 run.ts 的墙钟预算，理论上能在预算内跑完两次尝试。
 * 但线上实测推翻了这个假设：22 秒**不够生成一次**。第一次真跑的诊断里，
 * 除了 zh-CN 第一次侥幸返回，其余每一次调用都是 `This operation was aborted`，
 * 两轮超时把 48 秒预算吃光，第三次只剩 2 秒。等于重试阶梯从来没真正生效过，
 * 每天都直奔兜底稿。
 *
 * 现在取 34 秒：一次生成有充裕余量，且 34 + 落库/推送/心跳仍在 48 秒预算内。
 * 代价是超时那次几乎吃掉整个预算、没有第二次机会——这是有意的取舍：
 * 与其两次都来不及生成完，不如让一次真正跑完。快速失败（HTTP 4xx/5xx、
 * 空内容）耗时很短，那种情况下预算仍然够重试，MIN_CALL_BUDGET_MS 会放行。
 *
 * 调用方仍会把「剩余预算」作为上限二次收窄本值。
 */
export const DEFAULT_TIMEOUT_MS = 34_000;

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
