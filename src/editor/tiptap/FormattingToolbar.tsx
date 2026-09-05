/**
 * Selection bubble formatting toolbar for TipTap Live.
 */

import type { Editor } from "@tiptap/core";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  RiArrowDownSLine,
  RiBold,
  RiChat3Line,
  RiChatQuoteLine,
  RiCheckboxLine,
  RiCodeSSlashLine,
  RiExternalLinkLine,
  RiH1,
  RiH2,
  RiH3,
  RiInboxLine,
  RiItalic,
  RiLink,
  RiListOrdered,
  RiListUnordered,
  RiParagraph,
  RiQuoteText,
  RiStrikethrough,
  RiUnderline,
} from "react-icons/ri";
import { placeAnchoredMenu } from "../../lib/menuPlacement";
import { useChatStore } from "../../store/chatStore";
import { useChatUiStore } from "../../store/chatUiStore";

type Props = {
  editor: Editor;
  notePath: string;
  onComment: () => void;
  onCapture: () => void;
  onInsertNoteLink: () => void;
};

type BlockValue =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "quote"
  | "bullet"
  | "ordered"
  | "task";

type BlockOption = {
  value: BlockValue;
  label: string;
  icon: ReactNode;
};

const BLOCK_OPTIONS: BlockOption[] = [
  { value: "paragraph", label: "Paragraph", icon: <RiParagraph size={16} /> },
  { value: "h1", label: "Heading 1", icon: <RiH1 size={16} /> },
  { value: "h2", label: "Heading 2", icon: <RiH2 size={16} /> },
  { value: "h3", label: "Heading 3", icon: <RiH3 size={16} /> },
  { value: "quote", label: "Quote", icon: <RiQuoteText size={16} /> },
  {
    value: "bullet",
    label: "Bullet list",
    icon: <RiListUnordered size={16} />,
  },
  {
    value: "ordered",
    label: "Numbered list",
    icon: <RiListOrdered size={16} />,
  },
  { value: "task", label: "Check list", icon: <RiCheckboxLine size={16} /> },
];

function currentBlock(editor: Editor): BlockValue {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("blockquote")) return "quote";
  if (editor.isActive("taskList")) return "task";
  if (editor.isActive("bulletList")) return "bullet";
  if (editor.isActive("orderedList")) return "ordered";
  return "paragraph";
}

function applyBlock(editor: Editor, value: BlockValue) {
  const chain = editor.chain().focus();
  switch (value) {
    case "paragraph":
      chain.setParagraph().run();
      break;
    case "h1":
      chain.setHeading({ level: 1 }).run();
      break;
    case "h2":
      chain.setHeading({ level: 2 }).run();
      break;
    case "h3":
      chain.setHeading({ level: 3 }).run();
      break;
    case "quote":
      chain.toggleBlockquote().run();
      break;
    case "bullet":
      chain.toggleBulletList().run();
      break;
    case "ordered":
      chain.toggleOrderedList().run();
      break;
    case "task":
      chain.toggleTaskList().run();
      break;
  }
}

function FmtButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ms-fmt-btn${active ? " is-active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function FmtSep() {
  return <span className="ms-fmt-sep" aria-hidden="true" />;
}

