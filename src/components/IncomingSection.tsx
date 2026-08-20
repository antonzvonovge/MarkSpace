import { INCOMING_TAB_PATH, isIncomingTab, useVaultStore } from "../store/vaultStore";
import { IncomingSectionIcon } from "./treeIcons";

export function IncomingSection() {
  const activePath = useVaultStore((s) => s.activePath);
  const tabs = useVaultStore((s) => s.tabs);
  const openIncomingTab = useVaultStore((s) => s.openIncomingTab);
  const activeTab = tabs.find((t) => t.path === activePath);
  const active =
    activePath === INCOMING_TAB_PATH ||
    Boolean(activeTab && isIncomingTab(activeTab));

  return (
    <div className="incoming-section">
      <button
        type="button"
        className={
          active ? "incoming-section-btn is-active" : "incoming-section-btn"
        }
        aria-current={active ? "page" : undefined}
        onClick={() => {
          void openIncomingTab();
        }}
      >
        <span className="incoming-section-icon" aria-hidden>
          <IncomingSectionIcon />
        </span>
        <span>Incoming</span>
      </button>
    </div>
  );
}
