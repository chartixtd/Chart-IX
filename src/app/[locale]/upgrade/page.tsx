"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

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
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [userTier, setUserTier] = useState<string | null>(null);

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

    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        supabase
          .from("users")
          .select("tier")
          .eq("id", data.user.id)
          .single()
          .then(({ data: profile }) => {
            if (profile) setUserTier(profile.tier);
          });
      }
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
    <div className="mx-auto max-w-5xl px-4 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-text-primary">{t("banner_title")}</h1>
        <p className="mt-3 text-text-secondary">{t("banner_subtitle")}</p>
      </div>

      {userTier === "pro" && (
        <div className="mt-6 rounded-lg border border-gold/30 bg-gold/5 p-4 text-center">
          <p className="text-gold font-semibold">{t("already_pro")}</p>
        </div>
      )}

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {plans.length > 0 ? (
          plans.map((plan) => {
            const d = discount(plan);
            return (
              <Card
                key={plan.id}
                className="text-center"
                padding="lg"
              >
                {d && (
                  <div className="-mt-10 mb-2">
                    <span className="inline-block rounded-full gold-gradient px-3 py-1 text-xs font-semibold text-black">
                      {t("save_percent", { percent: d })}
                    </span>
                  </div>
                )}
                <h3 className="text-lg font-semibold text-text-primary">
                  {planLabel(plan.plan_type)}
                </h3>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-text-primary">
                    {plan.currency_symbol}{plan.price}
                  </span>
                  <span className="text-text-muted"> {period(plan.plan_type)}</span>
                </div>
                {plan.original_price && (
                  <p className="mt-1 text-sm text-text-muted line-through">
                    {plan.currency_symbol}{plan.original_price}
                  </p>
                )}
                <p className="mt-6 text-sm text-text-secondary">{t("contact_admin")}</p>
              </Card>
            );
          })
        ) : (
          <>
            <Card className="text-center" padding="lg">
              <h3 className="text-lg font-semibold text-text-primary">{t("monthly")}</h3>
              <div className="mt-4">
                <span className="text-4xl font-bold text-text-primary">-</span>
              </div>
              <p className="mt-6 text-sm text-text-secondary">{t("loading")}</p>
            </Card>
            <Card className="text-center" padding="lg">
              <h3 className="text-lg font-semibold text-text-primary">{t("yearly")}</h3>
              <div className="mt-4">
                <span className="text-4xl font-bold text-text-primary">-</span>
              </div>
              <p className="mt-6 text-sm text-text-secondary">{t("loading")}</p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
