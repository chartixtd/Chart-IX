# 每日 AI 市场早报（Daily Briefing）设计文档

日期：2026-08-08
状态：已获用户批准

## 背景

站点已有完整的文章系统（`articles` 表、后台编辑器、多语言详情页、分类），但内容全部依赖人工撰写，更新频率受限于人力。同时站点已具备三类可自动获取的原料：

1. **新闻**——`src/lib/news-server.ts` 已在抓 RSS（CoinDesk / Cointelegraph / 吴说区块链），但只覆盖加密货币，且仅用于资讯页的原样罗列。
2. **行情**——`src/lib/bingx/market.ts` 的 `getSpotTickers()` 一次请求即可拿到全部现货行情及其**真 24 小时**涨跌，含黄金代币 `XAUT-USDT` / `PAXG-USDT`。（合约 ticker 只有约 3 分钟窗口，不可用于本功能——详见下文「行情口径」。）
3. **调度**——`.github/workflows/cron-tick.yml` + `src/lib/cron-auth.ts` + `cron_heartbeats` 已是一套跑通的外部定时体系。

本设计把这三者接上 DeepSeek，每天早上自动产出一篇《早报》文章并发布，无需人工介入。

## 目标

每天 UTC+8 08:00 自动发布一篇免费文章，包含两部分：

- **24 小时要闻**——加密货币、黄金与大宗、宏观金融三个板块的摘要。
- **市场解读**——基于真实行情数据的简短分析。

「全自动」的定义是：正常情况零人工介入，异常情况**也不开天窗**——存在一条不依赖任何模型的兜底路径，保证每天必有一篇上线，且任何降级都会主动告警。

## 已确认的决策（用户逐项批准）

| 项 | 决定 |
|---|---|
| 发布策略 | 自动发布 + 质量门槛；门槛不通过绝不公开 |
| 文章结构 | **一篇**，内含「24 小时要闻」+「市场解读」两个板块 |
| 多语言 | 只生成 `zh-CN` 与 `en-US`；`ms-MY` 由现有回退链自动显示英文版 |
| 阅读门槛 | `tier_required = 'free'`，全部免费 |
| 运行位置 | 方案 A：Next.js cron 路由，复用现有全部基础设施 |
| 发布时间 | UTC+8 每日 08:00（时间窗内幂等重试） |
| 分类 | 新建独立分类「每日早报」 |
| 署名 | 新建专用账号（如「Chart-IX 编辑部」），不用个人 admin 号 |
| L4 兜底稿 | **直接发布**（零 AI 生成，事实风险为零） |

## 实测事实（2026-08-08 实测，勿凭文档或记忆改写）

### RSS 源可用性

全部以 `User-Agent: Mozilla/5.0 (compatible; Chart-IX/1.0)` 实测：

| 源 | URL | 结果 |
|---|---|---|
| Investing.com Commodities | `https://www.investing.com/rss/commodities.rss` | 200，10 条，**黄金/大宗主力源** |
| FXStreet | `https://www.fxstreet.com/rss/news` | 200，30 条 |
| CNBC Finance | `https://www.cnbc.com/id/10000664/device/rss/rss.html` | 200，30 条 |
| Yahoo Finance | `https://finance.yahoo.com/news/rssindex` | 200，42 条 |
| Federal Reserve Press | `https://www.federalreserve.gov/feeds/press_all.xml` | 200，20 条 |
| Seeking Alpha | `https://seekingalpha.com/market_currents.xml` | 200，7 条 |

**已排除**（实测不可用，不要再试）：Kitco `KitcoNews.xml` 返回 404；RSSHub 金十 403；华尔街见闻 `rss.xml` 返回 200 但零条目；Reuters 与 `marketwatch.com/rss/topstories` 均 301（Reuters 已停止对外 RSS；MarketWatch 的可用地址是 `feeds.content.dowjones.io/public/rss/mw_topstories`，实测 200/10 条）。

### 早报采用的源清单（共 8 个，全文以此为准）

