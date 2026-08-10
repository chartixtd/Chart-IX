"use client";

import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { usePost, useToggleReaction, useUpdatePost, useDeleteCommunityPost } from "@/hooks/useCommunity";
import { PostComposerModal } from "@/components/community/PostComposerModal";
import { CommentThread } from "@/components/community/CommentThread";
import { formatRelativeTime } from "@/components/community/CommunityPostCard";

const REACTION_EMOJI = ["👍", "❤️", "🚀", "🔥", "😂"];

export default function CommunityPostPage() {
  const t = useTranslations("community");
  const locale = useLocale();
  const auth = useAuth();
  const params = useParams<{ id: string }>();
  const postId = params.id;

  const { data: post, isPending, error } = usePost(postId);
  const toggleReaction = useToggleReaction(postId);
  const updatePost = useUpdatePost(postId);
  const deletePost = useDeleteCommunityPost();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const isAuthor = post ? auth.userId === post.author_id : false;
  const isAdmin = auth.role === "admin";
  const isPro = auth.tier === "pro";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`/${locale}/articles?tab=community`} className="mb-4 hidden text-sm text-text-muted hover:text-gold lg:inline-block">
        {t("back_to_community")}
      </Link>

      {isPending && (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {(error || (!isPending && !post)) && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {t("post_not_found")}
        </p>
      )}

      {post && (
        <Card className="overflow-hidden" padding="none">
          {post.cover_image && (
            // Fixed height (was max-h-96 on the plain <img>) so the fill-based
            // Image below has a definite box to fill.
            <div className="relative h-96 w-full border-b border-border-default">
              <Image src={post.cover_image} alt="" fill className="object-cover" sizes="(min-width: 768px) 768px, 100vw" />
            </div>
          )}

          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-text-primary">{post.title}</h1>
                <p className="mt-1 text-xs text-text-muted">
                  {post.author?.display_name ?? t("anonymous")} · {formatRelativeTime(post.created_at, locale, t)}
                  {post.updated_at !== post.created_at && ` · ${t("edited")}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {isAuthor && (
                  <button onClick={() => setEditOpen(true)} className="text-xs text-text-muted hover:text-gold">
                    {t("edit")}
                  </button>
                )}
                {isAdmin && (
                  <button
                    onClick={() => setConfirmDeleteOpen(true)}
                    disabled={deletePost.isPending}
                    className="text-xs text-text-muted hover:text-danger disabled:opacity-50"
                  >
                    {t("delete")}
                  </button>
                )}
              </div>
            </div>

            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{post.content}</p>

            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border-default pt-4">
              {REACTION_EMOJI.map((emoji) => {
                const count = post.reaction_counts[emoji] ?? 0;
                const active = post.viewer_reactions.includes(emoji);
                return (
                  <button
                    key={emoji}
                    onClick={() => isPro && toggleReaction.mutate(emoji)}
                    // Deliberately not disabled while the mutation is in flight:
                    // useToggleReaction writes the new state to the cache on click,
                    // so the button already reflects the result. Disabling here
                    // would freeze a control that has visibly already responded.
                    disabled={!isPro}
                    aria-pressed={active}
                    title={isPro ? undefined : t("pro_required")}
                    className={cn(
                      "flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm transition-colors",
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
            </div>

            <CommentThread postId={post.id} />
          </div>
        </Card>
      )}

      {post && (
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
      )}

      {post && (
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
      )}
    </div>
  );
}
