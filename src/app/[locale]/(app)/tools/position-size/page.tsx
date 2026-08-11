import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildLanguageAlternates } from "@/lib/seo";
import PositionSizeClient from "./PositionSizeClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "calculator" });
  return {
    title: t("title"),
    description: t("subtitle"),
    // 页面没有这个覆盖时会继承 [locale]/layout.tsx 的兜底
    // alternates（buildLanguageAlternates("")，指向三个语言的首页）——
    // 对本页来说那是错的 hreflang，必须自己指向 /tools/position-size。
    alternates: { languages: buildLanguageAlternates("/tools/position-size") },
  };
}

export default function PositionSizePage() {
  return <PositionSizeClient />;
}
