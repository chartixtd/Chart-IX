import type { Config } from "tailwindcss";

/**
 * Obsidian & Gilt — 设计 token 层
 *
 * 核心主张：金不是一个颜色，是一种材质。所有"金"的强调都应该落在
 * bg-gold-foil（9 段渐变，50% 处有高光带）+ shadow-foil（斜面）上，
 * 而不是 text-gold 平涂。平涂只保留给小尺寸图标与状态文字。
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
        // Warm obsidian — never pure black (OLED smear + 暖调是品牌的一半)
        "bg-primary": "#0B0A08",
        "bg-secondary": "#14120E",
        "bg-tertiary": "#1C1913",
        "bg-hover": "#262117",
        "border-default": "#2C271C",
        "border-hover": "#3A3325",
        // Champagne gold — 六阶，两端是为了让渐变能读成金属而不是渐变
        "gold-deep": "#6E5323",
        "gold-dark": "#A5813A",
        gold: "#C9A24B",
        "gold-hover": "#DDB964",
        "gold-light": "#EBD08A",
        "gold-spec": "#FFF6DC",
        // Warm off-white ink, never pure white
        "text-primary": "#F5F0E6",
        "text-secondary": "#A89F8C",
        // 旧值 #6E675A 对 bg-primary 只有 3.53:1，压着风险声明与免责文案，
        // 属于 WCAG AA 不达标。#8A8172 是 5.15:1（对 bg-tertiary 仍有 4.56:1）。
        "text-muted": "#8A8172",
        success: "#34C77B",
        "success-bg": "rgba(52, 199, 123, 0.1)",
        danger: "#E85055",
        "danger-bg": "rgba(232, 80, 85, 0.1)",
        warning: "#E0A93B",
        "warning-bg": "rgba(224, 169, 59, 0.1)",
        info: "#5B8DEF",
        "info-bg": "rgba(91, 141, 239, 0.1)",
      },
      spacing: {
        "safe-t": "env(safe-area-inset-top)",
        "safe-b": "env(safe-area-inset-bottom)",
        "safe-l": "env(safe-area-inset-left)",
        "safe-r": "env(safe-area-inset-right)",
        // 底部 tab bar 高度(56) + 中央凸起溢出(14) + 系统安全区
        // 页面内容底部统一用 pb-tabbar，避免逐页手算导致漂移
        tabbar: "calc(70px + env(safe-area-inset-bottom))",
      },
      height: {
        dvh: "100dvh",
      },
      minHeight: {
        dvh: "100dvh",
      },
      fontFamily: {
        display: [
          "var(--font-space-grotesk)",
          '"Noto Sans SC"',
          "system-ui",
          "sans-serif",
        ],
        sans: ["var(--font-inter)", '"Noto Sans SC"', "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.045em",
        tighter: "-0.025em",
      },
      /**
       * 圆角分两族，用同一套 key 表达：
       *   xs/sm/md  = 数据面（交易终端、表格、订单、后台）— 锐利传达精密
       *   lg/xl/2xl = 内容面（营销、卡片、弹窗、Bento）— 圆润传达亲和
       * 现有 184 处 rounded-xs/sm/md 全在密集 UI 里，重定义后自动收紧。
       */
      borderRadius: {
        xs: "2px",
        sm: "4px",
        md: "6px",
        lg: "12px",
        xl: "16px",
        "2xl": "24px",
      },
      boxShadow: {
        card: "0 4px 20px -6px rgba(0, 0, 0, 0.55)",
        "card-lg": "0 12px 40px -10px rgba(0, 0, 0, 0.7)",
        modal: "0 24px 60px -12px rgba(0, 0, 0, 0.75)",
        nav: "0 1px 0 rgba(201, 162, 75, 0.12)",
        gold: "0 8px 30px -8px rgba(201, 162, 75, 0.35)",
        // 材质配方本体在 globals.css 的 :root 里（见那里的注释——用 theme()
        // 在 @layer components 取这些含逗号的值会静默失败）。这里只做引用。
        foil: "var(--bevel)",
        "foil-sm": "var(--bevel-sm)",
        glass: "var(--glass-shadow)",
        "glass-sm": "var(--glass-shadow-sm)",
      },
      backgroundImage: {
        "gold-foil": "var(--foil)",
        "gold-foil-x": "var(--foil-x)",
        "gold-sheen":
          "linear-gradient(105deg, transparent 30%, rgba(255,246,220,0.55) 48%, transparent 66%)",
        obsidian: "var(--obsidian)",
        "hairline-gold": "var(--hairline-gold)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(24px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        sheen: {
          "0%": { transform: "translateX(-120%)" },
          "60%, 100%": { transform: "translateX(220%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        // 金箔高光带缓慢扫过（用在超大标题 / logo，background-size: 200%）
        "foil-sweep": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "price-up": {
          "0%": { backgroundColor: "rgba(52, 199, 123, 0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        "price-down": {
          "0%": { backgroundColor: "rgba(232, 80, 85, 0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        "ring-expand": {
          "0%": { boxShadow: "0 0 0 0 rgba(201, 162, 75, 0.4)" },
          "100%": { boxShadow: "0 0 0 4px rgba(201, 162, 75, 0)" },
        },
        breathe: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.03)" },
        },
        // 环境光晕：两团金色光斑缓慢漂移。这是本设计里"发光"的全部预算——
        // 氛围里的光，不是描边上的光。
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
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out",
        "slide-up": "slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slide-down 0.2s ease-out",
        "scale-in": "scale-in 0.18s ease-out",
        "rise-in": "rise-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
        sheen: "sheen 1.1s cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 2s linear infinite",
        "foil-sweep": "foil-sweep 7s ease-in-out infinite",
        "price-up": "price-up 0.8s ease-out",
        "price-down": "price-down 0.8s ease-out",
        "ring-expand": "ring-expand 0.6s ease-out",
        breathe: "breathe 8s ease-in-out infinite",
        "aura-a": "aura-a 22s ease-in-out infinite",
        "aura-b": "aura-b 28s ease-in-out infinite",
        "sheet-in": "sheet-in 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
