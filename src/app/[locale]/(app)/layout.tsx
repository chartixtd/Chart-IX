import { getServerAuth } from "@/lib/supabase/get-auth";
import { getSiteSettings } from "@/lib/site-settings";
import { AppChrome } from "../AppChrome";

// Everything under (app) is per-user — the auth read below opts this whole
// group into dynamic rendering, which is what these pages need anyway.
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [initialAuth, siteSettings] = await Promise.all([
    getServerAuth(),
    getSiteSettings(locale),
  ]);

  return (
    <AppChrome locale={locale} initialAuth={initialAuth} siteSettings={siteSettings}>
      {children}
    </AppChrome>
  );
}
