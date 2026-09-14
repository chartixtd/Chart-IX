import { redirect } from "next/navigation";
import { DEFAULT_LANE } from "@/lib/screener/lanes";

/**
 * `/screener/alerts` 同样只做跳转，理由与 `/screener` 那条一致。
 *
 * 路由匹配上不会跟 `/screener/[assetClass]` 打架：静态段优先于动态段，
 * 所以 `/screener/alerts` 永远命中这个文件，而不会被当成
 * `assetClass = "alerts"`（那种情况会被 isLaneKey 挡成 404）。
 */
export default async function ScreenerAlertsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/screener/alerts/${DEFAULT_LANE}`);
}
