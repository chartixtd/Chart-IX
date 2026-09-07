import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { AuraField } from "@/components/motion/AuraField";
import { GoldChart } from "@/components/motion/GoldChart";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { Icon } from "@/components/ui/Icon";
import { HotCoinsRail } from "./HotCoinsRail";

/**
 * 首页（Persuade 面，8 / 7 / 3）
 *
 * 第一屏：左五右七的分栏。左侧是超大轻字重标题，右侧是真实 BTC 行情渲染成的
 * 香槟金曲线——产品本身就是视觉，不用假截图。金只出现在四处：发丝线、数字、
 * 唯一的实心 CTA、那条曲线。
 *
 * 版式家族逐段不重复：分栏英雄 → 行情条 → 双栏编号台账 → 三栏时间线 →
 * Bento → 居中铭牌 → 风险声明。
 */

const TRUST_KEYS = ["trust_1", "trust_2", "trust_3", "trust_4"] as const;
const HOW_KEYS = ["how_1", "how_2", "how_3"] as const;

function Numeral({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={`numeral tabular-nums text-gold ${className}`}>{String(n).padStart(2, "0")}</span>
  );
}

export default async function HomeClient({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <div>
      <ScrollReveal />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="hero-ground grain relative overflow-hidden">
        <AuraField />
        <div aria-hidden className="ruled-grid pointer-events-none absolute inset-0 opacity-70" />

        <div className="relative mx-auto max-w-page px-6 pb-16 pt-14 lg:pb-24 lg:pt-20">
          <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-5">
              <p className="section-mark eyebrow-gold animate-rise-in">{t("hero_eyebrow")}</p>
              <h1 className="display mt-9 animate-rise-in text-[clamp(2.75rem,5.4vw,5rem)] leading-[1.02] [animation-delay:80ms]">
                {t("hero_title")}
              </h1>
              <p className="mt-8 max-w-md animate-rise-in text-base leading-relaxed text-text-secondary [animation-delay:160ms] lg:text-lg">
                {t("hero_subtitle")}
              </p>
              <div className="mt-11 flex animate-rise-in flex-wrap items-center gap-3 [animation-delay:240ms]">
                <Link href={`/${locale}/register`}>
                  <Button size="lg">{t("hero_cta")}</Button>
                </Link>
                <Link href={`/${locale}/videos`}>
                  <Button variant="ghost" size="lg" className="text-text-primary">
                    {t("hero_secondary")}
                    <Icon name="arrowRight" className="h-4 w-4 text-gold" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* 曲线铭牌：一圈发丝描边，顶边一线金光 */}
            <div className="animate-blur-in [animation-delay:200ms] lg:col-span-7">
              <div className="ink-glass relative rounded-xl p-5 sm:p-7">
                <div className="h-[280px] sm:h-[380px] lg:h-[460px]">
                  <GoldChart symbol="BTC-USDT" interval="1h" limit={168} height={320} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 行情条 */}
        <div className="relative border-y border-border-default bg-bg-primary/60">
          <div className="mx-auto max-w-page px-6 py-4">
            <HotCoinsRail />
          </div>
        </div>
      </section>

      {/* ── Trust：双栏编号台账 ─────────────────────────────────────────── */}
      <section className="py-24 lg:py-36">
        <div className="mx-auto max-w-page px-6">
          <div className="grid gap-14 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-4">
              <h2 className="display text-display-lg lg:sticky lg:top-28" data-reveal>
                {t("trust_title")}
              </h2>
            </div>
            <div className="lg:col-span-8">
              <ul className="grid gap-x-10 sm:grid-cols-2" data-reveal-group>
                {TRUST_KEYS.map((key, i) => (
                  <li key={key} className="border-t border-border-hover py-9">
                    <Numeral n={i + 1} className="text-2xl" />
                    <h3 className="mt-7 font-display text-xl font-medium tracking-tight text-text-primary lg:text-2xl">
                      {t(`${key}_title`)}
                    </h3>
                    <p className="mt-3 max-w-sm text-sm leading-relaxed text-text-secondary lg:text-[15px]">
                      {t(`${key}_desc`)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works：三栏时间线 ────────────────────────────────────── */}
      <section className="border-t border-border-default bg-bg-secondary/40 py-24 lg:py-36">
        <div className="mx-auto max-w-page px-6">
          <h2 className="display max-w-2xl text-display-lg" data-reveal>
            {t("how_title")}
          </h2>
          <ol className="relative mt-20 grid gap-12 md:grid-cols-3 md:gap-8" data-reveal-group>
            {/* 顶部一条贯穿的发丝线，每一步从它上面生长出来 */}
            <span aria-hidden className="absolute inset-x-0 top-0 hidden h-px bg-border-hover md:block" />
            {HOW_KEYS.map((key, i) => (
              <li key={key} className="relative md:pt-12">
                <span
                  aria-hidden
                  className="absolute -top-px left-0 hidden h-[3px] w-12 bg-gold md:block"
                />
                <span className="numeral text-display-lg text-text-primary/90">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-8 font-display text-xl font-medium tracking-tight text-text-primary">
                  {t(`${key}_title`)}
                </h3>
                <p className="mt-3 max-w-xs text-sm leading-relaxed text-text-secondary">
                  {t(`${key}_desc`)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Features：Bento（3 项 = 3 格）────────────────────────────────── */}
      <section id="features" className="py-24 lg:py-36">
        <div className="mx-auto max-w-page px-6">
          <h2 className="display max-w-2xl text-display-lg" data-reveal>
            {t("features_title")}
          </h2>

          <div className="mt-16 grid gap-4 lg:grid-cols-12 lg:grid-rows-2" data-reveal-group>
            {/* 实盘交易：真实 ETH 曲线 */}
            <div className="ink ink-hover relative flex flex-col overflow-hidden rounded-lg lg:col-span-7 lg:row-span-2">
              <div className="relative flex-1 p-7 pb-0 sm:p-9 sm:pb-0">
                <div className="h-56 sm:h-72 lg:h-full lg:min-h-[280px]">
                  <GoldChart symbol="ETH-USDT" interval="4h" limit={120} height={240} />
                </div>
              </div>
              <div className="border-t border-border-default p-7 sm:p-9">
                <h3 className="font-display text-xl font-medium tracking-tight text-text-primary lg:text-2xl">
                  {t("feature_trade_title")}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
                  {t("feature_trade_desc")}
                </p>
              </div>
            </div>

            {/* 系统化学习：发丝栅格 + 环境光 */}
            <div className="hero-ground ink-hover relative overflow-hidden rounded-lg border border-border-default p-7 sm:p-9 lg:col-span-5">
              <div aria-hidden className="ruled-grid absolute inset-0" />
              <div aria-hidden className="aura aura-gold -right-24 -top-24 h-64 w-64" />
              <div className="relative">
                <span className="flex h-11 w-11 items-center justify-center rounded-sm border border-gold/40 text-gold">
                  <Icon name="book" className="h-5 w-5" />
                </span>
                <h3 className="mt-14 font-display text-xl font-medium tracking-tight text-text-primary">
                  {t("feature_learn_title")}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t("feature_learn_desc")}</p>
              </div>
            </div>

            {/* 风险控制：深金色调的墨面 */}
            <div className="ink-hover relative overflow-hidden rounded-lg border border-border-default bg-gradient-to-br from-gold-deep/25 via-bg-secondary to-bg-secondary p-7 sm:p-9 lg:col-span-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-sm border border-gold/40 text-gold">
                <Icon name="lock" className="h-5 w-5" />
              </span>
              <h3 className="mt-14 font-display text-xl font-medium tracking-tight text-text-primary">
                {t("feature_control_title")}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t("feature_control_desc")}</p>
            </div>
          </div>

          <div className="mt-12" data-reveal>
            <Link
              href={`/${locale}/trade`}
              className="link-underline inline-flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.18em] text-gold"
            >
              {t("view_full_trading")}
              <Icon name="arrowRight" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA：铭牌 ─────────────────────────────────────────────── */}
      <section className="border-t border-border-default">
        <div className="hero-ground grain relative overflow-hidden py-28 lg:py-40" data-reveal>
          <AuraField />
          <div className="relative mx-auto max-w-3xl px-6 text-center">
            <div className="hairline-gold mx-auto w-20" />
            <h2 className="display mt-10 text-display-xl">{t("final_cta_title")}</h2>
            <p className="mx-auto mt-6 max-w-lg text-base leading-relaxed text-text-secondary lg:text-lg">
              {t("final_cta_subtitle")}
            </p>
            <div className="mt-12">
              <Link href={`/${locale}/register`}>
                <Button size="lg">{t("hero_cta")}</Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 风险声明 */}
      <section className="border-t border-border-default py-14">
        <div className="mx-auto max-w-page px-6">
          <div className="grid gap-6 lg:grid-cols-12">
            <h3 className="text-sm font-medium text-text-secondary lg:col-span-3">{t("risk_title")}</h3>
            <p className="text-xs leading-relaxed text-text-muted lg:col-span-7">{t("risk_body")}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
