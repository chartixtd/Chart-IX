import { describe, it, expect } from "vitest";
import {
  briefingDateLabel,
  briefingTitleSubject,
  formatBriefingTitle,
  normalizeBriefingTitle,
} from "./title";

describe("briefingDateLabel", () => {
  it("中文去掉前导零", () => {
    expect(briefingDateLabel("2026-08-09", "zh-CN")).toBe("8月9日");
  });
  it("英文用三字母月份", () => {
    expect(briefingDateLabel("2026-08-09", "en-US")).toBe("Aug 9");
  });
  it("日期不是 ISO 形态时原样返回，绝不产出 NaN", () => {
    expect(briefingDateLabel("不是日期", "zh-CN")).toBe("不是日期");
    expect(briefingDateLabel("2026-13-40", "zh-CN")).toBe("2026-13-40");
  });
});

describe("briefingTitleSubject", () => {
  // 线上真实出现过的三种标题形态，剥完都该只剩正题
  it("剥掉标准前缀", () => {
    expect(briefingTitleSubject("早报 | 8月9日 比特币震荡，黄金续创新高", "zh-CN")).toBe(
      "比特币震荡，黄金续创新高"
    );
  });
  it("剥掉全角竖线、无空格的写法", () => {
    expect(briefingTitleSubject("早报｜8月9日 比特币震荡", "zh-CN")).toBe("比特币震荡");
  });
  it("剥掉「日期在前」的写法", () => {
    expect(briefingTitleSubject("8月9日早报：比特币震荡", "zh-CN")).toBe("比特币震荡");
  });
  it("没有前缀时原样返回", () => {
    expect(briefingTitleSubject("比特币震荡，黄金续创新高", "zh-CN")).toBe(
      "比特币震荡，黄金续创新高"
    );
  });
  it("整条都是前缀时不返回空串", () => {
    expect(briefingTitleSubject("早报 | 8月9日", "zh-CN")).toBe("早报 | 8月9日");
  });

  it("英文：剥掉翻译器给出的各种栏目名", () => {
    expect(briefingTitleSubject("Morning Report | August 9: Bitcoin steady", "en-US")).toBe(
      "Bitcoin steady"
    );
    expect(briefingTitleSubject("Daily Briefing | Aug 9 — Bitcoin steady", "en-US")).toBe(
      "Bitcoin steady"
    );
  });

  // 英文那条前缀规则要求后面跟分隔符或数字，正是为了不吃掉这种正题
  it("英文：正题以 Report/Briefing 开头时不被剥掉", () => {
    expect(briefingTitleSubject("Report shows CPI cooled in July", "en-US")).toBe(
      "Report shows CPI cooled in July"
    );
  });
});

describe("normalizeBriefingTitle", () => {
  it("模型写错日期时以流水线算出的日期为准", () => {
    // 模型照抄 prompt 示例里的 8月8日 是高频漂移
    expect(normalizeBriefingTitle("早报｜8月8日 比特币震荡", "2026-08-10", "zh-CN")).toBe(
      "早报 | 8月10日 比特币震荡"
    );
  });
  it("模型只给正题时补上前缀", () => {
    expect(normalizeBriefingTitle("比特币震荡", "2026-08-10", "zh-CN")).toBe(
      "早报 | 8月10日 比特币震荡"
    );
  });
  it("重复归一是幂等的", () => {
    const once = normalizeBriefingTitle("早报｜8月8日 比特币震荡", "2026-08-10", "zh-CN");
    expect(normalizeBriefingTitle(once, "2026-08-10", "zh-CN")).toBe(once);
  });
  it("英文侧同样幂等", () => {
    const once = normalizeBriefingTitle(
      "Morning Post | August 10: Bitcoin steady",
      "2026-08-10",
      "en-US"
    );
    expect(once).toBe("Daily Briefing | Aug 10 — Bitcoin steady");
    expect(normalizeBriefingTitle(once, "2026-08-10", "en-US")).toBe(once);
  });
});

describe("normalizeBriefingTitle — 线上真实标题", () => {
  // 8 月 9 日那篇的原标题。正题里带连字符与逗号，剥前缀时一个字都不能碰
  it("正题里的连字符与标点原样保留", () => {
    expect(
      normalizeBriefingTitle(
        "早报｜8月9日 比特币震荡，BIP-110软分叉进入强制信号阶段",
        "2026-08-09",
        "zh-CN"
      )
    ).toBe("早报 | 8月9日 比特币震荡，BIP-110软分叉进入强制信号阶段");
  });

  it("翻译器把栏目名译成什么都归一得掉", () => {
    for (const raw of [
      "Morning Post | August 9 Bitcoin volatile, BIP-110 soft fork enters signalling",
      "Daily Newspaper｜Aug 9: Bitcoin volatile, BIP-110 soft fork enters signalling",
      "Morning Report - Aug 9 - Bitcoin volatile, BIP-110 soft fork enters signalling",
    ]) {
      expect(normalizeBriefingTitle(raw, "2026-08-09", "en-US")).toBe(
        "Daily Briefing | Aug 9 — Bitcoin volatile, BIP-110 soft fork enters signalling"
      );
    }
  });
});

describe("formatBriefingTitle", () => {
  it("正题为空时只留前缀，不留下悬空的分隔符", () => {
    expect(formatBriefingTitle("", "2026-08-10", "zh-CN")).toBe("早报 | 8月10日");
  });
});
