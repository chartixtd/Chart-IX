"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CommunityComment, CommunityPost } from "@/types";

/** Community API routes return {data}/{error}, not {success,data} like the trading routes. */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json.error ?? "Request failed") as Error & {
      status?: number;
      retryAfterMs?: number;
    };
    err.status = res.status;
    err.retryAfterMs = json.retryAfterMs;
    throw err;
  }
  // Most routes wrap the payload in {data}; the admin delete routes just
  // return {success: true} with no data key — fall back to the whole body.
  return (json.data !== undefined ? json.data : json) as T;
}

const POSTS_KEY = ["community", "posts"] as const;

export function useCommunityPosts() {
  return useQuery({
    queryKey: POSTS_KEY,
    queryFn: () => fetchJson<CommunityPost[]>("/api/community/posts"),
    staleTime: 15_000,
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; content: string }) =>
      fetchJson<CommunityPost>("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: POSTS_KEY });
    },
  });
}

export function useUpdatePost(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; content: string }) =>
      fetchJson<CommunityPost>(`/api/community/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: POSTS_KEY });
    },
  });
}

export function useComments(postId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["community", "comments", postId],
    queryFn: () => fetchJson<CommunityComment[]>(`/api/community/posts/${postId}/comments`),
    staleTime: 10_000,
    enabled,
  });
}

export function useCreateComment(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      fetchJson<CommunityComment>(`/api/community/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "comments", postId] });
      queryClient.invalidateQueries({ queryKey: POSTS_KEY });
    },
  });
}

export function useToggleReaction(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (emoji: string) =>
      fetchJson<{ emoji: string; active: boolean }>(`/api/community/posts/${postId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: POSTS_KEY });
    },
  });
}

export function useDeleteCommunityPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) =>
      fetchJson<{ success: true }>(`/api/admin/community/posts/${postId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: POSTS_KEY });
    },
  });
}

export function useDeleteCommunityComment(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      fetchJson<{ success: true }>(`/api/admin/community/comments/${commentId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community", "comments", postId] });
      queryClient.invalidateQueries({ queryKey: POSTS_KEY });
    },
  });
}
