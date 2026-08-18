import { describe, it, expect } from "vitest";
import { toFiniteNumber } from "./types";

describe("toFiniteNumber", () => {
  it("number 输入直接透传", () => {
    expect(toFiniteNumber(45740423.0381)).toBe(45740423.0381);
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(-12.5)).toBe(-12.5);
  });

  it("string 输入走 parseFloat", () => {
    expect(toFiniteNumber("45714242")).toBe(45714242);
    expect(toFiniteNumber("12.34")).toBeCloseTo(12.34);
    expect(toFiniteNumber("-7")).toBe(-7);
  });

  it("同一根 K 线混用 string/number 时两条路径结果一致——这是 T20 review F1 的核心场景", () => {
    // 实测样本：{"open":"45714242","high":45740423.0381,"low":"45714242","close":45740423.0381}
    // open/low 是字符串，high/close 是数字，四个字段解析出来必须是同一个量级的数。
    expect(toFiniteNumber("45714242")).toBe(toFiniteNumber(45714242));
    expect(toFiniteNumber("45740423.0381")).toBeCloseTo(toFiniteNumber(45740423.0381));
  });

  it("无法解析的字符串返回 NaN，不抛错", () => {
    expect(Number.isNaN(toFiniteNumber("not-a-number"))).toBe(true);
    expect(Number.isNaN(toFiniteNumber(""))).toBe(true);
  });

  it("非有限的 number（NaN/Infinity）也统一收口成 NaN", () => {
    expect(Number.isNaN(toFiniteNumber(NaN))).toBe(true);
    expect(Number.isNaN(toFiniteNumber(Infinity))).toBe(true);
    expect(Number.isNaN(toFiniteNumber(-Infinity))).toBe(true);
  });

  it("数字开头但带垃圾后缀的字符串——parseFloat 会抢救出前缀，这是刻意保留的原生行为", () => {
    // 不是这个函数要修的问题，写这条用例只是让这个已知行为不会被将来的重构悄悄改掉。
    expect(toFiniteNumber("123abc")).toBe(123);
  });
});
