"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { useFavoritesStore } from "@/stores/favorites";
import { usePriceAlertsStore, type PriceAlert } from "@/stores/priceAlerts";
import {
  useTradePrefsStore, type TradeMarketType, type TradeRightTab, DEFAULT_PINNED_INTERVALS,
} from "@/stores/tradePrefs";
import {
  useChartStore, migrateLegacyIndicators,
  type AppliedIndicator, type Drawing,
} from "@/stores/chartStore";
import { INDICATOR_BY_ID } from "@/lib/chart/indicator-registry";

interface StoredPreferences {
  favorites?: string[];
  priceAlerts?: PriceAlert[];
  trade?: {
    symbol?: string;
    interval?: string;
    market?: TradeMarketType;
    rightTab?: TradeRightTab;
    pinnedIntervals?: string[];
    /** Pre-registry indicator settings, read only to migrate them forward. */
    chartIndicators?: Record<string, unknown>;
    indicatorParams?: Record<string, number>;
  };
  chart?: {
    appliedIndicators?: AppliedIndicator[];
    drawings?: Record<string, Drawing[]>;
    drawingColor?: string;
    keepToolActive?: boolean;
  };
}

/** Snapshot the synced stores into a single JSONB-friendly object. */
function snapshot(): StoredPreferences {
  const trade = useTradePrefsStore.getState();
  const chart = useChartStore.getState();
  return {
    favorites: useFavoritesStore.getState().favorites,
    priceAlerts: usePriceAlertsStore.getState().alerts,
    trade: {
      symbol: trade.symbol,
      interval: trade.interval,
      market: trade.market,
      rightTab: trade.rightTab,
      pinnedIntervals: trade.pinnedIntervals,
    },
    chart: {
      appliedIndicators: chart.appliedIndicators,
      drawings: chart.drawings,
      drawingColor: chart.drawingColor,
      keepToolActive: chart.keepToolActive,
    },
  };
}

/**
 * Headless preferences synchroniser.
 *
 * On login it pulls the user's saved preferences from `user_preferences`,
 * merges them with whatever is already in localStorage (favorites/alerts are
 * unioned so nothing is lost; trade and chart prefs let the DB win for
 * cross-device continuity), hydrates the stores, then writes the merged result
 * back. After hydration it debounce-persists any further store changes.
 *
 * Logged-out visitors keep using localStorage untouched.
 */
export function PreferencesSync() {
  const userId = useAuth().userId;
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!userId) {
      hydratedRef.current = false;
      return;
    }

    const supabase = createClient();
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribers: Array<() => void> = [];

    const persist = () => {
      const preferences = snapshot();
      supabase
        .from("user_preferences")
        .upsert({ user_id: userId, preferences }, { onConflict: "user_id" })
        .then(() => {});
    };

    const schedulePersist = () => {
      if (!hydratedRef.current) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(persist, 800);
    };

    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("preferences")
        .eq("user_id", userId)
        .maybeSingle();

      if (cancelled) return;

      const remote = (data?.preferences ?? {}) as StoredPreferences;

      // favorites: union local + remote (order-stable, deduped)
      const localFavorites = useFavoritesStore.getState().favorites;
      const mergedFavorites = Array.from(
        new Set([...(remote.favorites ?? []), ...localFavorites])
      );
      useFavoritesStore.setState({ favorites: mergedFavorites });

      // priceAlerts: merge by id (remote first, local fills gaps)
      const localAlerts = usePriceAlertsStore.getState().alerts;
      const byId = new Map<string, PriceAlert>();
      for (const a of remote.priceAlerts ?? []) byId.set(a.id, a);
      for (const a of localAlerts) if (!byId.has(a.id)) byId.set(a.id, a);
      usePriceAlertsStore.setState({ alerts: Array.from(byId.values()) });

      // trade prefs: DB wins when present (restore last-used setup on new device)
      if (remote.trade) {
        const { symbol, interval, market, rightTab, pinnedIntervals } = remote.trade;
        useTradePrefsStore.setState({
          ...(symbol ? { symbol } : {}),
          ...(interval ? { interval } : {}),
          ...(market ? { market } : {}),
          ...(rightTab ? { rightTab } : {}),
          ...(pinnedIntervals?.length ? { pinnedIntervals } : { pinnedIntervals: DEFAULT_PINNED_INTERVALS }),
        });
      }

      // chart state: prefer the saved instance list; otherwise carry a v1 save forward
      const chart = useChartStore.getState();
      if (remote.chart?.appliedIndicators) {
        useChartStore.setState({
          // Drop instances whose registry entry no longer exists.
          appliedIndicators: remote.chart.appliedIndicators.filter((a) => INDICATOR_BY_ID.has(a.defId)),
          migratedV1: true,
          ...(remote.chart.drawings ? { drawings: remote.chart.drawings } : {}),
          ...(remote.chart.drawingColor ? { drawingColor: remote.chart.drawingColor } : {}),
          ...(typeof remote.chart.keepToolActive === "boolean"
            ? { keepToolActive: remote.chart.keepToolActive }
            : {}),
        });
      } else if (remote.trade?.chartIndicators && !chart.migratedV1) {
        useChartStore.setState({
          appliedIndicators: migrateLegacyIndicators(
            remote.trade.chartIndicators as Parameters<typeof migrateLegacyIndicators>[0],
            remote.trade.indicatorParams
          ),
          migratedV1: true,
        });
      } else if (remote.chart?.drawings) {
        useChartStore.setState({ drawings: remote.chart.drawings });
      }

      hydratedRef.current = true;

      // Write the merged snapshot back so the DB reflects the union.
      persist();

      // Persist any subsequent local changes (debounced).
      unsubscribers.push(useFavoritesStore.subscribe(schedulePersist));
      unsubscribers.push(usePriceAlertsStore.subscribe(schedulePersist));
      unsubscribers.push(useTradePrefsStore.subscribe(schedulePersist));
      unsubscribers.push(useChartStore.subscribe(schedulePersist));
    })();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribers.forEach((u) => u());
      hydratedRef.current = false;
    };
  }, [userId]);

  return null;
}
