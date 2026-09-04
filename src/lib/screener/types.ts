import { RATE_LIMIT_PER_MIN } from "@/lib/coinglass/limits";
import type { AlertCardData } from "./cards";
import type { Ignition } from "./ignition";
import type { Scenario, ScenarioDirection } from "./factors/scenario";

export type Direction = "long" | "short";

/**
 * 警报表 `direction` 列 / `AlertRecord.direction` 用的类型（评审 F2 修复）。
 * 存的是"有效方向"：有场景时是 scenario.direction（可能是 manage），
 * 无场景（老警报）时是分数兜底方向（long/short）——direction 列与
 * currentPct/peakPct 的符号从此同源，不再存在"列面板显示 SHORT、
 * 涨跌却不翻号"这种自相矛盾。
 *
 * 跟 `ScannerRow.direction`（永远是 long/short，服务表格 pill 与下单
 * 按钮，manage 场景在 pipeline.ts 里已经兜底成分数方向）是两个不同的
 * 概念，一个管"警报卡该显示成什么"，一个管"这一行该跳到哪个下单方向"，
 * 不要混用。
 */
export type EffectiveDirection = ScenarioDirection;

/**
 * 扫描间隔 15 分钟。触发器（pg_cron / GitHub Actions）打得比这更密，
 * 由服务端按这个数门控——「漏掉的一轮由下一轮补上」，
 * 与早报和榜单推送是同一条原则。
 */
export const SCAN_INTERVAL_MS = 900_000;

/**
 * T22 之前，警报触发/关闭靠总分（OI60+CVD40）越过 ALERT_TRIGGER_SCORE(70)/
 * ALERT_CLOSE_SCORE(65) 两条线判断，这两个常量已删除——警报现在改成场景
 * 驱动（见 factors/scenario.ts 与 alerts.ts）：触发条件是「检测到场景」，
 * 不再是「总分首次达标」。总分（ScannerRow.total）仍然存在，仍然管表格
 * 排序，只是不再是警报状态机的判据。
 *
 * ALERT_CLOSE_STREAK 保留，但语义变了：原来是「连续多少次扫描低于关闭线
 * 才关」，现在是「场景连续消失多少轮才关」（约 45 分钟）——摆动点确认
 * 本身有滞后，场景短暂消失是常态抖动，不该立刻关警报。
 */
export const ALERT_CLOSE_STREAK = 3;

/** 批量层调用数：liquidation/coin-list + funding-rate/exchange-list，两次固定调用。 */
const BATCH_LAYER_CALLS = 2;

/**
 * 每个币在明细层要打的调用总数：open-interest/aggregated-history +
 * price/history + taker-buy-sell-volume 聚合版，三次。
 *
 * T24 从 4 降到 3：行情层的 pairs-markets 被 screener_volume_cache 取代了。
 * 它此前唯一的作用是取全市场成交额和 BingX 合约 id，而成交额现在由缓存
 * 提供（扫描时零配额），合约 id 直接用 BingX ticker 自己的 symbol
 * （实测 39 个里 38 个可直接当 CoinGlass 的 instrument_id 用）。
 *
 * 顺带修掉一个静默丢币的 bug：`pairs-markets?symbol=PEPE` 里**没有 BingX
 * 那一行**（BingX 把它上成 1000PEPE-USDT），旧的 toMarketStage 要求
 * BingX 行必须存在，所以所有带乘数的币（1000PEPE / 1000BONK /
 * 1000000BABYDOGE 等，实测 9 个）此前根本进不了榜单。
 *
 * 现在这个数**就是** pipeline.ts 里 `detailTasks` 的下标基数（`base = i * 3`）
 * ——T21～T23 期间两者语义不同（那时还有行情层单独一次调用走另一个数组），
 * 是这段代码最容易改错的地方，现在合二为一了。
 */
const DETAIL_CALLS_PER_COIN = 3;

