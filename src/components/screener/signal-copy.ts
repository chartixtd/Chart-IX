import { formatPrice, formatPercent } from "@/lib/utils";
import type { CardTrigger } from "@/lib/screener/cards";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface SignalCopy {
  /** 操作指令：一句话说**该做什么**。短，能单独成行 */
  action: string;
  /** 判读：一段话说**发生了什么**。长，只在完整的警报卡上出现 */
  verdict: string;
  trap: boolean;
}

/**
 * 一张警报卡的文案从 trigger 推出来。
 *
 * 提出来是因为主页的信号行与扫描器的警报卡必须说同一句话——两处各写一遍
 * ICU 变量的拼装，迟早会漂成两套说法。
 *
 * `strength` / `oiState` 必须一并传进去：文案里凡是描述 OI 或强度的**定语**
 * 都用 ICU select 从这两个值选词，漏传会让 `{oiState, select, ...}` 整段原样
 * 漏到界面上。详见 factors/scenario.ts。
 *
 * 调用方的 t 必须绑在 `screener` 命名空间上。
 */
export function signalCopy(trigger: CardTrigger, t: Translate): SignalCopy {
  if (trigger.type === "scenario") {
    const sc = trigger.scenario;
    const vars = {
      level: formatPrice(sc.structureLevel),
      cvdPct: formatPercent(sc.cvdPct),
      oiPct: formatPercent(sc.oiPct),
      oiState: sc.oiState,
      strength: sc.strength,
    };
    return {
      action: t(`scenarios.${sc.kind}.action`, vars),
      verdict: t(`scenarios.${sc.kind}.reading`, vars),
      trap: sc.trap,
    };
  }

  const ig = trigger.ignition;
  return {
    action: t(`ignition.${ig.direction}.action`),
    verdict: t(`ignition.reading.${ig.direction}`, {
      level: formatPrice(ig.level),
      invalid: formatPrice(ig.invalidationPrice),
      distancePct: `${ig.distancePct.toFixed(2)}%`,
    }),
    trap: false,
  };
}

/** 「多久以前触发」。主页信号行与警报卡共用同一组阈值与文案键 */
export function triggeredLabel(iso: string, t: Translate): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return t("alerts.just_now");
  if (mins < 60) return t("alerts.minutes_ago", { n: mins });
  return t("alerts.hours_ago", { n: Math.round(mins / 60) });
}
