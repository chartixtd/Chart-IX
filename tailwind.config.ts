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
        "bg-primary": "#0a0a0a",
        "bg-secondary": "#141414",
        "bg-tertiary": "#1a1a1a",
        "bg-hover": "#222222",
        "border-default": "#2a2a2a",
        "border-hover": "#3a3a3a",
        gold: "#d4a843",
        "gold-hover": "#e0b95a",
        "gold-light": "#f0d078",
        "gold-dark": "#c8963e",
        "text-primary": "#ffffff",
        "text-secondary": "#a0a0a0",
        "text-muted": "#666666",
        success: "#22c55e",
        "success-bg": "rgba(34, 197, 94, 0.1)",
        danger: "#ef4444",
        "danger-bg": "rgba(239, 68, 68, 0.1)",
        warning: "#f59e0b",
        "warning-bg": "rgba(245, 158, 11, 0.1)",
        info: "#3b82f6",
        "info-bg": "rgba(59, 130, 246, 0.1)",
      },
      fontFamily: {
        sans: ['"Inter"', '"Noto Sans SC"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      borderRadius: {
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
      },
      boxShadow: {
        card: "0 2px 8px rgba(0, 0, 0, 0.4)",
        modal: "0 8px 32px rgba(0, 0, 0, 0.6)",
        nav: "0 1px 0 rgba(255, 255, 255, 0.06)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-in-out",
        "slide-up": "slide-up 0.3s ease-in-out",
        "slide-down": "slide-down 0.2s ease-in-out",
        "scale-in": "scale-in 0.15s ease-in-out",
      },
    },
  },
  plugins: [],
};

export default config;
