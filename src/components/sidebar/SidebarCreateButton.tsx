import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FcDocument, FcWorkflow } from "react-icons/fc";
import { MdMoreHoriz } from "react-icons/md";
import { resolveCreateFolder, setLastCreateFolder } from "../../lib/createLocation";
import { ancestorFolderPaths } from "../../lib/lastVaultFolder";
import { placeAnchoredMenu } from "../../lib/menuPlacement";
import { saveExpandedPaths } from "../../lib/settingsStore";
import {
  INCOMING_FOLDER,
  SKILLS_FOLDER,
  ensureFolder,
  isValidSkillId,
} from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import { DialogShell } from "../AppDialog";
import { VaultFolderBrowseDialog } from "../VaultFolderBrowseDialog";
import {
  CourseTrackerIcon,
  DiagramIcon,
  DictionaryIcon,
  HabitTrackerIcon,
  LinksIcon,
  PlusIcon,
} from "../treeIcons";

export type SidebarCreateKind =
  | "note"
  | "drawio"
  | "mdlnks"
  | "mddict"
  | "mdhabit"
  | "mdcourse"
  | "skill";

const ENTITIES: { kind: SidebarCreateKind; label: string }[] = [
  { kind: "note", label: "New note" },
  { kind: "drawio", label: "New diagram" },
  { kind: "mdlnks", label: "New links" },
  { kind: "mddict", label: "New dictionary" },
  { kind: "mdhabit", label: "New habit tracker" },
  { kind: "mdcourse", label: "New course" },
  { kind: "skill", label: "New skill" },
];

const COPY: Record<
  SidebarCreateKind,
  { title: string; description: string; defaultName: string }
> = {
  note: {
    title: "New note",
    description: "Create a markdown note.",
    defaultName: "Untitled",
  },
  drawio: {
    title: "New diagram",
    description: "Create a Draw.io diagram.",
    defaultName: "Diagram",
  },
  mdlnks: {
    title: "New links",
    description: "Create a links collection.",
    defaultName: "Links",
  },
  mddict: {
    title: "New dictionary",
    description: "Create a vocabulary dictionary.",
    defaultName: "Dictionary",
  },
  mdhabit: {
    title: "New habit tracker",
    description: "Create a yearly habit tracker.",
    defaultName: "Habits",
  },
  mdcourse: {
    title: "New course",
    description: "Create a course tracker.",
    defaultName: "Course",
  },
  skill: {
    title: "New skill",
    description: "Skill id: lowercase letters, digits, and hyphens.",
    defaultName: "my-skill",
  },
};

function EntityIcon({ kind }: { kind: SidebarCreateKind }) {
  if (kind === "note") return <FcDocument size={16} />;
  if (kind === "drawio") return <DiagramIcon />;
  if (kind === "mdlnks") return <LinksIcon />;
  if (kind === "mddict") return <DictionaryIcon />;
  if (kind === "mdhabit") return <HabitTrackerIcon />;
  if (kind === "mdcourse") return <CourseTrackerIcon />;
  return <FcWorkflow size={16} />;
}

function CaretIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M2.5 4.25 6 7.75l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function expandFolder(folder: string) {
  if (!folder) return;
  const { vaultPath, expandedPaths } = useVaultStore.getState();
  const toOpen = [...ancestorFolderPaths(folder), folder];
  const missing = toOpen.filter((path) => !expandedPaths.includes(path));
  if (missing.length === 0) return;
  const next = [...expandedPaths, ...missing];
  useVaultStore.setState({ expandedPaths: next });
  if (vaultPath) void saveExpandedPaths(vaultPath, next);
}

type MenuPos = {
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
  maxHeight: number;
};

