"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MarketOverview } from "@/components/trade/MarketOverview";

const TRUST_ICONS = ["🔒", "🌱", "🌐", "🛡️"] as const;
const TRUST_KEYS = ["trust_1", "trust_2", "trust_3", "trust_4"] as const;
const HOW_KEYS = ["how_1", "how_2", "how_3"] as const;

export default function HomePage() {
  const t = useTranslations("home");
  const locale = useLocale();

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border-default">
        <div className="absolute inset-0 bg-gradient-to-b from-gold/5 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 py-24 text-center sm:py-32">
          <span className="inline-block rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-xs font-medium text-gold">
            {t("hero_eyebrow")}
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            <span className="gold-text">{t("hero_title")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">
            {t("hero_subtitle")}
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href={`/${locale}/register`}>
              <Button size="lg">{t("hero_cta")}</Button>
            </Link>
            <Link href={`/${locale}/videos`}>
              <Button variant="outline" size="lg">
                {t("hero_secondary")}
              </Button>
            </Link>
          </div>
          <p className="mx-auto mt-6 max-w-lg text-xs text-text-muted">
            {t("risk_caption")}
          </p>
        </div>
      </section>

      {/* Trust signals */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-center text-3xl font-bold">{t("trust_title")}</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_KEYS.map((key, i) => (
              <Card key={key} className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gold/10 text-2xl">
                  {TRUST_ICONS[i]}
                </div>
                <h3 className="text-base font-semibold">{t(`${key}_title`)}</h3>
                <p className="mt-2 text-sm text-text-secondary">{t(`${key}_desc`)}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border-default py-20">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-center text-3xl font-bold">{t("how_title")}</h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {HOW_KEYS.map((key, i) => (
              <div key={key} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full gold-gradient text-sm font-bold text-black">
                  {i + 1}
                </div>
                <h3 className="mt-4 text-lg font-semibold">{t(`${key}_title`)}</h3>
                <p className="mt-2 text-sm text-text-secondary">{t(`${key}_desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border-default py-20">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-center text-3xl font-bold">{t("features_title")}</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Card className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gold/10 text-2xl">
                📚
              </div>
              <h3 className="text-lg font-semibold">{t("feature_learn_title")}</h3>
              <p className="mt-2 text-sm text-text-secondary">{t("feature_learn_desc")}</p>
            </Card>
            <Card className="text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gold/10 text-2xl">
                📈
              </div>
              <h3 className="text-lg font-semibold">{t("feature_trade_title")}</h3>
              <p className="mt-2 text-sm text-text-secondary">{t("feature_trade_desc")}</p>
            </Card>
            <Card className="text-center sm:col-span-2 lg:col-span-1">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gold/10 text-2xl">
                🛡️
              </div>
              <h3 className="text-lg font-semibold">{t("feature_control_title")}</h3>
              <p className="mt-2 text-sm text-text-secondary">{t("feature_control_desc")}</p>
            </Card>
          </div>
        </div>
      </section>

      {/* Live Market Overview */}
      <section className="border-t border-border-default py-20">
        <div className="mx-auto max-w-7xl px-4">
          <h2 className="text-2xl font-bold text-text-primary">{t("market_overview")}</h2>
          <p className="mt-1 text-sm text-text-muted">Real-time data from BingX</p>
          <div className="mt-6">
            <MarketOverview />
          </div>
          <div className="mt-6 text-center">
            <Link href={`/${locale}/trade`}>
              <Button variant="outline">{t("view_full_trading")}</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border-default py-20">
        <div className="relative mx-auto max-w-4xl overflow-hidden rounded-lg border border-gold/20 bg-gradient-to-b from-gold/10 to-transparent px-6 py-16 text-center">
          <h2 className="text-3xl font-bold text-text-primary">{t("final_cta_title")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-text-secondary">{t("final_cta_subtitle")}</p>
          <div className="mt-8">
            <Link href={`/${locale}/register`}>
              <Button size="lg">{t("final_cta_button")}</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Risk disclosure */}
      <section className="border-t border-border-default py-12">
        <div className="mx-auto max-w-4xl px-4">
          <h3 className="text-sm font-semibold text-text-secondary">{t("risk_title")}</h3>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">{t("risk_body")}</p>
        </div>
      </section>
    </div>
  );
}
