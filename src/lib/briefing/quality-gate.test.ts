import { describe, it, expect } from "vitest";
import { extractPrices, extractPercents, parseBriefingJson, checkBriefing } from "./quality-gate";
import type { BriefingJson, MarketFact, BriefingSource } from "./types";

const FACTS: MarketFact[] = [
  { symbol: "BTC-USDT", label: "BTC", lastPrice: 64959.52, change24hPct: 0.92 },
  { symbol: "XAUT-USDT", label: "XAUT", lastPrice: 4325.51, change24hPct: 1.37 },
];

const SOURCES: BriefingSource[] = [
  { title: "美国 CPI 同比 3.1%", url: "https://e.com/1", source: "CNBC", publishedAt: 0, summary: "" },
];

// 夹具的每段长度都必须真的越过阈值，否则基线用例自己就过不了门槛。
// 实测（[...s].length）：overview 111 / crypto 109 / gold 100，正文合计 430，
// 三者均在 SECTION_MIN=80..SECTION_MAX=600 内，正文高于 BODY_MIN=400 共 30 字余量。
// 各用例替换的子串（$64,959.52、0.92%、1.37%）长度中性，替换后不会跌破阈值。
function validJson(over: Partial<BriefingJson> = {}): BriefingJson {
  return {
    title: "早报 | 8月8日 比特币小幅上行，黄金续创新高",
    summary: "过去二十四小时加密市场温和上行，黄金延续强势，宏观面关注美联储表态。",
    headlines: [
      { topic: "加密货币", points: ["比特币在六万四千美元上方反复震荡", "以太坊跟随大盘小幅走高"] },
      { topic: "黄金与大宗", points: ["黄金代币续创阶段新高，避险资金持续流入"] },
      { topic: "宏观金融", points: ["市场等待本周公布的通胀数据"] },
    ],
    analysis: {
      overview:
        "过去二十四小时市场整体偏暖，风险资产与避险资产同步走高，反映资金面宽松而非单边押注方向。这种组合通常出现在宏观预期尚未收敛的阶段，市场既不愿全面撤离风险，也不敢放弃避险头寸，因而呈现两头都不放的状态，等待更明确的政策指引。",
      crypto:
        "BTC 报 $64,959.52，二十四小时上涨 0.92%，涨幅温和且未伴随异常放量，属于区间内的正常波动。从成交结构看，买盘并未出现明显的集中释放，尚不足以判定趋势发生改变，需要继续观察后续几个交易日成交能否跟上。",
      gold:
        "黄金代币 XAUT 报 $4,325.51，二十四小时上涨 1.37%，明显强于同期加密资产，显示避险需求仍在累积。这与近期宏观不确定性上升的背景一致，后续值得留意其与实际利率之间的关系是否继续背离。",
      watchlist: ["关注美联储官员本周的公开讲话", "关注黄金能否站稳当前阶段高位"],
    },
    ...over,
  };
}

function check(json: unknown, finishReason: string | null = "stop") {
  return checkBriefing({ json, facts: FACTS, sources: SOURCES, locale: "zh-CN", finishReason });
}

describe("extractPrices", () => {
  it("抽取带 $ 与千分位的价格", () => {
    expect(extractPrices("BTC 报 $64,959.52 上行")).toEqual([64959.52]);
  });
  it("抽取多个价格", () => {
    expect(extractPrices("$1,000 与 $2.5")).toEqual([1000, 2.5]);
  });
  it("不把裸数字当价格", () => {
    expect(extractPrices("2026 年 8 月 8 日，共 12 条")).toEqual([]);
  });
});

describe("extractPercents", () => {
  it("抽取正负百分比", () => {
    expect(extractPercents("上涨 0.92%，下跌 -1.5%")).toEqual([0.92, -1.5]);
  });
  it("无百分比时返回空", () => {
    expect(extractPercents("没有数字")).toEqual([]);
  });
});

