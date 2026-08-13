import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatBriefingMessage, briefingArticleUrl } from "./telegram";

/**
 * 早报链接推送的消息成型。
 *
 * 这两个函数是纯的，投递机制（多目标、话题、重试）由 telegram-send 与
 * telegram-push 各自的测试覆盖，这里只守内容本身：网址对不对、标题会不会
 * 把消息打成一堆乱码。
 */

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  // SITE_URL 在模块加载时就定型了，所以这里断言的是打包时的默认值，
  // 而不是当前进程的环境变量——固定住它，免得本地 .env 让测试飘。
  process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
});

afterEach(() => {
  if (ORIGINAL_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL_SITE_URL;
});

describe("briefingArticleUrl", () => {
  it("按推送语言选文章 locale", () => {
    expect(briefingArticleUrl("daily-briefing-2026-08-08", "zh")).toContain(
      "/zh-CN/articles/daily-briefing-2026-08-08"
    );
    expect(briefingArticleUrl("daily-briefing-2026-08-08", "en")).toContain(
      "/en-US/articles/daily-briefing-2026-08-08"
    );
  });

  it("是绝对网址——Telegram 里的相对路径点不开", () => {
    expect(briefingArticleUrl("s", "zh")).toMatch(/^https?:\/\//);
  });
});

describe("formatBriefingMessage", () => {
  it("网址独占一行且不包在标签里，好让预览卡展开、也方便复制", () => {
    const url = "https://chart-ix.com/zh-CN/articles/daily-briefing-2026-08-08";
    const lines = formatBriefingMessage("zh", "早报 | 8月8日 比特币小幅上行", url).split("\n");
    expect(lines[lines.length - 1]).toBe(url);
    expect(lines.join("\n")).not.toContain("<a ");
  });

  it("标题里的尖括号被转义——parse_mode=HTML 下不转义会整条发不出去", () => {
    const msg = formatBriefingMessage("en", "Bitcoin <b>surges</b> & holds", "https://x.test/a");
    expect(msg).toContain("Bitcoin &lt;b&gt;surges&lt;/b&gt; &amp; holds");
    // 标题里的假标签被吃掉后，剩下的加粗标签只能是我们自己那对
    expect(msg.match(/<b>/g)).toHaveLength(1);
  });

  it("抬头跟着推送语言走，与文章语言一致", () => {
    expect(formatBriefingMessage("zh", "t", "u")).toContain("每日早报");
    expect(formatBriefingMessage("en", "t", "u")).toContain("Daily Briefing");
  });
});
