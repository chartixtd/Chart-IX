import { getSiteSettings } from "@/lib/site-settings";
import { AppChrome } from "../AppChrome";

// This group is the static/ISR island: no cookies, no per-user reads.
// Auth for the navbar hydrates client-side via AuthProvider's own fetch
// (instant when coming from an (app) page thanks to its module-level cache).
// Do NOT import getServerAuth or anything that touches cookies()/headers()
// here — that would silently demote articles/videos/learn back to dynamic
// rendering and defeat their `revalidate = 300`.
export default async function StaticLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const siteSettings = await getSiteSettings(locale);

  return (
    <AppChrome locale={locale} siteSettings={siteSettings}>
      {children}
    </AppChrome>
  );
}
