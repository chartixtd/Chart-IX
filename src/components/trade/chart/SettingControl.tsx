"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { settingOptions, type SettingDef } from "@/lib/chart/indicator-registry";
import type { ExternalSettingValue } from "@/lib/chart/external-series";
import { parseExchangeList } from "@/lib/chart/external-series";
import { cn } from "@/lib/utils";

interface Props {
  def: SettingDef;
  settings: Record<string, ExternalSettingValue> | undefined;
  isZh: boolean;
  onChange: (patch: Record<string, ExternalSettingValue>) => void;
}

const inputCls =
  "rounded-xs border border-border-default bg-bg-primary px-2 py-1 font-mono text-[11px] text-text-primary focus:border-gold focus:outline-none";

/**
 * 指标「输入」页里的一个非数值设置控件。
 *
 * 文本类在失焦/回车时才提交：自定义品种每敲一个字母就提交的话，"E" → "ET"
 * → "ETH" 会各发一次 CoinGlass 请求，白白消耗配额。
 */
export function SettingControl({ def, settings, isZh, onChange }: Props) {
  const t = useTranslations("trade.indicators");
  const label = isZh ? def.labelZh : def.label;
  const value = settings?.[def.key];

  if (def.type === "select") {
    const current = typeof value === "string" ? value : def.default;
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-text-secondary">{label}</span>
        <select
          value={current}
          onChange={(e) => onChange({ [def.key]: e.target.value })}
          className={cn(inputCls, "w-40")}
        >
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>{isZh ? o.labelZh : o.label}</option>
          ))}
        </select>
      </label>
    );
  }

  if (def.type === "text") {
    return (
      <label className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-text-secondary">{label}</span>
        <CommitInput
          value={typeof value === "string" ? value : def.default}
          placeholder={def.placeholder}
          onCommit={(v) => onChange({ [def.key]: v.trim() })}
          className={cn(inputCls, "w-40 uppercase")}
        />
      </label>
    );
  }

  // multiselect
  const options = settingOptions(def, settings);
  const selected = Array.isArray(value) ? value : def.default;
  const optionValues = new Set(options.map((o) => o.value));
  const customOnes = selected.filter((v) => !optionValues.has(v));
  const toggle = (v: string, on: boolean) => {
    const next = on ? [...selected.filter((x) => x !== v), v] : selected.filter((x) => x !== v);
    onChange({ [def.key]: next });
  };
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-text-secondary">{label}</span>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1 text-[11px] text-text-primary">
            <input
              type="checkbox"
              checked={selected.includes(o.value)}
              onChange={(e) => toggle(o.value, e.target.checked)}
              className="h-3 w-3 accent-gold"
            />
            <span className="truncate">{isZh ? o.labelZh : o.label}</span>
          </label>
        ))}
      </div>
      {def.allowCustom && (
        <label className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-text-muted">{t("setting_custom_exchanges")}</span>
          <CommitInput
            value={customOnes.join(", ")}
            placeholder="…"
            onCommit={(text) => {
              // 手填的和勾选的按不区分大小写去重："okx" 不该和已勾选的 "OKX" 并存
              const keep = selected.filter((v) => optionValues.has(v));
              const taken = new Set([...options.map((o) => o.value), ...keep].map((v) => v.toLowerCase()));
              const extra = parseExchangeList(text).filter((v) => !taken.has(v.toLowerCase()));
              onChange({ [def.key]: [...keep, ...extra] });
            }}
            className={cn(inputCls, "w-40")}
          />
        </label>
      )}
    </div>
  );
}

function CommitInput({
  value, placeholder, onCommit, className,
}: { value: string; placeholder?: string; onCommit: (v: string) => void; className?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  return (
    <input
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      className={className}
    />
  );
}
