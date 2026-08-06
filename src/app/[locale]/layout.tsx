import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { getServerAuth } from "@/lib/supabase/get-auth";
import { buildLanguageAlternates } from "@/lib/seo";
import { ClientLocaleLayout } from "./ClientLocaleLayout";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "seo" });
  const fullTitle = `Chart-IX — ${t("title")}`;

  return {
    title: t("title"),
    description: t("description"),
    manifest: `/${locale}/manifest.webmanifest`,
    appleWebApp: {
      capable: true,
      title: "Chart-IX",
      statusBarStyle: "black-translucent",
    },
    // Fallback for every page that doesn't set its own more specific
    // `alternates` (e.g. articles/[slug] pointing at the same slug in each
    // locale) — Next merges metadata shallowly per top-level key, so a page
    // that does set `alternates` fully overrides this rather than merging.
    alternates: { languages: buildLanguageAlternates("") },
    openGraph: { title: fullTitle, description: t("description") },
    twitter: { title: fullTitle, description: t("description") },
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

  // Load messages + prefetch auth in parallel on the server
  const [allMessages, initialAuth] = await Promise.all([
    import(`@/i18n/messages/${locale}.json`).then((m) => m.default),
    getServerAuth(),
  ]);

  // The `admin` namespace is a third of the whole message bundle and is only
  // read under /admin, which sits outside this layout and loads its own copy
  // via AdminLocaleProvider. Dropping it here keeps ~7KB of JSON out of the
  // serialized RSC payload of every user-facing page.
  const { admin: _admin, ...messages } = allMessages;

  return (
    <ClientLocaleLayout locale={locale} messages={messages} initialAuth={initialAuth}>
      {children}
    </ClientLocaleLayout>
  );
}
