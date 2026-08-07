import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { buildLanguageAlternates } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings";
import { LocaleProviders } from "./LocaleProviders";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, settings] = await Promise.all([
    getTranslations({ locale, namespace: "seo" }),
    getSiteSettings(locale),
  ]);

  // 后台配的 site_name / site_description 优先，未配置时回退到 i18n 文案。
  // 品牌名是全局的；描述支持按语言存值，所以只填了中文不会污染英文页面。
  const brand = settings.siteName ?? "Chart-IX";
  const description = settings.siteDescription ?? t("description");
  const fullTitle = `${brand} — ${t("title")}`;

  return {
    title: t("title"),
    description,
    manifest: `/${locale}/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      title: brand,
      statusBarStyle: "black-translucent",
    },
    // Fallback for every page that doesn't set its own more specific
    // `alternates` (e.g. articles/[slug] pointing at the same slug in each
    // locale) — Next merges metadata shallowly per top-level key, so a page
    // that does set `alternates` fully overrides this rather than merging.
    alternates: { languages: buildLanguageAlternates("") },
    openGraph: { title: fullTitle, description },
    twitter: { title: fullTitle, description },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  const allMessages = (await import(`@/i18n/messages/${locale}.json`)).default;

  // The `admin` namespace is a third of the whole message bundle and is only
  // read under /admin, which sits outside this layout and loads its own copy
  // via AdminLocaleProvider. Dropping it here keeps ~7KB of JSON out of the
  // serialized RSC payload of every user-facing page.
  const { admin: _admin, ...messages } = allMessages;

  return (
    <LocaleProviders locale={locale} messages={messages}>
      {children}
    </LocaleProviders>
  );
}
