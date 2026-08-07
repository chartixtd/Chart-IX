"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * False during SSR and the hydration render, true afterwards.
 * Lets a page whose desktop/mobile trees differ structurally render a
 * neutral skeleton for the (single) hydration frame, then mount the
 * correct tree once — instead of hydrating the mobile tree on desktop
 * and remounting everything (chart included) after the breakpoint flips.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}