describe("parseBriefingJson", () => {
  it("解析裸 JSON", () => {
    expect(parseBriefingJson('{"title":"t"}')).toEqual({ title: "t" });
  });
  it("解析被 ```json 围栏包裹的输出", () => {
    expect(parseBriefingJson('```json\n{"title":"t"}\n```')).toEqual({ title: "t" });
  });
  it("空字符串返回 null（DeepSeek 文档明示会偶发空内容）", () => {
    expect(parseBriefingJson("")).toBeNull();
  });
  it("非法 JSON 返回 null", () => {
    expect(parseBriefingJson("{not json")).toBeNull();
  });
});

describe("checkBriefing", () => {
  it("合格稿通过", () => {
    expect(check(validJson()).ok).toBe(true);
  });

  it("finish_reason 为 length 判定截断", () => {
    const r = check(validJson(), "length");
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "truncated")).toBe(true);
  });

  it("缺字段判定结构不完整", () => {
    const r = check({ title: "t" });
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });

  it("headlines 少于 2 个主题不通过", () => {
    const r = check(validJson({ headlines: [{ topic: "加密货币", points: ["a"] }] }));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });

  it("标题过短不通过", () => {
    const r = check(validJson({ title: "早报" }));
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "length")).toBe(true);
  });

  it("编造的价格被抓出", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("$64,959.52", "$99,999.00");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("价格在 ±0.5% 容差内视为正确（允许模型四舍五入）", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("$64,959.52", "$65,000.00");
    expect(check(j).ok).toBe(true);
  });

  it("编造的涨跌幅被抓出", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("0.92%", "7.50%");
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "hallucinated-number")).toBe(true);
  });

  it("涨跌幅在 ±0.2 个百分点内视为正确", () => {
    const j = validJson();
    j.analysis.crypto = j.analysis.crypto.replace("0.92%", "1.00%");
    expect(check(j).ok).toBe(true);
  });

  it("headlines 里来自新闻的百分比不参与核对（避免误报）", () => {
    const j = validJson();
    j.headlines[0].points.push("美国 CPI 同比 3.1%");
    expect(check(j).ok).toBe(true);
  });

  it("analysis 中引用源文里出现过的数字不算编造", () => {
    const j = validJson();
    j.analysis.overview += "市场消化了 3.1% 的通胀读数，情绪趋于稳定，短期内仍以震荡为主。";
    expect(check(j).ok).toBe(true);
  });

  it("禁用表述被抓出", () => {
    const j = validJson();
    j.analysis.watchlist = ["建议买入 BTC"];
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "banned-phrase")).toBe(true);
  });

  it("英文禁用表述同样被抓出", () => {
    const j = validJson();
    j.analysis.overview = "We recommend buying now. " + j.analysis.overview;
    const r = checkBriefing({
      json: j, facts: FACTS, sources: SOURCES, locale: "zh-CN", finishReason: "stop",
    });
    expect(r.failures.some((f) => f.rule === "banned-phrase")).toBe(true);
  });

  it("中文稿写成英文被判语言串台", () => {
    const j = validJson({
      summary: "Over the past twenty four hours the market moved higher across the board today.",
    });
    j.analysis.overview =
      "Over the past twenty four hours risk assets and safe havens both advanced, which usually happens when macro expectations have not converged and market participants are waiting for clearer guidance from policymakers.";
    j.analysis.crypto =
      "Bitcoin traded at sixty four thousand and change over the session, with a mild advance that did not come with unusual volume, so the range remains intact for now and needs confirmation.";
    j.analysis.gold =
      "Gold tokens extended their advance during the period, outperforming crypto assets and signalling that hedging demand is still present across the broader market today.";
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "language")).toBe(true);
  });

  it("分析段落过短不通过", () => {
    const j = validJson();
    j.analysis.overview = "涨了。";
    const r = check(j);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "length")).toBe(true);
  });

  it("null 输入不抛错，判定结构不完整", () => {
    const r = check(null);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.rule === "structure")).toBe(true);
  });
});
