"use client";

import { useTranslations } from "next-intl";

export function PricingHeading() {
  const t = useTranslations("admin");
  return (
    <h1 className="mb-6 text-2xl font-bold text-text-primary">
      {t("pricing_list.title")}
    </h1>
  );
}
