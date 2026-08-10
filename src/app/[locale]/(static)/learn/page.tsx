import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { buildLanguageAlternates } from "@/lib/seo";
import { routing } from "@/i18n/routing";
import { LearnHub } from "./LearnHub";

// 学习路径删除后这一页不再读库，纯静态渲染即可。
export const revalidate = 300;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "learn" });
  return { title: t("hub_title"), alternates: { languages: buildLanguageAlternates("/learn") } };
}

export default async function LearnPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:py-12">
      <LearnHub locale={locale} />
    </div>
  );
}
