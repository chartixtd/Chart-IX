"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MarketOverview } from "@/components/trade/MarketOverview";

export default function HomePage() {
  const t = useTranslations("home");

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border-default">
        <div className="absolute inset-0 bg-gradient-to-b from-gold/5 to-transparent" />
        <div className="relative mx-auto max-w-7xl px-4 py-24 text-center sm:py-32">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            <span className="gold-text">{t("hero_title")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">
            {t("hero_subtitle")}
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/videos">
              <Button size="lg">{t("hero_cta")}</Button>
            </Link>
            <Link href="#features">
              <Button variant="outline" size="lg">
                {t("hero_secondary")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20">
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
            <Link href="/trade">
              <Button variant="outline">{t("view_full_trading")}</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
