"use client";

import { useImperativeHandle, type Ref } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import type { Locale } from "@/types";

const LOCALES: Locale[] = ["zh-CN", "en-US", "ms-MY"];

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
    }, [editorKey]);

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
    }, [editorKey]);

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
