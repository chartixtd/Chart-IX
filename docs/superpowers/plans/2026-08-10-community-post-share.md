# 社区帖子分享到站外 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给社区帖子加一个能把链接发到站外的分享按钮，并让分享出去的链接在微信/Telegram 里显示帖子自己的标题与摘要，而不是站点的通用文案。

**Architecture:** 分三步走，风险从低到高。先写可单测的摘要纯函数；再写分享按钮组件并接到两处调用点；最后把客户端渲染的详情页拆成「服务端外壳 + 客户端交互」以便导出 `generateMetadata`——这一步是全计划风险最高的，交互代码**原样搬运、一行不改**。服务端外壳照搬文章详情页已有的 `cache()` + `generateMetadata` 模式，不新发明。

**Tech Stack:** Next.js 15 App Router（server component + `generateMetadata`）、next-intl（zh-CN / en-US / ms-MY）、React Query（既有 `usePost` 等 hook 不动）、Web Share API + Clipboard API、vitest。

**设计文档：** `docs/superpowers/specs/2026-08-10-community-post-share-design.md`

## Global Constraints

- **交互行为一行不改。** 点赞、评论、编辑、删除的逻辑在 Task 3 里只是从一个文件搬到另一个文件。任何"顺手优化"都是越界——搬运出错是本计划最主要的风险来源。
- **不做站内转发**（转推式），不改任何数据库表结构，不写迁移。
- **`alternates` 必须显式设成只有 `canonical`。** 两层理由：(1) 不照搬文章页的 `languages`——那个字段意为「互为翻译版本」，对文章成立（`title`/`content` 是 `{locale: text}` 对象），对社区帖子不成立（单一纯文本，三个语言前缀下同一份内容）；(2) **"不写"不等于"没有"**：`src/app/[locale]/layout.tsx:39` 已全局设了 `alternates: { languages: buildLanguageAlternates("") }`，指向各语言**首页**，而 Next 的 metadata 按顶层键浅合并——页面不写就会继承这份错的。必须写 `alternates: { canonical: ... }` 把它覆盖掉。
- **社区帖子内容是纯文本**（`community_posts.content TEXT`，详情页用 `whitespace-pre-wrap` 直接渲染）。做摘要**不要**套 `stripHtml`——那会让人误以为内容可能含 HTML。
- **分享的是规范链接** `${SITE_URL}/${locale}/community/${id}`，不是 `window.location.href`（后者会把 `?tab=community` 之类的查询参数带出去）。`SITE_URL` 来自 `src/lib/constants.ts`，是 `NEXT_PUBLIC_` 变量，客户端可用。
- **用户取消系统分享面板会抛 `AbortError`，必须静默吞掉**——取消不是失败，不能弹错误提示。
- 三个语言文件必须同步，缺一个会在该语言下抛缺失键错误。
- 不新增组件测试。项目 vitest 是 node 环境，`include` 只有 `src/lib/**` 与 `src/stores/**`；不要为此引入 jsdom 或 React Testing Library。
- 每个任务结束前跑 `npx tsc --noEmit`；最后一个任务跑全量 `npm run lint && npx vitest run && npm run build`。
- 提交信息用中文，沿用仓库前缀风格。

---

## File Structure

| 文件 | 责任 | 处置 |
|---|---|---|
| `src/lib/community-share.ts` | 帖子内容 → 分享摘要的纯函数 | **新建**（Task 1） |
| `src/lib/community-share.test.ts` | 上述函数的单元测试 | **新建**（Task 1） |
| `src/components/community/SharePostButton.tsx` | 分享按钮：系统面板优先、桌面降级复制 | **新建**（Task 2） |
| `src/i18n/messages/{zh-CN,en-US,ms-MY}.json` | 文案 | 修改（Task 2，新增 `community.share` / `community.link_copied`） |
| `src/components/community/CommunityPostCard.tsx` | 列表卡片 | 修改（Task 2，加分享按钮） |
| `src/app/[locale]/(app)/community/[id]/CommunityPostClient.tsx` | 详情页的全部交互 | **新建**（Task 3，从现有 page.tsx 原样搬入 + 加分享按钮） |
| `src/app/[locale]/(app)/community/[id]/page.tsx` | 服务端外壳 + `generateMetadata` | 重写（Task 3） |

