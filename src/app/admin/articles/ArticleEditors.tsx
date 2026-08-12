"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import ImageExtension from "@tiptap/extension-image";
import { useToast } from "@/components/ui/Toast";
import { compressImage } from "@/lib/image-compress";
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
  "prose prose-invert prose-sm max-w-none min-h-[200px] max-h-[45vh] overflow-y-auto px-4 py-2 focus:outline-none focus:ring-1 focus:ring-gold/50 lg:min-h-[320px] lg:max-h-[60vh] [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-sm";

/** 与 /api/admin/upload 的服务端限制一致，用来在发请求前先挡下必然失败的图。 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXTENSIONS = [
  StarterKit,
  Placeholder.configure({ placeholder: "Write something..." }),
  // 不开 allowBase64：图片一律走上传拿公开 URL，否则整张图会被塞进文章
  // HTML 里存进数据库。
  ImageExtension.configure({ inline: false, allowBase64: false }),
];

/** 从拖放/剪贴板的 DataTransfer 里挑出图片文件，顺序保持用户给的顺序。 */
function imageFilesOf(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  return Array.from(dt.files ?? []).filter((f) => f.type.startsWith("image/"));
}

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
  const [dragOver, setDragOver] = useState(false);

  /**
   * 一批图片的完整流程：压缩 → 并发上传 → 按原顺序插入。工具栏选文件、往正文
   * 里拖、以及粘贴，三个入口共用这一条。
   *
   * 两处提速：上传前在浏览器里把图压小（见 image-compress），以及多张并发
   * 上传而不是排队等——原先 5 张就要串行等 5 次。
   *
   * 并发之后仍按用户给的先后顺序插入：Promise.allSettled 保序，正文里的图片
   * 次序才不会随网络快慢乱掉。
   *
   * @param at 插入位置。拖放时是鼠标落点，其余情况传 null 表示插在光标处。
   */
  const uploadAndInsert = async (files: File[], at: number | null) => {
    if (files.length === 0 || !editor) return;

    setUploading(true);
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const payload = await compressImage(file);
        // 压缩后再判大小：原图超 10MB 但压完没有的，不该被挡下来
        if (payload.size > MAX_UPLOAD_BYTES) throw new Error("exceeds 10 MB");

        const formData = new FormData();
        formData.append("file", payload);
        const res = await fetch("/api/admin/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        return { src: data.url as string, alt: file.name };
      })
    );
    setUploading(false);

    let uploaded = 0;
    // 拖放的落点是上传开始前算的，等上传回来文档可能已经被改短，越界会抛错
    let pos = at === null ? null : Math.min(at, editor.state.doc.content.size);
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        if (pos === null) {
          editor.chain().focus().setImage(result.value).run();
        } else {
          editor
            .chain()
            .focus()
            .insertContentAt(pos, { type: "image", attrs: result.value })
            .run();
          // 下一张接在刚插入的这张后面，整批才保持选中时的顺序
          pos = editor.state.selection.to;
        }
        uploaded += 1;
      } else {
        const reason = result.reason;
        toast(
          `${files[i].name}: ${reason instanceof Error ? reason.message : "Upload failed"}`,
          "error"
        );
      }
    });

    if (uploaded > 0) {
      toast(uploaded === 1 ? "Image inserted" : `${uploaded} images inserted`, "success");
    }
  };

  // 最新一版的处理函数：下面的 editorProps 只在 editor 变化时装一次，
  // 直接闭包捕获会永远停在首帧那版。
  const uploadRef = useRef(uploadAndInsert);
  uploadRef.current = uploadAndInsert;

  /**
   * 把「拖进来」和「粘贴」也接到同一条上传流水线上。
   *
   * 走 TipTap 的 editorProps 而不是在外层 div 上挂 onDrop：ProseMirror 自己
   * 也监听 drop/paste，外层监听器排在它后面，等轮到时默认行为已经发生了
   * （拖进来的图会变成一串文件名文本）。这两个钩子返回 true 即表示已接管。
   */
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        // setOptions 是整体替换而非合并，attributes 得一并带上，否则编辑器
        // 会丢掉 EDITOR_CLASS 的排版与滚动约束
        attributes: { class: EDITOR_CLASS },
        handleDrop: (view, event) => {
          const files = imageFilesOf((event as DragEvent).dataTransfer);
          if (files.length === 0) return false; // 拖的不是图片，交还给默认行为
          event.preventDefault();
          const dropEvent = event as DragEvent;
          const coords = view.posAtCoords({ left: dropEvent.clientX, top: dropEvent.clientY });
          void uploadRef.current(files, coords?.pos ?? null);
          return true;
        },
        handlePaste: (_view, event) => {
          const files = imageFilesOf((event as ClipboardEvent).clipboardData);
          // 从网页复制来的图通常只有 HTML 没有文件，那种仍走默认粘贴
          if (files.length === 0) return false;
          event.preventDefault();
          void uploadRef.current(files, null);
          return true;
        },
      },
    });
  }, [editor]);

  if (!editor) return null;

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // 先清空，否则再次选同一批文件不会触发 change
    e.target.value = "";
    void uploadAndInsert(files, null);
  };

  return (
    <div
      className={`rounded-sm border overflow-hidden transition-colors ${
        dragOver ? "border-gold" : "border-border-default"
      }`}
      // dragover 必须 preventDefault，否则浏览器根本不会派发 drop，而是自己
      // 打开这张图片、把没保存的文章顶掉
      onDragOver={(e) => {
        if (imageFilesOf(e.dataTransfer).length > 0 || e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        // 只有真正离开整个编辑器才熄灭；在内部元素之间移动会连发 leave/enter
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        // 落在正文里的已被上面的 handleDrop 接管（它调过 preventDefault）；
        // 这里只兜住落在工具栏等正文之外的那部分，插到光标处。
        if (e.defaultPrevented) return;
        const files = imageFilesOf(e.dataTransfer);
        if (files.length === 0) return;
        e.preventDefault();
        void uploadAndInsert(files, null);
      }}
    >
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
          title="Insert images — pick several at once, or drag/paste them into the body"
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
