import { getFuturesTickers } from "@/lib/bingx/market";
import { buildMarketCapMap } from "@/lib/market-cap";
import { fetchMarketCapRows } from "@/lib/market-cap-fetch";
import { runWithConcurrency } from "@/lib/coinglass/client";
import { getPairsMarkets, getFundingRateList, pickExchangeRow } from "@/lib/coinglass/market";
import { getOpenInterestHistory } from "@/lib/coinglass/open-interest";
// getLiquidationCoinList 保留：它服务的是下面 rankForDeepScan 的预排序信号
// （爆仓异常度），跟已经退役的 Sweep 因子是两回事，不要因为删 Sweep 而连带删掉。
import { getLiquidationCoinList } from "@/lib/coinglass/liquidation";
import { getPriceHistory } from "@/lib/coinglass/price-history";
import { getTakerVolumeHistory } from "@/lib/coinglass/taker-volume";
import type {
  CoinGlassPairMarket,
  CoinGlassFundingRow,
  CoinGlassLiquidationCoin,
  CoinGlassPriceBar,
  CoinGlassTakerBar,
  CoinGlassOiBar,
} from "@/lib/coinglass/types";
import { preselect, amplitudeFromTicker, SERVER_GATE } from "./universe";
import type { PreselectCandidate } from "./universe";
import { rankForDeepScan } from "./preselect-rank";
import type { RankInput } from "./preselect-rank";
import { pickDirection, amplitudeFromBars } from "./score";
import { pickFundingRate } from "./funding";
import { classifyScenario } from "./factors/scenario";
import type { Direction, ScannerRow, ScannerPayload } from "./types";
import { DEEP_SCAN_LIMIT } from "./types";

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
 * toMarketStage 已经要求 BingX 那一行必须存在（否则整个币跳过），
 * 所以这里的回落分支实际不会触发。
 */
export const PRICE_EXCHANGE = "BingX";

interface MarketStage {
  candidate: PreselectCandidate;
  /** BingX 那一行，用于展示价格 */
  bingx: CoinGlassPairMarket;
  /** 拉 K 线用的交易所与合约 id —— 与下单盘口同源 */
  priceExchange: string;
  priceInstrumentId: string;
  volumeUsd: number;
  change24h: number | null;
}

/**
 * 行情层：一个币一次 pairs-markets，且只对预排序选中的 `DEEP_SCAN_LIMIT`
 * 个候选调用（见 runScan 里预排序那一段的注释）。
 *
 * 这里**不再**用 volume_usd 卡门槛（T19 之前有一个 `< SERVER_GATE.minVolumeUsd`
 * 就 return null 的检查，已删掉）：现在 pairs-markets 只对选中的
 * `DEEP_SCAN_LIMIT` 个调用，卡这个门槛只会让某几轮不足 `DEEP_SCAN_LIMIT` 行，
 * 而不会缩小上游调用量——门槛该起的作用已经被「只选这些进明细层」这件事本身
 * 取代了。真实成交额仍然写进 `ScannerRow.volumeUsd`，交给客户端滑块做流动性过滤。
 */
function toMarketStage(
  candidate: PreselectCandidate,
  rows: CoinGlassPairMarket[] | null
): MarketStage | null {
  if (!rows || rows.length === 0) return null;

  const bingx = rows.find((r) => r.exchange_name === BINGX_EXCHANGE);
  // BingX 那一行拿不到就整个跳过：没有它就没有可下单的价格，
  // 而这个页面唯一的出口就是跳去 BingX 下单。
  if (!bingx) return null;

  const price = pickExchangeRow(rows, PRICE_EXCHANGE);
  if (!price) return null;

  // 成交额用全交易所之和，而不是单家 —— 流动性门槛问的是「这个币好不好进出」，
  // 那是全市场的属性。
  const volumeUsd = rows.reduce((a, r) => a + (Number.isFinite(r.volume_usd) ? r.volume_usd : 0), 0);
  // 这条门槛只能在这里执行：CoinGlass 的成交额要逐币调 pairs-markets 才有，
  // 粗筛阶段查不到值。所以会有少数深度扫描名额落在这里被淘汰（实测 14 个里
  // 约掉 1 个）。粗筛那边用 SERVER_GATE.minBingxVolumeUsd 当粗略代理先挡一层。
  if (volumeUsd < SERVER_GATE.minVolumeUsd) return null;

  return {
    candidate,
    bingx,
    priceExchange: price.exchange_name,
    priceInstrumentId: price.instrument_id,
    volumeUsd,
    change24h: Number.isFinite(bingx.price_change_percent_24h)
      ? bingx.price_change_percent_24h
      : null,
  };
}

