import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { buildManifest } from "@/lib/pwa/manifest";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    return new Response("Not found", { status: 404 });
  }

  const t = await getTranslations({ locale, namespace: "pwa" });
  const manifest = buildManifest(locale, {
    name: t("app_name"),
    shortName: t("short_name"),
    description: t("app_description"),
    tradeShortcut: t("shortcut_trade"),
    screenerShortcut: t("shortcut_screener"),
  });

  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
