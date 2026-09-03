import { describe, it, expect } from "vitest";
import { OI_STATES_BY_KIND } from "./factors/scenario";
import type { Scenario, ScenarioKind, ScenarioStrength } from "./factors/scenario";
import type { OiState } from "./factors/series";
import { scenarioLabel, scenarioAction } from "./alert-copy";
import { scenarioVars } from "@/components/screener/scenario-ui";
import zh from "@/i18n/messages/zh-CN.json";
import en from "@/i18n/messages/en-US.json";
import ms from "@/i18n/messages/ms-MY.json";

/**
 * 防的是**一整类** bug，不是某几条文案：**文案断言了判定并不保证的状态**。
 *
 * 这一类上线过三处，全都不报错、页面照常渲染，只是在骗读的人：
 *   · A2 顶着「增仓型」的名字，而卡上同时写着 OI -2.20%
 *   · A4/B4 写「已从暴减转为企稳」，而判定明明放行了 OI 仍在减少
 *   · A1/B1 写「钱没有在撤」，而它的健康档恰恰**只**在 OI 下降时成立
 *
 * 根因是文案在断言。修法是让它从数据选词（i18n 用 ICU select，推送那一路用
 * alert-copy 的两个函数），而这个文件负责让「又写死了」这件事**变成红灯**。
 *
 * 两个方向都验：
 *   ① 判定放宽了某个场景的 OI 档位、却没更新 OI_STATES_BY_KIND → 抓不到，
 *      但下面第 ② 条会因为契约变宽而要求文案跟上，等于强制先改表。
 *   ② 契约里跨了「增/减」两个方向的场景，文案必须用 select，不能写死。
 */

const LOCALES = { "zh-CN": zh, "en-US": en, "ms-MY": ms } as const;
const KINDS = Object.keys(OI_STATES_BY_KIND) as ScenarioKind[];

const RISING: OiState[] = ["surge", "up"];
const FALLING: OiState[] = ["down", "plunge"];

/** 这个场景的 OI 会不会跨方向——跨了，任何写死的 OI 定语都必然对一半错一半。 */
function spansDirections(kind: ScenarioKind): boolean {
  const set = OI_STATES_BY_KIND[kind];
  return set.some((s) => RISING.includes(s)) && set.some((s) => FALLING.includes(s));
}

type Copy = { name: string; action: string; reading: string };
const copyOf = (loc: keyof typeof LOCALES, kind: ScenarioKind): Copy =>
  (LOCALES[loc].screener.scenarios as unknown as Record<string, Copy>)[kind];