| # | 源 | 板块 |
|---|---|---|
| 1 | CoinDesk（既有） | 加密 |
| 2 | Cointelegraph（既有） | 加密 |
| 3 | 吴说区块链（既有） | 加密 |
| 4 | Investing.com Commodities | 黄金/大宗 |
| 5 | FXStreet | 外汇/宏观 |
| 6 | CNBC Finance | 传统金融 |
| 7 | Yahoo Finance | 广度兜底 |
| 8 | Federal Reserve Press | 政策原始公告 |

实测可用但**不纳入**：Seeking Alpha（仅 7 条，且以观点稿为主，与「要闻」定位不符）、MarketWatch（覆盖面与 CNBC / Yahoo 高度重叠，边际收益低于多打一个源的成本）。两者已验证可用，日后需要扩源时是首选补充项。

### pubDate 解析

Investing.com 的 `pubDate` 是非 RFC822 格式（`Aug 07, 2026 20:16 GMT`）。现有 `news-server.ts` 用 `Date.parse` 解析、`NaN` 则**静默丢弃该条**——若解析失败，整个黄金源会无声消失。实测三种格式均可解析：

```
"Aug 07, 2026 20:16 GMT"        -> 2026-08-07T20:16:00.000Z   OK
"Fri, 07 Aug 2026 21:51:00 GMT" -> 2026-08-07T21:51:00.000Z   OK
"Fri, 07 Aug 2026 15:21 GMT"    -> 2026-08-07T15:21:00.000Z   OK
```

**此结论必须用测试锁住**，否则某次重构改动解析逻辑时会静默失去黄金源。

### DeepSeek API

- **模型线已换代**：当前文档只列 `deepseek-v4-flash` 与 `deepseek-v4-pro`，**不再有 `deepseek-chat` / `deepseek-reasoner`**。实施时须用真实 key 打一次 `/models` 复核，不得照旧知识写死。
- 价格（每百万 token）：`v4-flash` 输入 $0.14（未命中缓存）/ 输出 $0.28；`v4-pro` 输入 $0.435 / 输出 $0.87。官方文档挂有「近期将显著上调价格」的公告，故模型名必须可配置。
- **JSON 模式可用**：`response_format: {"type": "json_object"}`。文档要求：prompt 中必须出现 "json" 一词、须给出期望格式示例、须合理设置 `max_tokens` 以免截断。
- **文档明示「偶尔会返回空内容」**，官方建议改 prompt 后重试。此为降级阶梯 L1 存在的直接依据。
- 限流为**并发制**（`v4-flash` 2500 并发、`v4-pro` 500 并发），超限返回 429。本功能每天两次调用，无压力。
- `base_url` 为 `https://api.deepseek.com`（OpenAI 兼容）；另提供 Anthropic 格式端点 `https://api.deepseek.com/anthropic`。本设计用 OpenAI 兼容格式。
- 端点存活性以无效 key 探测确认（返回 401 `authentication_error`），未使用用户的真实 key。

### 既有代码约束

1. **文章正文回退链**为 `content[locale] ?? content["en-US"] ?? ""`（`ArticleDetailClient.tsx:42`）。故 `en-US` 缺失会让英文与马来文读者看到**空白正文**——`en-US` 是硬性必需项，不是可选项。
2. **`articles.slug` 有 `UNIQUE` 约束**（`007_articles.sql`），可直接用作幂等闸门。
3. **`articles.author_id` 是 `NOT NULL` 且外键指向 `auth.users`**，必须提供一个真实存在的账号 UUID。
4. **`sanitizeArticleHtml` 白名单不含 `<a>` 与 `<table>`，且 `allowedAttributes: {}`**（`src/lib/sanitize-html.ts`）。该白名单是刻意对齐 TipTap StarterKit 的输出能力。未经扩展，早报中的来源链接与行情表格会在详情页被整段剥除。
5. **`getScreenerPayload()` 不可用于本功能**：`telegram-push/route.ts` 已记录它冷缓存时需「几十秒、数百个 BingX 请求」，会吃光 60s 预算。

