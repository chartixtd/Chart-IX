import { getFuturesTickers } from "@/lib/bingx/market";
import { buildMarketCapMap } from "@/lib/market-cap";
import { fetchMarketCapRows } from "@/lib/market-cap-fetch";
import { runWithConcurrency } from "@/lib/coinglass/client";
import { getFundingRateList } from "@/lib/coinglass/market";
import { getOpenInterestHistory } from "@/lib/coinglass/open-interest";
import { getPriceHistory } from "@/lib/coinglass/price-history";
import { getTakerVolumeHistory } from "@/lib/coinglass/taker-volume";
import type {
  CoinGlassFundingRow,
  CoinGlassPriceBar,
  CoinGlassTakerBar,
  CoinGlassOiBar,
} from "@/lib/coinglass/types";
import type { BingXTicker } from "@/types/bingx";
import { preselect, amplitudeFromTicker, SERVER_GATE } from "./universe";
import type { PreselectCandidate } from "./universe";
import { readVolumeCache } from "./volume-cache";
import type { CachedVolume } from "./volume-cache";
import { readMemos, saveMemos } from "./cards-store";
import { buildCard, sortCards, memoKey, ignitionMemoKey } from "./cards";
import type { AlertCardData, ScenarioMemo } from "./cards";
import { pickDirection, amplitudeFromBars } from "./score";
import { pickFundingRate } from "./funding";
import { classifyScenario } from "./factors/scenario";
import { scenarioInvalidated } from "./invalidation";
import { detectIgnition } from "./ignition";
import type { Direction, ScannerRow, ScannerPayload } from "./types";
import { QUIET_RANK_TAKE, CARD_RESERVE_SLOTS, SCANNER_PAYLOAD_VERSION } from "./types";
import { volumeRatio, VOLUME_RATIO_MIN } from "./volume-ratio";

/** 用户实际下单的交易所。价格与资金费率都取这一家。 */
export const BINGX_EXCHANGE = "BingX";

/*
 * 资金流类数据（主动买卖 → CVD）不再在这里选交易所。
 *
 * 曾经这里有一个 `FLOW_EXCHANGE = "Binance"`，理由是 CVD 问的是「**整个市场**
 * 的钱往哪边走」，要在最深的池子里取样而不是在用户执行的那个池子里
 * （BingX 成交量普遍比 Binance 薄一个数量级：实测 VELVET 8.2M vs 108.1M、
 * COMP 2.9M vs 24.6M）。这个理由今天依然成立，只是**实现方式变了**：
 * CoinGlass 有一个多交易所聚合的主动买卖端点，直接按币名取四家之和，
 * 比「挑一家最深的」更贴近「整个市场」这个原意，也不再需要先解析出
 * 某家交易所的 instrument_id。选哪四家与为什么，见 taker-volume.ts 的
 * CVD_EXCHANGES。
 *
 * 价格那一侧的取舍与这里相反，见下面 PRICE_EXCHANGE。
 */

/**
 * 价格类数据（K 线 → OI 背离判断与真振幅）取哪一家。
 *
 * 和资金流相反，这一类必须跟用户下单的盘口同源：OI 因子判断的是「持仓量
 * 变化配合的是不是这个盘口的真实价格走势」、振幅判断的是「今天这个盘口
 * 真的在动吗」，两者都是拿去 BingX 执行的，用别家的 K 线算等于按 A 市场的
 * 走势在 B 市场下单。
 *
 * 这个常量现在同时是「拉哪家 K 线」和「表格上标的来源」——T24 去掉行情层
 * 之后不再有「BingX 拿不到就回落到别家」这条分支：候选本来就来自 BingX
 * ticker，合约 id 就是那个 symbol，不存在挑不到的情况。
 */
export const PRICE_EXCHANGE = "BingX";

export interface ScanTarget {
  candidate: PreselectCandidate;
  /** BingX ticker 的 24h 高低算出的振幅，% —— 选币排名的唯一依据 */
  amplitude: number;
  /** 全交易所成交额之和，来自 screener_volume_cache（扫描时零配额） */
  volumeUsd: number;
  /** BingX 最新成交价 */
  price: number;
  change24h: number | null;
  /**
   * 进主表还是只坐复核名额。
   * 复核名额上的币这一轮照样被完整扫描（要算出它的场景还在不在），
   * 但**不进主表**——主表是「振幅前 20」，它已经不在里面了。
   */
  inMainTable: boolean;
}

