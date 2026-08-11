"use client";

import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import ImageExtension from "@tiptap/extension-image";
import { useToast } from "@/components/ui/Toast";
import type { Locale } from "@/types";

const LOCALES: Locale[] = ["zh-CN", "en-US", "ms-MY"];

/**
 * 正文区自己滚动，而不是把弹窗撑高。没有 max-h 的话，一篇长文章会让弹窗
 * 高出视口，标题栏与下方的封面/分类字段就都够不着了。
 *
 * `prose*` 在本项目里是空类名（没装 @tailwindcss/typography，见 globals.css
 * 里 prose-custom 的说明），所以插入的图片得自己约束宽度，否则一张大图会把
 * 编辑器横向撑破。
 */
const EDITOR_CLASS =
  "prose prose-invert prose-sm max-w-none min-h-[200px] max-h-[45vh] overflow-y-auto px-4 py-2 focus:outline-none focus:ring-1 focus:ring-gold/50 [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-sm";

/** 与 /api/admin/upload 的服务端限制保持一致，好在选中文件时就先挡下来。 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXTENSIONS = [
  StarterKit,
  Placeholder.configure({ placeholder: "Write something..." }),
  // 不开 allowBase64：图片一律走上传拿公开 URL，否则整张图会被塞进文章
  // HTML 里存进数据库。
  ImageExtension.configure({ inline: false, allowBase64: false }),
];

export interface ArticleEditorsHandle {
  getHTML: (locale: Locale) => string;
  setContent: (locale: Locale, html: string) => void;
}

interface ArticleEditorsProps {
  activeTab: Locale;
  editorKey: number;
  contentZhInitial: string;
  contentEnInitial: string;
  contentMsInitial: string;
  // Plain prop rather than a real `ref` — next/dynamic's wrapper is a plain
  // function component (not React.forwardRef), so a JSX `ref=` attribute on
  // the dynamic()-wrapped component never reaches this one; useImperativeHandle
  // accepts a ref-like value from anywhere, so routing it through as a normal
  // prop sidesteps that entirely.
  handleRef: Ref<ArticleEditorsHandle>;
}

/* ────────── Toolbar button ────────── */
function ToolbarBtn({
  active,
  onClick,
  children,
  title,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-sm px-1.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  /**
   * 一次可以选多张：逐张上传、逐张插入，这样先传完的图片马上出现在正文里，
   * 中途某一张失败也不会连累其余的。
   */
  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // 先清空，否则再次选同一批文件不会触发 change
    e.target.value = "";
    if (files.length === 0 || !editor) return;

    setUploading(true);
    let failed = 0;
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast(`${file.name}: exceeds 10 MB`, "error");
        failed += 1;
        continue;
      }
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        editor.chain().focus().setImage({ src: data.url, alt: file.name }).run();
      } catch (err) {
        failed += 1;
        toast(`${file.name}: ${err instanceof Error ? err.message : "Upload failed"}`, "error");
      }
    }
    setUploading(false);

    const uploaded = files.length - failed;
    if (uploaded > 0) {
      toast(uploaded === 1 ? "Image inserted" : `${uploaded} images inserted`, "success");
    }
  };

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
        <span className="mx-1 w-px self-stretch bg-border-default" />
        <ToolbarBtn
          active={false}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          title="Insert images (multiple allowed)"
        >
          {uploading ? (
            <span className="text-[10px]">Uploading…</span>
          ) : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="10" r="1.5" />
              <path d="M21 16l-5-5-4 4-2-2-4 4" />
            </svg>
          )}
        </ToolbarBtn>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFiles}
        />
      </div>
      {/* Editor content */}
      <EditorContent editor={editor} />
    </div>
  );
}

/**
 * Owns the three TipTap editor instances (one per locale) and exposes
 * getHTML/setContent to the parent via ref, instead of the parent holding
 * Editor instances directly — that's what lets ArticlesManager dynamic-import
 * this file with `ssr: false` and keep @tiptap/* (and its ~130kB) out of the
 * initial /admin/articles bundle.
 */
export function ArticleEditors({
  activeTab,
  editorKey,
  contentZhInitial,
  contentEnInitial,
  contentMsInitial,
  handleRef,
}: ArticleEditorsProps) {
    const editorZh = useEditor({
      extensions: EXTENSIONS,
      content: contentZhInitial,
      editorProps: {
        attributes: { class: EDITOR_CLASS },
      },
    }, [editorKey]);

    const editorEn = useEditor({
      extensions: EXTENSIONS,
      content: contentEnInitial,
      editorProps: {
        attributes: { class: EDITOR_CLASS },
      },
    }, [editorKey]);

    const editorMs = useEditor({
      extensions: EXTENSIONS,
      content: contentMsInitial,
      editorProps: {
        attributes: { class: EDITOR_CLASS },
      },
    }, [editorKey]);

    const editorMap: Record<Locale, Editor | null> = {
      "zh-CN": editorZh,
      "en-US": editorEn,
      "ms-MY": editorMs,
    };

    useImperativeHandle(handleRef, () => ({
      getHTML: (loc) => editorMap[loc]?.getHTML() ?? "",
      setContent: (loc, html) => editorMap[loc]?.commands.setContent(html),
    }), [editorZh, editorEn, editorMs]);

    return (
      <div key={editorKey}>
        {LOCALES.map((loc) => (
          <div key={loc} className={activeTab === loc ? "" : "hidden"}>
            <TiptapEditorBlock editor={editorMap[loc]} />
          </div>
        ))}
      </div>
    );
}
