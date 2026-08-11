/**
 * 上传前在浏览器里把图片压小。
 *
 * 手机拍的图动辄 4000px 宽、好几 MB，原样传上去既慢又拖累文章页加载——
 * 而正文的阅读栏只有 68ch，再宽的像素也看不出来。缩到 1600px 再转 WebP，
 * 通常能把体积砍到十分之一，上传时间跟着一起降。
 *
 * 所有函数都以「失败就退回原文件」为准则：压缩是加速手段，不该成为上传
 * 失败的新理由。
 */

/** 只压位图。GIF 动图过一遍 canvas 会只剩第一帧，SVG 是矢量、光栅化反而变大。 */
export const COMPRESSIBLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** 长边上限。正文阅读栏 68ch（约 690px），2x 屏也够用。 */
export const MAX_IMAGE_DIMENSION = 1600;

/**
 * WebP 质量。本站的配图多是带文字的图表截图，有损压得太狠会在字周围起毛边，
 * 所以取 0.9 而不是更省的 0.82——实测同一张截图 0.82 是 154KB、0.9 是 206KB，
 * 这 50KB 对上传时间的影响可以忽略，换的是文字边缘不糊。
 */
export const WEBP_QUALITY = 0.9;

export function shouldCompress(type: string): boolean {
  return COMPRESSIBLE_TYPES.includes(type);
}

/** 等比缩到长边不超过 max；本来就小于 max 的不放大。 */
export function resolveTargetSize(
  width: number,
  height: number,
  max: number = MAX_IMAGE_DIMENSION
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest === 0) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 换扩展名，没有扩展名就直接补一个。 */
export function replaceExtension(filename: string, ext: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}.${ext}`;
}

/**
 * 读出图片的像素尺寸。读不出来（格式不认、浏览器不支持）返回 null，调用方
 * 应当据此走「不做尺寸相关处理」的那条路，而不是把上传拦下来。
 */
export async function readImageSize(
  file: File
): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * 压缩单张图片。任何一步不成立都原样返回入参——包括压完反而更大的情况
 * （小图转 WebP 有时会胖一点）。
 */
export async function compressImage(file: File): Promise<File> {
  if (!shouldCompress(file.type)) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = resolveTargetSize(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], replaceExtension(file.name, "webp"), { type: "image/webp" });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