### 行情口径（2026-08-08 实测修正，覆盖本文档早期表述）

**合约 ticker 的 `priceChangePercent` 不是 24 小时涨跌，不得用于早报。** 它只是约 3 分钟窗口（`screener-server.ts:134` 已记载）。同一时刻实测对照：

| 标的 | 合约 ticker | 现货 ticker |
|---|---|---|
| BTC-USDT | **0.00%** | **0.92%** |
| ETH-USDT | 0.00% | 0.59% |

若照早期表述用 `getFuturesTickers()` 算「24h 涨跌」，早报会每天把 3 分钟波动当成 24 小时行情写进正文并加以解读——一个每天都在说谎、却完全不报错的功能。

**正确来源是现货 24h ticker** `GET /openApi/spot/v1/ticker/24hr`（即 `getSpotTickers()`），与 `buildChange24hMap`（`screener-scoring.ts:115`）既有做法一致。实测 `openTime → closeTime` 相差正好 86,400,000 ms，确为真 24 小时窗口。

**黄金取 `XAUT-USDT`，不取 `NCCOGOLD2USD-USDT`。** 实测 2026-08-08（周六）：

- `NCCOGOLD2USD-USDT` 在现货盘**不存在**（它是合约独有的代币化标的），拿不到真 24h 涨跌。
- `XAUT-USDT`（Tether Gold）与 `PAXG-USDT`（Paxos Gold）现货均在，24h 分别 +1.37% / +1.43%，互为交叉校验。
- 两者是 24/7 交易的黄金代币，**不受周末与假日休市影响**——这同时解决了「代币化商品休市时无数据」的问题（`instruments.ts` 记载休市品种在 ticker/K线/深度接口一律返回 109415，早报每天都跑，必然撞上周末）。
- 行文中须表述为「黄金（XAUT）」一类可核查的说法，不得表述为伦敦金或 COMEX 黄金期货报价。

**早报标的集**（全部实测存在于现货盘）：`BTC-USDT`、`ETH-USDT`、`SOL-USDT`、`BNB-USDT`、`XRP-USDT`、`DOGE-USDT`、`XAUT-USDT`、`PAXG-USDT`。

**响应字段形态**：现货接口的 `priceChangePercent` 是**带百分号的字符串**（如 `"0.92%"`），而 `openPrice` / `lastPrice` 等返回的是**数字**而非 `BingXTicker` 类型声明的 `string`。一律用 `parseFloat(String(v))` 归一，勿直接做数值运算。
6. **`admin_settings` 是通用键值表**（`key TEXT UNIQUE` + `value JSONB`，见 `004_create_admin.sql`），新增配置项无需建表。
7. **`feature_flags` 表已在 038 迁移中删除**，新迁移不得写入该表（007 曾写过）。
8. 现有 `cron-auth.ts` 采用两级放行：带 `CRON_SECRET` 免限流，匿名 tick 走全站共享限流桶。**仓库是公开的**，这正是当初不把 secret 交给 workflow 的原因。

## 前置条件（阻塞项，实施第一步必须先处理）

**`.github/workflows/cron-tick.yml` 从未被提交过。** 2026-08-08 核实：`git ls-files .github` 返回 0，全历史无任何提交触及该目录。文件只存在于本地工作区，GitHub 上并无此 workflow——**当前线上的 `telegram-push` 与 `price-alerts` 实际上没有任何调度器在触发**。

这与 `cron-auth.ts` 中记载的既有事故完全同形：028 迁移里的 pg_cron 注册 SQL 是模板、从未在线上执行，正是「Telegram 一直不会自动推送」的根因。修复被写出来了，但没有被发布出去，同一个失败模式重演了一次。

本设计依赖该 workflow 作为调度器。若不先提交并推送，早报会以完全相同的方式静默不触发，且表现为「代码都对、就是没文章」——最难排查的一类故障。

