"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SITE_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** 「已复制」提示停留多久后复原。 */
const COPIED_FEEDBACK_MS = 2000;

/**
 * 把帖子链接分享到站外。
 *
 * 手机浏览器基本都有 navigator.share，调它弹系统面板（微信/Telegram/复制都在
 * 里面）；桌面没有，退到复制链接并把文案短暂换成「已复制」。
 *
 * 分享的是规范链接而不是 window.location.href——后者会把 ?tab=community
 * 这类查询参数一起带出去。
 */
export function SharePostButton({
  postId,
  title,
  className,
}: {
  postId: string;
  title: string;
  className?: string;
}) {
  const t = useTranslations("community");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件在提示还亮着时被卸载（比如帖子被删），别对已卸载的组件 setState
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleShare = async () => {
    const url = `${SITE_URL}/${locale}/community/${postId}`;

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // 用户取消系统面板会抛 AbortError，剪贴板权限被拒也会抛——两者都不是
      // 需要告警的错误，静默即可，不要打断阅读。
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className={cn(
        "flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-gold",
        className
      )}
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12M12 4 8 8M12 4l4 4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
      </svg>
      {copied ? t("link_copied") : t("share")}
    </button>
  );
}