/**
 * 服务端一次算出整池榜单。
 *
 * T19 之前这里是三段式：批量层（tickers/市值/资金费率，0 次 CoinGlass 调用）
 * → 行情层（对*每个粗筛候选*调 pairs-markets）→ 明细层（对*每个行情层存活的
 * 候选*调 4 个端点）。粗筛池子常有 100–150 个候选，三段式在真实 key 下
 * 一轮要打 450–800 次 CoinGlass 调用，而 `API-KEY-MAX-LIMIT: 80`——差一个
 * 数量级，dryrun 直接被 429 打回、当时的四因子全部退化成缺数据的默认分
 * （见 client.ts 顶部 `COINGLASS_CONCURRENCY` 的注释）。
 *
 * 现在是四段式，一轮固定 74 次调用（`DEEP_SCAN_LIMIT` 目前推导为 18，见
 * `types.ts` 的注释——**这个数不是拍脑袋定的整数，是从限流器的真实配额
 * `RATE_LIMIT_PER_MIN` 推导出来的，改了限流器配额这里的次数会跟着变**。
 * T21 退役 Zone/Sweep 两因子之后每个币少打一次 liquidation/history，
 * `DEEP_SCAN_LIMIT` 因此从 14 涨到 18——同一条不等式，配额没变，
 * 单个币变便宜了，能塞进去的币就变多了）：
 *   ① 批量层（4 路，2 次 CoinGlass 调用）：BingX ticker（0 次）+ CoinGecko
 *      市值（0 次）+ `liquidation/coin-list`（1 次，全币爆仓，供 ③ 预排序用）+
 *      `funding-rate/exchange-list`（1 次，全币资金费率）。
 *   ② 粗筛：`preselect()`，0 次调用，只用批量层已有的数据。
 *   ③ 预排序：从粗筛池子里选出 `DEEP_SCAN_LIMIT` 个进入明细层，
 *      0 次调用（下面详细说）。
 *   ④ 明细层（`DEEP_SCAN_LIMIT` × 4 次调用）：只对预排序选中的候选依次调
 *      pairs-markets、open-interest/aggregated-history、price/history、
 *      taker-buy-sell-volume/history。
 *
 * `2 + DEEP_SCAN_LIMIT × 4` 必须 `≤ RATE_LIMIT_PER_MIN`（不是 CoinGlass 文档
 * 写的 80，是限流器实际生效的 75——两者的差就是限流器给「cron 刚扫完、用户
 * 马上刷新」这类重叠留的余量）。**这条不等式踩过一次真实的坑**：T19 第一版
 * `DEEP_SCAN_LIMIT` 直接写死 15，当时`DETAIL_CALLS_PER_COIN` 还是 5，
 * `2 + 15 × 5 = 77 > 75`，最后两次调用撞上限流器等待，一轮跑到 60.7 秒，
 * 撞破 Vercel Hobby 的 60 秒函数上限——这正是为什么 `DEEP_SCAN_LIMIT`
 * 现在改成从 `RATE_LIMIT_PER_MIN` 推导，而不是写死的常量，具体推导式与
 * 断言测试见 `types.ts`。
 *
 * 为什么是预排序而不是直接把 `DEEP_SCAN_LIMIT` 定成粗筛门槛的一部分：粗筛用的
 * 信号（市值、BingX 高低振幅）批量层就有，不花额外调用；但「这个币现在
 * 是否值得深挖」还需要爆仓异常度这个信号——liquidation/coin-list 同样
 * 是批量层已经拿到的数据，不花额外调用，所以能在明细层开始之前，
 * 用「爆仓异常度 + 振幅」各半的分数从粗筛池子里再挑一轮，把最值得
 * 打分的那些送进明细层，而不是任意选或者按粗筛的自然顺序截断。
 *
 * 预排序的代价（无法避免，不是疏忽）：OI/CVD 两个因子的数据只有
 * 进了明细层才能拿到，预排序阶段完全看不到，只能用爆仓与振幅这两个
 * 粗筛阶段就有的信号做代理。一个「爆仓平淡、振幅也一般，但 OI/CVD
 * 两项本来会打出高分」的币，在限流器 75/分钟的真实配额下就是进不了这一轮的深度扫描——
 * 这是配额约束下必然要接受的代价，下一轮扫描（15 分钟后）它仍有机会
 * 凭爆仓或振幅的变化被选中。
 *
 * 失败语义（与 spec 的降级矩阵一一对应）：
 *   · BingX ticker 失败或为空 → 抛错。没有可交易白名单，产出的榜单
 *     可能整片都是下不了单的币。
 *   · CoinGecko 市值失败或空 map → 抛错。这与旧的 6 维模型相反：那里
 *     市值只是 25% 权重的打分项，可以降级成中性分；这里市值是硬门槛，
 *     拿不到 = 门槛失效 = BTC/ETH 和查不到的合成品直接涌进小市值筛选器。
 *   · 资金费率整表失败 → 降级，fundingRate 全为 null。它在两因子模型里
 *     只是展示字段，不参与打分。
 *   · liquidation/coin-list 整表失败 → 降级，不中断。预排序退化成
 *     只按振幅排（爆仓这一半的信号对每个候选都是同一个常数，不再区分
 *     谁高谁低，实际效果等价于「爆仓百分位全给 0」，具体原理见
 *     preselect-rank.ts 里 percentileRank 的并列取平均名次注释）。
 *     它不是硬门槛，不该因为这一个批量端点挂掉就让整轮扫描失败。
 *   · 单个币的单个端点失败 → runWithConcurrency 把它写成 null，
 *     对应因子走各自的缺失分支，不牵连其他币。
 */
