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
      <div className="text-red-400">
        {t("error_loading", { resource })}: {errorMessage}
      </div>
    );
  }

  return (
    <h1 className="mb-6 text-2xl font-bold text-text-primary">
      {t(titleKey)}
    </h1>
  );
}
