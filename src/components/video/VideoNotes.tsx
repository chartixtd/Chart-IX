"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

interface VideoNote {
  id: string;
  user_id: string;
  video_id: string;
  content: string;
  timestamp_seconds: number;
  created_at: string;
  updated_at: string;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

interface VideoNotesProps {
  videoId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function VideoNotes({ videoId, videoRef }: VideoNotesProps) {
  const auth = useAuth();
  const [notes, setNotes] = useState<VideoNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState("");
  const [timestampSeconds, setTimestampSeconds] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [expanded, setExpanded] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/video/notes?video_id=${videoId}`);
      const json = await res.json();
      if (json.data) {
        setNotes(json.data as VideoNote[]);
      }
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    if (auth.userId) {
      fetchNotes();
    } else {
      setLoading(false);
    }
  }, [auth.userId, fetchNotes]);

  const handleCaptureTimestamp = () => {
    const el = videoRef.current;
    if (el) {
      setTimestampSeconds(Math.floor(el.currentTime));
    }
  };

  const handleSave = async () => {
    if (!content.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/video/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: videoId,
          content: content.trim(),
          timestamp_seconds: timestampSeconds,
        }),
      });
      const json = await res.json();
      if (json.data) {
        setNotes((prev) =>
          [...prev, json.data].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds)
        );
        setContent("");
        setTimestampSeconds(0);
      }
    } catch {
      // silently ignore
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch("/api/video/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setEditContent("");
      }
    } catch {
      // silently ignore
    }
  };

  const handleEditStart = (note: VideoNote) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditContent("");
  };

  const handleEditSave = async (id: string) => {
    if (!editContent.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/video/notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, content: editContent.trim() }),
      });
      const json = await res.json();
      if (json.data) {
        setNotes((prev) => prev.map((n) => (n.id === id ? json.data : n)));
        setEditingId(null);
        setEditContent("");
      }
    } catch {
      // silently ignore
    } finally {
      setSaving(false);
    }
  };

  const handleJumpToTimestamp = (seconds: number) => {
    const el = videoRef.current;
    if (el) {
      el.currentTime = seconds;
    }
  };

  // 未登录不显示
  if (!auth.userId) return null;

  return (
    <Card className="mt-6">
      {/* Header - click to expand/collapse */}
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <h2 className="text-lg font-semibold text-text-primary">📝 我的笔记</h2>
        <svg
          className={cn(
            "h-5 w-5 text-text-muted transition-transform",
            expanded && "rotate-180"
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* 新建笔记区域 */}
          <div className="space-y-3 rounded-md border border-border-default bg-bg-tertiary p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xs bg-bg-secondary px-2 py-0.5 text-xs text-text-muted">
                {formatTimestamp(timestampSeconds)}
              </div>
              <Button variant="outline" size="sm" onClick={handleCaptureTimestamp}>
                在此刻添加笔记
              </Button>
            </div>
            <textarea
              className="w-full rounded-xs border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold/60 focus:outline-none resize-none"
              rows={3}
              placeholder="写下你的笔记..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                disabled={!content.trim()}
                onClick={handleSave}
              >
                保存笔记
              </Button>
            </div>
          </div>

          {/* 笔记列表 */}
          {loading ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : notes.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-muted">暂无笔记，开始记录吧</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-md border border-border-default bg-bg-tertiary p-3"
                >
                  {editingId === note.id ? (
                    /* 编辑模式 */
                    <div className="space-y-2">
                      <textarea
                        className="w-full rounded-xs border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold/60 focus:outline-none resize-none"
                        rows={3}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={handleEditCancel}>
                          取消
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={saving}
                          disabled={!editContent.trim()}
                          onClick={() => handleEditSave(note.id)}
                        >
                          保存
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* 展示模式 */
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className="shrink-0 rounded-xs bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold hover:bg-gold/25 transition-colors"
                          onClick={() => handleJumpToTimestamp(note.timestamp_seconds)}
                          title="跳转到此时间点"
                        >
                          {formatTimestamp(note.timestamp_seconds)}
                        </button>
                        <div className="flex shrink-0 gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleEditStart(note)}>
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger hover:text-danger"
                            onClick={() => handleDelete(note.id)}
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </Button>
                        </div>
                      </div>
                      <p className="mt-1.5 text-sm text-text-secondary leading-relaxed break-words">
                        {truncateText(note.content, 50)}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