function BlockTypePicker({
  editor,
  value,
  onPick,
}: {
  editor: Editor;
  value: BlockValue;
  onPick: (value: BlockValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected =
    BLOCK_OPTIONS.find((o) => o.value === value) ?? BLOCK_OPTIONS[0]!;

  const [pos, setPos] = useState<{
    left: number;
    top: number | null;
    bottom: number | null;
    width: number;
    maxHeight: number;
  } | null>(null);

  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const placed = placeAnchoredMenu(r, {
      gap: 6,
      width: Math.max(200, r.width),
      maxHeight: 280,
      minHeight: 120,
      prefer: "below",
    });
    setPos({
      left: placed.left,
      top: placed.top,
      bottom: placed.bottom,
      width: placed.width,
      maxHeight: placed.maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
    const idx = Math.max(
      0,
      BLOCK_OPTIONS.findIndex((o) => o.value === value),
    );
    setSelectedIndex(idx);
    queueMicrotask(() => menuRef.current?.focus({ preventScroll: true }));
  }, [open, updatePos, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onReposition = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        editor.chain().focus().run();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % BLOCK_OPTIONS.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (i) => (i - 1 + BLOCK_OPTIONS.length) % BLOCK_OPTIONS.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const choice = BLOCK_OPTIONS[selectedIndex];
        if (choice) {
          onPick(choice.value);
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, selectedIndex, onPick, editor]);

  useEffect(() => {
    if (!open) return;
    const el = menuRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, open]);

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="ms-fmt-block-menu"
            role="listbox"
            tabIndex={-1}
            aria-label="Block type"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top ?? undefined,
              bottom: pos.bottom ?? undefined,
              width: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: 12000,
            }}
          >
            <div className="ms-fmt-block-list">
              {BLOCK_OPTIONS.map((opt, i) => (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  data-index={i}
                  aria-selected={i === selectedIndex}
                  className={`ms-fmt-block-option${i === selectedIndex ? " is-selected" : ""}${opt.value === value ? " is-active" : ""}`}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(opt.value);
                    setOpen(false);
                  }}
                >
                  <span className="ms-fmt-block-option-icon" aria-hidden="true">
                    {opt.icon}
                  </span>
                  <span className="ms-fmt-block-option-label">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="ms-fmt-block-picker">
      <button
        ref={triggerRef}
        type="button"
        className="ms-fmt-block-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Block type"
        title={selected.label}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ms-fmt-block-trigger-icon" aria-hidden="true">
          {selected.icon}
        </span>
        <span className="ms-fmt-block-trigger-label">{selected.label}</span>
        <RiArrowDownSLine
          size={16}
          className="ms-fmt-block-trigger-caret"
          aria-hidden="true"
        />
      </button>
      {menu}
    </div>
  );
}

export function LiveFormattingToolbar({
  editor,
  notePath,
  onComment,
  onCapture,
  onInsertNoteLink,
}: Props) {
  const [, bump] = useState(0);
  const refresh = useCallback(() => bump((n) => n + 1), []);

  const setUrlLink = useCallback(() => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", prev ?? "https://");
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmed })
      .run();
  }, [editor]);

  const addToChat = useCallback(() => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, " ");
    if (!text.trim()) return;
    useChatStore.getState().addSelectionToDraft(text, notePath);
    useChatUiStore.getState().setOpen(true);
  }, [editor, notePath]);

  const onPickBlock = useCallback(
    (value: BlockValue) => {
      applyBlock(editor, value);
      refresh();
    },
    [editor, refresh],
  );

  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: "top",
        offset: 8,
        flip: true,
        shift: true,
      }}
      updateDelay={80}
      shouldShow={({ editor: ed, state }) => {
        if (!ed.isEditable) return false;
        const { empty, from, to } = state.selection;
        if (empty || from === to) return false;
        if (ed.isActive("codeBlock")) return false;
        // Do not require editor focus — toolbar / portaled picker blur the view.
        return true;
      }}
      className="ms-fmt-toolbar"
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("input, textarea")) return;
        // Keep text selection while clicking toolbar chrome.
        e.preventDefault();
      }}
    >
      <div
        className="ms-fmt-toolbar-inner"
        onMouseEnter={refresh}
        onFocus={refresh}
      >
        <BlockTypePicker
          editor={editor}
          value={currentBlock(editor)}
          onPick={onPickBlock}
        />
        <FmtSep />
        <FmtButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => {
            editor.chain().focus().toggleBold().run();
            refresh();
          }}
        >
          <RiBold size={16} />
        </FmtButton>
        <FmtButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => {
            editor.chain().focus().toggleItalic().run();
            refresh();
          }}
        >
          <RiItalic size={16} />
        </FmtButton>
        <FmtButton
          label="Underline"
          active={editor.isActive("underline")}
          onClick={() => {
            editor.chain().focus().toggleUnderline().run();
            refresh();
          }}
        >
          <RiUnderline size={16} />
        </FmtButton>
        <FmtButton
          label="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => {
            editor.chain().focus().toggleStrike().run();
            refresh();
          }}
        >
          <RiStrikethrough size={16} />
        </FmtButton>
        <FmtButton
          label="Inline code"
          active={editor.isActive("code")}
          onClick={() => {
            editor.chain().focus().toggleCode().run();
            refresh();
          }}
        >
          <RiCodeSSlashLine size={16} />
        </FmtButton>
        <FmtSep />
        <FmtButton
          label="Link"
          active={editor.isActive("link")}
          onClick={setUrlLink}
        >
          <RiExternalLinkLine size={16} />
        </FmtButton>
        <FmtButton label="Insert note link" onClick={onInsertNoteLink}>
          <RiLink size={16} />
        </FmtButton>
        <FmtSep />
        <FmtButton label="Add to chat" onClick={addToChat}>
          <RiChatQuoteLine size={16} />
        </FmtButton>
        <FmtButton label="Comment" onClick={onComment}>
          <RiChat3Line size={16} />
        </FmtButton>
        <FmtButton label="Capture to Incoming" onClick={onCapture}>
          <RiInboxLine size={16} />
        </FmtButton>
      </div>
    </BubbleMenu>
  );
}
