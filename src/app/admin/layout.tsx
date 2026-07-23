import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { AdminHeader } from "@/components/layout/AdminHeader";

type ValidLocale = "zh-CN" | "en-US" | "ms-MY";

function isValidLocale(s: string | undefined): s is ValidLocale {
  return s === "zh-CN" || s === "en-US" || s === "ms-MY";
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Read user's language preference from cookie (set by LanguageSwitcher)
  const cookieStore = await cookies();
  const raw = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: ValidLocale = isValidLocale(raw) ? raw : "en-US";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = (await import(`@/i18n/messages/${locale}.json`)).default as any;

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      <div className="min-h-screen bg-bg-primary">
        <AdminHeader />
        <div className="flex">
          <AdminSidebar />
          <main className="ml-56 flex-1 p-6">{children}</main>
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