**为什么摘要函数要单独成文件：** 项目的 vitest 只扫 `src/lib/**`。放在页面文件里就永远测不到，而"截断到多少字符、空白怎么折叠"恰恰是最容易写错又最容易测的部分。

---

### Task 1: 分享摘要纯函数

**Files:**
- Create: `src/lib/community-share.ts`
- Create: `src/lib/community-share.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `export function buildShareExcerpt(content: string, maxLength?: number): string`
  — Task 3 的 `generateMetadata` 调用它。默认 `maxLength = 160`。

**背景：**
社区帖子的 `content` 是纯文本，用户会打很多换行。直接塞进 `og:description` 会带一堆换行，且长度不受控。这个函数把连续空白（含换行）折叠成单个空格，然后截断。

**不要**复用文章页的 `stripHtml`：那个函数先剥 HTML 标签再折叠空白，用在纯文本上虽然结果碰巧一样，却会让读代码的人以为社区内容可能含 HTML。

截断规则与文章页保持一致：超长时截到 `maxLength - 1` 再补一个 `…`，所以结果长度恰好等于 `maxLength`。

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/community-share.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildShareExcerpt } from "./community-share";

describe("buildShareExcerpt", () => {
  it("把换行与连续空格折叠成单个空格", () => {
    expect(buildShareExcerpt("第一行\n\n第二行   第三行")).toBe("第一行 第二行 第三行");
  });

  it("去掉首尾空白", () => {
    expect(buildShareExcerpt("  \n 正文 \n  ")).toBe("正文");
  });

  it("短内容原样返回，不加省略号", () => {
    const short = "一句很短的帖子";
    expect(buildShareExcerpt(short)).toBe(short);
  });

  it("超长内容截断，且结果长度正好等于上限", () => {
    const long = "长".repeat(300);
    const out = buildShareExcerpt(long);
    expect(out.length).toBe(160);
    expect(out.endsWith("…")).toBe(true);
  });

  it("恰好等于上限时不截断、不加省略号", () => {
    const exact = "边".repeat(160);
    expect(buildShareExcerpt(exact)).toBe(exact);
  });

  it("自定义上限生效", () => {
    const out = buildShareExcerpt("字".repeat(50), 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("空内容返回空串——调用方据此不设 description", () => {
    expect(buildShareExcerpt("")).toBe("");
    expect(buildShareExcerpt("   \n  ")).toBe("");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npx vitest run src/lib/community-share.test.ts
```

预期：FAIL，找不到模块 `./community-share`。

- [ ] **Step 3: 写实现**

创建 `src/lib/community-share.ts`：

```ts
/** og:description 的实用上限——再长各家预览卡片也会自己截掉。 */
const DEFAULT_MAX_LENGTH = 160;

/**
 * 把社区帖子正文压成一行分享摘要。
 *
 * 社区内容是纯文本（community_posts.content 是 TEXT，详情页用
 * whitespace-pre-wrap 直接渲染），所以这里**只**折叠空白 + 截断，不剥 HTML
 * 标签——套上 stripHtml 那类处理会让人误以为内容可能含 HTML。
 *
 * 用户在帖子里打的换行对预览卡片没有意义，全部折成单个空格。
 */
export function buildShareExcerpt(content: string, maxLength = DEFAULT_MAX_LENGTH): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  // 截到 maxLength - 1 再补省略号，结果长度正好是 maxLength（与文章页一致）
  return text.slice(0, maxLength - 1) + "…";
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npx vitest run src/lib/community-share.test.ts
npx tsc --noEmit
```

预期：7 条全部通过，类型检查干净。

- [ ] **Step 5: 提交**

```bash
git add src/lib/community-share.ts src/lib/community-share.test.ts
git commit -m "feat(community): 加入分享摘要函数（纯文本折叠 + 截断）"
```

---

### Task 2: 分享按钮组件与列表卡片接入

**Files:**
- Create: `src/components/community/SharePostButton.tsx`
- Modify: `src/components/community/CommunityPostCard.tsx:121-140`
- Modify: `src/i18n/messages/zh-CN.json`、`en-US.json`、`ms-MY.json`

