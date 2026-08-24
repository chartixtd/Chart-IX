import { cn } from "@/lib/utils";

/**
 * 站内统一线性图标集。
 *
 * 存在的理由：改版前全站有约 30 处拿 emoji 当结构性图标（后台侧栏 10 个菜单项
 * 全是 emoji，还有指标显隐、收藏、置顶、连通性状态等）。emoji 的问题不是"不好看"：
 *   - 字形由系统 emoji 字体决定，Windows 彩色、Android 另一套、Linux 可能是豆腐块
 *   - 无法用 currentColor 跟随主题，也无法统一描边粗细与尺寸 token
 *   - 在 Satori / OG 图这类服务端渲染环境里经常直接渲染失败
 *
 * 全部图标共用一套语法：24 viewBox、stroke=currentColor、1.5 描边、圆头圆角，
 * 与首页与底部导航里手绘的那批线条图标同源。
 */

const PATHS = {
  // —— 后台侧栏 ——
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="8.5" rx="1.2" />
      <rect x="13.5" y="3" width="7.5" height="5" rx="1.2" />
      <rect x="3" y="15" width="7.5" height="6" rx="1.2" />
      <rect x="13.5" y="11" width="7.5" height="10" rx="1.2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.9M17.5 14.2A5.5 5.5 0 0 1 20.5 19" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </>
  ),
  quiz: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.2a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.2-2.6 4" />
      <path d="M12 17.4v.2" />
    </>
  ),
  article: (
    <>
      <path d="M5 3.5h9L19 8v12.5H5z" />
      <path d="M14 3.5V8h5" />
      <path d="M8.5 12.5h7M8.5 16h4.5" />
    </>
  ),
  briefing: (
    <>
      <path d="M4 5.5h13v13H4z" />
      <path d="M17 9h3v7.5a2 2 0 0 1-3 1.7" />
      <path d="M7 9h7M7 12.5h7M7 16h4" />
    </>
  ),
  pricing: (
    <>
      <path d="M12 3v18" />
      <path d="M16.5 7.2A3.8 3.8 0 0 0 13 5.5h-1.6a3 3 0 0 0 0 6h1.2a3 3 0 0 1 0 6H11a3.8 3.8 0 0 1-3.5-1.7" />
    </>
  ),
  telegram: (
    <>
      <path d="M21 4.5 2.8 11.3c-.7.3-.7.9.1 1.1l4.7 1.5L19 6.6c.4-.3.8-.1.5.2l-9.4 8.6-.3 4.4c.4 0 .6-.2.9-.5l2.1-2 4.4 3.2c.8.5 1.4.2 1.6-.7l3-13.9c.3-1.2-.4-1.7-1.2-1.4z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3.3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1.1z" />
    </>
  ),
  logs: (
    <>
      <path d="M4.5 5.5h15M4.5 10h15M4.5 14.5h10M4.5 19h7" />
    </>
  ),

  // —— 状态与操作 ——
  bell: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10z" />
      <path d="M10.2 19a2 2 0 0 0 3.6 0" />
    </>
  ),
  star: <path d="m12 3.8 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 10l5.9-.9z" />,
  pin: (
    <>
      <path d="M14.5 3.5 20.5 9.5l-3 1-3.4 3.4-.6 4.3-6.7-6.7 4.3-.6L14.5 8z" />
      <path d="M7.8 16.2 3.5 20.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M4 4.5 20 20M9.6 9.8a2.8 2.8 0 0 0 3.9 3.9" />
      <path d="M6.4 6.7C4 8.4 2.5 12 2.5 12s3.5 6.2 9.5 6.2c1.6 0 3-.4 4.2-1M17.9 15.3c2-1.6 3.6-3.3 3.6-3.3S18 5.8 12 5.8c-.8 0-1.5.1-2.2.3" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  x: <path d="M6 6 18 18M18 6 6 18" />,
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5h14v11l-4 4H5z" />
      <path d="M19 15.5h-4v4" />
      <path d="M8.5 9h7M8.5 12.5h4" />
    </>
  ),
  path: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M6 8.5v4a3 3 0 0 0 3 3h6" />
    </>
  ),
  candles: (
    <>
      <path d="M7 4v4M7 16v4M17 4v6M17 18v2" />
      <rect x="5" y="8" width="4" height="8" rx="0.5" />
      <rect x="15" y="10" width="4" height="8" rx="0.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.8-3.8" />
    </>
  ),
  news: (
    <>
      <path d="M3.5 5.5h13v13H3.5z" />
      <path d="M16.5 9h4v7.5a2 2 0 0 1-4 0z" />
      <path d="M6.5 9h7M6.5 12h7M6.5 15h4" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5 6 5.5h12l2.5 8v5h-17z" />
      <path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5" />
    </>
  ),
  arrowRight: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  alert: (
    <>
      <path d="M12 4.2 21 19.8H3z" />
      <path d="M12 10v4M12 17v.3" />
    </>
  ),
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.8V20h14V9.8" />
    </>
  ),
  /** 由低到高的阶梯：表示"从零开始、循序渐进" */
  steps: (
    <>
      <path d="M4 20h16M7 20V9M12 20V5M17 20v-8" />
      <path d="m7 9 5-4 5 7" />
    </>
  ),
  /** 拖拽把手。六点栅格是这个操作的通用记号，用户不需要学 */
  grip: (
    <>
      <circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  // —— 成就徽章（仪表盘）。此前直接渲染数据库里的 emoji，跨平台字形
  // 不一致也跟不了 currentColor，未解锁态只能靠 grayscale 滤镜硬调 ——
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
      <path d="M8 5.5H5.5c0 2.5 1 4 2.8 4.4M16 5.5h2.5c0 2.5-1 4-2.8 4.4" />
      <path d="M12 13v3.5M8.5 20.5h7M10 20.5v-2a2 2 0 0 1 4 0v2" />
    </>
  ),
  seedling: (
    <>
      <path d="M12 20.5V11" />
      <path d="M12 11C12 7 9.5 4.5 4.5 4.5c0 5 2.5 7.5 7.5 6.5" />
      <path d="M12 13c0-3 2-5 6.5-5 0 4.5-2 6.5-6.5 5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </>
  ),
  graduation: (
    <>
      <path d="m12 4 10 4.5-10 4.5L2 8.5z" />
      <path d="M6.5 10.8v4.7c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.7" />
      <path d="M22 8.5v5" />
    </>
  ),
  // —— 更多/溢出菜单。以前用 ⋮ / ⋯ 文本字符，基线与字形随字体回落漂移 ——
  "dots-v": (
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  "dots-h": (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  className?: string;
  /** 描边粗细。密集 UI 用 1.5，大尺寸展示用 1.25 */
  strokeWidth?: number;
  /** 实心态（收藏/置顶等 on/off 用同一个图标区分填充，而不是换两个图标） */
  filled?: boolean;
  /** 图标独立承载语义时必须给；与文字并排时留空，让它对读屏隐形 */
  label?: string;
}

export function Icon({ name, className, strokeWidth = 1.5, filled, label }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-5 w-5 shrink-0", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}