/**
 * 一轮扫描进入明细层的币数上限，由 `RATE_LIMIT_PER_MIN` **推导**而不是写死的整数。
 *
 * T19 第一版直接写死 15：`2 + 15 × 5 = 77`，看着卡在 CoinGlass 文档写的
 * `API-KEY-MAX-LIMIT: 80`（每分钟）以内，但忘了限流器自己留了 5 次余量、
 * 真正生效的窗口是 `RATE_LIMIT_PER_MIN = 75`，`77 > 75`——真实 dryrun 里
 * 最后两次调用撞上限流器，等了将近一整个滚动窗口才放行，60.7 秒撞破
 * Vercel Hobby 的 60 秒函数上限。
 *
 * `DEEP_SCAN_LIMIT` 与 `RATE_LIMIT_PER_MIN` 是绑死的一对数：必须满足
 * `BATCH_LAYER_CALLS + DETAIL_CALLS_PER_COIN × DEEP_SCAN_LIMIT ≤ RATE_LIMIT_PER_MIN`，
 * 改任何一边都要重新满足这条不等式，光靠注释提醒守不住这种「两个常量必须配套」
 * 的约束（上一次翻车就是注释写对了、数字对不上）。所以这里不再写死数字，
 * 而是从 `RATE_LIMIT_PER_MIN` 用 `Math.floor` 反推——只要限流器的配额常量改了，
 * 这个上限会跟着自动重算，不可能再出现两处数字互相矛盾的情况。
 * `types.test.ts` 用一条断言把这条不等式钉死，防止未来有人绕开这个推导式
 * 直接把 `DEEP_SCAN_LIMIT` 改回一个写死的数字。
 */
export const DEEP_SCAN_LIMIT = Math.floor((RATE_LIMIT_PER_MIN - BATCH_LAYER_CALLS) / DETAIL_CALLS_PER_COIN);

/**
 * 实际送进明细层的币数：按 24h 振幅**从低到高**排名取前这么多——挑最安静的。
 *
 * **方向是反的，这是刻意的，而且是实测逼出来的。**
 *
 * 曾经这里取振幅最高的 20 个。那样确实能选到「会大动」的币（高振幅档
 * 未来 12h 大动作率 18.2%，是基准的 1.92 倍），但它回答错了问题：
 * 我们要的不是「哪个币会动」，是「哪个币**刚要开始**动」。
 *
 * 实测（45 个币 / 418 个不重叠时点）把这个区别量了出来——「捕获率」=
 * 进场后还能吃到的那段 ÷ 整段行情：
 *
 *   振幅最低 1/3   已走 2.2%  还能延续 2.8%  会回吐 0.8%  捕获率 56%
 *   振幅中间 1/3   已走 6.1%  还能延续 4.7%  会回吐 2.1%  捕获率 43%
 *   振幅最高 1/3   已走 7.8%  还能延续 3.9%  会回吐 5.3%  捕获率 33%   ← 曾经选这一档
 *
 * 高振幅那一档里 61% 的情况「回吐 > 延续」——**选中之后更可能是往回走**。
 * 换句话说旧口径系统性地在行情尾部进场。
 *
 * 叠加点火（detectIgnition）之后差距更极端（50 个币 / 84 次点火）：
 *   振幅最低 1/3 + 点火   延续 6.6% / 回吐 1.1%   延续占比 85%   胜率 83%
 *   振幅最高 1/3 + 点火   延续 2.4% / 回吐 8.9%   延续占比 21%   胜率 36%
 *
 * 顺带排除过一个更"讲究"的方案：用压缩比（6h振幅÷24h振幅）选币。实测它
 * **比不筛选还差**（延续占比 59% vs 不筛选的 82%），已放弃——别再试了。
 */
export const QUIET_RANK_TAKE = 20;

/**
 * 留给「已有卡片但这轮掉出振幅前 20」的币的名额。
 *
 * 卡片的去留必须只由信号决定（场景没了/变了/价格打穿失效线），不能因为
 * 「振幅排名掉了几位」就消失——排名第 20 与第 25 名实测只差 1.67 个百分点，
 * 边界纯粹是噪音。所以有卡片的币即使掉出前 20，也要继续被扫描，
 * 否则这一轮根本算不出它的场景还在不在。
 *
 * 这些名额是**白捡的**：配额允许 DEEP_SCAN_LIMIT(24) 个，而主表只要 20 个，
 * 剩下的 4 个本来就一直空着。实测每轮判出场景的只有 3–4 个币，而且大多
 * 本来就在前 20 里（高振幅），4 个名额绰绰有余。发现新机会的 20 个名额
 * 一个都不占。
 */