**Interfaces:**
- Consumes: 无（不依赖 Task 1）
- Produces: `SharePostButton({ postId, title, className }: { postId: string; title: string; className?: string })`
  — Task 3 的详情页也会用它。

**背景：**
按钮要在两处出现：列表卡片（本任务）和详情页（Task 3）。逻辑只写一遍。

**卡片上有个坑：** 现有的操作行整体包在 `{(isAuthor || isAdmin) && (...)}` 里——只有作者或管理员才渲染。分享按钮要**所有人可见**，所以这一行的条件必须改成始终渲染，编辑/删除各自保持自己的条件。改错的话普通访客就看不到分享按钮，而这恰恰是分享功能的主要受众。

**降级逻辑：** `navigator.share` 在手机浏览器基本都有；桌面 Chrome 没有。不可用时退到剪贴板，按钮文案短暂变「已复制」。两个 API 都可能抛异常（用户取消面板抛 `AbortError`、剪贴板权限被拒），一律静默吞掉——分享失败不该打断阅读。

- [ ] **Step 1: 加三语文案**

在每个语言文件的 `community` 对象里新增两个键（位置放在 `back_to_community` 附近即可，缩进对齐该层级既有的键）：

`src/i18n/messages/zh-CN.json`：
```json
    "share": "分享",
    "link_copied": "已复制链接",
```

`src/i18n/messages/en-US.json`：
```json
    "share": "Share",
    "link_copied": "Link copied",
```

`src/i18n/messages/ms-MY.json`：
```json
    "share": "Kongsi",
    "link_copied": "Pautan disalin",
```

- [ ] **Step 2: 校验 JSON**

```bash
node -e "for (const f of ['zh-CN','en-US','ms-MY']) JSON.parse(require('fs').readFileSync('src/i18n/messages/'+f+'.json','utf8')); console.log('all valid JSON')"
```

预期：输出 `all valid JSON`。

- [ ] **Step 3: 写分享按钮组件**

创建 `src/components/community/SharePostButton.tsx`：

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SITE_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** 「已复制」提示停留多久后复原。 */
const COPIED_FEEDBACK_MS = 2000;

/**
 * 把帖子链接分享到站外。
 *
 * 手机浏览器基本都有 navigator.share，调它弹系统面板（微信/Telegram/复制都在
 * 里面）；桌面没有，退到复制链接并把文案短暂换成「已复制」。
 *
 * 分享的是规范链接而不是 window.location.href——后者会把 ?tab=community
 * 这类查询参数一起带出去。
 */
export function SharePostButton({
  postId,
  title,
  className,
}: {
  postId: string;
  title: string;
  className?: string;
}) {
  const t = useTranslations("community");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件在提示还亮着时被卸载（比如帖子被删），别对已卸载的组件 setState
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleShare = async () => {
    const url = `${SITE_URL}/${locale}/community/${postId}`;

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // 用户取消系统面板会抛 AbortError，剪贴板权限被拒也会抛——两者都不是
      // 需要告警的错误，静默即可，不要打断阅读。
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className={cn(
        "flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-gold",
        className
      )}
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12M12 4 8 8M12 4l4 4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
      </svg>
      {copied ? t("link_copied") : t("share")}
    </button>
  );
}
```

- [ ] **Step 4: 接到列表卡片**

在 `src/components/community/CommunityPostCard.tsx` 顶部 import 区加：

```tsx
import { SharePostButton } from "./SharePostButton";
```

然后把这一整段

```tsx
      {(isAuthor || isAdmin) && (
        <div className="flex items-center justify-end gap-3 border-t border-border-default px-4 py-2">
          {isAuthor && (
            <button
              onClick={() => setEditOpen(true)}
              className="text-xs text-text-muted transition-colors hover:text-gold"
            >
              {t("edit")}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deletePost.isPending}
              className="text-xs text-text-muted transition-colors hover:text-danger disabled:opacity-50"
            >
              {t("delete")}
            </button>
          )}
        </div>
      )}
