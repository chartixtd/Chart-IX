/**
 * 「多久以前」。文案键在 `news` 命名空间下（just_now / minutes_ago /
 * hours_ago / days_ago），调用方传一个已经绑好那个命名空间的 t。
 *
 * 提出来的理由：资讯页与学习中心要的是同一句话，而站内此前已经有三份各写
 * 一遍的 formatRelativeTime（评论、社区、资讯）。这一份只收 ms epoch 的，
 * 另外两份收 ISO 字符串的暂不动——它们的阈值与这份不同，合并是另一件事。
 *
 * 超过 7 天就不再说「多久以前」，改成具体日期：一条两周前的资讯说
 * 「14 天前」并不比「9 月 2 日」更有用。
 */
export function formatRelativeMs(
  ms: number,
  localeStr: string,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const diffMin = Math.floor((Date.now() - ms) / 60_000);
  if (diffMin < 1) return t("just_now");
  if (diffMin < 60) return t("minutes_ago", { count: diffMin });

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("hours_ago", { count: diffHour });

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return t("days_ago", { count: diffDay });

  try {
    return new Intl.DateTimeFormat(localeStr, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}
