"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useChartStore, type Drawing } from "@/stores/chartStore";
import { ColorPicker } from "./ColorPicker";
import { LineStyleControl } from "./LineStyleControl";

export function DrawingSettingsModal({
  symbol,
  drawing,
  onClose,
}: {
  symbol: string;
  drawing: Drawing;
  onClose: () => void;
}) {
  const updateDrawing = useChartStore((s) => s.updateDrawing);
  const [fontSize, setFontSize] = useState(drawing.fontSize ?? 12);

  const showFill = drawing.tool === "rect" || drawing.tool === "channel" || drawing.tool === "circle" || drawing.tool === "triangle";
  const showFontSize = drawing.tool === "text";

  return (
    <Modal open onClose={onClose} title="图形设置" size="sm">
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs text-text-muted">颜色</p>
          <ColorPicker value={drawing.color} onChange={(color) => updateDrawing(symbol, drawing.id, { color })} />
        </div>
        <div>
          <p className="mb-1.5 text-xs text-text-muted">线宽 / 线型</p>
          <LineStyleControl
            width={drawing.lineWidth}
            style={drawing.lineStyle}
            onWidthChange={(lineWidth) => updateDrawing(symbol, drawing.id, { lineWidth })}
            onStyleChange={(lineStyle) => updateDrawing(symbol, drawing.id, { lineStyle })}
          />
        </div>
        {showFill && (
          <div>
            <p className="mb-1.5 text-xs text-text-muted">填充透明度 ({Math.round(drawing.opacity * 100)}%)</p>
            <input
              type="range" min={0} max={1} step={0.05} value={drawing.opacity}
              onChange={(e) => updateDrawing(symbol, drawing.id, { opacity: parseFloat(e.target.value) })}
              className="w-full accent-gold"
            />
          </div>
        )}
        {showFontSize && (
          <div>
            <p className="mb-1.5 text-xs text-text-muted">文字大小 ({fontSize}px)</p>
            <input
              type="range" min={9} max={28} step={1} value={fontSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setFontSize(v);
                updateDrawing(symbol, drawing.id, { fontSize: v });
              }}
              className="w-full accent-gold"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
