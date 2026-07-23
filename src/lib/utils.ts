import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Cache Intl.NumberFormat instances — avoids allocation on every price update
const formatterCache = new Map<number, Intl.NumberFormat>();
function getFormatter(decimals: number): Intl.NumberFormat {
  let fmt = formatterCache.get(decimals);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatterCache.set(decimals, fmt);
  }
  return fmt;
}

export function formatNumber(value: number, decimals = 2): string {
  return getFormatter(decimals).format(value);
}

export function formatPrice(price: number): string {
  if (price >= 1) return getFormatter(2).format(price);
  if (price >= 0.01) return getFormatter(4).format(price);
  return getFormatter(8).format(price);
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unknown error occurred";
}
