import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getNewsPayload } from "@/lib/news-server";
import NewsClient from "./NewsClient";
import NewsLoading from "./loading";
import type { NewsItem, NewsLang } from "@/types";

// 目前只有一个中文源（吴说区块链），马来语没有对应的资讯源——退化到英文
function langForLocale(locale: string): NewsLang {
  return locale === "zh-CN" ? "zh" : "en";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "news" });
  return { title: t("title") };
}

export default async function NewsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const lang = langForLocale(locale);

  let items: NewsItem[] = [];
  let fetchError: string | null = null;

  try {
    items = await getNewsPayload(lang);
  } catch (error) {
    fetchError = String(error);
  }

  return (
    <Suspense fallback={<NewsLoading />}>
      <NewsClient initialItems={items} fetchError={fetchError} lang={lang} />
    </Suspense>
  );
}
