import { useEffect, useMemo, useState } from "react";
import type { AgentMemoryEntry } from "../../lib/vaultApi";
import { useAgentMemoryStore } from "../../store/agentMemoryStore";
import { useVaultStore } from "../../store/vaultStore";
import { Select } from "../ui/Select";

const GLOBAL_SCOPE = "__global__";

export function MemorySettingsPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tree = useVaultStore((s) => s.tree);
  const doc = useAgentMemoryStore((s) => s.doc);
  const hydrateMemory = useAgentMemoryStore((s) => s.hydrateForVault);
  const setEnabled = useAgentMemoryStore((s) => s.setEnabled);
  const add = useAgentMemoryStore((s) => s.add);
  const update = useAgentMemoryStore((s) => s.update);
  const remove = useAgentMemoryStore((s) => s.remove);
  const clear = useAgentMemoryStore((s) => s.clear);

  const [draftText, setDraftText] = useState("");
  const [draftScope, setDraftScope] = useState(GLOBAL_SCOPE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editScope, setEditScope] = useState(GLOBAL_SCOPE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrateMemory(vaultPath);
  }, [vaultPath, hydrateMemory]);

  const projectOptions = useMemo(() => {
    const roots =
      tree?.children
        ?.filter((c) => c.isDir && c.path && !c.path.includes("/"))
        .map((c) => c.path) ?? [];
    const fromMemories = doc.entries
      .map((e) => e.projectPath)
      .filter((p): p is string => Boolean(p));
    return [...new Set([...roots, ...fromMemories])].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [tree, doc.entries]);

  const scopeOptions = useMemo(
    () => [
      { value: GLOBAL_SCOPE, label: "Global" },
      ...projectOptions.map((p) => ({ value: p, label: `Project: ${p}` })),
    ],
    [projectOptions],
  );

  const grouped = useMemo(() => {
    const global = doc.entries.filter((e) => !e.projectPath);
    const byProject = new Map<string, AgentMemoryEntry[]>();
    for (const entry of doc.entries) {
      if (!entry.projectPath) continue;
      const list = byProject.get(entry.projectPath) ?? [];
      list.push(entry);
      byProject.set(entry.projectPath, list);
    }
    const projects = [...byProject.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return { global, projects };
  }, [doc.entries]);

  if (!vaultPath) {
    return (
      <div className="sync-panel">
        <p className="sync-panel-lead">
          Open a vault to manage agent memory.
        </p>
      </div>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (entry: AgentMemoryEntry) => {
    setEditingId(entry.id);
    setEditText(entry.text);
    setEditScope(entry.projectPath ?? GLOBAL_SCOPE);
  };

  return (
    <div className="sync-panel">
      <p className="sync-panel-lead">
        Durable facts the agent uses across chats in this vault. Stored in{" "}
        <code>.markspace/agent-memory.json</code> and synced with the vault.
        Global memories are personal preferences; project memories apply when
        that project is selected in chat.
      </p>

      <section className="sync-block">
        <label className="agent-memory-toggle">
          <input
            type="checkbox"
            checked={doc.enabled}
            disabled={busy}
            onChange={(e) => void run(() => setEnabled(e.target.checked))}
          />
          <span>Use memory</span>
        </label>

        {error && <p className="embedding-model-error">{error}</p>}

        <div className="agent-memory-add">
          <textarea
            className="sync-input agent-memory-textarea"
            rows={2}
            value={draftText}
            disabled={busy}
            placeholder="Add a memory…"
            onChange={(e) => setDraftText(e.target.value)}
          />
          <div className="agent-memory-add-row">
            <Select
              variant="field"
              value={draftScope}
              options={scopeOptions}
              aria-label="Memory scope"
              disabled={busy}
              onChange={setDraftScope}
            />
            <button
              type="button"
              className="sync-btn sync-btn-primary"
              disabled={busy || !draftText.trim()}
              onClick={() =>
                void run(async () => {
                  await add(
                    draftText.trim(),
                    draftScope === GLOBAL_SCOPE ? null : draftScope,
                  );
                  setDraftText("");
                })
              }
            >
              Add memory
            </button>
          </div>
        </div>

        {doc.entries.length === 0 ? (
          <p className="sync-block-desc">No saved memories yet.</p>
        ) : (
          <div className="agent-memory-groups">
            {grouped.global.length > 0 && (
              <div className="agent-memory-group">
                <div className="agent-memory-group-head">
                  <h4 className="agent-memory-group-title">Global</h4>
                  <button
                    type="button"
                    className="sync-btn"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Clear all global memories? This cannot be undone.",
                        )
                      ) {
                        return;
                      }
                      void run(() => clear("global"));
                    }}
                  >
                    Clear global
                  </button>
                </div>
                <ul className="agent-memory-list">
                  {grouped.global.map((entry) => (
                    <MemoryRow
                      key={entry.id}
                      entry={entry}
                      editing={editingId === entry.id}
                      editText={editText}
                      editScope={editScope}
                      scopeOptions={scopeOptions}
                      busy={busy}
                      onEditText={setEditText}
                      onEditScope={setEditScope}
                      onStartEdit={() => startEdit(entry)}
                      onCancelEdit={() => setEditingId(null)}
                      onSave={() =>
                        void run(async () => {
                          await update(
                            entry.id,
                            editText.trim(),
                            editScope === GLOBAL_SCOPE ? null : editScope,
                          );
                          setEditingId(null);
                        })
                      }
                      onDelete={() =>
                        void run(async () => {
                          await remove(entry.id);
                          if (editingId === entry.id) setEditingId(null);
                        })
                      }
                    />
                  ))}
                </ul>
              </div>
            )}

            {grouped.projects.map(([project, entries]) => (
              <div key={project} className="agent-memory-group">
                <div className="agent-memory-group-head">
                  <h4 className="agent-memory-group-title">
                    Project: {project}
                  </h4>
                  <button
                    type="button"
                    className="sync-btn"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Clear all memories for project “${project}”? This cannot be undone.`,
                        )
                      ) {
                        return;
                      }
                      void run(() => clear("project", project));
                    }}
                  >
                    Clear project
                  </button>
                </div>
                <ul className="agent-memory-list">
                  {entries.map((entry) => (
                    <MemoryRow
                      key={entry.id}
                      entry={entry}
                      editing={editingId === entry.id}
                      editText={editText}
                      editScope={editScope}
                      scopeOptions={scopeOptions}
                      busy={busy}
                      onEditText={setEditText}
                      onEditScope={setEditScope}
                      onStartEdit={() => startEdit(entry)}
                      onCancelEdit={() => setEditingId(null)}
                      onSave={() =>
                        void run(async () => {
                          await update(
                            entry.id,
                            editText.trim(),
                            editScope === GLOBAL_SCOPE ? null : editScope,
                          );
                          setEditingId(null);
                        })
                      }
                      onDelete={() =>
                        void run(async () => {
                          await remove(entry.id);
                          if (editingId === entry.id) setEditingId(null);
                        })
                      }
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {doc.entries.length > 0 && (
          <div className="sync-actions">
            <button
              type="button"
              className="sync-btn"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    "Clear all agent memories in this vault? This cannot be undone.",
                  )
                ) {
                  return;
                }
                void run(() => clear("all"));
              }}
            >
              Clear all
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function MemoryRow(props: {
  entry: AgentMemoryEntry;
  editing: boolean;
  editText: string;
  editScope: string;
  scopeOptions: { value: string; label: string }[];
  busy: boolean;
  onEditText: (v: string) => void;
  onEditScope: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const {
    entry,
    editing,
    editText,
    editScope,
    scopeOptions,
    busy,
    onEditText,
    onEditScope,
    onStartEdit,
    onCancelEdit,
    onSave,
    onDelete,
  } = props;

  if (editing) {
    return (
      <li className="agent-memory-item is-editing">
        <textarea
          className="sync-input agent-memory-textarea"
          rows={2}
          value={editText}
          disabled={busy}
          onChange={(e) => onEditText(e.target.value)}
        />
        <div className="agent-memory-add-row">
          <Select
            variant="field"
            value={editScope}
            options={scopeOptions}
            aria-label="Memory scope"
            disabled={busy}
            onChange={onEditScope}
          />
          <button
            type="button"
            className="sync-btn sync-btn-primary"
            disabled={busy || !editText.trim()}
            onClick={onSave}
          >
            Save
          </button>
          <button
            type="button"
            className="sync-btn"
            disabled={busy}
            onClick={onCancelEdit}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="agent-memory-item">
      <p className="agent-memory-text">{entry.text}</p>
      <div className="agent-memory-item-actions">
        <button
          type="button"
          className="sync-btn"
          disabled={busy}
          onClick={onStartEdit}
        >
          Edit
        </button>
        <button
          type="button"
          className="sync-btn"
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
