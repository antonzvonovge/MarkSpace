import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FcBriefcase } from "react-icons/fc";
import { listVaultProjects } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";

type Props = {
  value: string | null;
  disabled?: boolean;
  onChange: (projectPath: string | null) => void;
};

type MenuPos = { left: number; bottom: number; width: number };

export function ChatProjectPicker({ value, disabled, onChange }: Props) {
  const tree = useVaultStore((s) => s.tree);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const projects = useMemo(() => listVaultProjects(tree), [tree]);
  const selected = useMemo(
    () => projects.find((p) => p.path === value) ?? null,
    [projects, value],
  );
  const label = selected?.name ?? (value ? value : "Project");

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 200)),
      bottom: window.innerHeight - r.top + 6,
      width: Math.max(r.width, 160),
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="chat-project-menu"
            role="listbox"
            aria-label="Projects"
            style={{
              position: "fixed",
              left: pos.left,
              bottom: pos.bottom,
              width: pos.width,
              zIndex: 10000,
            }}
          >
            <button
              type="button"
              role="option"
              aria-selected={value == null}
              className={
                value == null
                  ? "chat-project-option is-active"
                  : "chat-project-option"
              }
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="chat-project-option-name is-none">
                No project
              </span>
            </button>
            {projects.length === 0 ? (
              <div className="chat-project-empty">No projects in vault</div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  role="option"
                  aria-selected={p.path === value}
                  className={
                    p.path === value
                      ? "chat-project-option is-active"
                      : "chat-project-option"
                  }
                  onClick={() => {
                    onChange(p.path);
                    setOpen(false);
                  }}
                >
                  <span className="chat-project-option-name">{p.name}</span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="chat-project-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={
          value
            ? "chat-project-trigger is-selected"
            : "chat-project-trigger"
        }
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Project"
        title={
          selected
            ? `Project: ${selected.name}`
            : value
              ? `Project: ${value}`
              : "No project selected"
        }
        onClick={() => setOpen((v) => !v)}
      >
        {value ? (
          <span className="chat-project-trigger-icon" aria-hidden>
            <FcBriefcase size={14} />
          </span>
        ) : null}
        <span className="chat-project-trigger-label">{label}</span>
      </button>
      {menu}
    </div>
  );
}
