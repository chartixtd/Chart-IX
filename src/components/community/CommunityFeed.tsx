"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useCommunityPosts, useCreatePost } from "@/hooks/useCommunity";
import { CommunityPostCard } from "./CommunityPostCard";
import { PostComposerModal } from "./PostComposerModal";

export function CommunityFeed() {
  const t = useTranslations("community");
  const locale = useLocale();
  const auth = useAuth();
  // isPending (not isLoading): isLoading is derived as isPending && isFetching, so
  // it goes false while a query sits "paused" (offline networkMode) with no data
  // and no error yet — which would otherwise fall through into the empty-state
  // branch below and claim "no posts" when the fetch never actually ran.
  const { data: posts, isPending, error } = useCommunityPosts();
  const createPost = useCreatePost();
  const [composerOpen, setComposerOpen] = useState(false);

  const isPro = auth.tier === "pro";

  return (
    <div>
      {/* mb-8 matches the gap the Articles tab leaves between its filter row
          and the first card, so switching tabs doesn't shift the grid. */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">{t("subtitle")}</p>
        {isPro ? (
          <Button variant="primary" size="sm" onClick={() => setComposerOpen(true)}>
            {t("new_post")}
          </Button>
        ) : auth.loading ? null : (
          <Link href={`/${locale}/upgrade`}>
            <Button variant="outline" size="sm">
              {t("pro_required_cta")}
            </Button>
          </Link>
        )}
      </div>

      {isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-md panel">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {t("load_failed")}
        </p>
      )}

      {!isPending && !error && (!posts || posts.length === 0) && (
        <EmptyState title={t("no_posts")} description={t("no_posts_desc")} />
      )}

      {!isPending && posts && posts.length > 0 && (
        // Same grid as the Articles tab (ArticlesClient.tsx) so switching tabs
        // doesn't change the page's shape, only its contents.
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <CommunityPostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      <PostComposerModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSubmit={async (input) => {
          await createPost.mutateAsync(input);
          setComposerOpen(false);
        }}
        submitting={createPost.isPending}
        error={createPost.error?.message ?? null}
      />
    </div>
  );
}