因此实施顺序上：**先提交并推送 `.github/workflows/cron-tick.yml`，确认 Actions 面板出现运行记录并且 `cron_heartbeats` 有新鲜时间戳，再开始本功能的开发。** 早报的 step 追加在一个已被验证在跑的 workflow 上，而不是一个假设在跑的 workflow 上。

## 架构

### 数据流

```
GitHub Actions tick (UTC 00:00/00:30/…/02:30，共 6 次)
        │
        ▼
GET /api/cron/daily-briefing        maxDuration = 60，authorizeCronTick 鉴权
        │
        ├─① 幂等闸门 ── 今天(UTC+8)的 slug 已存在？ ──是──▶ 返回 { skipped }
        │
        ├─② 取素材（并行）
        │     ├─ 8 个 RSS 源 → Promise.allSettled → 过滤 24h 窗口
        │     └─ getSpotTickers() 一次请求 → 抽取 8 个标的的真 24h 行情事实集
        │
        ├─③ 生成（并行，各带硬超时）
        │     ├─ DeepSeek(zh-CN) → JSON
        │     └─ DeepSeek(en-US) → JSON
        │
        ├─④ 质量门槛 ── 逐条校验 JSON ──不通过──▶ 降级阶梯
        │
        └─⑤ 落库 → 渲染 HTML → insert articles → (可选)推送 → 写心跳
```

### 调度：时间窗内幂等 tick，而非「一天打一次」

在 `cron-tick.yml` 新增一个 step，`cron: "0,30 0-2 * * *"`（UTC）= UTC+8 早 08:00–10:30 每 30 分钟一次，共 6 次机会。第 ① 步保证只会成功产出一篇。

这样某次 tick 撞上 DeepSeek 抽风、网络抖动或 60s 超时，半小时后自动重试，而不是整天开天窗。这与 `telegram-push` 用 `isPushDue` 门控的思路完全同构，不引入新概念。GitHub Actions 的 schedule 常有数分钟漂移，30 分钟粒度对此完全不敏感。

**幂等靠数据库唯一约束，不靠先查后插。** slug 固定为 `daily-briefing-YYYY-MM-DD`（按 UTC+8 日界计算），直接 insert，捕获唯一约束冲突即视为「今天已出稿」。两个 tick 万一并发也不可能双写——`check-then-insert` 在并发下有窗口，唯一约束没有。

### 模块划分

新增目录 `src/lib/briefing/`，每个模块单一职责、可独立测试：

| 文件 | 职责 |
|---|---|
| `types.ts` | `BriefingJson`、`MarketFact`、`SourceItem` 等类型 |
| `date.ts` | UTC+8 日界计算、slug 生成、24h 窗口边界 |
| `sources.ts` | 早报专用 RSS 源清单 + 24h 过滤 + 条数下限判定 |
| `market-facts.ts` | `getSpotTickers()` → 标的行情事实集（真 24h 口径，见上文「行情口径」） |
| `prompt.ts` | 中/英 prompt 构造（含事实注入与硬约束） |
| `deepseek.ts` | DeepSeek 客户端：JSON 模式、硬超时、重试、模型切换 |
| `quality-gate.ts` | 质量门槛全部规则（纯函数） |
| `render.ts` | `BriefingJson` → HTML |
| `fallback.ts` | L4 零 AI 兜底稿的组装与渲染 |

RSS 解析逻辑目前是 `news-server.ts` 的模块私有函数（`decodeEntities` / `extractTag` / `extractImage` / `fetchFeed`）。抽取为 `src/lib/rss.ts` 供两边共用——这是服务于本次目标的定向改进，不是顺手重构：早报需要同一套解析器，复制一份会让两处解析行为随时间发散。抽取后 `news-server.ts` 只保留自己的 `lang` 标注与 TTL 缓存逻辑，行为不变。

早报的源清单**独立于**资讯页的源清单。资讯页按语言分栏展示原始条目，需要中文源；早报由模型改写，源是什么语言无所谓。两者耦合只会互相牵制。

