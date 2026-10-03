import { open } from "@tauri-apps/plugin-dialog";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import brandLogo from "../assets/m.png";
import { FileTree, type FileTreeHandle } from "./FileTree";
import { SidebarCreateButton } from "./sidebar/SidebarCreateButton";
import { emptySidebarCreateParent } from "./sidebar/emptyCreateParent";
import { DashboardsSection } from "./DashboardsSection";
import { RoutinesSection } from "./RoutinesSection";
import { TasksSection } from "./TasksSection";
import {
  CalendarCheckIcon,
  SidebarCalendar,
} from "./SidebarCalendar";
import { loadLastVault, saveLastVault } from "../lib/settingsStore";
import { usePrefsStore, useSettingsTabActive } from "../store/prefsStore";
import { useSidebarUiStore } from "../store/sidebarUiStore";
import { useVaultStore } from "../store/vaultStore";
import {
  SIDEBAR_MIN_WIDTH,
  clampTagFilesWidth,
  TagFileSlotContext,
} from "./sidebar/tagFileSlot";

export { loadLastVault, saveLastVault };

function SettingsGearIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6.5 1.5h3l.35 1.4a4.5 4.5 0 0 1 1.35.78l1.4-.35 1.5 2.6-1.05 1a4.6 4.6 0 0 1 0 1.56l1.05 1-1.5 2.6-1.4-.35a4.5 4.5 0 0 1-1.35.78L9.5 14.5h-3l-.35-1.4a4.5 4.5 0 0 1-1.35-.78l-1.4.35-1.5-2.6 1.05-1a4.6 4.6 0 0 1 0-1.56l-1.05-1 1.5-2.6 1.4.35a4.5 4.5 0 0 1 1.35-.78L6.5 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export const Sidebar = memo(function Sidebar() {
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const settingsActive = useSettingsTabActive();
  const toggleSettings = usePrefsStore((s) => s.toggleSettings);
  const calendarOpen = useSidebarUiStore((s) => s.calendarOpen);
  const setCalendarOpen = useSidebarUiStore((s) => s.setCalendarOpen);
  const toggleCalendar = useSidebarUiStore((s) => s.toggleCalendar);
  const fileTreeRef = useRef<FileTreeHandle>(null);
  const [tagFileSlot, setTagFileSlot] = useState<HTMLDivElement | null>(null);
  const tagFilesOpen = useSidebarUiStore(
    (s) =>
      s.open && s.sidebarPane === "tags" && s.selectedTagPath != null,
  );
  const tagFilesWidth = useSidebarUiStore((s) => s.tagFilesWidth);
  const setTagFilesWidth = useSidebarUiStore((s) => s.setTagFilesWidth);
  const asideRef = useRef<HTMLElement | null>(null);
  const [primaryWidth, setPrimaryWidth] = useState<number | null>(null);
  /**
   * Pixel width of the primary column while the shell grows or shrinks for the
   * tag file list. Without this, the column flexes for a frame and the centered
   * pane switcher jumps.
   */
  const [frozenPrimary, setFrozenPrimary] = useState<number | null>(null);
  const tagFilesOpenRef = useRef(tagFilesOpen);
  const tagFilesWidthRef = useRef(tagFilesWidth);
  const frozenPrimaryRef = useRef<number | null>(null);
  tagFilesWidthRef.current = tagFilesWidth;
  frozenPrimaryRef.current = frozenPrimary;
  if (tagFilesOpen !== tagFilesOpenRef.current) {
    const asideWidth = asideRef.current?.clientWidth ?? null;
    const nextFrozen = tagFilesOpen
      ? (primaryWidth ?? asideWidth)
      : primaryWidth;
    tagFilesOpenRef.current = tagFilesOpen;
    if (nextFrozen != null && nextFrozen !== frozenPrimary) {
      setFrozenPrimary(nextFrozen);
    }
  }

  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = aside.clientWidth;
      if (width <= 0) return;
      const frozen = frozenPrimaryRef.current;
      if (!tagFilesOpenRef.current) {
        if (frozen != null) {
          if (width > frozen + 8) return;
          frozenPrimaryRef.current = null;
          setFrozenPrimary(null);
        }
        setPrimaryWidth(width);
        return;
      }
      const filesWidth = tagFilesWidthRef.current;
      if (frozen != null) {
        if (width < frozen + filesWidth - 1) return;
        frozenPrimaryRef.current = null;
        setFrozenPrimary(null);
      }
      setPrimaryWidth(Math.max(SIDEBAR_MIN_WIDTH, width - filesWidth));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(aside);
    return () => ro.disconnect();
  }, []);
  const fitTagFilesWidth = (width: number) => {
    const aside = asideRef.current?.clientWidth ?? 0;
    const maxByLeft =
      aside > 0 ? Math.max(0, aside - SIDEBAR_MIN_WIDTH) : width;
    return clampTagFilesWidth(Math.min(width, maxByLeft));
  };
  const tasksSection = useMemo(() => <TasksSection />, []);
  const routinesSection = useMemo(() => <RoutinesSection />, []);
  const dashboardsSection = useMemo(() => <DashboardsSection />, []);

  useEffect(() => {
    if (!calendarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCalendarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [calendarOpen, setCalendarOpen]);

  const pickVault = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open MarkSpace vault",
    });
    if (typeof selected === "string") {
      await openVaultAt(selected);
      await saveLastVault(selected);
    }
  };

  return (
    <TagFileSlotContext.Provider value={tagFileSlot}>
    <aside
      ref={asideRef}
      className="sidebar"
      onContextMenu={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest(".tree-row")) return;
        if (el.closest(".routines-row-line")) return;
        if (el.closest(".sidebar-footer")) return;
        if (el.closest(".sidebar-calendar")) return;
        if (el.closest("button")) return;
        if (el.closest(".tree-context-menu")) return;
        if (el.closest(".sidebar-tag-files, .sidebar-tag-split")) return;
        e.preventDefault();
        fileTreeRef.current?.openCreateMenu(
          e.clientX,
          e.clientY,
          emptySidebarCreateParent(
            el,
            useVaultStore.getState().selectedFolderPath,
          ),
        );
      }}
    >
      <div className="sidebar-top">
        <div className="brand-block">
          <div className="brand">
            <img className="brand-logo" src={brandLogo} alt="" />
            <span className="brand-name">MarkSpace</span>
          </div>
          <SidebarCreateButton
            onCreated={() => fileTreeRef.current?.revealActive()}
          />
        </div>

        <div className="sidebar-columns">
          <div
            className="sidebar-primary"
            style={
              frozenPrimary != null
                ? {
                    flex: `0 0 ${frozenPrimary}px`,
                    width: frozenPrimary,
                    maxWidth: frozenPrimary,
                    minWidth: 0,
                  }
                : tagFilesOpen
                  ? { flex: "1 1 0", minWidth: 0 }
                  : undefined
            }
          >
            <FileTree
              ref={fileTreeRef}
              tasksSection={tasksSection}
              routinesSection={routinesSection}
              dashboardsSection={dashboardsSection}
            />
            {calendarOpen && <SidebarCalendar />}
          </div>
          {tagFilesOpen ? (
            <>
              <div
                className="sidebar-tag-split"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize tag list"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  const delta = e.key === "ArrowRight" ? -16 : 16;
                  const next = fitTagFilesWidth(tagFilesWidthRef.current + delta);
                  tagFilesWidthRef.current = next;
                  setTagFilesWidth(next);
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  const startX = e.clientX;
                  const startWidth = tagFilesWidthRef.current;
                  const target = e.currentTarget;
                  target.setPointerCapture(e.pointerId);
                  const move = (ev: PointerEvent) => {
                    const next = fitTagFilesWidth(startWidth + startX - ev.clientX);
                    tagFilesWidthRef.current = next;
                    setTagFilesWidth(next);
                  };
                  const end = (ev: PointerEvent) => {
                    if (target.hasPointerCapture(ev.pointerId)) {
                      target.releasePointerCapture(ev.pointerId);
                    }
                    target.removeEventListener("pointermove", move);
                    target.removeEventListener("pointerup", end);
                    target.removeEventListener("pointercancel", end);
                  };
                  target.addEventListener("pointermove", move);
                  target.addEventListener("pointerup", end);
                  target.addEventListener("pointercancel", end);
                }}
              />
              <div
                className="sidebar-tag-files"
                ref={setTagFileSlot}
                style={{
                  width: tagFilesWidth,
                  flex: `0 0 ${tagFilesWidth}px`,
                  maxWidth: tagFilesWidth,
                }}
              />
            </>
          ) : null}
        </div>
      </div>

      <footer className="sidebar-footer">
        <button
          type="button"
          className="sidebar-footer-open"
          onClick={() => void pickVault()}
        >
          Open vault…
        </button>
        <div className="sidebar-footer-actions">
          <button
            type="button"
            className={
              settingsActive
                ? "sidebar-footer-btn is-active"
                : "sidebar-footer-btn"
            }
            aria-label={settingsActive ? "Close settings" : "Open settings"}
            title="Settings (Ctrl+,)"
            onClick={() => toggleSettings()}
          >
            <SettingsGearIcon />
          </button>
          <button
            type="button"
            className={
              calendarOpen
                ? "sidebar-footer-btn is-active"
                : "sidebar-footer-btn"
            }
            aria-label={calendarOpen ? "Close calendar" : "Open calendar"}
            aria-expanded={calendarOpen}
            title="Calendar"
            onClick={() => toggleCalendar()}
          >
            <CalendarCheckIcon />
          </button>
        </div>
      </footer>
    </aside>
    </TagFileSlotContext.Provider>
  );
});
