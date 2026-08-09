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
/**
 * 输出 token 上限。
 *
 * 与 prompt.ts 的 SECTION_TARGET_MAX 是一对：prompt 要求的篇幅必须留有余量地
 * 装进这个数，否则模型写到上限被截断（finish_reason=length），JSON 截在半截
 * 解析不出来，整篇退化成兜底稿——线上就这么发生过一次。
 * prompt.test.ts 里有一条测试守着这个耦合。
 */
export const DEFAULT_MAX_TOKENS = 3000;

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
        // **必须显式关掉思维链。**
        //
        // DeepSeek v4 的 thinking 默认是 enabled，而 reasoning_tokens 计在
        // completion_tokens_details 下——思维链的 token 同样吃 max_tokens。
        // 线上连续三次失败（29 秒返回空、28 秒被截断、24 秒返回空）全是这一个
        // 原因：模型把额度花在了我们根本读不到的 reasoning_content 上，轮到
        // content 时要么没额度了、要么写到一半被切断。
        //
        // 排查时一直在调超时和篇幅，而额度压根没花在正文上——这类问题的隐蔽
        // 之处在于，从 content 的角度看它和「模型写太长」完全同形。
        //
        // 早报是「照给定事实写摘要」，不需要链式推理；关掉它把整个额度还给正文，
        // 同时省下二十多秒。
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `DeepSeek HTTP ${res.status}: ${text.slice(0, 300)}` };
    }

    const data = (await res.json()) as {
      choices?: {
        message?: { content?: string; reasoning_content?: string };
        finish_reason?: string;
      }[];
      usage?: {
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";

    if (!content.trim()) {
      // 把 token 用量带进错误里。「返回空内容」这五个字本身什么也说明不了——
      // 而 completion 很高、reasoning 也很高、content 却是空的，一眼就能看出
      // 额度被思维链吃掉了。线上正是这个情况，却花了三轮才定位。
      const completion = data.usage?.completion_tokens ?? 0;
      const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
      const hasReasoning = Boolean(choice?.message?.reasoning_content);
      return {
        ok: false,
        error:
          `DeepSeek 返回空内容（completion_tokens=${completion}, ` +
          `reasoning_tokens=${reasoning}, 有 reasoning_content=${hasReasoning}, ` +
          `finish_reason=${choice?.finish_reason ?? "null"}）`,
      };
    }

    return { ok: true, content, finishReason: choice?.finish_reason ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
