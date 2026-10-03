import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SettingTwo } from "@icon-park/react";
import brandLogo from "../assets/m.png";
import { FileTree, type FileTreeHandle } from "./FileTree";
import { SidebarPaneTabs } from "./sidebar/SidebarPaneTabs";
import { SidebarCreateButton } from "./sidebar/SidebarCreateButton";
import { emptySidebarCreateParent } from "./sidebar/emptyCreateParent";
import { DashboardsSection } from "./DashboardsSection";
import { RoutinesSection } from "./RoutinesSection";
import { TasksSection } from "./TasksSection";
import {
  SidebarCalendar,
} from "./SidebarCalendar";
import { loadLastVault, saveLastVault } from "../lib/settingsStore";
import { pickAndOpenVault } from "../lib/pickVault";
import { usePrefsStore } from "../store/prefsStore";
import { useSidebarUiStore } from "../store/sidebarUiStore";
import { useVaultStore } from "../store/vaultStore";
import {
  SIDEBAR_MIN_WIDTH,
  clampTagFilesWidth,
  TagFileSlotContext,
} from "./sidebar/tagFileSlot";

export { loadLastVault, saveLastVault };

const brandSettingsIcon = {
  theme: "two-tone" as const,
  size: 18,
  strokeWidth: 3,
  fill: ["var(--pane-icon-stroke)", "var(--pane-icon-fill)"] as [string, string],
};

export const Sidebar = memo(function Sidebar() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const toggleSettings = usePrefsStore((s) => s.toggleSettings);
  const calendarOpen = useSidebarUiStore((s) => s.calendarOpen);
  const setCalendarOpen = useSidebarUiStore((s) => s.setCalendarOpen);
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
            <button
              type="button"
              className="brand-settings-btn"
              aria-label="Settings"
              title="Settings (Ctrl+,)"
              onClick={() => toggleSettings()}
            >
              <SettingTwo {...brandSettingsIcon} />
            </button>
            {vaultPath ? null : (
              <button
                type="button"
                className="brand-open-vault"
                onClick={() => void pickAndOpenVault()}
              >
                Open vault…
              </button>
            )}
          </div>
          {vaultPath ? (
            <SidebarCreateButton
              onCreated={() => fileTreeRef.current?.revealActive()}
            />
          ) : null}
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
            {vaultPath && calendarOpen ? <SidebarCalendar /> : null}
            {vaultPath ? (
              <footer className="sidebar-footer">
                <SidebarPaneTabs />
              </footer>
            ) : null}
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
    </aside>
    </TagFileSlotContext.Provider>
  );
});
