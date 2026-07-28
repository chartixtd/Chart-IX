"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useSpotTicker } from "@/hooks/useMarketData";
import { useBingXWebSocket } from "@/hooks/useBingXWebSocket";
import { formatPrice, formatPercent } from "@/lib/utils";
import { cn } from "@/lib/utils";

const TRUST_KEYS = ["trust_1", "trust_2", "trust_3", "trust_4"] as const;
const HOW_KEYS = ["how_1", "how_2", "how_3"] as const;
const HOT_SYMBOLS = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT"] as const;

// A restrained live quote — silent proof, not a trading panel.
function HotQuote({ symbol }: { symbol: string }) {
  const { data: ticker } = useSpotTicker(symbol);
  const base = symbol.split("-")[0];
  const pct = ticker ? parseFloat(ticker.priceChangePercent) : 0;
  const up = pct >= 0;

  return (
    <div className="flex items-baseline gap-2.5 whitespace-nowrap">
      <span className="font-display text-sm tracking-tight text-text-primary">{base}</span>
      {ticker ? (
        <>
          <span className="font-mono text-sm tabular-nums text-text-secondary">
            {formatPrice(Number(ticker.lastPrice))}
          </span>
          <span className={cn("font-mono text-xs tabular-nums", up ? "text-success" : "text-danger")}>
            {formatPercent(pct)}
          </span>
        </>
      ) : (
        <span className="h-3 w-16 animate-pulse rounded-xs bg-bg-tertiary" />
      )}
    </div>
  );
}

// Full-width quote rail across the top of the hero — a private-bank ticker,
// four hot pairs only, hairline-separated.
function HotCoinsRail() {
  const t = useTranslations("home");
  useBingXWebSocket([...HOT_SYMBOLS]);

  return (
    <div className="flex items-center gap-5 overflow-x-auto sm:gap-8">
      <span className="flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-text-muted">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
        {t("market_overview")}
      </span>
      <div className="flex items-center gap-5 sm:gap-7">
        {HOT_SYMBOLS.map((s, i) => (
          <div key={s} className="flex items-center gap-5 sm:gap-7">
            {i > 0 && <span className="h-4 w-px bg-border-default" />}
            <HotQuote symbol={s} />
          </div>
        ))}
      </div>
      <span className="ml-auto hidden shrink-0 text-[10px] uppercase tracking-[0.18em] text-text-muted md:inline">
        BingX · Live
      </span>
    </div>
  );
}

// Hairline gold line-icons drawn in the world's own grammar (no emoji).
function TrustIcon({ i, className }: { i: number; className?: string }) {
  const paths = [
    // vault / funds stay on exchange
    <g key="0">
      <rect x="3" y="6" width="18" height="13" rx="1.5" />
      <circle cx="12" cy="12.5" r="3" />
      <path d="M12 12.5v2.5M3 6l3-3h12l3 3" />
    </g>,
    // beginner friendly / seedling steps
    <g key="1">
      <path d="M4 20h16M7 20V9M12 20V5M17 20v-8" />
      <path d="M7 9l5-4 5 7" />
    </g>,
    // globe / multi-language
    <g key="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
    </g>,
    // shield / risk control
    <g key="3">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </g>,
  ];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[i]}
    </svg>
  );
}

function FeatureIcon({ i, className }: { i: number; className?: string }) {
  const paths = [
    // learn / stacked pages
    <g key="0">
      <path d="M4 5h7a2 2 0 012 2v12a2 2 0 00-2-2H4V5zM20 5h-7a2 2 0 00-2 2v12a2 2 0 012-2h7V5z" />
    </g>,
    // trade / candles
    <g key="1">
      <path d="M6 4v4M6 16v4M18 4v6M18 18v2" />
      <rect x="4" y="8" width="4" height="8" rx="0.5" />
      <rect x="16" y="10" width="4" height="8" rx="0.5" />
      <path d="M12 3v18" strokeDasharray="1.5 2.5" />
    </g>,
    // control / sliders
    <g key="2">
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2.2" />
      <circle cx="10" cy="16" r="2.2" />
    </g>,
  ];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[i]}
    </svg>
  );
}

