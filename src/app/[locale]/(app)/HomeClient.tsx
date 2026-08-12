import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { AuraField } from "@/components/motion/AuraField";
import { MetallicMonogram } from "@/components/motion/MetallicMonogram";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { HotCoinsRail } from "./HotCoinsRail";

const TRUST_KEYS = ["trust_1", "trust_2", "trust_3", "trust_4"] as const;
const HOW_KEYS = ["how_1", "how_2", "how_3"] as const;

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

export default async function HomeClient({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "home" });

  return (
    <div>
      {/* GSAP 滚动编排只在营销/阅读面注入；交易终端不会下载这段 */}
      <ScrollReveal />

      {/* ── Hero ──────────────────────────────────────────────────────────
          金属 IX 是第一眼的冲击点：9 段金箔 + 高光横扫 + 指针视差。
          它压在标题右侧而非居中，让超大标题保持左对齐的编辑式阅读起点。 */}
      <section className="hero-ground grain relative overflow-hidden">
        <AuraField />

        <MetallicMonogram className="absolute -right-10 top-1/2 -translate-y-1/2 text-[42vw] opacity-[0.13] sm:text-[30rem]" />

        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-24 sm:pt-32">
          <div className="max-w-4xl">
            <span className="inline-flex animate-rise-in items-center gap-3 text-xs font-medium uppercase tracking-[0.24em] text-gold">
              <span className="h-px w-10 bg-gold/50" />
              {t("hero_eyebrow")}
            </span>
            <h1 className="mt-8 animate-rise-in font-display text-[clamp(3rem,10vw,7rem)] font-bold leading-[0.94] tracking-tightest text-text-primary [animation-delay:60ms]">
              {t("hero_title")}
            </h1>
            <p className="mt-8 max-w-2xl animate-rise-in text-lg leading-relaxed text-text-secondary [animation-delay:120ms] sm:text-xl">
              {t("hero_subtitle")}
            </p>
            <div className="mt-11 flex animate-rise-in flex-wrap items-center gap-4 [animation-delay:180ms]">
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
            <p className="mt-8 max-w-md animate-rise-in text-xs leading-relaxed text-text-muted [animation-delay:220ms]">
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

      {/* ── Trust ─────────────────────────────────────────────────────────
          非对称 Bento：首条（资金留在交易所）占 4×2 的主格，是整段的论点；
          其余三条围绕它。玻璃面板在这里是安全的——营销页没有高频重绘。 */}
      <section className="relative border-t border-border-default py-24">
        <div className="mx-auto max-w-6xl px-4">
          <div className="max-w-2xl" data-reveal>
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-text-primary sm:text-5xl">
              {t("trust_title")}
            </h2>
            <div className="hairline-gold mt-6 w-16" />
          </div>

          <div
            className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:grid-rows-[repeat(3,minmax(0,auto))]"
            data-reveal-group
          >
            {TRUST_KEYS.map((key, i) => {
              // 0 → 主格（4 列 × 2 行）  1,2 → 右侧窄格  3 → 底部通栏
              const span = [
                "lg:col-span-4 lg:row-span-2",
                "lg:col-span-2",
                "lg:col-span-2",
                "sm:col-span-2 lg:col-span-6",
              ][i];
              const isLead = i === 0;
              return (
                <div
                  key={key}
                  className={`obsidian-glass group relative flex flex-col overflow-hidden rounded-xl p-7 transition-colors duration-300 hover:border-gold/30 ${span}`}
                >
                  <TrustIcon
                    i={i}
                    className={isLead ? "h-10 w-10 text-gold" : "h-8 w-8 text-gold"}
                  />
                  <h3
                    className={`mt-6 font-display font-semibold tracking-tight text-text-primary ${
                      isLead ? "text-2xl sm:text-3xl" : "text-lg"
                    }`}
                  >
                    {t(`${key}_title`)}
                  </h3>
                  <p
                    className={`mt-3 max-w-xl leading-relaxed text-text-secondary ${
                      isLead ? "text-base" : "text-sm"
                    }`}
                  >
                    {t(`${key}_desc`)}
                  </p>
                  {isLead && (
                    <span
                      aria-hidden
                      className="foil-text-static pointer-events-none absolute -bottom-8 -right-4 select-none font-display text-[9rem] font-bold leading-none opacity-[0.07]"
                    >
                      01
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────
          三步保持台账式而非 Bento：连续编号的节奏感需要等宽栅格，
          紧跟在非对称 Bento 之后也提供了必要的版式对比。 */}
      <section className="border-t border-border-default bg-bg-secondary/30 py-24">
        <div className="mx-auto max-w-6xl px-4">
          <h2
            className="text-center font-display text-3xl font-bold tracking-tight text-text-primary sm:text-4xl"
            data-reveal
          >
            {t("how_title")}
          </h2>
          <div
            className="mx-auto mt-16 grid max-w-5xl gap-px overflow-hidden rounded-xl border border-border-default bg-border-default sm:grid-cols-3"
            data-reveal-group
          >
            {HOW_KEYS.map((key, i) => (
              <div key={key} className="bg-bg-secondary p-8">
                <div className="flex items-baseline gap-3">
                  {/* 可读版金箔：序号是要看清的，不能用两端收在暗金上的 --foil-x */}
                  <span className="foil-text-bright font-display text-5xl font-bold leading-none">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="h-px flex-1 bg-border-hover" />
                </div>
                <h3 className="mt-6 font-display text-lg font-semibold tracking-tight text-text-primary">
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

      {/* ── Features ──────────────────────────────────────────────────────
          三块等宽 Bento，中间一块用金箔图标底衬做重心。 */}
      <section id="features" className="py-24">
        <div className="mx-auto max-w-6xl px-4">
          <h2
            className="font-display text-3xl font-bold tracking-tight text-text-primary sm:text-4xl"
            data-reveal
          >
            {t("features_title")}
          </h2>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-reveal-group>
            {(["feature_learn", "feature_trade", "feature_control"] as const).map((key, i) => (
              <div
                key={key}
                className="obsidian-glass flex flex-col rounded-xl p-7 transition-colors duration-300 hover:border-gold/30"
              >
                <div
                  className={
                    i === 1
                      ? "foil-sm flex h-12 w-12 items-center justify-center rounded-lg"
                      : "flex h-12 w-12 items-center justify-center rounded-lg border border-gold/25 bg-gold/[0.06] text-gold"
                  }
                >
                  <FeatureIcon i={i} className="h-6 w-6" />
                </div>
                <h3 className="mt-6 font-display text-lg font-semibold tracking-tight text-text-primary">
                  {t(`${key}_title`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  {t(`${key}_desc`)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-14" data-reveal>
            <Link href={`/${locale}/trade`}>
              <Button variant="outline">{t("view_full_trading")}</Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Final CTA — engraved plate ────────────────────────────────── */}
      <section className="border-t border-border-default py-24">
        <div
          className="hero-ground grain relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-gold/20 px-6 py-20 text-center"
          data-reveal
        >
          <AuraField />
          <div className="relative">
            <div className="hairline-gold mx-auto mb-8 w-16" />
            <h2 className="font-display text-4xl font-bold tracking-tight text-text-primary sm:text-5xl">
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
        </div>
      </section>

      {/* Risk disclosure */}
      <section className="border-t border-border-default py-14">
        <div className="mx-auto max-w-4xl px-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
            {t("risk_title")}
          </h3>
          <p className="mt-3 text-xs leading-relaxed text-text-muted">{t("risk_body")}</p>
        </div>
      </section>
    </div>
  );
}