### 为什么行情要注入模型

AI 写金融内容最常见的失败模式是编造价格。我们恰好持有真实行情，因此把它作为**事实集**注入 prompt，并在指令中禁止模型自行推断任何数字。质量门槛中的数字核对（见下）依赖同一份事实集，使「编价格」从「靠感觉发现」变成「机械可查」。

## 内容契约

### 模型返回 JSON，HTML 由我们渲染

不让模型直接产出 HTML。它返回结构化 JSON，服务端按固定模板渲染：

```json
{
  "title": "早报 | 8月8日 比特币回落，黄金创阶段新高",
  "summary": "一句话导读",
  "headlines": [
    { "topic": "加密货币",   "points": ["...", "..."] },
    { "topic": "黄金与大宗", "points": ["..."] },
    { "topic": "宏观金融",   "points": ["..."] }
  ],
  "analysis": {
    "overview":  "...",
    "crypto":    "...",
    "gold":      "...",
    "watchlist": ["今日关注：..."]
  }
}
```

三个理由：字段可逐条校验（质量门槛依赖于此）；渲染出的 HTML 结构与既有文章样式一致；模型再抽风也吐不出破损标签。`sanitizeArticleHtml` 仍在详情页兜第二道。

### Prompt 硬约束

- 行情数字**只能**引用注入的事实集，不得自行推断或回忆任何价格。
- 不得给出具体买卖点位、目标价、止损位或仓位建议。
- 不得使用「必涨」「稳赚」等确定性表述。
- 正文末尾固定附免责声明（模板文案，不由模型生成）。
- 按 DeepSeek JSON 模式要求：prompt 内出现 "json" 一词并给出上述格式示例。

### HTML 渲染

| 内容 | 标签 |
|---|---|
| 板块标题 | `<h2>` / `<h3>` |
| 要闻条目 | `<ul><li>` |
| **行情** | **`<ul><li>` + `<strong>`，不用 `<table>`** |
| 来源链接 | `<a href>` |
| 免责声明 | `<p><em>` |

**行情用列表而非表格**：白名单的 `allowedAttributes: {}` 意味着表格拿不到 class、无法做响应式样式，而 `ul/ol/li` 本就在白名单内且移动端更好读。

### sanitizer 扩展（必需的最小改动）

`src/lib/sanitize-html.ts` 需允许 `<a>`，否则来源链接会被剥除——新闻简报不标来源既失礼也不专业。改动限定为：

- `allowedTags` 增加 `"a"`。
- `allowedAttributes` 增加 `{ a: ["href", "rel", "target"] }`，其余标签维持 `{}` 不变。
- `allowedSchemes: ["http", "https"]`，杜绝 `javascript:` 伪协议。
- 用 `transformTags` 强制 `rel="nofollow noopener noreferrer"` 与 `target="_blank"`，不信任模型或源站给出的属性值。

不允许 `<table>` 系列、不允许任何事件属性，白名单其余部分不动。该扩展同时使后台人工撰写的文章可以带链接，属正向副作用。

## 降级阶梯（保底）

| 层级 | 触发条件 | 动作 |
|---|---|---|
| **L0** | 正常 | `v4-flash` 生成中英双语 → 质量门槛通过 → 发布 |
| **L1** | 单次调用失败、超时或**返回空内容** | 同一 tick 内重试 1 次 |
| **L2** | 重试仍失败，或质量门槛不通过 | 换 `v4-pro` 再生成一次 |
| **L3** | 两语中恰有一语成功 | 失败的那一语改用现有 Google Translate 通道翻译成功的那一版。英文失败时尤其关键——`en-US` 缺失会让英文与马来文读者看到空白正文 |
| **L4** | 上述均失败（LLM 链路整体不可用，或二次生成仍不过门槛） | **发布零 AI 兜底稿**；不合格的 AI 稿以 `is_published = false` 留档供复盘；告警 |
| **L5** | RSS 全部失败**且**行情取不到 | 不落库，心跳标 `error`，告警 |

