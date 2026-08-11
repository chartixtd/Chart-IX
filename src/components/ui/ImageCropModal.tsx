"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import {
  COVER_OUTPUT_WIDTH,
  COVER_OUTPUT_HEIGHT,
  clampOffset,
  minCoverScale,
  sourceRect,
} from "@/lib/image-crop";
import { WEBP_QUALITY, replaceExtension } from "@/lib/image-compress";

/** 取景框的显示尺寸（CSS 像素）。比例与导出一致，所见即所得。 */
const FRAME_WIDTH = 560;
const FRAME_HEIGHT = Math.round((FRAME_WIDTH * COVER_OUTPUT_HEIGHT) / COVER_OUTPUT_WIDTH);

/** 最多允许在「刚好铺满」的基础上再放大多少倍。 */
const MAX_ZOOM = 4;

interface ImageCropModalProps {
  open: boolean;
  file: File | null;
  title: string;
  hint: string;
  confirmLabel: string;
  cancelLabel: string;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}

/**
 * 固定 16:9 的封面取景器：拖动挪位置、滑块缩放，确认后按取景框框住的那块
 * 像素导出 WebP。
 *
 * 之所以裁成图片本身而不是存一个焦点坐标：封面在列表卡片、详情页头图、OG 图
 * 三处渲染，存坐标就要三处都改还要加数据库字段；直接裁出成品，存的就是最终
 * 要显示的那块，任何消费方都不用动。
 */
export function ImageCropModal({
  open,
  file,
  title,
  hint,
  confirmLabel,
  cancelLabel,
  onCancel,
  onConfirm,
}: ImageCropModalProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  // objectURL 必须在文件变化和卸载时都撤销，否则每选一次图就漏一份内存
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setNatural(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const baseScale = natural
    ? minCoverScale(natural.width, natural.height, FRAME_WIDTH, FRAME_HEIGHT)
    : 1;
  const scale = baseScale * zoom;
  const displayedWidth = (natural?.width ?? 0) * scale;
  const displayedHeight = (natural?.height ?? 0) * scale;

  /** 图片首次加载完成：按「刚好铺满并居中」摆好。 */
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setNatural({ width: naturalWidth, height: naturalHeight });
    const s = minCoverScale(naturalWidth, naturalHeight, FRAME_WIDTH, FRAME_HEIGHT);
    setOffset({
      x: (FRAME_WIDTH - naturalWidth * s) / 2,
      y: (FRAME_HEIGHT - naturalHeight * s) / 2,
    });
  };

  const applyOffset = (x: number, y: number) => {
    setOffset({
      x: clampOffset(x, displayedWidth, FRAME_WIDTH),
      y: clampOffset(y, displayedHeight, FRAME_HEIGHT),
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!natural) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX - offset.x,
      startY: e.clientY - offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    applyOffset(e.clientX - drag.startX, e.clientY - drag.startY);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  /** 缩放围绕取景框中心，否则放大时画面会往左上角跑。 */
  const handleZoom = (next: number) => {
    if (!natural) return;
    const nextScale = baseScale * next;
    const ratio = nextScale / scale;
    const cx = FRAME_WIDTH / 2;
    const cy = FRAME_HEIGHT / 2;
    const x = cx - (cx - offset.x) * ratio;
    const y = cy - (cy - offset.y) * ratio;
    setZoom(next);
    setOffset({
      x: clampOffset(x, natural.width * nextScale, FRAME_WIDTH),
      y: clampOffset(y, natural.height * nextScale, FRAME_HEIGHT),
    });
  };

  const handleConfirm = async () => {
    if (!file || !url || !natural) return;
    setBusy(true);
    try {
      const rect = sourceRect({
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        frameWidth: FRAME_WIDTH,
        frameHeight: FRAME_HEIGHT,
        scale,
        offsetX: offset.x,
        offsetY: offset.y,
      });

      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = COVER_OUTPUT_WIDTH;
      canvas.height = COVER_OUTPUT_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.drawImage(
        bitmap,
        rect.sx,
        rect.sy,
        rect.sw,
        rect.sh,
        0,
        0,
        COVER_OUTPUT_WIDTH,
        COVER_OUTPUT_HEIGHT
      );
      bitmap.close();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", WEBP_QUALITY)
      );
      // 裁切失败就退回原图上传——宁可封面比例不理想，也不能让上传断在这里
      onConfirm(
        blob
          ? new File([blob], replaceExtension(file.name, "webp"), { type: "image/webp" })
          : file
      );
    } catch {
      onConfirm(file);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onCancel} title={title} size="xl">
      <div className="space-y-4">
        <p className="text-xs text-text-muted">{hint}</p>

        <div
          className="relative mx-auto touch-none overflow-hidden rounded-sm border border-border-default bg-bg-tertiary"
          style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, maxWidth: "100%" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {url && (
            // 取景器要读 naturalWidth 并逐帧跟手，用原生 img 而不是 next/image
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt=""
              onLoad={handleImageLoad}
              draggable={false}
              className="absolute origin-top-left select-none"
              style={{
                left: offset.x,
                top: offset.y,
                width: displayedWidth || undefined,
                height: displayedHeight || undefined,
                cursor: dragRef.current ? "grabbing" : "grab",
              }}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">1x</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoom(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border-default accent-gold"
            aria-label={hint}
          />
          <span className="w-10 text-right text-xs text-text-muted">{zoom.toFixed(1)}x</span>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button onClick={handleConfirm} loading={busy} disabled={busy || !natural}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
