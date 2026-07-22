import { create } from "zustand";
import type { Locale } from "@/types";

interface LanguageState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLanguageStore = create<LanguageState>((set) => ({
  locale: "en-US",
  setLocale: (locale) => set({ locale }),
}));