export async function runScan(): Promise<ScannerPayload> {
  const [tickersSettled, capSettled, fundingSettled, liquidationSettled] = await Promise.allSettled([
    getFuturesTickers(),
    fetchMarketCapRows(),
    getFundingRateList(),
    getLiquidationCoinList(),
  ]);

  if (tickersSettled.status === "rejected") {
    throw new Error(`BingX tickers unavailable: ${String(tickersSettled.reason)}`);
  }
  const tickers = tickersSettled.value;
  if (tickers.length === 0) throw new Error("BingX tickers unavailable: empty response");

  if (capSettled.status === "rejected") {
    throw new Error(`Market cap unavailable: ${String(capSettled.reason)}`);
  }
  const marketCapMap = buildMarketCapMap(capSettled.value);
  // 空 map 必须当成失败：它是真值，会让每个币都走「查不到市值」那条路被排除，
  // 结果是一份看起来正常的空榜单被 TTL 缓存原样钉住。
  if (Object.keys(marketCapMap).length === 0) {
    throw new Error("Market cap unavailable: empty map");
  }

  const fundingByCoin = new Map<string, CoinGlassFundingRow>();
  if (fundingSettled.status === "fulfilled") {
    for (const row of fundingSettled.value) fundingByCoin.set(row.symbol, row);
  } else {
    console.error("[screener] funding rate list unavailable, degrading to null", fundingSettled.reason);
  }

  const liquidationByCoin = new Map<string, CoinGlassLiquidationCoin>();
  if (liquidationSettled.status === "fulfilled") {
    for (const row of liquidationSettled.value) liquidationByCoin.set(row.symbol, row);
  } else {
    // 不抛错：预排序对拿不到的币会用 liq1h = liq24h = 0 填充，
    // 效果是退化成只按振幅排（见上面 runScan 顶部注释与
    // preselect-rank.ts 的 percentileRank 注释）。
    console.error(
      "[screener] liquidation coin-list unavailable, degrading preselect to amplitude-only",
      liquidationSettled.reason
    );
  }

  // ① 批量层粗筛
  const candidates = preselect(tickers, marketCapMap);

  // ② 预排序：从粗筛池子里选出 DEEP_SCAN_LIMIT 个进入明细层。
  // tickerBySymbol 只是为了把 preselect() 已经消费过的 ticker 重新按
  // symbol 找回来算振幅——PreselectCandidate 本身不携带这个数值
  // （粗筛只需要知道振幅达不达标，预排序才需要具体数值），非空断言
  // 是安全的：candidates 里的每个 bingxSymbol 都直接来自 tickers 数组。
  const tickerBySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const rankInputs: RankInput[] = candidates.map((c) => {
    const liq = liquidationByCoin.get(c.coin);
    return {
      candidate: c,
      amplitude: amplitudeFromTicker(tickerBySymbol.get(c.bingxSymbol)!),
      liq1h: liq?.liquidation_usd_1h ?? 0,
      liq24h: liq?.liquidation_usd_24h ?? 0,
    };
  });
  const deepScanTargets = rankForDeepScan(rankInputs, DEEP_SCAN_LIMIT);

  // ③ 行情层：只对预排序选中的 DEEP_SCAN_LIMIT 个调用 pairs-markets
  const pairRows = await runWithConcurrency(
    deepScanTargets.map((c) => () => getPairsMarkets(c.coin))
  );
  const staged = deepScanTargets
    .map((c, i) => toMarketStage(c, pairRows[i]))
    .filter((s): s is MarketStage => s !== null);

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
    detailTasks.push(() => getPriceHistory(s.priceExchange, s.priceInstrumentId));
    detailTasks.push(() => getTakerVolumeHistory(s.candidate.coin));
  }
  const detail = await runWithConcurrency(detailTasks);

  const rows: ScannerRow[] = [];
  for (let i = 0; i < staged.length; i++) {
    const s = staged[i];
    const base = i * 3;
    // 拿不到时传 []，不是 undefined——oiScore 现在吃序列，空数组和「请求失败」
    // 是同一件事，让它自己走中性分支（见 oi.ts oiScore 顶部注释）。
    const oiBars = (detail[base] as CoinGlassOiBar[] | null) ?? [];
    const priceBars = (detail[base + 1] as CoinGlassPriceBar[] | null) ?? [];
    const taker = (detail[base + 2] as CoinGlassTakerBar[] | null) ?? [];

    const price = s.bingx.current_price;
    if (!Number.isFinite(price) || price <= 0) continue;

    const { direction, total, factors } = pickDirection({
      price,
      priceBars,
      taker,
      oiBars,
    });

    // 六场景判定用的正是这三条序列——调用次数不变，明细层本来就都拉了。
    // scenario 为 null 是绝大多数币的预期行为（大多数币此刻没有摆动点对
    // 命中任何一格），不是 bug。
    const scenario = classifyScenario(priceBars, oiBars, taker);

    // 行的最终方向：有场景时用 scenario.direction（manage 除外，manage
    // 不是可下单方向，维持分数方向）；无场景时维持分数方向。完整优先级
    // 说明见 types.ts ScannerRow.direction 的字段注释——打分（total/
    // factors）永远只看 OI60+CVD40，不受这条优先级影响，场景只覆盖
    // 「显示成哪个方向」。
    const rowDirection: Direction =
      scenario && scenario.direction !== "manage" ? scenario.direction : direction;

    rows.push({
      symbol: s.candidate.bingxSymbol,
      coin: s.candidate.coin,
      direction: rowDirection,
      total,
      factors,
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
      sourceExchange: s.priceExchange,
    });
  }

  rows.sort((a, b) => b.total - a.total || a.symbol.localeCompare(b.symbol));

  return { rows, computedAt: Date.now() };
}