```

替换为（注意：外层的 `(isAuthor || isAdmin) &&` 条件**去掉**，因为分享按钮所有人都要看到；编辑/删除各自的条件原样保留）

```tsx
      {/* 这一行始终渲染：分享对所有访客可见，编辑/删除各自按身份显示。
          原先整行包在 (isAuthor || isAdmin) 里，加分享后不能再那样。 */}
      <div className="flex items-center justify-end gap-3 border-t border-border-default px-4 py-2">
        <SharePostButton postId={post.id} title={post.title} className="mr-auto" />
        {isAuthor && (
          <button
            onClick={() => setEditOpen(true)}
            className="text-xs text-text-muted transition-colors hover:text-gold"
          >
            {t("edit")}
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={deletePost.isPending}
            className="text-xs text-text-muted transition-colors hover:text-danger disabled:opacity-50"
          >
            {t("delete")}
          </button>
        )}
      </div>
```

`mr-auto` 让分享按钮靠左、编辑/删除仍靠右，视觉上把"人人可用"和"少数人可用"的动作分开。

- [ ] **Step 5: 校验**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
```

预期：全部通过。

- [ ] **Step 6: 提交**

```bash
git add src/components/community/SharePostButton.tsx src/components/community/CommunityPostCard.tsx src/i18n/messages/zh-CN.json src/i18n/messages/en-US.json src/i18n/messages/ms-MY.json
git commit -m "feat(community): 列表卡片加分享按钮（系统面板优先，桌面降级复制）"
```

---

### Task 3: 详情页拆成服务端外壳 + 客户端交互