describe("文案契约", () => {
  it("每个场景在三种语言里都齐三段：名称 / 操作 / 判定句", () => {
    for (const loc of Object.keys(LOCALES) as Array<keyof typeof LOCALES>) {
      for (const kind of KINDS) {
        const c = copyOf(loc, kind);
        expect(c, `${loc} 缺 ${kind}`).toBeDefined();
        for (const f of ["name", "action", "reading"] as const) {
          expect(c[f]?.length ?? 0, `${loc} ${kind}.${f} 是空的`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("OI 会跨方向的场景，判定句必须用 {oiState, select} 选词，不能写死", () => {
    // 这是这个文件的核心断言。跨方向 = 同一个场景既可能 OI 在增、也可能在减，
    // 任何一句写死的「有新钱进来」或「资金在撤」都必然对一半错一半。
    for (const loc of Object.keys(LOCALES) as Array<keyof typeof LOCALES>) {
      for (const kind of KINDS) {
        if (!spansDirections(kind)) continue;
        expect(copyOf(loc, kind).reading, `${loc} ${kind}.reading 跨方向却写死了 OI 定语`).toContain(
          "{oiState, select"
        );
      }
    }
  });

  it("OI 方向唯一的场景不必用 select——避免把这条规则变成无脑套模板", () => {
    // A3/B3/B2/陷阱的判定硬性要求 OI 在增，写死「OI 同步增加」是**对的**。
    // 这条断言在于说明上一条不是「所有文案都得 select」，否则下一个人会
    // 到处套 select，把真正需要它的地方淹掉。
    expect(spansDirections("a3_e1_absorb")).toBe(false);
    expect(spansDirections("b2_distrib_top_div")).toBe(false);
    expect(spansDirections("trap_false_top_div")).toBe(false);
  });
});

describe("推送文案跟卡片文案不许分叉", () => {
  const scenario = (o: Partial<Scenario>): Scenario => ({
    kind: "a4_e4_flush",
    direction: "long",
    trap: false,
    strength: "healthy",
    triggeredAt: 0,
    invalidation: { price: 1, breach: "below" },
    structureLevel: 1,
    cvdPct: 1,
    oiPct: -1.5,
    oiState: "down",
    ...o,
  });

  /**
   * 两条路说的是**同一个事件**。分叉了读的人无从判断哪个是准的——Telegram
   * 说「清算结束」而卡片说「抛压未尽」，那条推送就等于噪音。
   *
   * i18n 那一路用 ICU select，推送这一路用函数分支，两边都得在同一批
   * 输入上改变输出。这里验的是「推送这一路真的会变」，不是逐字比对：
   * 逐字比对会把两种语言的自然语序也绑死，那种测试维护成本远大于收益。
   */
  it("A4 的 OI 仍在减时，推送不能说「清算结束」", () => {
    const stillFalling = scenarioAction("zh", scenario({ oiState: "down" }));
    const stabilised = scenarioAction("zh", scenario({ oiState: "up", oiPct: 1.5 }));
    expect(stillFalling).not.toBe(stabilised);
    expect(stillFalling).not.toContain("清算结束");
  });

  it("A4 的名字也不能在 OI 还在减时写「企稳」", () => {
    expect(scenarioLabel("zh", scenario({ oiState: "down" }))).not.toContain("企稳");
    expect(scenarioLabel("zh", scenario({ oiState: "flat" }))).toContain("企稳");
  });

  it("B4 镜像成立", () => {
    const s = (oi: OiState) => scenario({ kind: "b4_e8_cover_stall", direction: "short", oiState: oi });
    expect(scenarioAction("zh", s("down"))).not.toContain("回补结束");
    expect(scenarioLabel("zh", s("down"))).not.toBe(scenarioLabel("zh", s("up")));
  });

  it("A2 的中强档叫「真底背离」，不叫「增仓型」——OI 是减的", () => {
    // 线上真出现过：一张卡同时写着「增仓型底背离」和「OI -2.20%」。
    const medium = (st: ScenarioStrength) =>
      scenarioLabel("zh", scenario({ kind: "a2_accum_bottom_div", strength: st, oiState: "down" }));
    expect(medium("medium")).not.toContain("增仓");
    expect(medium("strongest")).toContain("增仓");
  });

  it("英文侧同样分支，不是只修了中文", () => {
    expect(scenarioLabel("en", scenario({ oiState: "down" }))).not.toBe(
      scenarioLabel("en", scenario({ oiState: "up" }))
    );
  });
});

/**
 * ICU 变量必须被 scenarioVars 全覆盖。
 *
 * 这一条是线上事故补的：改成 select 之后，速查表和主扫描表两个调用点都忘了
 * 传变量，next-intl 于是把**模板原文**渲染了出来——界面上直接显示
 * 「{strength, select, medium{True Bottom Divergence} other{…}}」这一整串。
 *
 * TypeScript 管不到 t() 的参数，编译和当时的全部测试都是绿的。所以这里换个
 * 角度盯：把所有场景文案里出现过的 select 变量名抽出来，要求 scenarioVars
 * 每一个都提供。以后谁在文案里新加一个 `{foo, select, …}` 而没把 foo 加进
 * scenarioVars，这条就会红——而 scenarioVars 是所有调用点唯一的取值入口。
 */
describe("ICU 变量覆盖", () => {
  it("文案里用到的每个 select 变量，scenarioVars 都得给", () => {
    const provided = new Set(Object.keys(scenarioVars()));
    const used = new Set<string>();
    for (const loc of Object.keys(LOCALES) as Array<keyof typeof LOCALES>) {
      for (const kind of KINDS) {
        const c = copyOf(loc, kind);
        for (const field of ["name", "action", "reading"] as const) {
          for (const m of c[field].matchAll(/\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*,\s*select/g)) {
            used.add(m[1]);
          }
        }
      }
    }
    expect(used.size, "一个 select 都没有？那这套选词机制已经被改没了").toBeGreaterThan(0);
    for (const v of used) {
      expect(provided.has(v), `文案用了 {${v}, select} 但 scenarioVars 没提供它`).toBe(true);
    }
  });

  it("scenarioVars 的默认值能渲染出主要说法——速查表那种泛列没有具体判定", () => {
    const d = scenarioVars();
    expect(d.strength).toBe("strongest");
    expect(d.oiState).toBe("up");
  });
});
