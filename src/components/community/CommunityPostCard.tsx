"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDeleteCommunityPost, useUpdatePost } from "@/hooks/useCommunity";
import type { CommunityPost } from "@/types";
import { PostComposerModal } from "./PostComposerModal";

/** Display order for the reaction summary — matches the toggle order on the detail page. */
const REACTION_EMOJI = ["👍", "❤️", "🚀", "🔥", "😂"];

export function formatRelativeTime(iso: string, localeStr: string, t: ReturnType<typeof useTranslations>) {
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

/**
 * Feed card, shaped to match the article card in ArticlesClient.tsx so both
 * tabs of the Articles page read as one catalogue: aspect-video cover, gold
 * attribution line where an article shows its category, clamped title, excerpt,
 * then a muted meta row.
 *
 * Reactions render read-only here. The interactive toggles live on the detail
 * page (src/app/[locale]/(app)/community/[id]/page.tsx): an article card carries no
 * controls, and once the whole card is a link, an <a> can't legally contain the
 * toggle buttons anyway. Author/admin actions stay, below the link and behind a
 * hairline, so they never nest inside the anchor either.
 */
export function CommunityPostCard({ post }: { post: CommunityPost }) {
  const t = useTranslations("community");
  const locale = useLocale();
  const auth = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const updatePost = useUpdatePost(post.id);
  const deletePost = useDeleteCommunityPost();

  const isAuthor = auth.userId === post.author_id;
  const isAdmin = auth.role === "admin";
  const detailHref = `/${locale}/community/${post.id}`;

  const reactions = REACTION_EMOJI
    .map((emoji) => [emoji, post.reaction_counts[emoji] ?? 0] as const)
    .filter(([, count]) => count > 0);

  return (
    <Card hover padding="none" className="overflow-hidden">
      <Link href={detailHref} className="group block">
        {/* Cover — fixed aspect ratio matching the article card, so a wide logo
            crops cleanly instead of stretching to fill a full-width band. */}
        <div className="relative aspect-video bg-bg-tertiary">
          {post.cover_image ? (
            <Image
              src={post.cover_image}
              alt=""
              fill
              className="object-cover"
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-text-muted">
              <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
          )}
        </div>

        <div className="p-4">
          {/* Author sits where an article card shows its category */}
          <p className="truncate text-xs font-medium text-gold">
            {post.author?.display_name ?? t("anonymous")}
          </p>

          <h3 className="mt-1 line-clamp-2 font-medium text-text-primary transition-colors group-hover:text-gold">
            {post.title}
          </h3>

          <p className="mt-2 line-clamp-2 text-sm text-text-secondary">{post.content}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
            <span>{formatRelativeTime(post.created_at, locale, t)}</span>
            {post.updated_at !== post.created_at && <span>{t("edited")}</span>}
            <span>{t("comments_count", { count: post.comment_count })}</span>
            {reactions.length > 0 && (
              <span className="flex items-center gap-1.5">
                {reactions.map(([emoji, count]) => (
                  <span key={emoji}>
                    {emoji} {count}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      </Link>

      {(isAuthor || isAdmin) && (
        <div className="flex items-center justify-end gap-3 border-t border-border-default px-4 py-2">
          {isAuthor && (
            <button
              onClick={() => setEditOpen(true)}
              className="text-xs text-text-muted transition-colors hover:text-gold"
            >
              {t("edit")}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={deletePost.isPending}
              className="text-xs text-text-muted transition-colors hover:text-danger disabled:opacity-50"
            >
              {t("delete")}
            </button>
          )}
        </div>
      )}

      <PostComposerModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={{ title: post.title, content: post.content, cover_image: post.cover_image }}
        onSubmit={async (input) => {
          await updatePost.mutateAsync(input);
          setEditOpen(false);
        }}
        submitting={updatePost.isPending}
        error={updatePost.error?.message ?? null}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          deletePost.mutate(post.id, { onSuccess: () => setConfirmDeleteOpen(false) });
        }}
        title={t("delete")}
        message={t("confirm_delete")}
        confirmText={t("delete")}
        loading={deletePost.isPending}
      />
    </Card>
  );
}
