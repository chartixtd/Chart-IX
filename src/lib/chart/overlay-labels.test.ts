import { describe, it, expect } from "vitest";
import { buildOverlayLabels, type Translate } from "./overlay-labels";
import zh from "@/i18n/messages/zh-CN.json";
import en from "@/i18n/messages/en-US.json";
import ms from "@/i18n/messages/ms-MY.json";

/**
 * 防的是这个 bug：**英文界面上，图表里画的是中文。**
 *
 * 线索是这些字画在 canvas 上——页面 DOM 里一个中文字都搜不到，截图才看得见，
 * 所以除了「每种语言都拼得出话」，这里还额外盯死两件事：
 *   ① 三份 messages 的 key 一个都不能缺（缺了 next-intl 只会把 key 原样画出来）
 *   ② 英文/马来文的值里不许出现汉字（写死中文的老路）
 */

const LOCALES = { "zh-CN": zh, "en-US": en, "ms-MY": ms } as const;
const CJK = /[一-鿿]/;

/** 只做 `{name}` 替换的最小 ICU——这些文案没有 plural/select，够用且不引依赖 */
function translator(messages: Record<string, string>): Translate {
  return (key, values) => {
    const raw = messages[key];
    if (raw === undefined) throw new Error(`missing key: ${key}`);
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = values?.[name];
      if (v === undefined) throw new Error(`missing value: ${name} for ${key}`);
      return v;
    });
  };
}

describe("图表叠加层的文案", () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    const chart = (messages as { trade: { chart?: Record<string, string> } }).trade.chart;

    it(`${locale}：每条线、每个箭头都拼得出话`, () => {
      expect(chart, `${locale} 缺少 trade.chart`).toBeDefined();
      const labels = buildOverlayLabels(translator(chart!));

      // 拼装本身不许抛（缺 key / 缺占位符都会在这里炸）
      expect(labels.entry("long", 200)).toBeTruthy();
      expect(labels.entry("short", "50")).toBeTruthy();
      expect(labels.positionMarker("open", "long", 77222.6)).toBeTruthy();
      expect(labels.positionMarker("close", "short", 77222.6)).toBeTruthy();
      expect(labels.fillMarker("buy", 101.5)).toBeTruthy();
      expect(labels.fillMarker("sell", "")).toBeTruthy();
      expect(labels.limitOrder("BUY")).toBeTruthy();
      expect(labels.conditionalOrder("SELL")).toBeTruthy();
      for (const s of [labels.liquidation, labels.takeProfit, labels.stopLoss, labels.unknownError]) {
        expect(s).toBeTruthy();
      }

      // 占位符必须真的被填掉——漏填就会在图上画出 "进场 {side} 200x"
      expect(labels.entry("long", 200)).not.toMatch(/[{}]/);
      expect(labels.positionMarker("open", "long", 1)).not.toMatch(/[{}]/);
    });

    if (locale !== "zh-CN") {
      it(`${locale}：图上不许出现汉字`, () => {
        for (const [key, value] of Object.entries(chart!)) {
          expect(CJK.test(value), `${locale} trade.chart.${key} = ${value}`).toBe(false);
        }
      });
    }
  }

  it("多/空、开/平走 messages，不在代码里拼字符串", () => {
    // 中文「开多」不带空格、英文 "Open Long" 带空格——拼接的写法必然错一边
    const zhLabels = buildOverlayLabels(translator(zh.trade.chart));
    const enLabels = buildOverlayLabels(translator(en.trade.chart));
    expect(zhLabels.positionMarker("open", "long", 77222.6)).toBe("开多 77222.6");
    expect(enLabels.positionMarker("open", "long", 77222.6)).toBe("Open Long 77222.6");
    expect(zhLabels.entry("long", 200)).toBe("进场 多 200x");
    expect(enLabels.entry("long", 200)).toBe("Entry Long 200x");
  });
});
