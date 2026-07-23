import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { getServerAuth } from "@/lib/supabase/get-auth";
import { ClientLocaleLayout } from "./ClientLocaleLayout";

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
  const [messages, initialAuth] = await Promise.all([
    import(`@/i18n/messages/${locale}.json`).then((m) => m.default),
    getServerAuth(),
  ]);

  return (
    <ClientLocaleLayout locale={locale} messages={messages} initialAuth={initialAuth}>
      {children}
    </ClientLocaleLayout>
  );
}