/**
 * 选币：成交量门槛 + 振幅排名。**这一整段不花任何上游调用。**
 *
 * T24 之前这里是「预排序（爆仓异常度 + 振幅各半）挑出 N 个 → 行情层逐个调
 * pairs-markets 拿成交额 → 不达标的丢掉」。那套的毛病是成交额门槛只对
 * 已经选中的币生效：选中了，进来才发现不达标，这一轮就白少一行。
 *
 * 现在成交额来自缓存，所以门槛能在**全池**生效，选出来的每个币都是
 * 已经过了流动性门槛的。名额不再被浪费。
 *
 * 振幅从「门槛」改成「排名」的理由是实测的：固定门槛在不同行情下筛掉的
 * 比例天差地别（同样一条 8%，过去七天有 76% 的时点在它之下，而大行情日
 * 只有 27%），候选池大小会自己漂；排名则不管行情如何都稳定输出这么多行。
 * 详见 universe.ts 里 SERVER_GATE 下方那段删除说明。
 *
 * 拿不到缓存的币直接排除，与市值同一条原则：下限是「必须证明达标」的
 * 条件，证明不了就当不达标。新上市的币会在轮转刷到它之后进入候选
 * （见 volume-cache.ts 的 pickStaleCoins——未缓存的排在刷新队列最前）。
 */
export function buildScanTargets(
  candidates: PreselectCandidate[],
  tickerBySymbol: Map<string, BingXTicker>,
  volumeCache: Map<string, CachedVolume>,
  cardSymbols: Set<string> = new Set()
): ScanTarget[] {
  const targets: ScanTarget[] = [];
  for (const candidate of candidates) {
    const cached = volumeCache.get(candidate.coin);
    if (!cached || cached.volumeUsd < SERVER_GATE.minVolumeUsd) continue;

    const ticker = tickerBySymbol.get(candidate.bingxSymbol);
    if (!ticker) continue;

    // 价格取 BingX ticker 自己的最新成交价。T24 之前取的是 pairs-markets
    // 里 BingX 那一行的 current_price——同一个来源绕了一圈，而且那一圈
    // 要花一次调用，还会静默丢币（见下面 bingxSymbol 的注释）。
    const price =
      typeof ticker.lastPrice === "number" ? ticker.lastPrice : parseFloat(ticker.lastPrice);
    if (!Number.isFinite(price) || price <= 0) continue;

    const change = parseFloat(ticker.priceChangePercent);
    targets.push({
      candidate,
      amplitude: amplitudeFromTicker(ticker),
      volumeUsd: cached.volumeUsd,
      price,
      change24h: Number.isFinite(change) ? change : null,
      inMainTable: true,
    });
  }

  // 振幅**从低到高**——挑最安静的，不是最吵的。方向反过来的完整依据见
  // types.ts 的 QUIET_RANK_TAKE 注释（实测：高振幅档捕获率只有 33%，
  // 且 61% 的情况回吐大于延续；低振幅档捕获率 56%，延续是回吐的 3.5 倍）。
  // 并列时按 symbol 排，只是为了让结果稳定可复现。
  targets.sort(
    (a, b) => a.amplitude - b.amplitude || a.candidate.bingxSymbol.localeCompare(b.candidate.bingxSymbol)
  );

  const picked = targets.slice(0, QUIET_RANK_TAKE);

  // 已有卡片但这轮掉出前 20 的币，坐配额里空着的那几个名额继续扫。
  // 不这么做的话，它们这一轮算不出场景，卡片会因为「排名掉了」而消失
  // ——而卡片消失必须只意味着「信号没了」，否则那个信号就不可信了。
  // 它们**追加**在 picked 之后而不是顶掉谁：主表的 20 行一个都不少。
  const inMain = new Set(picked.map((t) => t.candidate.bingxSymbol));
  const needsReserve = targets.filter(
    (t) => cardSymbols.has(t.candidate.bingxSymbol) && !inMain.has(t.candidate.bingxSymbol)
  );
  const reserved = needsReserve
    .slice(0, CARD_RESERVE_SLOTS)
    .map((t) => ({ ...t, inMainTable: false }));

  // 名额不够时要出声。**这个失败是完全静默的**：被挤掉的币这一轮算不出
  // 信号，它的卡片就消失了，而消失看起来跟「信号没了」一模一样。
  //
  // 4 个名额当初是按「每轮判出场景的只有 3–4 个币」定的，那是六场景时代的
  // 数字。点火卡出现得比场景卡频繁得多，而且**刚点火的币按定义正在变吵**，
  // 很容易下一轮就掉出「最安静的 20 个」——这两件事叠起来，挤爆的概率比
  // 当初高。真挤爆了就该调 QUIET_RANK_TAKE / CARD_RESERVE_SLOTS 的配比，
  // 但那要拿线上数据定，不是现在拍。
  if (needsReserve.length > CARD_RESERVE_SLOTS) {
    console.warn(
      `[screener] 复核名额不够：${needsReserve.length} 个有卡片的币掉出主表，` +
        `只能复核 ${CARD_RESERVE_SLOTS} 个，其余 ${needsReserve.length - CARD_RESERVE_SLOTS} 张卡片会因为排名而不是因为信号消失`
    );
  }

  return [...picked, ...reserved];
}

