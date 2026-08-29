import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { FcClapperboard, FcPackage, FcPlanner } from "react-icons/fc";
import { LearningLanguageFlag } from "../LearningLanguageFlag";
import { placeChatComposerMenu } from "../../lib/chatMenuPlacement";
import { learningLanguageFlagSvg } from "../../lib/languageFlags";
import { listVaultProjects } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";

type Props = {
  value: string | null;
  disabled?: boolean;
  onChange: (projectPath: string | null) => void;
};

type MenuPos = {
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
  maxHeight: number;
};

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 280;
const MENU_MIN_HEIGHT = 120;

function ProjectIcon({
  path,
  size = 14,
}: {
  path: string;
  size?: number;
}) {
  const props = useVaultStore((s) => s.projectPropertiesByPath[path]);
  if (props?.projectType === "languageLearning") {
    if (learningLanguageFlagSvg(props.learningLanguage)) {
      return (
        <LearningLanguageFlag
          language={props.learningLanguage}
          className="chat-project-flag"
        />
      );
    }
  }
  if (props?.projectType === "diary") {
    return <FcPlanner size={size} />;
  }
  if (props?.projectType === "movies") {
    return <FcClapperboard size={size} />;
  }
  return <FcPackage size={size} />;
}

function useProjectColor(path: string | null | undefined): string {
  return useVaultStore((s) =>
    path ? (s.projectPropertiesByPath[path]?.color ?? "") : "",
  );
}

export function ChatProjectPicker({ value, disabled, onChange }: Props) {
  const tree = useVaultStore((s) => s.tree);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
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
  const triggerColor = useProjectColor(value);

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const placed = placeChatComposerMenu(r, {
      from: el,
      gap: MENU_GAP,
      width: Math.max(r.width, 160),
      maxHeight: MENU_MAX_HEIGHT,
      minHeight: MENU_MIN_HEIGHT,
    });
    setPos({
      left: placed.left,
      top: placed.top,
      bottom: placed.bottom,
      width: placed.width,
      maxHeight: placed.maxHeight,
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
              top: pos.top ?? undefined,
              bottom: pos.bottom ?? undefined,
              width: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: 10000,
            }}
          >
            <button
              type="button"
              role="option"
              aria-selected={value == null}
              className={
                value == null
                  ? "chat-project-option is-none is-active"
                  : "chat-project-option is-none"
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
              projects.map((p) => {
                const color = projectPropertiesByPath[p.path]?.color ?? "";
                return (
                  <button
                    key={p.path}
                    type="button"
                    role="option"
                    aria-selected={p.path === value}
                    className={[
                      "chat-project-option",
                      p.path === value ? "is-active" : "",
                      color ? "has-project-color" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={
                      color
                        ? ({
                            ["--project-color"]: color,
                          } as CSSProperties)
                        : undefined
                    }
                    onClick={() => {
                      onChange(p.path);
                      setOpen(false);
                    }}
                  >
                    <span className="chat-project-option-icon" aria-hidden>
                      <ProjectIcon path={p.path} size={14} />
                    </span>
                    <span className="chat-project-option-name">{p.name}</span>
                  </button>
                );
              })
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
        className={[
          "chat-project-trigger",
          value ? "is-selected" : "",
          triggerColor ? "has-project-color" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          triggerColor
            ? ({ ["--project-color"]: triggerColor } as CSSProperties)
            : undefined
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
            <ProjectIcon path={value} size={14} />
          </span>
        ) : null}
        <span className="chat-project-trigger-label">{label}</span>
      </button>
      {menu}
    </div>
  );
}
