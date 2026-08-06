import type { CommunityPost } from "@/types";

/**
 * Pure toggle of one emoji on one post.
 *
 * Lives here rather than inside useToggleReaction so the optimistic-update
 * arithmetic is testable on its own — it's the part that decides what the user
 * sees the instant they click, before the server has answered.
 *
 * Returns a new object; never mutates the input, since React Query hands us
 * the live cache entry and mutating it in place would skip re-renders.
 */
export function applyReactionToggle(post: CommunityPost, emoji: string): CommunityPost {
  const wasActive = post.viewer_reactions.includes(emoji);
  const counts = { ...post.reaction_counts };
  const next = (counts[emoji] ?? 0) + (wasActive ? -1 : 1);

  // Drop the key at zero instead of keeping it: the feed card renders only
  // non-zero emoji, so a lingering 0 would show up as a stray "🔥 0".
  if (next > 0) counts[emoji] = next;
  else delete counts[emoji];

  return {
    ...post,
    reaction_counts: counts,
    viewer_reactions: wasActive
      ? post.viewer_reactions.filter((e) => e !== emoji)
      : [...post.viewer_reactions, emoji],
  };
}
