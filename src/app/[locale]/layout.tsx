import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
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

  // Load messages in server component
  const messages = (await import(`@/i18n/messages/${locale}.json`)).default;

  return (
    <ClientLocaleLayout locale={locale} messages={messages}>
      {children}
    </ClientLocaleLayout>
  );
}
