"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";
import { AuraField } from "@/components/motion/AuraField";

interface PricingPlan {
  id: number;
  plan_type: string;
  price: number;
  original_price: number | null;
  currency: string;
  currency_symbol: string;
  is_active: boolean;
}

const TELEGRAM_PATH =
  "M9.036 15.803l-.396 5.57c.567 0 .812-.244 1.108-.537l2.66-2.545 5.513 4.03c1.01.556 1.73.264 1.99-.933L23.94 3.94c.36-1.464-.53-2.037-1.51-1.68L1.11 10.44c-1.44.556-1.42 1.35-.245 1.708l5.462 1.704L18.9 6.297c.545-.36 1.04-.16.633.2z";

/**
 * Pro 升级页（Persuade 面）。
 * 定价不是卡片堆叠，而是一块横向铭牌：左侧标题与说明，右侧两档价格并排、
 * 年付一档用一条金色顶线与更大的数字标出——不加「推荐」徽章，数字自己说话。
 */
export default function UpgradePage() {
  const t = useTranslations("upgrade");
  const tCommon = useTranslations("common");
  const auth = useAuth();

  const isPro = auth.tier === "pro";

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["upgrade", "pricing"],
    queryFn: async () => {
      const supabase = createClient();
      const [plansRes, tgRes] = await Promise.all([
        supabase
          .from("pricing_config")
          .select("*")
          .eq("is_active", true)
          .order("price", { ascending: true }),
        supabase.from("admin_settings").select("value").eq("key", "telegram_group").maybeSingle(),
      ]);
      return {
        plans: (plansRes.data as PricingPlan[]) ?? [],
        telegramUrl: typeof tgRes.data?.value === "string" ? tgRes.data.value : null,
      };
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const plans = data?.plans ?? [];
  const telegramUrl = data?.telegramUrl ?? null;

  const planLabel = (plan: string) => {
    const map: Record<string, string> = { monthly: t("monthly"), yearly: t("yearly") };
    return map[plan] ?? plan;
  };

  const period = (plan: string) => (plan === "yearly" ? t("per_year") : t("per_month"));

  const discount = (plan: PricingPlan) => {
    if (!plan.original_price || plan.original_price <= plan.price) return null;
    return Math.round((1 - plan.price / plan.original_price) * 100);
  };

  return (
    <div className="hero-ground grain relative min-h-[calc(100dvh-72px)] overflow-hidden">
      <AuraField />
      <div aria-hidden className="ruled-grid absolute inset-0 opacity-60" />

      <div className="relative mx-auto max-w-page px-6 py-20 lg:py-28">
        {isPro ? (
          <div className="mx-auto max-w-lg text-center">
            <div className="foil mx-auto flex h-14 w-14 items-center justify-center rounded-full">
              <Icon name="star" filled className="h-6 w-6" />
            </div>
            <h1 className="display mt-10 text-display-lg">{t("already_pro")}</h1>
            <div className="hairline-gold mx-auto mt-8 w-16" />
            <p className="mt-8 leading-relaxed text-text-secondary">{t("already_pro_desc")}</p>
          </div>
        ) : (
          <div className="grid gap-16 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-5">
              <p className="section-mark eyebrow-gold">Chart-IX Pro</p>
              <h1 className="display mt-8 text-display-xl">{t("banner_title")}</h1>
              <p className="mt-8 max-w-md text-base leading-relaxed text-text-secondary lg:text-lg">
                {t("banner_subtitle")}
              </p>
              {telegramUrl && (
                <a href={telegramUrl} target="_blank" rel="noopener noreferrer" className="mt-12 inline-block">
                  <Button size="lg">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d={TELEGRAM_PATH} />
                    </svg>
                    {t("telegram_cta")}
                  </Button>
                </a>
              )}
            </div>

            <div className="lg:col-span-7">
              {isPending ? (
                <div className="ink-glass grid rounded-xl sm:grid-cols-2">
                  {[0, 1].map((i) => (
                    <div key={i} className={cn("p-9", i === 1 && "border-t border-border-default sm:border-l sm:border-t-0")}>
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="mt-8 h-14 w-40" />
                      <Skeleton className="mt-4 h-3 w-24" />
                      <Skeleton className="mt-10 h-3 w-48" />
                    </div>
                  ))}
                </div>
              ) : isError ? (
                <EmptyState
                  title={t("plans_error")}
                  action={
                    <Button variant="outline" onClick={() => refetch()}>
                      {tCommon("retry")}
                    </Button>
                  }
                />
              ) : plans.length > 0 ? (
                <div className="ink-glass grid rounded-xl sm:grid-cols-2">
                  {plans.map((plan, i) => {
                    const d = discount(plan);
                    const featured = plan.plan_type === "yearly";
                    return (
                      <div
                        key={plan.id}
                        className={cn(
                          "relative p-9 lg:p-11",
                          i > 0 && "border-t border-border-default sm:border-l sm:border-t-0"
                        )}
                      >
                        {featured && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-gold" />}
                        <div className="flex items-center justify-between gap-3">
                          <span className={cn("eyebrow", featured && "text-gold")}>{planLabel(plan.plan_type)}</span>
                          {d && (
                            <span className="foil-sm rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]">
                              {t("save_percent", { percent: d })}
                            </span>
                          )}
                        </div>
                        <div className="mt-10 flex items-baseline gap-1.5">
                          <span className="numeral text-[clamp(2.75rem,4vw,3.75rem)] leading-none">
                            <span className="mr-1 text-[0.5em] text-text-secondary">{plan.currency_symbol}</span>
                            {plan.price}
                          </span>
                          <span className="text-sm text-text-muted">{period(plan.plan_type)}</span>
                        </div>
                        {plan.original_price && (
                          <p className="mt-3 font-mono text-sm tabular-nums text-text-faint line-through">
                            {plan.currency_symbol}
                            {plan.original_price}
                          </p>
                        )}
                        <div className="mt-10 border-t border-border-default pt-6 text-sm leading-relaxed text-text-secondary">
                          {t("contact_admin")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title={t("plans_empty")} description={t("contact_admin")} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
