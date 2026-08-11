/**
 * 封面裁切的几何计算。
 *
 * 封面在列表卡片上是 16:9、在详情页头图上是 21:9，两处都用 object-cover 居中
 * 裁切——所以一张竖图传上去，露出来的永远是中间那条，作者没有发言权。这里把
 * 「露哪一段」交还给作者：在固定比例的取景框里拖动与缩放，最后按取景框实际
 * 框住的那块像素导出。
 *
 * 全部是纯函数，不碰 DOM，好在单测里把边界钉死——裁切最容易错的就是边缘：
 * 图片被拖出框、缩到比框还小、或者导出时取到负坐标。
 */

/** 卡片位的比例，也是导出比例。详情页 21:9 会在此基础上再居中裁一次。 */
export const COVER_ASPECT = 16 / 9;

/** 导出尺寸。1600 与 image-compress 的长边上限一致。 */
export const COVER_OUTPUT_WIDTH = 1600;
export const COVER_OUTPUT_HEIGHT = Math.round(COVER_OUTPUT_WIDTH / COVER_ASPECT);

/** 原图比例偏离目标比例超过这个值，才值得让作者去裁——否则裁了也没得选。 */
export const ASPECT_TOLERANCE = 0.02;

/** 图片比例与封面比例是否足够接近；接近就直接传，不打断作者。 */
export function matchesCoverAspect(
  width: number,
  height: number,
  tolerance: number = ASPECT_TOLERANCE
): boolean {
  if (width <= 0 || height <= 0) return true;
  return Math.abs(width / height - COVER_ASPECT) <= tolerance;
}

/** 恰好铺满取景框所需的最小缩放；再小就会露出取景框的底。 */
export function minCoverScale(
  naturalWidth: number,
  naturalHeight: number,
  frameWidth: number,
  frameHeight: number
): number {
  if (naturalWidth <= 0 || naturalHeight <= 0) return 1;
  return Math.max(frameWidth / naturalWidth, frameHeight / naturalHeight);
}

/**
 * 把位移夹回合法范围：图片任一边都不许越过取景框对应的边，否则会露白。
 * 图片比框还小时（理论上不会，minCoverScale 挡着）退化成 0。
 */
export function clampOffset(offset: number, displayedSize: number, frameSize: number): number {
  const min = Math.min(0, frameSize - displayedSize);
  return Math.min(0, Math.max(min, offset));
}

export interface CropView {
  naturalWidth: number;
  naturalHeight: number;
  frameWidth: number;
  frameHeight: number;
  scale: number;
  /** 图片左上角相对取景框左上角的位移，单位是取景框的显示像素，恒 ≤ 0。 */
  offsetX: number;
  offsetY: number;
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * 取景框此刻框住的是原图的哪一块（原图像素坐标）。
 * 结果会被夹进原图范围内，避免浮点误差导致 drawImage 取到画布外。
 */
export function sourceRect(view: CropView): SourceRect {
  const { naturalWidth, naturalHeight, frameWidth, frameHeight, scale } = view;
  const safeScale = scale > 0 ? scale : 1;

  const displayedWidth = naturalWidth * safeScale;
  const displayedHeight = naturalHeight * safeScale;
  const offsetX = clampOffset(view.offsetX, displayedWidth, frameWidth);
  const offsetY = clampOffset(view.offsetY, displayedHeight, frameHeight);

  const sw = Math.min(naturalWidth, frameWidth / safeScale);
  const sh = Math.min(naturalHeight, frameHeight / safeScale);
  const sx = Math.min(Math.max(0, -offsetX / safeScale), naturalWidth - sw);
  const sy = Math.min(Math.max(0, -offsetY / safeScale), naturalHeight - sh);

  return { sx, sy, sw, sh };
}