/**
 * 服务端一次算出整池榜单。四段式，一轮固定 `1 + QUIET_RANK_TAKE × 3` 次
 * CoinGlass 调用（当前 61 次）：
 *
 *   ① 批量层（1 次调用）：BingX ticker（0 次）+ CoinGecko 市值（0 次）+
 *      `funding-rate/exchange-list`（1 次，全币资金费率，仅供展示）。
 *   ② 粗筛 `preselect()`：0 次调用，只用批量层已有的数据。
 *   ③ 选币 `buildScanTargets()`：0 次调用。成交量门槛读 screener_volume_cache
 *      （由 cron 空转的 tick 轮转刷新，见 volume-cache.ts），振幅排名取前
 *      `QUIET_RANK_TAKE` 个（**最安静的**，不是最吵的）。
 *   ④ 明细层（`QUIET_RANK_TAKE × 3` 次）：open-interest/aggregated-history +
 *      price/history + 聚合版 taker-buy-sell-volume。
 *
 * `BATCH_LAYER_CALLS + DETAIL_CALLS_PER_COIN × DEEP_SCAN_LIMIT ≤ RATE_LIMIT_PER_MIN`
 * 这条不等式仍然是硬约束（推导式与断言测试见 types.ts）。**它踩过一次真实的坑**：
 * T19 第一版把上限写死成 15，`2 + 15 × 5 = 77 > 75`，最后两次调用撞上限流器
 * 等待，一轮跑到 60.7 秒，撞破 Vercel Hobby 的 60 秒函数上限。所以那个上限
 * 至今是从限流器配额推导的，不是写死的整数。
 *
 * 注意 `QUIET_RANK_TAKE`（想看几行，20）与 `DEEP_SCAN_LIMIT`（配额允许的
 * 上限，24）是两个不同的数，不要合并——理由见 types.ts 那两个常量的注释。
 *
 * **T24 相对上一版的三处结构性改动：**
 *
 * 1. 行情层（逐币 pairs-markets）整个消失了。它此前唯一的产出是全市场成交额
 *    和 BingX 合约 id：成交额现在来自缓存，合约 id 直接用 BingX ticker 自己的
 *    symbol。每个币从 4 次调用降到 3 次。
 * 2. 顺带修掉一个静默丢币的 bug：`pairs-markets?symbol=PEPE` 里**没有 BingX
 *    那一行**（BingX 把它上成 1000PEPE-USDT），旧代码要求 BingX 行必须存在，
 *    所以所有带乘数的币（实测 9 个：1000PEPE / 1000BONK / 1000000BABYDOGE …）
 *    此前根本进不了榜单。
 * 3. 预排序（爆仓异常度 + 振幅各半）退役，选币改成纯振幅排名。爆仓那一半
 *    从未被真实数据验证过，而振幅至少有一个方向性证据支持；在回测台建好
 *    之前，用一个未验证的信号去加权另一个未验证的信号，只是把不确定性
 *    叠起来。`liquidation/coin-list` 因此也不再拉，批量层从 2 次降到 1 次。
 *
 * 失败语义：
 *   · BingX ticker 失败或为空 → 抛错。没有可交易白名单，产出的榜单
 *     可能整片都是下不了单的币。
 *   · CoinGecko 市值失败或空 map → 抛错。市值是硬门槛，拿不到 = 门槛失效
 *     = BTC/ETH 和查不到的合成品直接涌进小市值筛选器。
 *   · 成交量缓存读失败 → readVolumeCache 返回空 Map，这一轮**没有任何币
 *     能证明成交量达标**，榜单为空。这是刻意的：宁可空榜也不要一份
 *     绕过了流动性门槛的榜单。缓存表是独立的一张表，读失败是罕见事件，
 *     而下一轮（15 分钟后）会自愈。
 *   · 资金费率整表失败 → 降级，fundingRate 全为 null，只是展示字段。
 *   · 单个币的单个端点失败 → runWithConcurrency 把它写成 null，
 *     对应因子走各自的缺失分支，不牵连其他币。
 */
