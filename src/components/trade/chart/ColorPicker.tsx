"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DRAWING_COLORS } from "@/stores/chartStore";
import { cn } from "@/lib/utils";

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  presets?: string[];
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function ColorPicker({ value, onChange, presets = DRAWING_COLORS }: ColorPickerProps) {
  const t = useTranslations("trade.drawing");
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  const commit = (v: string) => {
    setText(v);
    if (HEX_RE.test(v)) onChange(v);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="relative h-6 w-6 shrink-0 overflow-hidden rounded-xs border border-border-default">
        <input
          type="color"
          value={HEX_RE.test(value) ? value : "#000000"}
          onChange={(e) => commit(e.target.value)}
          className="absolute -left-1 -top-1 h-8 w-8 cursor-pointer border-none bg-transparent p-0"
          aria-label={t("pick_color")}
        />
      </label>
      <input
        type="text"
        value={text}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setText(value)}
        placeholder="#c9a24b"
        className="w-20 rounded-xs border border-border-default bg-bg-primary px-1.5 py-0.5 font-mono text-[11px] text-text-primary focus:border-gold focus:outline-none"
      />
      <div className="flex flex-wrap gap-1">
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => commit(c)}
            title={c}
            className={cn(
              "h-3.5 w-3.5 rounded-full border transition-transform",
              value === c ? "scale-125 border-text-primary" : "border-transparent"
            )}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}