**L4 是真正的保底。** 它不依赖 DeepSeek、不依赖任何模型：用 24h 内的 RSS 条目（标题 + 来源 + 链接）与真实行情，按固定模板机械拼装成《24 小时要闻速览》。内容全部是真实标题与真实价格的聚合，不含任何 AI 生成的判断，事实风险为零。直接发布——「今天这篇朴素了点」对每日栏目的伤害远小于「今天空一天」。

素材层自身亦有兜底：8 个 RSS 源走 `Promise.allSettled`（沿用 `news-server` 既有模式），挂掉几个不影响出稿；行情取不到则从 prompt 摘除数字部分并跳过行情列表渲染。

**告警**：降至 L4 或 L5 时，通过既有 `src/lib/telegram-send.ts` 给管理员发一条，同时经 Sentry 记录。杜绝「静默降级、三周后才发现」——这正是 `cron_heartbeats` 注释里记载过的失败模式。

## 质量门槛

校验对象是解析后的 `BriefingJson`，全部规则为纯函数，逐条可测：

| 检查项 | 规则 |
|---|---|
| 结构完整 | JSON 可解析；`title` / `summary` / `headlines`（≥2 个主题）/ `analysis.overview` 均存在且非空 |
| 截断检测 | 响应 `finish_reason !== "length"`；渲染后正文总长 > 400 字 |
| 长度区间 | 标题 10–60 字；导读 20–120 字；每个 `analysis` 段落 80–600 字 |
| **数字幻觉** | 抽取正文中所有价格与百分比形态的数字，逐个比对注入的行情事实集；比对不上即判定为编造。**容差：价格 ±0.5%（允许模型四舍五入），百分比 ±0.2 个百分点。** 仅校验价格与百分比两种形态，日期、条目计数、年份等不参与校验 |
| 禁用表述 | 「建议买入 / 目标价 / 止损位 / 必涨 / 梭哈 / 稳赚」及英文对应词表 |
| 语言串台 | `zh-CN` 版 CJK 字符占比须达阈值，`en-US` 版反之——防止模型中途换语言 |
| 素材充分 | 24h 内有效新闻条目少于 `MIN_SOURCE_ITEMS = 10` 则不调用模型，直接走 L4。8 个源在正常一天可产出数十条，低于 10 条意味着多数源已失效，此时让模型硬写只会得到注水内容 |

数字幻觉一条是门槛的核心价值所在，其余规则都是常规健壮性检查。

## 数据模型

### 迁移 `041_daily_briefing.sql`

1. 新增文章分类「每日早报」：
   `('{"en-US":"Daily Briefing","zh-CN":"每日早报","ms-MY":"Taklimat Harian"}', 'daily-briefing', 0)`
   每天一篇会把手写文章挤出「市场分析」分类，独立分类同时天然成为早报归档页。
2. 新增 `admin_settings` 键 `daily_briefing_push_enabled`，默认 `false`。
3. **不得**写入 `feature_flags`（该表已于 038 删除）。

### 落库字段

| 字段 | 值 |
|---|---|
| `slug` | `daily-briefing-YYYY-MM-DD`（UTC+8 日界） |
| `title` | `{"zh-CN": …, "en-US": …}` |
| `content` | `{"zh-CN": html, "en-US": html}` |
| `category_id` | 「每日早报」分类 ID |
| `author_id` | 取自环境变量 `BRIEFING_AUTHOR_ID` |
| `cover_image` | `null`——**不使用 RSS 源附带的图片**，那是第三方版权素材 |
| `tier_required` | `'free'` |
| `is_published` | 门槛通过或 L4 兜底稿为 `true`；不合格留档稿为 `false` |
| `published_at` | 发布时为当前时间 |

`author_id` 的 `NOT NULL` + 外键约束绕不过去，需预先创建「Chart-IX 编辑部」账号并把 UUID 配入环境变量。路由启动时校验该变量存在，缺失则直接走 L5 告警——比插入时才因外键报错更早暴露。

