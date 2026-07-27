import { useVaultStore, tabLabel, type EditorTab } from "../store/vaultStore";

function TabItem({ tab }: { tab: EditorTab }) {
  const activePath = useVaultStore((s) => s.activePath);
  const dirty = useVaultStore((s) => s.dirty);
  const openNote = useVaultStore((s) => s.openNote);
  const pinTab = useVaultStore((s) => s.pinTab);
  const closeTab = useVaultStore((s) => s.closeTab);

  const active = activePath === tab.path;
  const showDirty = active && dirty;

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
      onClick={() => void openNote(tab.path, { preview: tab.preview })}
      onDoubleClick={(e) => {
        e.preventDefault();
        pinTab(tab.path);
      }}
      role="tab"
      aria-selected={active}
    >
      <span className="editor-tab-label">
        {showDirty ? "● " : ""}
        {tabLabel(tab.path)}
      </span>
      <button
        type="button"
        className="editor-tab-close"
        title="Close"
        onClick={(e) => {
          e.stopPropagation();
          void closeTab(tab.path);
        }}
      >
        ×
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
