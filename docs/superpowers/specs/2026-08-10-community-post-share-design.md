# 社区帖子分享到站外 设计文档

日期：2026-08-10
状态：已获用户批准

## 背景与问题

社区帖子目前没有任何分享入口——看到一条想发给朋友，只能手动复制地址栏。用户要求
加「转发」功能。经确认，要的是**分享到站外**（把链接发给别人），不是站内转发
（转推式地把别人的帖子发到自己名下）——后者要改表结构、改列表查询、处理原帖被删，
是完全不同量级的工作，本设计不做。

用户同时要求**链接预览卡片**也要正确：链接发到微信/Telegram 后，预览卡片应显示帖子
的标题与摘要，而不是站点的通用文案。

## 已确认的现状事实（2026-08-10 核实）

- **帖子是公开可读的。** `supabase/migrations/030_community_posts.sql:62-64` 的 RLS
  策略是 `Public read community posts ... USING (true)`，注释写明「所有人可读（含未
  登录）」。分享出去的链接，未登录的人也能打开看到完整帖子——这是本功能成立的前提。
- **`(app)` 路由组没有鉴权。** `src/app/[locale]/(app)/layout.tsx` 里没有任何
  `redirect`/`getUser`；`src/middleware.ts` 只拦 `/admin`。所以 `/community/[id]`
  本来就是公开页面。
- **详情页整个是客户端组件。** `src/app/[locale]/(app)/community/[id]/page.tsx` 首行
  是 `"use client"`，用 `useParams` + `usePost` 取数据。客户端组件里**无法**导出
  `generateMetadata`，这正是预览卡片显示通用文案的原因。
- **帖子内容是纯文本。** 表结构（030 + `032_community_cover_image.sql`）是
  `title TEXT` / `content TEXT` / `cover_image TEXT`；详情页用
  `whitespace-pre-wrap` 直接渲染 `post.content`，不含 HTML 或 Markdown。所以做摘要
  只需折叠空白 + 截断，**不需要** `stripHtml`。
- **文章详情页已有一套可照搬的模式**（`articles/[slug]/page.tsx`）：服务端 `page.tsx`
  用 `cache()` 包住查询让 `generateMetadata` 与页面主体共用一次查询，导出
  `openGraph` / `twitter`，`cover_image` 作 OG 图，再渲染一个客户端子组件。本设计
  照搬这套，不新发明。
- `SITE_URL` 定义在 `src/lib/constants.ts:2`，来自 `NEXT_PUBLIC_SITE_URL`，**客户端
  可用**——分享按钮可以直接用它拼规范链接。
- `community` i18n 命名空间已存在（`tab_label`、`back_to_community`、
  `post_not_found` 等），新键加在这里。

## 设计

### ① 详情页改成「服务端外壳 + 客户端交互」

这是本次最大的改动面，但**交互行为一行不改**——只是换文件位置。

- **新的服务端 `community/[id]/page.tsx`**：`await params` 拿 id；用 `cache()` 包住
  一个 `getPostById(id)` 查询（沿用文章页的做法，让 `generateMetadata` 与页面主体
  只查一次库）；导出 `generateMetadata`；渲染客户端子组件并把 id 传下去。
- **`CommunityPostClient.tsx`（新文件）**：现有 `page.tsx` 的全部内容原样搬入——
  点赞、评论、编辑、删除、`usePost`、`useAuth` 全部保持现状。唯一改动是不再用
  `useParams` 取 id，改为从 props 接收（服务端已经解析过了）。
- **帖子不存在时**：页面调 `notFound()`；`generateMetadata` 在查不到时返回通用标题，
  不抛错。

**刻意接受的代价：** 服务端为了 meta 查一次帖子，客户端的 `usePost` 还会再查一次。
消除它需要把服务端数据灌进 react-query 的初始状态，那会让客户端组件与服务端外壳
耦合起来，违背「交互代码原样搬运」这一条。多一次查询换搬运风险归零，划算。

### ② 链接预览卡片（meta）

`generateMetadata` 产出：

- `title`：`post.title`
- `description`：`post.content` 折叠连续空白后截断到 160 字符，超出补省略号
- `openGraph`：同样的 title/description，`type: "article"`，
  `images: post.cover_image ? [post.cover_image] : undefined`
