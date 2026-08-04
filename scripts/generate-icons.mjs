#!/usr/bin/env node
/**
 * 从 logo/mlogo.png 生成 PWA 图标集。
 *
 * maskable 版本必须把图形收进内圈 80% 的安全区——Android 会按厂商形状
 * （圆形 / 方形 / 水滴）裁切，不留边的图标会被切掉角。
 *
 * 用法：node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "logo", "mlogo.png");
const OUT_DIR = join(root, "public", "icons");
const BG = { r: 0x0b, g: 0x0a, b: 0x08, alpha: 1 };

async function render(size, { safeZone }) {
  // safeZone=0.8 表示图形只占 80%，四周各留 10% 空白
  const inner = Math.round(size * safeZone);
  const logo = await sharp(SOURCE)
    .resize(inner, inner, { fit: "contain", background: { ...BG, alpha: 0 } })
    .toBuffer();
  const pad = Math.round((size - inner) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toBuffer();
}

const targets = [
  { file: "icon-192.png", size: 192, safeZone: 0.92 },
  { file: "icon-512.png", size: 512, safeZone: 0.92 },
  { file: "icon-maskable-192.png", size: 192, safeZone: 0.8 },
  { file: "icon-maskable-512.png", size: 512, safeZone: 0.8 },
  { file: "apple-touch-icon-180.png", size: 180, safeZone: 0.92 },
];

await mkdir(OUT_DIR, { recursive: true });
for (const { file, size, safeZone } of targets) {
  const buffer = await render(size, { safeZone });
  await sharp(buffer).toFile(join(OUT_DIR, file));
  console.log(`✓ ${file} (${size}×${size}, safe zone ${safeZone * 100}%)`);
}

// iOS 启动图。只覆盖当前主流 iPhone，老机型与 iPad 接受白闪
// （见 spec 的「已知限制」第 5 条）。
const SPLASH = [
  { w: 1170, h: 2532, name: "splash-1170x2532" }, // iPhone 12/13/14
  { w: 1179, h: 2556, name: "splash-1179x2556" }, // iPhone 14 Pro/15/16
  { w: 1284, h: 2778, name: "splash-1284x2778" }, // iPhone 12/13/14 Pro Max
  { w: 1290, h: 2796, name: "splash-1290x2796" }, // iPhone 14 Pro Max/15 Pro Max
  { w: 1206, h: 2622, name: "splash-1206x2622" }, // iPhone 16 Pro
  { w: 1320, h: 2868, name: "splash-1320x2868" }, // iPhone 16 Pro Max
];

const SPLASH_DIR = join(OUT_DIR, "splash");
await mkdir(SPLASH_DIR, { recursive: true });

for (const { w, h, name } of SPLASH) {
  const logoSize = Math.round(Math.min(w, h) * 0.32);
  const logo = await sharp(SOURCE)
    .resize(logoSize, logoSize, { fit: "contain", background: { ...BG, alpha: 0 } })
    .toBuffer();
  await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: logo, top: Math.round((h - logoSize) / 2), left: Math.round((w - logoSize) / 2) }])
    .png()
    .toFile(join(SPLASH_DIR, `${name}.png`));
  console.log(`✓ splash/${name}.png (${w}×${h})`);
}
