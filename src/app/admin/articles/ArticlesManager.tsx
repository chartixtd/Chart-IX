"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import type { Article, ArticleCategory, Locale } from "@/types";

interface ArticlesManagerProps {
  articles: Article[];
  categories: ArticleCategory[];
}

const PAGE_SIZE = 20;
const LOCALES: Locale[] = ["zh-CN", "en-US", "ms-MY"];
const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
  "ms-MY": "Bahasa Melayu",
};

/* ────────── Helper: strip HTML tags ────────── */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/* ────────── Toolbar button ────────── */
function ToolbarBtn({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-sm px-1.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-gold/20 text-gold"
          : "text-text-muted hover:text-text-primary hover:bg-bg-tertiary"
      }`}
    >
      {children}
    </button>
  );
}

/* ────────── TipTap Editor block ────────── */
function TiptapEditorBlock({
  editor,
}: {
  editor: Editor | null;
}) {
  if (!editor) return null;

  return (
    <div className="rounded-sm border border-border-default overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border-default bg-bg-tertiary px-2 py-1.5">
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <strong>B</strong>
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <em>I</em>
        </ToolbarBtn>
        <span className="mx-1 w-px self-stretch bg-border-default" />
        <ToolbarBtn
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading 2"
        >
          H2
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Heading 3"
        >
          H3
        </ToolbarBtn>
        <span className="mx-1 w-px self-stretch bg-border-default" />
        <ToolbarBtn
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet List"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <circle cx="4" cy="6" r="0.5" fill="currentColor" stroke="none" />
            <circle cx="4" cy="12" r="0.5" fill="currentColor" stroke="none" />
            <circle cx="4" cy="18" r="0.5" fill="currentColor" stroke="none" />
          </svg>
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Ordered List"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="10" y1="6" x2="21" y2="6" />
            <line x1="10" y1="12" x2="21" y2="12" />
            <line x1="10" y1="18" x2="21" y2="18" />
            <text x="3" y="9" fontSize="8" fill="currentColor" stroke="none">1</text>
            <text x="3" y="15" fontSize="8" fill="currentColor" stroke="none">2</text>
            <text x="3" y="21" fontSize="8" fill="currentColor" stroke="none">3</text>
          </svg>
        </ToolbarBtn>
        <span className="mx-1 w-px self-stretch bg-border-default" />
        <ToolbarBtn
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Blockquote"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" />
          </svg>
        </ToolbarBtn>
        <ToolbarBtn
          active={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="12" x2="20" y2="12" />
          </svg>
        </ToolbarBtn>
      </div>
      {/* Editor content */}
      <EditorContent editor={editor} />
    </div>
  );
}

/* ────────── Main Manager ────────── */
export function ArticlesManager({ articles, categories }: ArticlesManagerProps) {
  const router = useRouter();
  const t = useTranslations("admin");
  const tc = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();

  /* ── Search & Pagination ── */
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return articles;
    const q = searchQuery.toLowerCase();
    return articles.filter((a) => {
      const titles = [a.title?.["en-US"], a.title?.["zh-CN"], a.title?.["ms-MY"]];
      return titles.some((tt) => tt?.toLowerCase().includes(q));
    });
  }, [articles, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, safePage]);

  /* ── Modal ── */
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  /* Form fields */
  const [titleZh, setTitleZh] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleMs, setTitleMs] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [coverImageUploading, setCoverImageUploading] = useState(false);
  const coverImageInputRef = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState("");
  const [tier, setTier] = useState("free");
  const [isPublished, setIsPublished] = useState(false);

  /* Tab */
  const [activeTab, setActiveTab] = useState<Locale>("en-US");

  /* Editor key for fresh mount on open */
  const [editorKey, setEditorKey] = useState(0);

  /* Content initial values (used to seed tiptap editors) */
  const [contentZhInitial, setContentZhInitial] = useState("");
  const [contentEnInitial, setContentEnInitial] = useState("");
  const [contentMsInitial, setContentMsInitial] = useState("");

  /* Auto-translate state */
  const [translating, setTranslating] = useState(false);

  /* Three TipTap editors */
  const editorZh = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Write something..." }),
    ],
    content: contentZhInitial,
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm max-w-none min-h-[200px] px-4 py-2 focus:outline-none focus:ring-1 focus:ring-gold/50",
      },
    },
  });

  const editorEn = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Write something..." }),
    ],
    content: contentEnInitial,
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm max-w-none min-h-[200px] px-4 py-2 focus:outline-none focus:ring-1 focus:ring-gold/50",
      },
    },
  });

  const editorMs = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Write something..." }),
    ],
    content: contentMsInitial,
    editorProps: {
      attributes: {
        class:
          "prose prose-invert prose-sm max-w-none min-h-[200px] px-4 py-2 focus:outline-none focus:ring-1 focus:ring-gold/50",
      },
    },
  });

  const editorMap: Record<Locale, Editor | null> = {
    "zh-CN": editorZh,
    "en-US": editorEn,
    "ms-MY": editorMs,
  };

  /* ── Helpers ── */
  const getTitle = (article: Article): string => {
    return (
      article.title?.[locale as Locale] ??
      article.title?.["en-US"] ??
      article.title?.["zh-CN"] ??
      article.title?.["ms-MY"] ??
      t("articles_list.untitled")
    );
  };

  const getCategoryName = (cat: ArticleCategory | undefined): string => {
    if (!cat) return "-";
    return (
      cat.name?.[locale as Locale] ??
      cat.name?.["en-US"] ??
      cat.name?.["zh-CN"] ??
      cat.name?.["ms-MY"] ??
      cat.slug
    );
  };

  const resetForm = () => {
    setTitleZh("");
    setTitleEn("");
    setTitleMs("");
    setCoverImage("");
    setCategoryId("");
    setTier("free");
    setIsPublished(false);
    setActiveTab("en-US");
    setContentZhInitial("");
    setContentEnInitial("");
    setContentMsInitial("");
  };

  const openNew = () => {
    resetForm();
    setEditingId(null);
    setEditorKey((k) => k + 1);
    setShowModal(true);
  };

  const openEdit = (article: Article) => {
    setEditingId(article.id);
    setTitleZh(article.title?.["zh-CN"] ?? "");
    setTitleEn(article.title?.["en-US"] ?? "");
    setTitleMs(article.title?.["ms-MY"] ?? "");
    setCoverImage(article.cover_image ?? "");
    setCategoryId(article.category_id != null ? String(article.category_id) : "");
    setTier(article.tier_required ?? "free");
    setIsPublished(article.is_published ?? false);
    setActiveTab("en-US");
    setContentZhInitial(article.content?.["zh-CN"] ?? "");
    setContentEnInitial(article.content?.["en-US"] ?? "");
    setContentMsInitial(article.content?.["ms-MY"] ?? "");
    setEditorKey((k) => k + 1);
    setShowModal(true);
  };

  /* ── Cover image upload ── */
  const handleCoverImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCoverImageUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Upload failed");
      }

      const data = await res.json();
      setCoverImage(data.url);
      toast("Image uploaded", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setCoverImageUploading(false);
    }
  };

  /* ── Auto-translate ── */
  const handleAutoTranslate = async () => {
    setTranslating(true);
    try {
      const sourceLocale = activeTab;
      const sourceTitle =
        sourceLocale === "zh-CN"
          ? titleZh
          : sourceLocale === "en-US"
          ? titleEn
          : titleMs;
      const sourceEditor = editorMap[sourceLocale];
      const sourceContent = sourceEditor?.getHTML();

      if (
        (!sourceTitle || !sourceTitle.trim()) &&
        (!sourceContent || sourceContent === "<p></p>")
      ) {
        toast("No content to translate from", "error");
        return;
      }

      const targetLocales = LOCALES.filter((l) => l !== sourceLocale);

      for (const target of targetLocales) {
        const targetTitle =
          target === "zh-CN" ? titleZh : target === "en-US" ? titleEn : titleMs;
        const targetEditor = editorMap[target];
        const targetContent = targetEditor?.getHTML();

        /* Translate title */
        if (sourceTitle?.trim() && !targetTitle?.trim()) {
          const res = await fetch("/api/admin/articles/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: sourceTitle.trim(),
              from: sourceLocale,
              to: target,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (target === "zh-CN") setTitleZh(data.translated);
            else if (target === "en-US") setTitleEn(data.translated);
            else setTitleMs(data.translated);
          }
        }

        /* Translate content */
        if (
          sourceContent &&
          sourceContent !== "<p></p>" &&
          (!targetContent || targetContent === "<p></p>")
        ) {
          const res = await fetch("/api/admin/articles/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: stripHtml(sourceContent),
              from: sourceLocale,
              to: target,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const htmlContent = `<p>${data.translated}</p>`;
            targetEditor?.commands.setContent(htmlContent);
          }
        }
      }
      toast("Translation complete", "success");
    } catch {
      toast("Translation failed", "error");
    } finally {
      setTranslating(false);
    }
  };

  /* ── Save ── */
  const handleSave = async () => {
    const title: Record<string, string> = {};
    if (titleZh.trim()) title["zh-CN"] = titleZh.trim();
    if (titleEn.trim()) title["en-US"] = titleEn.trim();
    if (titleMs.trim()) title["ms-MY"] = titleMs.trim();

    if (Object.keys(title).length === 0) {
      toast(t("articles_list.article_created"), "error");
      return;
    }

    const content: Record<string, string> = {};
    const zhHtml = editorZh?.getHTML();
    const enHtml = editorEn?.getHTML();
    const msHtml = editorMs?.getHTML();
    if (zhHtml && zhHtml !== "<p></p>") content["zh-CN"] = zhHtml;
    if (enHtml && enHtml !== "<p></p>") content["en-US"] = enHtml;
    if (msHtml && msHtml !== "<p></p>") content["ms-MY"] = msHtml;

    setSaving(true);
    try {
      const isEdit = editingId != null;
      const url = "/api/admin/articles";
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, unknown> = {
        title,
        content: Object.keys(content).length > 0 ? content : null,
        category_id: categoryId ? parseInt(categoryId) : null,
        cover_image: coverImage.trim() || null,
        tier_required: tier,
        is_published: isPublished,
      };
      if (isEdit) body.id = editingId;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }

      toast(
        isEdit ? t("articles_list.article_updated") : t("articles_list.article_created"),
        "success"
      );
      setShowModal(false);
      resetForm();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  /* ── Delete ── */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/articles?id=${confirmDelete}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast(t("articles_list.article_deleted"), "success");
        router.refresh();
      } else {
        const data = await res.json();
        toast(data.error ?? "Delete failed", "error");
      }
    } catch {
      toast("Delete failed", "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  /* ── Render ── */
  return (
    <div>
      {/* Top bar */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-text-secondary">
          {t("articles_list.page", { page: safePage, total: totalPages })}
        </p>
        <div className="flex items-center gap-3">
          <Input
            placeholder={t("articles_list.search_placeholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-56"
          />
          <Button variant="primary" size="sm" onClick={openNew}>
            {t("articles_list.add_article")}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead className="bg-bg-tertiary text-left">
            <tr>
              <th className="px-4 py-3 text-text-muted">{t("articles_list.title_col")}</th>
              <th className="px-4 py-3 text-text-muted">{t("articles_list.category")}</th>
              <th className="px-4 py-3 text-text-muted">{t("articles_list.tier_required")}</th>
              <th className="px-4 py-3 text-text-muted">{t("articles_list.status")}</th>
              <th className="px-4 py-3 text-text-muted">{t("articles_list.views")}</th>
              <th className="px-4 py-3 text-text-muted">{t("articles_list.created")}</th>
              <th className="px-4 py-3 text-text-muted">{t("articles_list.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((a) => (
              <tr key={a.id} className="border-t border-border-default hover:bg-bg-tertiary/50">
                <td
                  className="max-w-[240px] truncate px-4 py-3 text-text-primary"
                  title={getTitle(a)}
                >
                  {getTitle(a)}
                </td>
                <td className="px-4 py-3 text-text-secondary">
                  {getCategoryName(a.category)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={a.tier_required === "pro" ? "gold" : "gray"}>
                    {a.tier_required === "pro"
                      ? t("articles_list.tier_pro_option")
                      : t("articles_list.tier_free_option")}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={a.is_published ? "green" : "red"}>
                    {a.is_published
                      ? t("articles_list.published")
                      : t("articles_list.draft")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-text-secondary">{a.view_count}</td>
                <td className="px-4 py-3 text-text-secondary">
                  {formatDate(a.created_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(a)}
                      className="text-text-secondary hover:text-gold"
                      title={t("articles_list.edit_article")}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(a.id)}
                      className="text-red-400 hover:text-red-300"
                      title={t("articles_list.delete_article")}
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <p className="mt-4 text-center text-text-muted">
          {t("articles_list.no_articles")}
        </p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-text-muted">
            {t("articles_list.page", { page: safePage, total: totalPages })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              {t("articles_list.prev")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              {t("articles_list.next")}
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t("articles_list.delete_article")}
        message={t("articles_list.delete_confirm")}
        confirmText={t("articles_list.delete_article")}
        cancelText={tc("common.cancel")}
        loading={deleting}
        variant="danger"
      />

      {/* Create / Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          resetForm();
        }}
        title={
          editingId
            ? t("articles_list.edit_article")
            : t("articles_list.new_article")
        }
        size="lg"
      >
        <div className="space-y-4">
          {/* Locale tabs */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-text-secondary">
                {t("articles_list.title_col")} &amp; {t("articles_list.content_label")}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleAutoTranslate}
                loading={translating}
                disabled={translating}
                className="text-xs"
              >
                {translating ? "Translating..." : "Translate All"}
              </Button>
            </div>

            {/* Slug hint */}
            <p className="text-xs text-text-muted mb-2">
              Slug is auto-generated from the English title.
            </p>

            <div className="flex gap-1 mb-3 border-b border-border-default">
              {LOCALES.map((loc) => (
                <button
                  key={loc}
                  type="button"
                  onClick={() => setActiveTab(loc)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === loc
                      ? "border-gold text-gold"
                      : "border-transparent text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {LOCALE_LABELS[loc]}
                </button>
              ))}
            </div>

            {/* Title input for active locale */}
            <Input
              placeholder={t("articles_list.title_col")}
              value={
                activeTab === "zh-CN"
                  ? titleZh
                  : activeTab === "en-US"
                  ? titleEn
                  : titleMs
              }
              onChange={(e) => {
                if (activeTab === "zh-CN") setTitleZh(e.target.value);
                else if (activeTab === "en-US") setTitleEn(e.target.value);
                else setTitleMs(e.target.value);
              }}
              className="mb-3"
            />

            {/* TipTap editors - only show active */}
            <div key={editorKey}>
              {LOCALES.map((loc) => (
                <div key={loc} className={activeTab === loc ? "" : "hidden"}>
                  <TiptapEditorBlock editor={editorMap[loc]} />
                </div>
              ))}
            </div>
          </div>

          {/* Cover image: file upload with preview + URL fallback */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">
              {t("articles_list.cover_image")}
            </label>
            <div className="flex items-center gap-3">
              <input
                ref={coverImageInputRef}
                type="file"
                accept="image/*"
                onChange={handleCoverImageUpload}
                className="block w-full text-sm text-text-secondary file:mr-3 file:py-1.5 file:px-3 file:rounded-sm file:border-0 file:text-sm file:font-medium file:bg-bg-tertiary file:text-text-primary hover:file:bg-bg-secondary file:cursor-pointer"
              />
              {coverImageUploading && (
                <span className="text-xs text-text-muted whitespace-nowrap">Uploading...</span>
              )}
            </div>
            {coverImage && (
              <div className="mt-2">
                <img
                  src={coverImage}
                  alt="Cover preview"
                  className="h-24 w-auto rounded-sm object-cover border border-border-default"
                />
              </div>
            )}
            <Input
              placeholder="Or paste image URL..."
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              className="mt-2"
            />
          </div>

          {/* Category & Tier row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-secondary">
                {t("articles_list.category")}
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold"
              >
                <option value="">-</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {getCategoryName(c)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-secondary">
                {t("articles_list.tier_required")}
              </label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className="w-full rounded-sm border border-border-default bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold"
              >
                <option value="free">{t("articles_list.tier_free_option")}</option>
                <option value="pro">{t("articles_list.tier_pro_option")}</option>
              </select>
            </div>
          </div>

          {/* Published toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
              className="h-4 w-4 rounded-sm border-border-default bg-bg-tertiary text-gold focus:ring-gold/50"
            />
            <span className="text-sm text-text-secondary">
              {t("articles_list.published")}
            </span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setShowModal(false);
                resetForm();
              }}
            >
              {tc("common.cancel")}
            </Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>
              {t("articles_list.save_article")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