- `twitter`：同样的 title/description
- **`alternates` 设成只有 `canonical`，指向默认语言下的本帖 URL。** 这一处有两层
  考量：
  1. 不照搬文章页的 `languages`。`buildLanguageAlternates` 的语义是「这几个 URL
     互为翻译版本」，对文章成立（`articles.title`/`content` 是 `{locale: text}`
     对象，每个语言前缀下是真正不同的译文），对社区帖子**不成立**——帖子的
     `title`/`content` 是单一纯文本，三个语言前缀下是同一份内容。
  2. **但"不写 `alternates`"并不等于"没有 `alternates`"。**
     `src/app/[locale]/layout.tsx:39` 已经全局设了
     `alternates: { languages: buildLanguageAlternates("") }`，指向各语言的**首页**。
     该文件自己的注释写明：Next 的 metadata 按顶层键浅合并，页面一旦设了
     `alternates` 就会整体覆盖、而不是合并。所以页面什么都不写，就会继承这份
     指向首页的 languages——等于宣称"本帖的其他语言版本是首页"，比不给更糟。

  因此必须显式覆盖。写成 `alternates: { canonical: ... }`：既清掉了继承来的错误
  languages，又顺带解决了同一份内容挂在三个语言前缀下的重复问题——三个 URL 统一
  指向默认语言那一个。

摘要函数不复用文章页的 `stripHtml`——那是给 HTML 用的，社区内容是纯文本，套上去只会
让人误以为内容可能含 HTML。写一个只做「折叠空白 + 截断」的小函数，放在服务端
`page.tsx` 里。

### ③ 分享按钮

**放两处**：详情页的操作区（与点赞并排）、列表卡片（`CommunityPostCard`）。列表里
看到就想分享是常见动作，只放详情页会少一半使用场景。

**行为按能力分两档**，运行时判断：

- `navigator.share` 可用（手机浏览器基本都支持）→ 调
  `navigator.share({ title, url })`，弹出系统面板，微信/Telegram/复制都在里面
- 不可用（桌面 Chrome 等）→ `navigator.clipboard.writeText(url)`，按钮文案短暂变成
  「已复制」，约 2 秒后复原

**分享的是规范链接**：`${SITE_URL}/${locale}/community/${id}`，不是
`window.location.href`——后者会把 `?tab=community` 之类的查询参数一起带出去。

**用户取消系统面板会抛 `AbortError`**，必须吞掉，不能弹错误提示——取消不是失败。
其他异常（如剪贴板权限被拒）也只做静默降级，不打断阅读。

**抽成一个共享组件** `src/components/community/SharePostButton.tsx`，接收
`{ postId, title }`，两处引用。逻辑只有一处，样式由调用方通过 `className` 微调。

### ④ 文案

`community` 命名空间新增两个键，三语齐全：

| 键 | zh-CN | en-US | ms-MY |
|---|---|---|---|
| `share` | 分享 | Share | Kongsi |
| `link_copied` | 已复制链接 | Link copied | Pautan disalin |

### ⑤ 测试与验收

**单元测试**（`src/lib/` 下的纯函数才进得了本项目的 vitest——node 环境，
`include` 只有 `src/lib/**` 与 `src/stores/**`）：

摘要函数是唯一可单测的部分。把它放在 `src/lib/community-share.ts` 而不是页面文件里，
就能测：

- 折叠连续空白与换行为单个空格
- 短内容原样返回、不加省略号
- 超长内容截断到 160 字符且以省略号结尾
- 空内容返回空串（调用方据此不设 description）

分享按钮与详情页拆分无法单测（组件、`navigator.share`），靠人工验收。

**人工验收**：

1. 桌面浏览器打开任一帖子详情页，查看网页源码，`<title>` 与
   `<meta property="og:title">` 是帖子标题、`og:description` 是内容摘要；有封面图的
   帖子 `og:image` 指向该图
2. 帖子列表卡片上有分享按钮，点击后（桌面）提示已复制，粘贴出来是
   `.../<语言>/community/<id>`，不带查询参数
3. 手机上点分享，弹出系统分享面板；**取消面板不出现任何报错提示**
4. 未登录的浏览器打开分享出来的链接，能看到完整帖子
5. 点赞、评论、编辑、删除在拆分后行为不变（这是搬运风险最高的一项，逐个点一遍）
6. 三语各看一次分享按钮文案

## 明确不做（YAGNI）

- 不做站内转发（转推式），不改任何表结构
- 不做分享次数统计
- 不做专门生成的分享卡片图（用现有 `cover_image`，没有就不给 OG 图）
- 不改点赞、评论、编辑、删除的任何行为
- 不把服务端数据灌进 react-query 初始状态（见 ① 的取舍说明）
- 不动文章页、视频页的既有 metadata
