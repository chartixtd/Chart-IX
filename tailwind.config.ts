import type { Config } from "tailwindcss";

/**
 * Ink & Gilt — 设计 token 层
 *
 * 主张：黑是石墨墨色（中性偏冷，绝不发棕、绝不纯黑），金是香槟金——
 * 只以四种形态出现：发丝线、数字、唯一的实心 CTA、金色行情曲线。
 * 大面积的「金色卡片 / 金色背景」在这个世界里不存在。
 *
 * 材质配方（金箔渐变、斜面、玻璃棱线）本体在 globals.css 的 :root 里，
 * 这里只做引用——theme() 在 @layer components 里解析含逗号的值会静默失败。
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 石墨墨色：中性偏冷，五阶。绝不纯黑（OLED 拖影 + 失去深度）
        "bg-primary": "#09090B",
        "bg-secondary": "#0F0F12",
        "bg-tertiary": "#16161A",
        "bg-hover": "#1E1E23",
        "bg-elevated": "#131317",
        // 描边：三阶中性灰，在任何底色上都成立
        "border-default": "#1F1F24",
        "border-hover": "#2C2C33",
        "border-strong": "#3A3A42",
        // 香槟金 —— 六阶。两端存在的唯一理由是让渐变能读成金属
        "gold-deep": "#6B5322",
        "gold-dark": "#A6863F",
        gold: "#D3B26A",
        "gold-hover": "#E2C784",
        "gold-light": "#EEDCA6",
        "gold-spec": "#FBF3DC",
        // 墨色文本：暖白、灰白、雾灰。text-muted 对 bg-primary 5.4:1（AA）
        "text-primary": "#F4F1EA",
        "text-secondary": "#A7A39A",
        "text-muted": "#807C74",
        "text-faint": "#5A5751",
        // 行情语义色。danger 对自身 10% 底色 >= 4.6:1
        success: "#3CC98A",
        "success-bg": "rgba(60, 201, 138, 0.1)",
        danger: "#EA5A5F",
        "danger-bg": "rgba(234, 90, 95, 0.1)",
        warning: "#E0AE45",
        "warning-bg": "rgba(224, 174, 69, 0.1)",
        info: "#6A9BF0",
        "info-bg": "rgba(106, 155, 240, 0.1)",
        // 场景基调色（screener）。色相与 scenario-ui.ts 的推导一致，
        // 饱和度压低一档以坐进墨色世界。
        "accent-teal": "#3CC4AF",
        "accent-orange": "#EE9A4D",
        "accent-violet": "#B692E8",
        "accent-magenta": "#DF7ECD",
        "accent-cyan": "#35D0E8",
        "accent-indigo": "#7C6CF0",
        "accent-rose": "#F2617A",
        "accent-ignite": "#B8E62E",
      },
      spacing: {
        "safe-t": "env(safe-area-inset-top)",
        "safe-b": "env(safe-area-inset-bottom)",
        "safe-l": "env(safe-area-inset-left)",
        "safe-r": "env(safe-area-inset-right)",
        tabbar: "calc(var(--tabbar-h, 70px) + env(safe-area-inset-bottom))",
      },
      height: {
        dvh: "100dvh",
      },
      minHeight: {
        dvh: "100dvh",
      },
      maxWidth: {
        page: "80rem",
        prose: "68ch",
      },
      fontFamily: {
        display: ["var(--font-manrope)", '"Noto Sans SC"', "system-ui", "sans-serif"],
        sans: ["var(--font-inter)", '"Noto Sans SC"', "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        // 展示字号阶：clamp 保证手机上不爆行
        "display-2xl": ["clamp(3.25rem, 8.5vw, 7.5rem)", { lineHeight: "0.95", letterSpacing: "-0.035em" }],
        "display-xl": ["clamp(2.75rem, 6vw, 5.25rem)", { lineHeight: "1", letterSpacing: "-0.03em" }],
        "display-lg": ["clamp(2.25rem, 4.2vw, 3.75rem)", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "display-md": ["clamp(1.75rem, 3vw, 2.5rem)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "display-sm": ["clamp(1.375rem, 2.2vw, 1.75rem)", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        eyebrow: ["0.6875rem", { lineHeight: "1", letterSpacing: "0.22em" }],
        micro: ["0.625rem", { lineHeight: "1", letterSpacing: "0.18em" }],
      },
      letterSpacing: {
        tightest: "-0.045em",
        tighter: "-0.025em",
        eyebrow: "0.22em",
        label: "0.12em",
      },
      /**
       * 圆角：锐利是这个世界的默认。
       *   xs/sm/md = 0/2/4px 数据面（终端、表格、后台）与营销面的按钮/输入框
       *   lg/xl/2xl = 6/10/14px 内容容器（弹窗、媒体、Bento 格）
       */
      borderRadius: {
        none: "0",
        xs: "0",
        sm: "2px",
        md: "4px",
        lg: "6px",
        xl: "10px",
        "2xl": "14px",
      },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255,255,255,0.03), 0 20px 50px -30px rgba(0,0,0,0.9)",
        "card-lg": "inset 0 1px 0 rgba(255,255,255,0.04), 0 40px 80px -40px rgba(0,0,0,0.9)",
        modal: "inset 0 1px 0 rgba(255,255,255,0.05), 0 40px 100px -30px rgba(0,0,0,0.95)",
        nav: "0 1px 0 rgba(211, 178, 106, 0.14)",
        gold: "0 24px 60px -24px rgba(211, 178, 106, 0.45)",
        foil: "var(--bevel)",
        "foil-sm": "var(--bevel-sm)",
        glass: "var(--glass-shadow)",
        "glass-sm": "var(--glass-shadow-sm)",
        ring: "0 0 0 1px rgba(211, 178, 106, 0.35)",
      },
      backgroundImage: {
        "gold-foil": "var(--foil)",
        "gold-foil-x": "var(--foil-x)",
        "gold-sheen":
          "linear-gradient(105deg, transparent 30%, rgba(251,243,220,0.5) 48%, transparent 66%)",
        obsidian: "var(--obsidian)",
        "hairline-gold": "var(--hairline-gold)",
        "ink-fade": "linear-gradient(180deg, rgba(9,9,11,0) 0%, #09090B 100%)",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(28px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // 只动 transform / opacity：动 filter 会每帧重建模糊，
        // 叠在英雄的两团 blur(90px) 环境光上足以把合成器拖住。
        "blur-in": {
          from: { opacity: "0", transform: "translateY(16px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "line-grow": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
        sheen: {
          "0%": { transform: "translateX(-120%)" },
          "60%, 100%": { transform: "translateX(220%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "foil-sweep": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "price-up": {
          "0%": { backgroundColor: "rgba(60, 201, 138, 0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        "price-down": {
          "0%": { backgroundColor: "rgba(234, 90, 95, 0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        "ring-expand": {
          "0%": { boxShadow: "0 0 0 0 rgba(211, 178, 106, 0.35)" },
          "100%": { boxShadow: "0 0 0 4px rgba(211, 178, 106, 0)" },
        },
        breathe: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.03)" },
        },
        "aura-a": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(6%, -4%, 0) scale(1.15)" },
        },
        "aura-b": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1.1)" },
          "50%": { transform: "translate3d(-7%, 5%, 0) scale(1)" },
        },
        "sheet-in": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out",
        "slide-up": "slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slide-down 0.2s ease-out",
        "scale-in": "scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        // 英雄区的入场：0.65s 而不是 0.9s。标题是 LCP 元素，它从 opacity 0
        // 淡入多久，LCP 就晚多久——体量感由字号承担，不该由时长换。
        "rise-in": "rise-in 0.65s cubic-bezier(0.16, 1, 0.3, 1) both",
        "blur-in": "blur-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) both",
        "line-grow": "line-grow 1.2s cubic-bezier(0.16, 1, 0.3, 1) both",
        sheen: "sheen 1.1s cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 2s linear infinite",
        "foil-sweep": "foil-sweep 7s ease-in-out infinite",
        "price-up": "price-up 0.8s ease-out",
        "price-down": "price-down 0.8s ease-out",
        "ring-expand": "ring-expand 0.6s ease-out",
        breathe: "breathe 8s ease-in-out infinite",
        "aura-a": "aura-a 24s ease-in-out infinite",
        "aura-b": "aura-b 30s ease-in-out infinite",
        "sheet-in": "sheet-in 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
        marquee: "marquee 40s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