**Files:**
- Create: `src/app/[locale]/(app)/community/[id]/CommunityPostClient.tsx`
- Rewrite: `src/app/[locale]/(app)/community/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 1 的 `buildShareExcerpt(content, maxLength?)`；Task 2 的 `SharePostButton({ postId, title, className? })`
- Produces: `CommunityPostClient({ postId }: { postId: string })`

**背景（本计划风险最高的一步）：**
现在 `page.tsx` 整个是 `"use client"`，所以没法导出 `generateMetadata`，分享出去的链接预览卡片只能显示站点通用文案。

做法照搬文章详情页（`src/app/[locale]/(static)/articles/[slug]/page.tsx`）：服务端 `page.tsx` 用 `cache()` 包住查询（让 `generateMetadata` 与页面主体共用一次查询），渲染一个客户端子组件。

**客户端那半是原样搬运**：现有 161 行的 `page.tsx` 内容整体搬进 `CommunityPostClient.tsx`，只改两处——组件名与签名（从 `useParams` 取 id 改为从 props 接收），以及在操作区插入分享按钮。点赞、评论、编辑、删除、骨架屏、错误态**一律不动**。

**刻意接受的重复查询：** 服务端为 meta 查一次，客户端的 `usePost` 还会再查一次。消除它要把服务端数据灌进 react-query 初始状态，那会让两边耦合、违背"原样搬运"。多查一次换搬运风险归零。

- [ ] **Step 1: 新建客户端组件**

创建 `src/app/[locale]/(app)/community/[id]/CommunityPostClient.tsx`，内容为现有 `page.tsx` 的完整内容，作以下三处改动：

1. 删掉 `import { useParams } from "next/navigation";`
2. 新增 `import { SharePostButton } from "@/components/community/SharePostButton";`
3. 把

```tsx
export default function CommunityPostPage() {
  const t = useTranslations("community");
  const locale = useLocale();
  const auth = useAuth();
  const params = useParams<{ id: string }>();
  const postId = params.id;
```

改为

```tsx
export function CommunityPostClient({ postId }: { postId: string }) {
  const t = useTranslations("community");
  const locale = useLocale();
  const auth = useAuth();
```

4. 在标题右侧的操作区插入分享按钮。把

```tsx
              <div className="flex shrink-0 items-center gap-3">
                {isAuthor && (
                  <button onClick={() => setEditOpen(true)} className="text-xs text-text-muted hover:text-gold">
                    {t("edit")}
                  </button>
                )}
```

改为

```tsx
              <div className="flex shrink-0 items-center gap-3">
                <SharePostButton postId={post.id} title={post.title} />
                {isAuthor && (
                  <button onClick={() => setEditOpen(true)} className="text-xs text-text-muted hover:text-gold">
                    {t("edit")}
                  </button>
                )}
```

**其余每一行都保持原样**——包括 `REACTION_EMOJI` 常量、`isPending`/`error` 分支、点赞按钮那段带长注释的 `disabled={!isPro}` 逻辑、`CommentThread`、`PostComposerModal`、`ConfirmDialog`。

- [ ] **Step 2: 重写服务端外壳**

把 `src/app/[locale]/(app)/community/[id]/page.tsx` 整个替换为：

```tsx
import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";
import { buildShareExcerpt } from "@/lib/community-share";
import { CommunityPostClient } from "./CommunityPostClient";

// React 的请求级缓存：generateMetadata 和页面主体都要这条帖子，
// 不包一层就会查两次库（沿用 articles/[slug]/page.tsx 的做法）。
const getPostById = cache(async (id: string) => {
  const supabase = await createClient();
  return supabase
    .from("community_posts")
    .select("id, title, content, cover_image")
    .eq("id", id)
    .maybeSingle();
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { data: post } = await getPostById(id);

  if (!post) return {};

  const description = buildShareExcerpt(post.content) || undefined;

  // alternates 必须显式写，而且只写 canonical：
  //  · 不给 languages——那个字段意为「这几个 URL 互为翻译版本」，对文章成立
  //    （title/content 是 {locale: text} 对象），对帖子不成立：帖子是单一纯
  //    文本，三个语言前缀下是同一份内容。
  //  · 但不能干脆不写。[locale]/layout.tsx 已全局设了指向各语言首页的
  //    languages，而 Next 的 metadata 按顶层键浅合并——这里不写就会继承那份，
  //    等于宣称「本帖的其他语言版本是首页」。写了 canonical 就整体覆盖掉了，
  //    同时把三个语言前缀下的同一份内容统一指向默认语言那一个。
  return {
    title: post.title,
    description,
    alternates: { canonical: `${SITE_URL}/${routing.defaultLocale}/community/${id}` },
    openGraph: {
      title: post.title,
      description,
      type: "article",
      images: post.cover_image ? [post.cover_image] : undefined,
    },
    twitter: { title: post.title, description },
  };
}

export default async function CommunityPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data: post } = await getPostById(id);

  if (!post) notFound();

  return <CommunityPostClient postId={id} />;
}
```

注意用 `maybeSingle()` 而不是 `single()`：帖子不存在时 `single()` 会走 error 分支，`maybeSingle()` 干净地给 `data: null`，正好对上 `if (!post) notFound()`。

- [ ] **Step 3: 校验类型与构建**

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

预期：四项全过。`npm run build` 会实际编译这个新的 server/client 边界——如果客户端组件里漏了 `"use client"` 或误用了服务端 API，这一步会报错。

- [ ] **Step 4: 确认没有残留的旧入口**

```bash
grep -n "useParams" "src/app/[locale]/(app)/community/[id]/CommunityPostClient.tsx" || echo "no useParams left — id now comes from props, good"
grep -c "use client" "src/app/[locale]/(app)/community/[id]/CommunityPostClient.tsx"
```

预期：第一条输出 `no useParams left — id now comes from props, good`；第二条输出 `1`。

- [ ] **Step 5: 提交**

```bash
git add "src/app/[locale]/(app)/community/[id]"
git commit -m "feat(community): 详情页拆出服务端外壳，分享链接带上帖子自己的预览卡片"
```

---

### Task 4: 浏览器验收

**Files:** 无代码改动（纯验证任务）

**Interfaces:**
- Consumes: Task 1–3 的全部产出
- Produces: 无

**背景：**
只有 Task 1 有单元测试。分享按钮（依赖 `navigator.share`/剪贴板）、meta 标签、以及 Task 3 的搬运正确性都只能在真实浏览器里验。

**dev server 的坑（前几次踩过）：** 若在 git worktree 里执行本计划，`preview_start` 按会话工作目录解析 `.claude/launch.json`，起的可能是主仓库而不是 worktree。验收前先确认服务的确实是本次改动的代码（例如列表卡片上能看到分享按钮）。

- [ ] **Step 1: 起开发服务器**

- [ ] **Step 2: 验证 meta 标签**

打开任一帖子详情页，在控制台执行：

```js
JSON.stringify({
  title: document.title,
  ogTitle: document.querySelector('meta[property="og:title"]')?.content,
  ogDesc: document.querySelector('meta[property="og:description"]')?.content,
  ogImage: document.querySelector('meta[property="og:image"]')?.content,
  hreflangCount: document.querySelectorAll('link[rel="alternate"][hreflang]').length,
  canonical: document.querySelector('link[rel="canonical"]')?.href,
})
```

预期：`title`/`ogTitle` 是帖子标题；`ogDesc` 是内容摘要（单行、无换行）；有封面图的帖子 `ogImage` 指向该图；**`hreflangCount` 为 `0`**（说明成功覆盖了 layout 那份指向首页的 languages——这一条是本次最容易搞错的地方，务必真的看一眼）；`canonical` 指向默认语言下的本帖 URL。

用**英文页面**（`/en-US/community/<id>`）再看一次 `canonical`，它应当仍指向默认语言那个 URL，而不是英文自己。

- [ ] **Step 3: 验证分享按钮在列表上人人可见**

用**未登录**的浏览器（或无痕窗口）打开社区列表，确认每张卡片上都有分享按钮——这是最容易做错的一点（原先那一行只对作者/管理员渲染）。

- [ ] **Step 4: 验证复制链接（桌面路径）**

桌面浏览器点分享按钮，确认文案短暂变成「已复制链接」再复原，粘贴出来是
`<站点地址>/<语言>/community/<帖子 id>`，**不带任何查询参数**。

- [ ] **Step 5: 验证系统面板与取消（手机路径）**

在支持 `navigator.share` 的环境点分享，弹出系统面板；**取消面板后页面上不应出现任何错误提示**。

- [ ] **Step 6: 验证未登录可读**

未登录状态直接打开分享出来的链接，能看到完整帖子（RLS 是公开可读，本就应该如此）。

- [ ] **Step 7: 逐个回归详情页的交互（Task 3 的搬运风险）**

登录后在详情页依次操作，每项都要确认行为与改动前一致：

- 点各个表情能加/取消反应；非 Pro 用户点不动且有提示
- 评论区能加载、能发评论
- 作者身份下「编辑」能打开弹窗、能保存
- 管理员身份下「删除」能弹确认框、能删
- 帖子加载中显示骨架屏；访问一个不存在的 id 得到 404 页

- [ ] **Step 8: 三语抽查**

切到英文与马来文各看一次，分享按钮文案分别是 `Share` / `Kongsi`，复制后提示分别是 `Link copied` / `Pautan disalin`。

- [ ] **Step 9: 控制台检查**

上述各页控制台无报错。

- [ ] **Step 10: 关闭开发服务器**

---

## 自检记录

- **设计文档逐节覆盖：** ①详情页拆分 → Task 3；②链接预览卡片 meta → Task 3 Step 2（摘要函数来自 Task 1）；③分享按钮 → Task 2（组件 + 列表卡片）+ Task 3 Step 1（详情页接入）；④文案 → Task 2 Step 1；⑤测试与验收 → Task 1 的单测 + Task 4 的十步人工验收。
- **顺序依赖：** Task 1 必须早于 Task 3（后者的 `generateMetadata` 调用前者）；Task 2 必须早于 Task 3（后者引用 `SharePostButton`）。Task 1 与 Task 2 之间没有依赖。
- **类型一致性：** Task 1 产出 `buildShareExcerpt(content: string, maxLength?: number): string`，Task 3 Step 2 以单参数调用；Task 2 产出 `SharePostButton({ postId, title, className? })`，Task 2 Step 4 传 `postId`/`title`/`className`、Task 3 Step 1 传 `postId`/`title`——都在签名内。
- **一处容易被漏掉的改动已显式写出：** 列表卡片的操作行原先整体包在 `(isAuthor || isAdmin) &&` 里；不改这个条件的话，普通访客（分享功能的主要受众）根本看不到按钮。Task 2 Step 4 给出了完整的替换前后文，并在验收 Step 3 用未登录浏览器专门验一遍。
- **占位符扫描：** 无 TBD / TODO / 「类似 Task N」/ 无代码的步骤。
