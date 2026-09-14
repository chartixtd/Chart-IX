import { redirect } from "next/navigation";
import { DEFAULT_LANE } from "@/lib/screener/lanes";

/**
 * `/screener` 本身不再渲染任何东西——主扫描表拆成了三条分栏路由，
 * 这里把裸地址转到默认那一栏。
 *
 * 保留这个路由而不是直接让它 404：它是这个产品对外的地址（导航、书签、
 * 旧链接、推送里的链接都指着它），断掉的代价远大于一次 307。
 *
 * 服务端 redirect 而不是客户端 useEffect：后者会先渲染一帧空页面再跳，
 * 而且会在浏览器历史里留下一条回不去的记录（点后退又被弹回来）。
 */
export default async function ScreenerIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/screener/${DEFAULT_LANE}`);
}
