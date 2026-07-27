import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from "react-resizable-panels";
import { Sidebar, loadLastVault } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { NoteEditor } from "./editor/NoteEditor";
import type { VaultChange } from "./lib/vaultApi";
import { readNote } from "./lib/vaultApi";
import { useVaultStore } from "./store/vaultStore";
import "./App.css";

function App() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const activePath = useVaultStore((s) => s.activePath);
  const content = useVaultStore((s) => s.content);
  const error = useVaultStore((s) => s.error);
  const setContent = useVaultStore((s) => s.setContent);
  const saveActive = useVaultStore((s) => s.saveActive);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const suppressWatchUntil = useVaultStore((s) => s.suppressWatchUntil);
  const timer = useRef<number | null>(null);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "markspace-shell",
    storage: localStorage,
  });

  useEffect(() => {
    void (async () => {
      const last = await loadLastVault();
      if (last) await openVaultAt(last);
    })();
  }, [openVaultAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveActive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<VaultChange>("vault-change", async (event) => {
      if (Date.now() < useVaultStore.getState().suppressWatchUntil) return;
      await refreshTree();
      const { activePath: current, dirty } = useVaultStore.getState();
      if (!current || dirty) return;
      if (
        event.payload.path === current ||
        event.payload.path.endsWith(`/${current}`) ||
        current.endsWith(event.payload.path)
      ) {
        try {
          const next = await readNote(current);
          useVaultStore.setState({ content: next, dirty: false });
        } catch {
          // file may have been deleted
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [refreshTree, suppressWatchUntil]);

  const onEditorChange = (markdown: string) => {
    setContent(markdown);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void saveActive();
    }, 500);
  };

  return (
    <div className="app-shell">
      <UpdateBanner />
      <Group
        className="app-panels"
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <Panel
          id="sidebar"
          className="sidebar-panel"
          defaultSize={280}
          minSize={200}
          maxSize={480}
          groupResizeBehavior="preserve-pixel-size"
        >
          <Sidebar />
        </Panel>

        <Separator className="app-splitter" />

        <Panel id="main" className="main-panel" minSize={360}>
          <main className="main-pane">
            {error && <div className="error-banner">{error}</div>}
            {!vaultPath && (
              <div className="empty-state">
                <h1>MarkSpace</h1>
                <p>
                  Open a local folder as your vault. Notes are plain Markdown — editable here
                  or in VS Code / Cursor.
                </p>
              </div>
            )}
            {vaultPath && !activePath && (
              <div className="empty-state">
                <h1>Select a note</h1>
                <p>Or create one from the sidebar.</p>
              </div>
            )}
            {activePath && (
              <>
                <TabBar />
                <NoteEditor
                  key={activePath}
                  path={activePath}
                  content={content}
                  onChange={onEditorChange}
                />
              </>
            )}
          </main>
        </Panel>
      </Group>
    </div>
  );
}

export default App;
