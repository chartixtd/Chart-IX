"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useComments, useCreateComment, useDeleteCommunityComment } from "@/hooks/useCommunity";

function formatRelativeTime(iso: string, localeStr: string, t: ReturnType<typeof useTranslations>) {
  const ms = new Date(iso).getTime();
  const diffMin = Math.floor((Date.now() - ms) / 60_000);
  if (diffMin < 1) return t("just_now");
  if (diffMin < 60) return t("minutes_ago", { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("hours_ago", { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return t("days_ago", { count: diffDay });
  try {
    return new Intl.DateTimeFormat(localeStr, { year: "numeric", month: "short", day: "numeric" }).format(ms);
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

export function CommentThread({ postId }: { postId: string }) {
  const t = useTranslations("community");
  const locale = useLocale();
  const auth = useAuth();
  // isPending, not isLoading — see CommunityFeed.tsx for why.
  const { data: comments, isPending } = useComments(postId, true);
  const createComment = useCreateComment(postId);
  const deleteComment = useDeleteCommunityComment(postId);
  const [content, setContent] = useState("");
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);

  const isPro = auth.tier === "pro";
  const isAdmin = auth.role === "admin";

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setRateLimitMsg(null);
    try {
      await createComment.mutateAsync(content.trim());
      setContent("");
    } catch (err) {
      const e = err as Error & { status?: number; retryAfterMs?: number };
      if (e.status === 429) {
        const seconds = Math.ceil((e.retryAfterMs ?? 0) / 1000);
        setRateLimitMsg(t("rate_limited", { seconds }));
      }
    }
  };

  return (
    <div className="mt-3 space-y-2.5 border-t border-border-default pt-3">
      {isPending && <Skeleton className="h-10 w-full" />}

      {!isPending && comments && comments.length === 0 && (
        <p className="text-xs text-text-muted">{t("no_comments")}</p>
      )}

      {!isPending &&
        comments?.map((comment) => (
          <div key={comment.id} className="flex items-start justify-between gap-2 text-xs">
            <div className="min-w-0">
              <span className="font-medium text-text-primary">
                {comment.author?.display_name ?? t("anonymous")}
              </span>
              <span className="ml-1.5 text-text-muted">
                {formatRelativeTime(comment.created_at, locale, t)}
              </span>
              <p className="mt-0.5 whitespace-pre-wrap text-text-secondary">{comment.content}</p>
            </div>
            {isAdmin && (
              <button
                onClick={() => {
                  if (window.confirm(t("confirm_delete"))) deleteComment.mutate(comment.id);
                }}
                className="shrink-0 text-text-muted hover:text-danger"
              >
                {t("delete")}
              </button>
            )}
          </div>
        ))}

      {isPro ? (
        <div className="flex items-center gap-2 pt-1">
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder={t("comment_placeholder")}
            maxLength={2_000}
            className="flex-1 rounded-sm border border-border-default bg-bg-input px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-gold focus:outline-none"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSubmit}
            disabled={createComment.isPending || !content.trim()}
          >
            {t("comment_submit")}
          </Button>
        </div>
      ) : (
        !auth.loading && (
          <Link href={`/${locale}/upgrade`} className="block text-xs text-gold hover:underline">
            {t("pro_required")}
          </Link>
        )
      )}

      {rateLimitMsg && <p className="text-xs text-danger">{rateLimitMsg}</p>}
    </div>
  );
}
