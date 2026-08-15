import { open } from "@tauri-apps/plugin-dialog";
import { memo, useEffect, useRef } from "react";
import brandLogo from "../assets/m.png";
import { FileTree, type FileTreeHandle } from "./FileTree";
import {
  CalendarCheckIcon,
  SidebarCalendar,
} from "./SidebarCalendar";
import { loadLastVault, saveLastVault } from "../lib/settingsStore";
import { usePrefsStore, useSettingsTabActive } from "../store/prefsStore";
import { useSidebarUiStore } from "../store/sidebarUiStore";
import { useVaultStore } from "../store/vaultStore";

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
    <aside
      className="sidebar"
      onContextMenu={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest(".tree-row")) return;
        if (el.closest(".sidebar-footer")) return;
        if (el.closest(".sidebar-calendar")) return;
        if (el.closest("button")) return;
        if (el.closest(".tree-context-menu")) return;
        e.preventDefault();
        fileTreeRef.current?.openCreateMenu(e.clientX, e.clientY);
      }}
    >
      <div className="sidebar-top">
        <div className="brand-block">
          <div className="brand">
            <img className="brand-logo" src={brandLogo} alt="" />
            MarkSpace
          </div>
        </div>

        <FileTree ref={fileTreeRef} />
      </div>

      {calendarOpen && <SidebarCalendar />}

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
  );
});
