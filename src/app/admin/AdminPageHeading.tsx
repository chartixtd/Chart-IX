"use client";

import { useTranslations } from "next-intl";

export function AdminPageHeading({
  titleKey,
  resource,
  errorMessage,
}: {
  titleKey: string;
  resource?: string;
  errorMessage?: string | null;
}) {
  const t = useTranslations("admin");

  if (errorMessage && resource) {
    return (
      <div className="text-danger">
        {t("error_loading", { resource })}: {errorMessage}
      </div>
    );
  }

  // 后台每个页面的标题都走这里，所以展示字与发丝金分隔只需要在这一处落地
  return (
    <div className="mb-6">
      <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">
        {t(titleKey)}
      </h1>
      <div className="hairline-gold mt-3 w-16 opacity-70" />
    </div>
  );
}