export async function runScan(): Promise<ScannerPayload> {
  const [tickersSettled, capSettled, fundingSettled, volumeCache, memos] = await Promise.all([
    getFuturesTickers().then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e })
    ),
    fetchMarketCapRows().then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e })
    ),
    getFundingRateList().then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e })
    ),
    // 两张缓存表，不打上游，与三个网络请求并行只是为了少等一个来回
    readVolumeCache(),
    readMemos(),
  ]);

  if (!tickersSettled.ok) {
    throw new Error(`BingX tickers unavailable: ${String(tickersSettled.e)}`);
  }
  const tickers = tickersSettled.v;
  if (tickers.length === 0) throw new Error("BingX tickers unavailable: empty response");

  if (!capSettled.ok) {
    throw new Error(`Market cap unavailable: ${String(capSettled.e)}`);
  }
  const marketCapMap = buildMarketCapMap(capSettled.v);
  // 空 map 必须当成失败：它是真值，会让每个币都走「查不到市值」那条路被排除，
  // 结果是一份看起来正常的空榜单被 TTL 缓存原样钉住。
  if (Object.keys(marketCapMap).length === 0) {
    throw new Error("Market cap unavailable: empty map");
  }

  const fundingByCoin = new Map<string, CoinGlassFundingRow>();
  if (fundingSettled.ok) {
    for (const row of fundingSettled.v) fundingByCoin.set(row.symbol, row);
  } else {
    console.error("[screener] funding rate list unavailable, degrading to null", fundingSettled.e);
  }

  // ② 粗筛：只用批量层已有的免费数据（BingX ticker + CoinGecko 市值）
  const candidates = preselect(tickers, marketCapMap);

  // ③ 选币：成交量门槛（读缓存）+ 振幅排名，0 次上游调用。
  // tickerBySymbol 是为了把 preselect() 已经消费过的 ticker 按 symbol 找回来
  // ——PreselectCandidate 本身不携带价格与振幅（粗筛不需要它们）。
  const tickerBySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const cardSymbols = new Set([...memos.values()].map((m) => m.symbol));
  const staged = buildScanTargets(candidates, tickerBySymbol, volumeCache, cardSymbols);

  // ④ 明细层：三个端点共用同一个并发池，所以并发上限是对上游的真实总上限。
  // staged 现在最多 DEEP_SCAN_LIMIT 个，入队顺序与下面取结果的 base + 0..2 下标算术
  // 保持原样不动（评审逐个验算过的对齐关系，见下方注释）。
  //
  // T21 退役 Zone/Sweep 之后这里从 4 个端点降到 3 个（去掉了 getLiquidationHistory），
  // 下标基数因此要跟着从 `i * 4` 改成 `i * 3`——这是这次改动最容易漏改的一处：
  // 只改入队数量、忘了改下标基数，不会报错，只会让每个币从这里往后的
  // oiBars/priceBars/taker 全部读到别的币的数据，分数悄悄整体错位。
  // 手工验算（staged 有 3 个币时，detailTasks 的 9 个元素分别对应谁）：
  //   detailTasks = [oi0, price0, taker0, oi1, price1, taker1, oi2, price2, taker2]
  //   i=0 → base=0 → detail[0]=oi0  detail[1]=price0  detail[2]=taker0
  //   i=1 → base=3 → detail[3]=oi1  detail[4]=price1  detail[5]=taker1
  //   i=2 → base=6 → detail[6]=oi2  detail[7]=price2  detail[8]=taker2
  const detailTasks: Array<() => Promise<unknown>> = [];
  for (const s of staged) {
    detailTasks.push(() => getOpenInterestHistory(s.candidate.coin));
    // K 线取下单盘口（OI 判断与振幅要跟执行同源），资金流取最深的池子
    // （CVD 统计的是整个市场的方向，薄盘口取样会让它失效）。
    // 调用次数不变，只是 exchange 参数不同。
    // BingX ticker 的 symbol 直接就是 CoinGlass 的 instrument_id（实测 39 个
    // 里 38 个可用，唯一的例外是 CoinGlass 上根本查不到的币）。这样就不必
    // 先调 pairs-markets 去找 instrument_id——那一步不但费一次调用，还会
    // 把所有带乘数的币整个丢掉（见 runScan 顶部第 2 条）。
    detailTasks.push(() => getPriceHistory(PRICE_EXCHANGE, s.candidate.bingxSymbol));
    detailTasks.push(() => getTakerVolumeHistory(s.candidate.coin));
  }
  const detail = await runWithConcurrency(detailTasks);

  const rows: ScannerRow[] = [];
  const cards: AlertCardData[] = [];
  const newMemos: ScenarioMemo[] = [];
  const now = Date.now();
  for (let i = 0; i < staged.length; i++) {
    const s = staged[i];
    const base = i * 3;
    // 拿不到时传 []，不是 undefined——oiScore 现在吃序列，空数组和「请求失败」
    // 是同一件事，让它自己走中性分支（见 oi.ts oiScore 顶部注释）。
    const oiBars = (detail[base] as CoinGlassOiBar[] | null) ?? [];
    const priceBars = (detail[base + 1] as CoinGlassPriceBar[] | null) ?? [];
    const taker = (detail[base + 2] as CoinGlassTakerBar[] | null) ?? [];

    const price = s.price;

    // 「整段拿不到」= 对应的序列是空数组（上游请求失败或这个币在 CoinGlass
    // 上查不到）。两个因子各自需要哪几条序列，与它们内部的取数一致：
    // OI 要持仓量 + K 线（象限判断比的是两者的配合），CVD 要主动买卖 + K 线
    // （背离那一半要比价格走向）。
    const dataGaps: Array<"oi" | "cvd"> = [];
    if (oiBars.length === 0 || priceBars.length === 0) dataGaps.push("oi");
    if (taker.length === 0 || priceBars.length === 0) dataGaps.push("cvd");
    const { direction, total, factors } = pickDirection({
      price,
      priceBars,
      taker,
      oiBars,
    });

    // 六场景判定用的正是这三条序列——调用次数不变，明细层本来就都拉了。
    // scenario 为 null 是绝大多数币的预期行为（大多数币此刻没有摆动点对
    // 命中任何一格），不是 bug。
    //
    // **失效判定在这里做，不在卡片那一层做。** 场景只比较两个已确认的
    // 摆动点，完全不看那之后价格走去了哪儿，所以它会长期报出一个早就
    // 死掉的结构：实测 APR 的存量清算锚在 0.1821 → 0.1744 两个低点上，
    // 而价格已经反弹到 0.2217（比失效线高 21%）。此前失效只在卡片那层
    // 判，后果是**主扫描表照样显示「存量清算 · 分批止盈，等反手」，
    // 而卡片是空的**——两个视图对同一个币给出相反的结论。
    //
    // 置 null 而不是加个标记：一个已经被价格证伪的结构，不该出现在
    // 「现在是哪种局面」这个问题的答案里，表格和卡片都不该。
    // 点火：当根收盘突破前 6 小时区间。**这是唯一没有确认延迟的信号**——
    // 六场景要等摆动点确认（2.5 小时），等到了就不叫「刚启动」了。
    const ignition = detectIgnition(priceBars, oiBars);

    const raw = classifyScenario(priceBars, oiBars, taker);
    const scenario = raw && !scenarioInvalidated(raw, priceBars) ? raw : null;

    // 行的最终方向：有场景时用 scenario.direction（manage 除外，manage
    // 不是可下单方向，维持分数方向）；无场景时维持分数方向。完整优先级
    // 说明见 types.ts ScannerRow.direction 的字段注释——打分（total/
    // factors）永远只看 OI60+CVD40，不受这条优先级影响，场景只覆盖
    // 「显示成哪个方向」。
    const rowDirection: Direction =
      scenario && scenario.direction !== "manage" ? scenario.direction : direction;

    const row: ScannerRow = {
      symbol: s.candidate.bingxSymbol,
      coin: s.candidate.coin,
      direction: rowDirection,
      total,
      factors,
      dataGaps,
      ignition,
      scenario,
      price,
      change24h: s.change24h,
      // K 线拿不到时退回 0：振幅只用于展示与客户端滑块过滤，
      // 0 会被任何滑块挡住，这正是「数据不全就别推荐」的正确行为。
      amplitude: amplitudeFromBars(priceBars) ?? 0,
      volumeUsd: s.volumeUsd,
      marketCap: s.candidate.marketCap,
      marketCapRank: s.candidate.marketCapRank,
      fundingRate: pickFundingRate(fundingByCoin.get(s.candidate.coin), BINGX_EXCHANGE),
      // 展示的是**价格/K 线**的来源（也就是下单盘口），不是资金流的来源。
      // 表格里这个标签紧挨着 symbol 与价格，标的就是「这一行的价格是哪儿的」。
      sourceExchange: PRICE_EXCHANGE,
    };

    // 成交量正在萎缩的币整个剔除——不进主表，也不出卡片。
    //
    // 绝对门槛（2000万）只能挡掉完全没法交易的币，挡不掉「平时一天 5 亿、
    // 今天只有 8000 万」这种：绝对量很漂亮，但行情其实已经走完了。
    // 量能比拿这个币自己平时的量当基准，问的是「它现在比平时活跃还是清淡」。
    //
    // 算不出来时**不拦**（volumeRatio 返回 null）——理由见 volume-ratio.ts：
    // 证明不了在萎缩不等于在萎缩，拿一个算不出来的指标删行只会让榜单
    // 无声变短。
    const volRatio = volumeRatio(taker);
    if (volRatio !== null && volRatio < VOLUME_RATIO_MIN) continue;

    // 复核名额上的币不进主表——主表是排名前 20，它已经不在里面了。
    // 但它的卡片照常参与下面的判定，这正是给它留名额的全部意义。
    if (s.inMainTable) rows.push(row);

    // 场景**或**点火都能出卡片，两者都没有才跳过。
    //
    // 加上点火这一路，是因为选币翻成「最安静」之后六场景几乎判不出来：
    // 它的第一道门要求「价格创了新极值且至少差 1%」，而安静的币正在区间
    // 里横盘，按定义就不创新极值。实测最吵的 25 个币 48% 能过这道门，
    // 最安静的 25 个只有 8%——线上的表现是场景数从每天 8–26 个直接掉到 0。
    // 不是判定坏了，是选币和警报两边要的东西相反。详见 cards.ts CardTrigger。
    //
    // 钥匙要按触发源分别拼，所以这里跟 buildCard 里的优先级必须一致：
    // 场景优先。不一致的话会拿场景的钥匙去查点火卡的备忘，每轮都查不到，
    // 卡片的首次价与计时永远重置。
    const cardKey = scenario
      ? memoKey(row.symbol, scenario)
      : ignition
        ? ignitionMemoKey(row.symbol, ignition)
        : null;
    if (cardKey) {
      const built = buildCard({ row, priceBars, memo: memos.get(cardKey), now });
      if (built.newMemo) newMemos.push(built.newMemo);
      if (built.card) cards.push(built.card);
    }
  }

  // 写备忘顺带清过期。放在返回之前而不是 await 之后再算，是因为写失败
  // 不该影响这一轮的产出——saveMemos 内部吞掉错误，只记录。
  await saveMemos(newMemos, now);

  // 数据不全的行一律沉底，不参与分数排序——它们的分数是缺失回退值，
  // 拿它跟真实算出来的分数比大小没有意义。
  rows.sort(
    (a, b) =>
      a.dataGaps.length - b.dataGaps.length ||
      b.total - a.total ||
      a.symbol.localeCompare(b.symbol)
  );

  const newKeys = new Set(newMemos.map((m) => m.key));
  return {
    version: SCANNER_PAYLOAD_VERSION,
    rows,
    cards: sortCards(cards),
    newCards: cards.filter((c) => newKeys.has(c.key)),
    computedAt: now,
  };
}

/**
 * 成交量缓存该覆盖哪些币：过了所有**免费**门槛的候选。
 *
 * 与 runScan 共用同一个 `preselect()`，这是刻意的——两边如果各写一份口径，
 * 迟早会漂：缓存里刷的是 A 集合、扫描时按 B 集合筛，交集之外的币
 * 要么永远缺成交量（进不了榜），要么白白占着轮转名额。
 *
 * 只用 BingX ticker + CoinGecko 市值，0 次 CoinGlass 调用。
 */
export async function listVolumeRefreshCoins(): Promise<string[]> {
  const [tickers, capRows] = await Promise.all([getFuturesTickers(), fetchMarketCapRows()]);
  const marketCapMap = buildMarketCapMap(capRows);
  if (tickers.length === 0 || Object.keys(marketCapMap).length === 0) return [];
  return preselect(tickers, marketCapMap).map((c) => c.coin);
}