export const CARD_RESERVE_SLOTS = DEEP_SCAN_LIMIT - QUIET_RANK_TAKE;

/**
 * 两因子权重：OI 60 / CVD 40。保持退役前 Zone/Sweep/OI/CVD = 30/20/30/20
 * 里 OI:CVD = 30:20（即 3:2）的相对轻重不变，只是把 Zone 与 Sweep 空出来的
 * 50 分按同一个比例分给 OI 与 CVD，不趁机改变两者谁更重要。
 */
export const FACTOR_MAX = {
  oi: 60,
  cvd: 40,
} as const;

export interface FactorBreakdown {
  oi: number;
  cvd: number;
}

export interface ScannerRow {
  /** BingX 永续 symbol，如 "TIA-USDT"。下单链接与警报表都用它当主键。 */
  symbol: string;
  /** CoinGlass 币种名，如 "TIA"。剥掉了 -USDT 与合约乘数前缀。 */
  coin: string;
  /**
   * 这一行的最终方向。有场景时取 scenario.direction（manage 除外——manage
   * 表示「不是新趋势、该观望/止盈」，不是一个可以下单的方向，此时这个
   * 字段维持分数方向，供操作按钮使用；表格 pill 是否显示「观望」由前端
   * 单独判断 scenario.direction === "manage"）；无场景时维持分数方向
   * （OI60+CVD40 打分更高的一侧）。分数与排序的口径完全不受这条优先级
   * 影响：total/factors 永远是两个方向各打一遍分之后取更高的那侧，
   * 场景只覆盖「这一行该显示成哪个方向」，不覆盖打分本身。
   */
  direction: Direction;
  /** 0–100，等于 factors 两项之和（已取整）。打分口径不因 scenario 改变。 */
  total: number;
  factors: FactorBreakdown;
  /**
   * 哪些因子的上游序列这一轮整段拿不到。空数组 = 数据齐全。
   *
   * **为什么需要它：两个因子在缺数据时都会退回中性分**（OI 给 30、CVD 给 10，
   * 合计 40），于是一个上游全挂、什么都没算出来的币，和一个真实处于中性
   * 状态的币，在榜单上分数一样、排在一起，读者分不出哪个是「没信号」、
   * 哪个是「没数据」。实测一轮 dryrun 的分数几乎全挤在 31–65 这一段，
   * 很大程度就是这个原因。
   *
   * 缺数据时**不**把分数改成 null：分数在内部仍然要能参与比较（pickDirection
   * 要在 long/short 之间选一边），改成 null 会让打分链路上每一处都要处理
   * 空值。真正要修的是**展示**——榜单上这一行的分数显示成「—」并排到最后，
   * 而不是假装它是个 40 分。
   *
   * 警报路径不受影响：六场景判定要求三条序列齐全且等长，缺数据时返回 null，
   * 从来不会因为缺数据而误触发。
   */
  dataGaps: Array<"oi" | "cvd">;
  /**
   * 点火：当根收盘刚突破前 6 小时区间，null = 还在区间里。
   *
   * 这是这套系统里**唯一没有确认延迟**的信号（六场景要等摆动点确认，
   * 2.5 小时）。实测它本身就是主要信号：只要点火，未来 12 小时延续中位
   * 6.1% / 回吐 1.3%，延续占比 82%——而选币的作用是「别把它毁掉」
   * （最安静那档 85%，最吵那档塌到 21%）。完整数据见 ignition.ts。
   */
  ignition: Ignition | null;
  /** 六场景判定结果（factors/scenario.ts），无场景为 null。警报改成场景驱动之后，这是警报状态机的判据。 */
  scenario: Scenario | null;
  /**
   * price / change24h / amplitude / volumeUsd 这四个字段口径故意不同，
   * 各自回答不同的问题：
   *   · price 与 change24h 取 BingX ticker 自己的 lastPrice / priceChangePercent，
   *     两者必须同源——用户在哪儿下单就该看哪儿的价和涨跌，不能显示的价格
   *     来自 BingX、涨跌却来自另一个市场。（T24 之前取的是 pairs-markets 里
   *     BingX 那一行，同一个来源绕了一圈，还要多花一次调用。）
   *   · amplitude 取 BingX 的 30m K 线算，因为振幅要连续的价格序列。
   *     注意**选币排名用的是另一份**——BingX ticker 的 24h 高低，那份在
   *     批量层免费就有，不必等 K 线。实测两份几乎一致（14 个币中位差 0.0%、
   *     最大 0.3%），因为 CoinGlass 的 BingX K 线就是 BingX 自己的数据、
   *     48 根 30 分钟也正好是 24 小时。
   *   · volumeUsd 来自 screener_volume_cache，是全交易所 volume_usd 求和，
   *     因为流动性门槛问的是「这个币好不好进出」，那是全市场属性，
   *     不该只看下单那一家。
   */
  price: number;
  /** BingX 那一行的 24h 涨跌 %，与 price 同源（见上方 price 的注释） */
  change24h: number | null;
  /** 30m K 线算的真 24h 振幅 %，取自 history 交易所（见上方 price 的注释） */
  amplitude: number;
  /** CoinGlass 全交易所 volume_usd 之和（见上方 price 的注释） */
  volumeUsd: number;
  marketCap: number;
  marketCapRank: number;
  /** BingX 那一行的资金费率；缺失时是全交易所中位数；都拿不到为 null */
  fundingRate: number | null;
  /** K 线/CVD 实际取自哪个交易所，供前端标注数据来源 */
  sourceExchange: string;
}

