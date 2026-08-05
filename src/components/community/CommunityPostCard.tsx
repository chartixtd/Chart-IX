"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { useDeleteCommunityPost, useToggleReaction, useUpdatePost } from "@/hooks/useCommunity";
import type { CommunityPost } from "@/types";
import { PostComposerModal } from "./PostComposerModal";
import { CommentThread } from "./CommentThread";

const REACTION_EMOJI = ["👍", "❤️", "🚀", "🔥", "😂"];

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

export function CommunityPostCard({ post }: { post: CommunityPost }) {
  const t = useTranslations("community");
  const locale = useLocale();
  const auth = useAuth();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const toggleReaction = useToggleReaction(post.id);
  const updatePost = useUpdatePost(post.id);
  const deletePost = useDeleteCommunityPost();

  const isAuthor = auth.userId === post.author_id;
  const isAdmin = auth.role === "admin";
  const isPro = auth.tier === "pro";

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-primary">{post.title}</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            {post.author?.display_name ?? t("anonymous")} · {formatRelativeTime(post.created_at, locale, t)}
            {post.updated_at !== post.created_at && ` · ${t("edited")}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isAuthor && (
            <button
              onClick={() => setEditOpen(true)}
              className="text-xs text-text-muted hover:text-gold"
            >
              {t("edit")}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => {
                if (window.confirm(t("confirm_delete"))) deletePost.mutate(post.id);
              }}
              disabled={deletePost.isPending}
              className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
            >
              {t("delete")}
            </button>
          )}
        </div>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{post.content}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {REACTION_EMOJI.map((emoji) => {
          const count = post.reaction_counts[emoji] ?? 0;
          const active = post.viewer_reactions.includes(emoji);
          return (
            <button
              key={emoji}
              onClick={() => isPro && toggleReaction.mutate(emoji)}
              disabled={!isPro || toggleReaction.isPending}
              title={isPro ? undefined : t("pro_required")}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
                active
                  ? "border-gold/50 bg-gold/15 text-gold"
                  : "border-border-default text-text-muted hover:border-gold/30 hover:text-text-secondary",
                !isPro && "cursor-not-allowed opacity-60"
              )}
            >
              <span>{emoji}</span>
              {count > 0 && <span className="tabular-nums">{count}</span>}
            </button>
          );
        })}

        <button
          onClick={() => setCommentsOpen((v) => !v)}
          className="ml-1 text-xs text-text-muted hover:text-text-primary"
        >
          {t("comments_count", { count: post.comment_count })}
        </button>
      </div>

      {commentsOpen && <CommentThread postId={post.id} />}

      <PostComposerModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={{ title: post.title, content: post.content }}
        onSubmit={async (input) => {
          await updatePost.mutateAsync(input);
          setEditOpen(false);
        }}
        submitting={updatePost.isPending}
        error={updatePost.error?.message ?? null}
      />
    </Card>
  );
}
