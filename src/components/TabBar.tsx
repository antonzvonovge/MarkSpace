import { useVaultStore, tabLabel, type EditorTab } from "../store/vaultStore";

function TabItem({ tab }: { tab: EditorTab }) {
  const activePath = useVaultStore((s) => s.activePath);
  const openNote = useVaultStore((s) => s.openNote);
  const pinTab = useVaultStore((s) => s.pinTab);
  const closeTab = useVaultStore((s) => s.closeTab);

  const active = activePath === tab.path;

  return (
    <div
      className={[
        "editor-tab",
        active ? "is-active" : "",
        tab.preview ? "is-preview" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={tab.path}
      onMouseDown={(e) => {
        if (e.detail > 1) e.preventDefault();
      }}
      onClick={() => void openNote(tab.path, { preview: tab.preview })}
      onDoubleClick={(e) => {
        e.preventDefault();
        pinTab(tab.path);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          void closeTab(tab.path);
        }
      }}
      role="tab"
      aria-selected={active}
    >
      <span className="editor-tab-label">{tabLabel(tab.path)}</span>
      <button
        type="button"
        className="editor-tab-close"
        title="Close"
        aria-label={`Close ${tabLabel(tab.path)}`}
        onClick={(e) => {
          e.stopPropagation();
          void closeTab(tab.path);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 8.707l3.646 3.647.708-.708L8.707 8l3.647-3.646-.708-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z"
          />
        </svg>
      </button>
    </div>
  );
}

export function TabBar() {
  const tabs = useVaultStore((s) => s.tabs);
  if (!tabs.length) return null;

  return (
    <div className="editor-tabbar" role="tablist">
      {tabs.map((tab) => (
        <TabItem key={tab.path} tab={tab} />
      ))}
    </div>
  );
}