/**
 * 扫描结果的**形状**版本。给 ScannerRow / ScannerPayload 加删字段时必须 +1。
 *
 * 存在的理由是一次真实的生产崩溃：给 ScannerRow 加了 `ignition` 字段之后，
 * DB 缓存里还躺着上一版算出来的 payload——那些行没有这个 key，读出来是
 * `undefined` 而不是 `null`，前端 `=== null` 的判断拦不住，直接读
 * `.direction` 就白屏了（TypeError: Cannot read properties of undefined）。
 *
 * **类型系统在这里帮不上忙**：payload 从 DB 读出来时是 `any`，一句
 * `as ScannerPayload` 就把它当成了当前版本的形状，而它其实是上一版的。
 * 同样的隐患 `dataGaps`（`r.dataGaps.length`）、`cards`、`newCards` 全都有。
 *
 * 版本对不上就当缓存不存在，下一个请求重算一遍——代价是一轮扫描，
 * 比白屏便宜太多。
 */
/**
 * 信号结束之后，卡片还灰着留多久。
 *
 * 这个值要覆盖「收到 Telegram 推送 → 有空点开看」的典型间隔。推送实测每
 * 20–35 分钟就有一批，而人不会每次都马上看。2 小时够覆盖绝大多数情况，
 * 又不至于让警报栏堆满昨天的东西。
 */
export const CARD_GRACE_MS = 2 * 60 * 60 * 1000;

/** 最多同时留几张已结束的卡。防止行情剧烈时警报栏被灰卡淹掉。 */
export const CARD_GRACE_MAX = 12;

export const SCANNER_PAYLOAD_VERSION = 10;

export interface ScannerPayload {
  /** 见 SCANNER_PAYLOAD_VERSION —— 形状对不上的缓存一律丢弃 */
  version: number;
  rows: ScannerRow[];
  /**
   * 六场景卡片，按总分从高到低。**它是 rows 的视图，不是独立的实体**
   * ——每一张都来自当轮扫描里判出场景、且未被价格打穿失效线的行。
   * 没有「关闭」这个动作：卡片不在 = 这一轮它就不成立。
   */
  cards: AlertCardData[];
  /**
   * 这一轮**新出现**的卡片（备忘表里刚建的那些）。给 Telegram 推送用，
   * 前端不消费——推送要回答的是「有什么新事」，而 cards 回答的是
   * 「现在有什么」，两者不是一回事。
   */
  newCards: AlertCardData[];
  /** 这份结果的计算时间，ms epoch —— 前端用它算倒计时 */
  computedAt: number;
}