### 推送

复用 `buildContentMessage` 与 `getOptedInSubscriptions`。开关读 `admin_settings.daily_briefing_push_enabled`，**缺省视为关闭**——每天一条推送对用户是打扰，先观察内容质量若干天再由你手动打开。

### 后台手动触发

新增 `POST /api/admin/briefing/run-now`，沿用 `telegram-push/push-now` 既有模式（`requireAdmin` 鉴权 + 复用同一条流水线）。调试与补发都依赖它，实现成本很低。

## 密钥管理

- 新增环境变量 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`（默认 `deepseek-v4-flash`）、`DEEPSEEK_FALLBACK_MODEL`（默认 `deepseek-v4-pro`）、`BRIEFING_AUTHOR_ID`。
- 全部配置在 Vercel 环境变量，`.env.local.example` 只补空值占位与注释。
- 密钥**不得**进入 GitHub Actions workflow——仓库是公开的，这与 `cron-auth.ts` 记载的既有安全决策一致。cron step 仍只发匿名或带 `CRON_TICK_TOKEN` 的 HTTP 请求。
- 设计讨论期间在对话中明文出现过的 DeepSeek key 视为已泄露，**上线前必须在 DeepSeek 控制台吊销并重新签发**。

## 测试策略

沿用既有 `vitest`。只测纯函数，不测外部依赖：

| 测试文件 | 覆盖内容 |
|---|---|
| `quality-gate.test.ts` | 每条规则的通过 / 不通过双向用例；数字幻觉检测器（含容差边界、百分比与货币两种形态） |
| `render.test.ts` | `BriefingJson` → HTML；渲染结果经 `sanitizeArticleHtml` 后**不丢失任何预期内容**（回归防线：白名单未来若收紧，此测试会先红） |
| `fallback.test.ts` | L4 兜底稿在「有行情无新闻」「有新闻无行情」等组合下的渲染 |
| `date.test.ts` | UTC+8 日界与 slug 生成，含跨日、跨月、UTC 与 UTC+8 不同日的边界 |
| `sources.test.ts` | 24h 窗口过滤；**三种 pubDate 格式均可解析**（锁住上文实测结论）；条数下限判定 |
| `deepseek.test.ts` | 以 fixture 覆盖正常响应、**空内容响应**、`finish_reason: "length"` 截断响应三种真实故障样本；重试与模型切换逻辑 |

不对真实 DeepSeek 端点、真实 RSS 源发起网络请求——外部依赖用 fixture。

## 文件清单

**新增**

```
src/lib/briefing/{types,date,sources,market-facts,prompt,deepseek,quality-gate,render,fallback}.ts
src/lib/briefing/{quality-gate,render,fallback,date,sources,deepseek}.test.ts
src/lib/rss.ts                                   （自 news-server.ts 抽取）
src/app/api/cron/daily-briefing/route.ts
src/app/api/admin/briefing/run-now/route.ts
supabase/migrations/041_daily_briefing.sql
```

**修改**

```
src/lib/news-server.ts          改为复用 src/lib/rss.ts，行为不变
src/lib/sanitize-html.ts        白名单增加 <a>（限 http/https、强制 rel）
.github/workflows/cron-tick.yml 新增 daily-briefing step 与 schedule
.env.local.example              补 DEEPSEEK_* 与 BRIEFING_AUTHOR_ID 占位
```

## 明确不做（YAGNI）

- 不做周报／月报分支。
- 不做文章封面图生成——省成本，且第三方源图有版权风险。
- 不做段落级付费截断（现有系统只有整篇级 `tier_required`，早报既然全免费就不需要）。
- 不接入 `ms-MY` 生成——回退链已使马来文读者看到英文版，额外一次调用换不来对应价值。
- 不改动资讯页的源清单——早报与资讯页的源需求不同，耦合只会互相牵制。
