import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FavoritesState {
  favorites: string[];
  toggleFavorite: (symbol: string) => void;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set) => ({
      favorites: [],
      toggleFavorite: (symbol) =>
        set((state) => ({
          favorites: state.favorites.includes(symbol)
            ? state.favorites.filter((s) => s !== symbol)
            : [...state.favorites, symbol],
        })),
    }),
    { name: "chart-ix-favorites" }
  )
);
