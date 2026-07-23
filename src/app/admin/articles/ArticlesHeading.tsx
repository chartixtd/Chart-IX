"use client";
import { useTranslations } from "next-intl";
export function ArticlesHeading() {
  const t = useTranslations("admin");
  return <h1 className="mb-6 text-2xl font-bold">{t("articles_list.title")}</h1>;
}
