"use client";

import { useState } from "react";
import Image from "next/image";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface ShareCardModalProps {
  open: boolean;
  onClose: () => void;
  totalValue: number;
  pnl: number;
  pnlPct: number;
  achievements: number;
}

export function ShareCardModal({ open, onClose, totalValue, pnl, pnlPct, achievements }: ShareCardModalProps) {
  const [loaded, setLoaded] = useState(false);

  const src = `/api/share/performance?${new URLSearchParams({
    totalValue: totalValue.toFixed(2),
    pnl: pnl.toFixed(2),
    pnlPct: pnlPct.toFixed(2),
    achievements: String(achievements),
  }).toString()}`;

  return (
    <Modal open={open} onClose={onClose} title="分享我的模拟盘战绩" size="lg">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-md border border-border-default">
          {/* Fixed 1200x630 — see the ImageResponse size in src/app/api/share/performance/route.tsx.
              unoptimized: every load has unique query params (the user's own stats), so Next's
              optimizer would never get a cache hit here anyway — just adds proxy latency. */}
          <Image
            src={src}
            alt="Chart-IX 模拟盘战绩"
            width={1200}
            height={630}
            unoptimized
            className="h-auto w-full"
            onLoad={() => setLoaded(true)}
          />
        </div>
        <p className="text-xs text-text-muted">图片仅展示模拟盘（虚拟资金）战绩，不涉及真实资金。</p>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
          <a href={src} download="chart-ix-performance.png">
            <Button variant="primary" size="sm" disabled={!loaded}>下载图片</Button>
          </a>
        </div>
      </div>
    </Modal>
  );
}