export function SidebarCreateButton({
  onCreated,
}: {
  onCreated?: () => void;
}) {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [kind, setKind] = useState<SidebarCreateKind | null>(null);

  const disabled = !vaultPath;

  const openKind = (next: SidebarCreateKind) => {
    setMenuOpen(false);
    setKind(next);
  };

  const updateMenuPos = () => {
    const el = rootRef.current;
    if (!el) return;
    const placed = placeAnchoredMenu(el.getBoundingClientRect(), {
      width: 220,
      align: "end",
      prefer: "below",
      maxHeight: 320,
    });
    setMenuPos({
      left: placed.left,
      top: placed.top,
      bottom: placed.bottom,
      width: placed.width,
      maxHeight: placed.maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
      }
    };
    const onReposition = () => updateMenuPos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (disabled) setMenuOpen(false);
  }, [disabled]);

  const menu =
    menuOpen && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="sidebar-create-menu"
            role="menu"
            style={{
              position: "fixed",
              left: menuPos.left,
              top: menuPos.top ?? undefined,
              bottom: menuPos.bottom ?? undefined,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
            }}
          >
            {ENTITIES.map((item) => (
              <button
                key={item.kind}
                type="button"
                role="menuitem"
                className="tree-create-item"
                onClick={() => openKind(item.kind)}
              >
                <EntityIcon kind={item.kind} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="sidebar-create" ref={rootRef}>
        <button
          type="button"
          className="sidebar-create-main"
          disabled={disabled}
          aria-label="New note"
          title="New note"
          onClick={() => openKind("note")}
        >
          <PlusIcon />
          <span>New</span>
        </button>
        <button
          type="button"
          className="sidebar-create-caret"
          disabled={disabled}
          aria-label="Choose what to create"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Choose what to create"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <CaretIcon />
        </button>
      </div>
      {menu}
      <CreateEntityDialog
        kind={kind}
        onCancel={() => setKind(null)}
        onReveal={() => onCreated?.()}
      />
    </>
  );
}

function CreateEntityDialog({
  kind,
  onCancel,
  onReveal,
}: {
  kind: SidebarCreateKind | null;
  onCancel: () => void;
  onReveal: () => void;
}) {
  const nameId = useId();
  const yearId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const copy = kind ? COPY[kind] : COPY.note;
  const [name, setName] = useState(copy.defaultName);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [folder, setFolder] = useState(INCOMING_FOLDER);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) return;
    const state = useVaultStore.getState();
    setName(COPY[kind].defaultName);
    setYear(String(new Date().getFullYear()));
    setFolder(
      kind === "skill"
        ? SKILLS_FOLDER
        : resolveCreateFolder(state.tree, state.projectPropertiesByPath),
    );
    setPickerOpen(false);
    setError(null);
    const id = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [kind]);

  const yearNum = Number.parseInt(year, 10);
  const yearOk = Number.isInteger(yearNum) && yearNum >= 1 && yearNum <= 9999;
  const canSubmit = Boolean(name.trim()) && (kind !== "mdhabit" || yearOk);

  const submit = () => {
    if (!kind || !canSubmit) return;
    const trimmed = name.trim();
    if (kind === "skill") {
      const id = trimmed.toLowerCase().replace(/\.md$/i, "");
      if (!isValidSkillId(id)) {
        setError("Use lowercase letters, digits, and hyphens (e.g. meeting-notes).");
        return;
      }
      onCancel();
      void useVaultStore.getState().createSkill(id).then(onReveal);
      return;
    }

    const target = folder;
    const createKind = kind;
    setLastCreateFolder(target);
    onCancel();
    void (async () => {
      try {
        await ensureFolder(target);
        expandFolder(target);
        useVaultStore.getState().selectFolder(target);
        const store = useVaultStore.getState();
        if (createKind === "note") await store.createNoteInSelection(trimmed);
        else if (createKind === "drawio") await store.createDrawioInSelection(trimmed);
        else if (createKind === "mdlnks") await store.createMdlnksInSelection(trimmed);
        else if (createKind === "mddict") await store.createMddictInSelection(trimmed);
        else if (createKind === "mdhabit") {
          await store.createMdhabitInSelection(trimmed, yearNum);
        } else await store.createMdcourseInSelection(trimmed);
      } catch (e) {
        useVaultStore.setState({
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        onReveal();
      }
    })();
  };

  return (
    <>
      <DialogShell
        open={kind !== null}
        title={copy.title}
        description={copy.description}
        onCancel={onCancel}
        footer={
          <>
            <button type="button" className="app-dialog-btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="app-dialog-btn is-primary"
              disabled={!canSubmit}
              onClick={submit}
            >
              Create
            </button>
          </>
        }
      >
        <div className="app-dialog-body">
          <label className="app-dialog-label" htmlFor={nameId}>
            {kind === "skill" ? "Skill id" : "Name"}
          </label>
          <input
            ref={nameRef}
            id={nameId}
            className="app-dialog-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            spellCheck={false}
            autoComplete="off"
          />
          {kind === "mdhabit" ? (
            <>
              <label className="app-dialog-label" htmlFor={yearId}>
                Year
              </label>
              <input
                id={yearId}
                className="app-dialog-input"
                type="number"
                min={1}
                max={9999}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            </>
          ) : null}
          <span className="app-dialog-label">Folder</span>
          <div className="create-entity-location">
            <span className="create-entity-location-path" title={folder}>
              {folder}
            </span>
            {kind !== "skill" ? (
              <button
                type="button"
                className="create-entity-more"
                aria-label="Choose folder"
                title="Choose folder"
                onClick={() => setPickerOpen(true)}
              >
                <MdMoreHoriz size={18} />
              </button>
            ) : null}
          </div>
          {error ? <p className="create-entity-error">{error}</p> : null}
        </div>
      </DialogShell>
      <VaultFolderBrowseDialog
        open={pickerOpen && kind !== null && kind !== "skill"}
        nested
        hideReserved
        selectedPath={folder}
        onCancel={() => setPickerOpen(false)}
        onChoose={(next) => {
          setFolder(next);
          setPickerOpen(false);
        }}
      />
    </>
  );
}
