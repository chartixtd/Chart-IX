import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm graphite / obsidian — never pure black
        "bg-primary": "#0B0A08",
        "bg-secondary": "#14120E",
        "bg-tertiary": "#1C1913",
        "bg-hover": "#262117",
        "border-default": "#2C271C",
        "border-hover": "#3A3325",
        // Champagne gold — engraved metal, not neon
        gold: "#C9A24B",
        "gold-hover": "#DDB964",
        "gold-light": "#EBD08A",
        "gold-dark": "#A5813A",
        // Warm off-white ink, never pure white
        "text-primary": "#F5F0E6",
        "text-secondary": "#A89F8C",
        "text-muted": "#6E675A",
        success: "#34C77B",
        "success-bg": "rgba(52, 199, 123, 0.1)",
        danger: "#E5484D",
        "danger-bg": "rgba(229, 72, 77, 0.1)",
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
        display: ["var(--font-marcellus)", '"Noto Serif SC"', "Georgia", "serif"],
        sans: ["var(--font-inter)", '"Noto Sans SC"', "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        tighter: "-0.02em",
      },
      borderRadius: {
        xs: "4px",
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "20px",
      },
      boxShadow: {
        card: "0 4px 20px -6px rgba(0, 0, 0, 0.55)",
        "card-lg": "0 12px 40px -10px rgba(0, 0, 0, 0.7)",
        modal: "0 24px 60px -12px rgba(0, 0, 0, 0.75)",
        nav: "0 1px 0 rgba(201, 162, 75, 0.12)",
        gold: "0 8px 30px -8px rgba(201, 162, 75, 0.35)",
      },
      backgroundImage: {
        "gold-foil":
          "linear-gradient(135deg, #A5813A 0%, #C9A24B 45%, #EBD08A 100%)",
        "gold-sheen":
          "linear-gradient(105deg, transparent 30%, rgba(235,208,138,0.5) 48%, transparent 66%)",
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
          from: { opacity: "0", transform: "translateY(20px)" },
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
        "price-up": {
          "0%": { backgroundColor: "rgba(52, 199, 123, 0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        "price-down": {
          "0%": { backgroundColor: "rgba(229, 72, 77, 0.18)" },
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
        "price-up": "price-up 0.8s ease-out",
        "price-down": "price-down 0.8s ease-out",
        "ring-expand": "ring-expand 0.6s ease-out",
        breathe: "breathe 8s ease-in-out infinite",
        "sheet-in": "sheet-in 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
