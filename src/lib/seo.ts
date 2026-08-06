import { PUBLIC_LOCALES, SITE_URL } from "@/lib/constants";
import { routing } from "@/i18n/routing";

/**
 * Builds the `alternates.languages` map for Next's Metadata API — tells
 * search engines the other locale versions of this exact page are
 * translations of each other, not duplicate content. Scoped to
 * PUBLIC_LOCALES (matches sitemap.ts): ms-MY stays reachable by URL but
 * isn't promoted as an indexed alternate, same as it's hidden from the
 * language switcher.
 *
 * @param pathSuffix path after the locale segment, e.g. "/articles/foo" — pass "" for the locale root.
 */
export function buildLanguageAlternates(pathSuffix: string): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of PUBLIC_LOCALES) {
    languages[locale] = `${SITE_URL}/${locale}${pathSuffix}`;
  }
  // x-default points visitors with no locale preference match at the site's default locale.
  languages["x-default"] = `${SITE_URL}/${routing.defaultLocale}${pathSuffix}`;
  return languages;
}