export default function HomePage() {
  const t = useTranslations("home");
  const locale = useLocale();

  return (
    <div>
      {/* Hero — headline-led, full-width editorial */}
      <section className="hero-ground grain relative overflow-hidden">
        {/* Oversized monogram watermark */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-8 top-1/2 -translate-y-1/2 select-none font-display text-[38vw] leading-none text-gold/[0.04] sm:text-[28rem] animate-breathe"
        >
          IX
        </span>

        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-24 sm:pt-28">
          <div className="max-w-4xl">
            <span className="inline-flex items-center gap-3 text-xs font-medium uppercase tracking-[0.22em] text-gold animate-rise-in">
              <span className="h-px w-10 bg-gold/50" />
              {t("hero_eyebrow")}
            </span>
            <h1 className="mt-8 font-display text-[clamp(2.75rem,9vw,6rem)] leading-[0.98] tracking-tightest text-text-primary animate-rise-in [animation-delay:60ms]">
              {t("hero_title")}
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-text-secondary animate-rise-in [animation-delay:120ms] sm:text-xl">
              {t("hero_subtitle")}
            </p>
            <div className="mt-11 flex flex-wrap items-center gap-4 animate-rise-in [animation-delay:180ms]">
              <Link href={`/${locale}/register`}>
                <Button size="lg">{t("hero_cta")}</Button>
              </Link>
              <Link href={`/${locale}/videos`}>
                <Button variant="ghost" size="lg" className="text-text-primary">
                  {t("hero_secondary")}
                  <span aria-hidden className="ml-1 text-gold">→</span>
                </Button>
              </Link>
            </div>
            <p className="mt-8 max-w-md text-xs leading-relaxed text-text-muted animate-rise-in [animation-delay:220ms]">
              {t("risk_caption")}
            </p>
          </div>
        </div>

        {/* Hot-coins quote rail — silent proof at the base of the hero */}
        <div className="relative border-y border-border-default bg-bg-primary/40 backdrop-blur-sm">
          <div className="mx-auto max-w-6xl px-4 py-4">
            <HotCoinsRail />
          </div>
        </div>
      </section>

      {/* Trust signals — editorial two-column ledger */}
      <section className="border-t border-border-default py-24">
        <div className="mx-auto grid max-w-6xl gap-x-16 gap-y-10 px-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="font-display text-3xl leading-tight tracking-tight text-text-primary sm:text-4xl">
              {t("trust_title")}
            </h2>
            <div className="hairline-gold mt-6 w-16" />
          </div>
          <div className="divide-y divide-border-default">
            {TRUST_KEYS.map((key, i) => (
              <div key={key} className="flex gap-6 py-7 first:pt-0">
                <TrustIcon i={i} className="mt-0.5 h-8 w-8 shrink-0 text-gold" />
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">
                    {t(`${key}_title`)}
                  </h3>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-text-secondary">
                    {t(`${key}_desc`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — numbered ledger of steps */}
      <section className="border-t border-border-default bg-bg-secondary/30 py-24">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center font-display text-3xl tracking-tight text-text-primary sm:text-4xl">
            {t("how_title")}
          </h2>
          <div className="mx-auto mt-16 grid max-w-5xl gap-px overflow-hidden rounded-lg border border-border-default bg-border-default sm:grid-cols-3">
            {HOW_KEYS.map((key, i) => (
              <div key={key} className="bg-bg-secondary p-8">
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-4xl leading-none text-gold">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="h-px flex-1 bg-border-hover" />
                </div>
                <h3 className="mt-6 text-lg font-semibold text-text-primary">
                  {t(`${key}_title`)}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-text-secondary">
                  {t(`${key}_desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="font-display text-3xl tracking-tight text-text-primary sm:text-4xl">
            {t("features_title")}
          </h2>
          <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {(["feature_learn", "feature_trade", "feature_control"] as const).map(
              (key, i) => (
                <div key={key} className="flex gap-5">
                  <div className="shrink-0">
                    <div className="flex h-12 w-12 items-center justify-center rounded-md border border-gold/25 bg-gold/5">
                      <FeatureIcon i={i} className="h-6 w-6 text-gold" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">
                      {t(`${key}_title`)}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                      {t(`${key}_desc`)}
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
          <div className="mt-14">
            <Link href={`/${locale}/trade`}>
              <Button variant="outline">{t("view_full_trading")}</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA — engraved plate */}
      <section className="border-t border-border-default py-24">
        <div className="hero-ground grain relative mx-auto max-w-4xl overflow-hidden rounded-xl border border-gold/20 px-6 py-20 text-center">
          <div className="hairline-gold mx-auto mb-8 w-16" />
          <h2 className="font-display text-4xl tracking-tight text-text-primary sm:text-5xl">
            {t("final_cta_title")}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-text-secondary">
            {t("final_cta_subtitle")}
          </p>
          <div className="mt-10">
            <Link href={`/${locale}/register`}>
              <Button size="lg">{t("final_cta_button")}</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Risk disclosure */}
      <section className="border-t border-border-default py-14">
        <div className="mx-auto max-w-4xl px-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t("risk_title")}
          </h3>
          <p className="mt-3 text-xs leading-relaxed text-text-muted">
            {t("risk_body")}
          </p>
        </div>
      </section>
    </div>
  );
}
