"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface PricingPlan {
  id: number;
  plan_type: string;
  price: number;
  original_price: number | null;
  currency: string;
  currency_symbol: string;
  is_active: boolean;
}

export default function UpgradePage() {
  const t = useTranslations("upgrade");
  const locale = useLocale();
  const auth = useAuth();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);

  const isPro = auth.tier === "pro";

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("pricing_config")
      .select("*")
      .eq("is_active", true)
      .order("price", { ascending: true })
      .then(({ data }) => {
        if (data) setPlans(data);
      });

    supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "telegram_group")
      .maybeSingle()
      .then(({ data }) => {
        if (typeof data?.value === "string") setTelegramUrl(data.value);
      });
  }, []);

  const planLabel = (plan: string) => {
    const map: Record<string, string> = { monthly: t("monthly"), yearly: t("yearly") };
    return map[plan] ?? plan;
  };

  const period = (plan: string) => {
    return plan === "yearly" ? t("per_year") : t("per_month");
  };

  const discount = (plan: PricingPlan) => {
    if (!plan.original_price || plan.original_price <= plan.price) return null;
    return Math.round((1 - plan.price / plan.original_price) * 100);
  };

  return (
    <div className="hero-ground grain min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-5xl px-4 py-20">
        {isPro ? (
          <div className="mx-auto max-w-lg text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-gold/30 bg-gold/5">
              <span className="font-display text-2xl text-gold">★</span>
            </div>
            <h1 className="mt-6 font-display text-4xl tracking-tight text-text-primary">{t("already_pro")}</h1>
            <div className="hairline-gold mx-auto mt-5 w-16" />
            <p className="mt-5 leading-relaxed text-text-secondary">{t("already_pro_desc")}</p>
          </div>
        ) : (
          <>
            <div className="mx-auto max-w-2xl text-center">
              <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-gold">
                <span className="h-px w-8 bg-gold/50" />
                Chart-IX Pro
                <span className="h-px w-8 bg-gold/50" />
              </span>
              <h1 className="mt-6 font-display text-4xl tracking-tight text-text-primary sm:text-5xl">
                {t("banner_title")}
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-text-secondary">{t("banner_subtitle")}</p>
            </div>

            <div className="mx-auto mt-16 grid max-w-3xl gap-6 md:grid-cols-2">
              {plans.length > 0 ? (
                plans.map((plan) => {
                  const d = discount(plan);
                  const featured = plan.plan_type === "yearly";
                  return (
                    <div
                      key={plan.id}
                      className={cn(
                        "relative overflow-hidden rounded-lg border p-8 text-center shadow-card transition-all duration-300",
                        featured
                          ? "border-gold/40 bg-bg-secondary shadow-gold"
                          : "border-border-default bg-bg-secondary hover:border-gold/30"
                      )}
                    >
                      {d && (
                        <span className="absolute right-4 top-4 inline-block rounded-full gold-gradient px-3 py-1 text-xs font-semibold text-bg-primary">
                          {t("save_percent", { percent: d })}
                        </span>
                      )}
                      <h3 className="font-display text-xl tracking-tight text-text-primary">
                        {planLabel(plan.plan_type)}
                      </h3>
                      <div className="mt-6 flex items-baseline justify-center gap-1">
                        <span className="font-display text-5xl tracking-tight text-text-primary tabular-nums">
                          {plan.currency_symbol}{plan.price}
                        </span>
                        <span className="text-sm text-text-muted">{period(plan.plan_type)}</span>
                      </div>
                      {plan.original_price && (
                        <p className="mt-2 text-sm text-text-muted line-through tabular-nums">
                          {plan.currency_symbol}{plan.original_price}
                        </p>
                      )}
                      <div className="hairline-gold mx-auto mt-6 w-12 opacity-60" />
                      <p className="mt-6 text-sm text-text-secondary">{t("contact_admin")}</p>
                    </div>
                  );
                })
              ) : (
                <>
                  <div className="rounded-lg border border-border-default bg-bg-secondary p-8 text-center">
                    <h3 className="font-display text-xl tracking-tight text-text-primary">{t("monthly")}</h3>
                    <div className="mt-6 font-display text-5xl text-text-muted">—</div>
                    <p className="mt-6 text-sm text-text-secondary">{t("loading")}</p>
                  </div>
                  <div className="rounded-lg border border-border-default bg-bg-secondary p-8 text-center">
                    <h3 className="font-display text-xl tracking-tight text-text-primary">{t("yearly")}</h3>
                    <div className="mt-6 font-display text-5xl text-text-muted">—</div>
                    <p className="mt-6 text-sm text-text-secondary">{t("loading")}</p>
                  </div>
                </>
              )}
            </div>

            {telegramUrl && (
              <div className="mt-12 text-center">
                <a href={telegramUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="lg">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M9.036 15.803l-.396 5.57c.567 0 .812-.244 1.108-.537l2.66-2.545 5.513 4.03c1.01.556 1.73.264 1.99-.933L23.94 3.94c.36-1.464-.53-2.037-1.51-1.68L1.11 10.44c-1.44.556-1.42 1.35-.245 1.708l5.462 1.704L18.9 6.297c.545-.36 1.04-.16.633.2z" />
                    </svg>
                    {t("telegram_cta")}
                  </Button>
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
