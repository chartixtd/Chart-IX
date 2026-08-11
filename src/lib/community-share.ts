/** og:description 的实用上限——再长各家预览卡片也会自己截掉。 */
const DEFAULT_MAX_LENGTH = 160;

/**
 * 把社区帖子正文压成一行分享摘要。
 *
 * 社区内容是纯文本（community_posts.content 是 TEXT，详情页用
 * whitespace-pre-wrap 直接渲染），所以这里**只**折叠空白 + 截断，不剥 HTML
 * 标签——套上 stripHtml 那类处理会让人误以为内容可能含 HTML。
 *
 * 用户在帖子里打的换行对预览卡片没有意义，全部折成单个空格。
 */
export function buildShareExcerpt(content: string, maxLength = DEFAULT_MAX_LENGTH): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  // 截到 maxLength - 1 再补省略号，结果长度正好是 maxLength（与文章页一致）
  return text.slice(0, maxLength - 1) + "…";
}
