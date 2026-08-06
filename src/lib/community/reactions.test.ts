import { describe, it, expect } from "vitest";
import { applyReactionToggle } from "./reactions";
import type { CommunityPost } from "@/types";

function makePost(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: "post-1",
    author_id: "user-1",
    author: null,
    title: "t",
    content: "c",
    cover_image: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    comment_count: 0,
    reaction_counts: {},
    viewer_reactions: [],
    ...overrides,
  };
}

describe("applyReactionToggle", () => {
  it("adds the emoji and starts its count at 1 when the viewer hasn't reacted", () => {
    const next = applyReactionToggle(makePost(), "🔥");
    expect(next.reaction_counts).toEqual({ "🔥": 1 });
    expect(next.viewer_reactions).toEqual(["🔥"]);
  });

  it("increments an emoji others have already used", () => {
    const next = applyReactionToggle(makePost({ reaction_counts: { "🔥": 3 } }), "🔥");
    expect(next.reaction_counts).toEqual({ "🔥": 4 });
    expect(next.viewer_reactions).toEqual(["🔥"]);
  });

  it("removes the key entirely when the viewer's reaction was the only one", () => {
    const post = makePost({ reaction_counts: { "🔥": 1 }, viewer_reactions: ["🔥"] });
    const next = applyReactionToggle(post, "🔥");
    // Not { "🔥": 0 } — the feed card lists non-zero emoji, a 0 would render as "🔥 0"
    expect(next.reaction_counts).toEqual({});
    expect(next.viewer_reactions).toEqual([]);
  });

  it("decrements but keeps the key when others still have that reaction", () => {
    const post = makePost({ reaction_counts: { "🔥": 3 }, viewer_reactions: ["🔥"] });
    const next = applyReactionToggle(post, "🔥");
    expect(next.reaction_counts).toEqual({ "🔥": 2 });
    expect(next.viewer_reactions).toEqual([]);
  });

  it("leaves other emoji untouched", () => {
    const post = makePost({
      reaction_counts: { "👍": 2, "🔥": 1 },
      viewer_reactions: ["👍"],
    });
    const next = applyReactionToggle(post, "🔥");
    expect(next.reaction_counts).toEqual({ "👍": 2, "🔥": 2 });
    expect(next.viewer_reactions).toEqual(["👍", "🔥"]);
  });

  it("round-trips back to the original state when toggled twice", () => {
    const post = makePost({ reaction_counts: { "👍": 2, "🔥": 5 }, viewer_reactions: ["👍"] });
    const back = applyReactionToggle(applyReactionToggle(post, "🔥"), "🔥");
    expect(back.reaction_counts).toEqual(post.reaction_counts);
    expect(back.viewer_reactions).toEqual(post.viewer_reactions);
  });

  it("does not mutate the input — React Query hands us the live cache entry", () => {
    const post = makePost({ reaction_counts: { "🔥": 1 }, viewer_reactions: ["🔥"] });
    const snapshot = JSON.stringify(post);
    applyReactionToggle(post, "🔥");
    expect(JSON.stringify(post)).toBe(snapshot);
  });

  it("preserves unrelated post fields so the optimistic entry stays complete", () => {
    const post = makePost({ title: "hello", comment_count: 7, cover_image: "https://x/y.png" });
    const next = applyReactionToggle(post, "👍");
    expect(next.title).toBe("hello");
    expect(next.comment_count).toBe(7);
    expect(next.cover_image).toBe("https://x/y.png");
  });
});
