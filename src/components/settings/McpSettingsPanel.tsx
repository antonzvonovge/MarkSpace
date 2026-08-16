import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DialogShell } from "../AppDialog";
import {
  DiagramIcon,
  DictionaryIcon,
  HabitTrackerIcon,
  LinksIcon,
  RefreshIcon,
} from "../treeIcons";
import {
  MCP_SPECIALIST_OPTIONS,
  emptyMcpServerConfig,
  isSafeMcpId,
  normalizeMcpServerConfig,
  type McpScope,
  type McpServerConfig,
  type McpServerSnapshot,
  type McpStatus,
  type McpUseIn,
} from "../../ai/mcpTypes";
import { specialistLabel, type SpecialistKind } from "../../ai/toolPacks";
import { useMcpStore } from "../../store/mcpStore";
import { useVaultStore } from "../../store/vaultStore";

function statusLabel(status: McpStatus, toolCount: number): string {
  if (status === "connected") {
    return toolCount === 1 ? "1 tool" : `${toolCount} tools`;
  }
  if (status === "connecting") return "Connecting…";
  if (status === "failed") return "Failed";
  return "Disabled";
}

function recordToLines(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function linesToRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return out;
}

function useInPills(useIn: McpUseIn): string[] {
  if (useIn === "always" || useIn.length === 0) return ["Always"];
  return useIn.map((k) => specialistLabel(k));
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

function ResearchGlyph() {
  return (
    <Glyph>
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M10.2 10.2 13.4 13.4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </Glyph>
  );
}

function EditorGlyph() {
  return (
    <Glyph>
      <path
        d="M3.5 2.75h6.1L12.5 5.6v7.65a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2.85V5.6h2.7M5.4 8.4h5.2M5.4 11h3.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

function TerminalGlyph() {
  return (
    <Glyph>
      <rect
        x="2.25"
        y="3.25"
        width="11.5"
        height="9.5"
        rx="1.6"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M5 7.1 6.7 8.5 5 9.9M8.2 10.1h2.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

function AgentGlyph() {
  return (
    <Glyph>
      <path
        d="M3 3.5h4.5V8H3V3.5Zm5.5 0H13V6H8.5V3.5ZM3 9h4.5v3.5H3V9Zm5.5 2H13v1.5H8.5V11Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M5.25 8v1M10.75 6v5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </Glyph>
  );
}

function CommandGlyph() {
  return (
    <Glyph>
      <path
        d="M4.2 5.4 6.6 8 4.2 10.6M8.2 10.8h3.6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

function UrlGlyph() {
  return (
    <Glyph>
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M3 8h10M8 2.75c1.5 1.7 2.25 3.4 2.25 5.25S9.5 11.55 8 13.25M8 2.75C6.5 4.45 5.75 6.15 5.75 8S6.5 11.55 8 13.25"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </Glyph>
  );
}

function CheckGlyph() {
  return (
    <Glyph>
      <path
        d="M3.6 8.2 6.4 11 12.4 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

function SpecialistGlyph({ kind }: { kind: SpecialistKind }) {
  switch (kind) {
    case "research":
      return <ResearchGlyph />;
    case "edit_notes":
      return <EditorGlyph />;
    case "diagram":
      return <DiagramIcon />;
    case "links":
      return <LinksIcon />;
    case "dict":
      return <DictionaryIcon />;
    case "habits":
      return <HabitTrackerIcon />;
    case "terminal":
      return <TerminalGlyph />;
  }
}

function ChoiceCard({
  selected,
  title,
  description,
  icon,
  onClick,
}: {
  selected: boolean;
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`mcp-choice-card${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="mcp-choice-card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="mcp-choice-card-copy">
        <span className="mcp-choice-card-title">{title}</span>
        <span className="mcp-choice-card-desc">{description}</span>
      </span>
    </button>
  );
}

function McpSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className={`mcp-switch${checked ? " is-on" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="mcp-switch-track" aria-hidden="true">
        <span className="mcp-switch-thumb" />
      </span>
    </label>
  );
}

function McpServerRow({
  snapshot,
  onEdit,
  onRemove,
  onToggle,
  onReload,
  reloading,
}: {
  snapshot: McpServerSnapshot;
  onEdit: () => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
  onReload: () => void;
  reloading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const transport = snapshot.url?.trim()
    ? snapshot.url
    : [snapshot.command, ...(snapshot.args ?? [])].filter(Boolean).join(" ");
  const pills = useInPills(snapshot.useIn);

  return (
    <li className={`mcp-server-row is-${snapshot.status}`}>
      <div className="mcp-server-row-main">
        <button
          type="button"
          className="mcp-server-expand"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`mcp-status-dot is-${snapshot.status}`} />
          <span className="mcp-server-copy">
            <span className="mcp-server-name">{snapshot.id}</span>
            <span className="mcp-server-pills">
              <span className="mcp-pill">
                {snapshot.scope === "vault" ? "Vault" : "Machine"}
              </span>
              {pills.slice(0, 2).map((pill) => (
                <span key={pill} className="mcp-pill is-use">
                  {pill}
                </span>
              ))}
              {pills.length > 2 ? (
                <span className="mcp-pill is-use">+{pills.length - 2}</span>
              ) : null}
            </span>
          </span>
          <span className="mcp-server-meta">
            {statusLabel(snapshot.status, snapshot.tools.length)}
          </span>
        </button>
        <McpSwitch
          checked={snapshot.enabled}
          label={`Enable ${snapshot.id}`}
          onChange={onToggle}
        />
        <button
          type="button"
          className="tree-toolbar-btn"
          title="Reload this server"
          aria-label={`Reload ${snapshot.id}`}
          disabled={reloading || !snapshot.enabled}
          onClick={() => onReload()}
        >
          <RefreshIcon spinning={reloading} />
        </button>
      </div>
      {snapshot.status === "failed" && snapshot.error ? (
        <p className="mcp-server-error" role="alert">
          {snapshot.error}
        </p>
      ) : null}
      {open ? (
        <div className="mcp-server-details">
          <p className="mcp-server-detail-line">
            <span className="mcp-detail-label">Transport</span>
            <span>{transport || "—"}</span>
          </p>
          {snapshot.tools.length > 0 ? (
            <div className="mcp-tool-chips">
              {snapshot.tools.map((tool) => (
                <span
                  key={tool.name}
                  className="mcp-tool-chip"
                  title={tool.description || tool.name}
                >
                  {tool.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="sync-block-desc">No tools listed.</p>
          )}
          <div className="mcp-server-actions">
            <button type="button" className="app-dialog-btn" onClick={onEdit}>
              Edit
            </button>
            <button
              type="button"
              className="app-dialog-btn is-danger"
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

type Draft = {
  id: string;
  enabled: boolean;
  transport: "command" | "url";
  command: string;
  argsText: string;
  url: string;
  envText: string;
  headersText: string;
  useAlways: boolean;
  specialists: SpecialistKind[];
};

function configToDraft(cfg: McpServerConfig): Draft {
  return {
    id: cfg.id,
    enabled: cfg.enabled,
    transport: cfg.url?.trim() && !cfg.command?.trim() ? "url" : "command",
    command: cfg.command ?? "",
    argsText: (cfg.args ?? []).join("\n"),
    url: cfg.url ?? "",
    envText: recordToLines(cfg.env ?? {}),
    headersText: recordToLines(cfg.headers ?? {}),
    useAlways: cfg.useIn === "always",
    specialists: cfg.useIn === "always" ? [] : [...cfg.useIn],
  };
}

function draftToConfig(draft: Draft): McpServerConfig | null {
  const args = draft.argsText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const raw: Partial<McpServerConfig> = {
    id: draft.id.trim(),
    enabled: draft.enabled,
    useIn: draft.useAlways
      ? "always"
      : draft.specialists.length > 0
        ? draft.specialists
        : "always",
    command: draft.transport === "command" ? draft.command.trim() : "",
    args: draft.transport === "command" ? args : [],
    url: draft.transport === "url" ? draft.url.trim() : "",
    env: linesToRecord(draft.envText),
    headers: linesToRecord(draft.headersText),
  };
  return normalizeMcpServerConfig(raw);
}

function McpServerDialog({
  open,
  title,
  initial,
  existingIds,
  onCancel,
  onSave,
}: {
  open: boolean;
  title: string;
  initial: McpServerConfig;
  existingIds: string[];
  onCancel: () => void;
  onSave: (cfg: McpServerConfig) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => configToDraft(initial));

  useEffect(() => {
    if (open) setDraft(configToDraft(initial));
  }, [open, initial]);

  const taken = new Set(
    existingIds
      .map((id) => id.trim().toLowerCase())
      .filter((id) => id && id !== initial.id.trim().toLowerCase()),
  );
  const idKey = draft.id.trim().toLowerCase();
  const idOk = isSafeMcpId(draft.id);
  const duplicate = Boolean(idKey) && taken.has(idKey);
  const hasTransport =
    draft.transport === "url"
      ? Boolean(draft.url.trim())
      : Boolean(draft.command.trim());
  const specialistsOk = draft.useAlways || draft.specialists.length > 0;
  const canSave = idOk && !duplicate && hasTransport && specialistsOk;

  const toggleKind = (kind: SpecialistKind) => {
    setDraft((prev) => {
      const has = prev.specialists.includes(kind);
      return {
        ...prev,
        specialists: has
          ? prev.specialists.filter((k) => k !== kind)
          : [...prev.specialists, kind],
      };
    });
  };

  return (
    <DialogShell
      open={open}
      title={title}
      description="Only connected servers are sent to the model."
      wide
      className="is-mcp"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={!canSave}
            onClick={() => {
              const cfg = draftToConfig(draft);
              if (cfg) onSave(cfg);
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="app-dialog-body">
        <label className="app-dialog-label" htmlFor="mcp-id">
          Name
        </label>
        <input
          id="mcp-id"
          className="app-dialog-input"
          value={draft.id}
          onChange={(e) => setDraft({ ...draft, id: e.target.value })}
          placeholder="github"
          spellCheck={false}
          autoComplete="off"
        />
        {!idOk && draft.id.trim() ? (
          <p className="app-dialog-desc">
            Use letters, numbers, hyphen, or underscore (max 64).
          </p>
        ) : null}
        {duplicate ? (
          <p className="app-dialog-desc">A server with this name already exists.</p>
        ) : null}

        <span className="app-dialog-label">How it connects</span>
        <div className="mcp-choice-grid" role="group" aria-label="Transport">
          <ChoiceCard
            selected={draft.transport === "command"}
            title="Command"
            description="Local stdio process"
            icon={<CommandGlyph />}
            onClick={() => setDraft({ ...draft, transport: "command" })}
          />
          <ChoiceCard
            selected={draft.transport === "url"}
            title="URL"
            description="Streamable HTTP"
            icon={<UrlGlyph />}
            onClick={() => setDraft({ ...draft, transport: "url" })}
          />
        </div>

        {draft.transport === "command" ? (
          <>
            <label className="app-dialog-label" htmlFor="mcp-command">
              Command
            </label>
            <input
              id="mcp-command"
              className="app-dialog-input"
              value={draft.command}
              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              placeholder="npx"
              spellCheck={false}
              autoComplete="off"
            />
            <label className="app-dialog-label" htmlFor="mcp-args">
              Arguments (one per line)
            </label>
            <textarea
              id="mcp-args"
              className="app-dialog-input app-dialog-textarea mcp-dialog-textarea"
              rows={3}
              value={draft.argsText}
              onChange={(e) => setDraft({ ...draft, argsText: e.target.value })}
              placeholder={"-y\n@modelcontextprotocol/server-github"}
              spellCheck={false}
            />
            <label className="app-dialog-label" htmlFor="mcp-env">
              Environment (KEY=value)
            </label>
            <textarea
              id="mcp-env"
              className="app-dialog-input app-dialog-textarea mcp-dialog-textarea"
              rows={3}
              value={draft.envText}
              onChange={(e) => setDraft({ ...draft, envText: e.target.value })}
              spellCheck={false}
            />
          </>
        ) : (
          <>
            <label className="app-dialog-label" htmlFor="mcp-url">
              URL
            </label>
            <input
              id="mcp-url"
              className="app-dialog-input"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="https://example.com/mcp"
              spellCheck={false}
              autoComplete="off"
            />
            <label className="app-dialog-label" htmlFor="mcp-headers">
              Headers (Name=value)
            </label>
            <textarea
              id="mcp-headers"
              className="app-dialog-input app-dialog-textarea mcp-dialog-textarea"
              rows={3}
              value={draft.headersText}
              onChange={(e) =>
                setDraft({ ...draft, headersText: e.target.value })
              }
              placeholder="Authorization=Bearer …"
              spellCheck={false}
            />
          </>
        )}

        <span className="app-dialog-label">Use in</span>
        <div className="mcp-choice-grid" role="group" aria-label="Use in">
          <ChoiceCard
            selected={draft.useAlways}
            title="Always"
            description="Parent Agent can call these tools"
            icon={<AgentGlyph />}
            onClick={() => setDraft({ ...draft, useAlways: true })}
          />
          <ChoiceCard
            selected={!draft.useAlways}
            title="Specialists"
            description="Only the workers you pick below"
            icon={<CheckGlyph />}
            onClick={() => setDraft({ ...draft, useAlways: false })}
          />
        </div>

        {!draft.useAlways ? (
          <>
            <div
              className="mcp-specialist-tiles"
              role="group"
              aria-label="Specialists"
            >
              {MCP_SPECIALIST_OPTIONS.map((opt) => {
                const on = draft.specialists.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`mcp-specialist-tile${on ? " is-selected" : ""}`}
                    aria-pressed={on}
                    onClick={() => toggleKind(opt.value)}
                  >
                    <span className="mcp-specialist-tile-icon" aria-hidden="true">
                      <SpecialistGlyph kind={opt.value} />
                    </span>
                    <span className="mcp-specialist-tile-label">{opt.label}</span>
                  </button>
                );
              })}
            </div>
            {!specialistsOk ? (
              <p className="mcp-dialog-hint">Pick at least one specialist.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </DialogShell>
  );
}

export function McpSettingsPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const globalServers = useMcpStore((s) => s.globalServers);
  const vaultServers = useMcpStore((s) => s.vaultServers);
  const snapshots = useMcpStore((s) => s.snapshots);
  const reloading = useMcpStore((s) => s.reloading);
  const reloadingId = useMcpStore((s) => s.reloadingId);
  const hydrated = useMcpStore((s) => s.hydrated);
  const setGlobalServers = useMcpStore((s) => s.setGlobalServers);
  const setVaultServers = useMcpStore((s) => s.setVaultServers);
  const reloadAll = useMcpStore((s) => s.reloadAll);
  const reloadServer = useMcpStore((s) => s.reloadServer);
  const hydrate = useMcpStore((s) => s.hydrate);
  const hydrateForVault = useMcpStore((s) => s.hydrateForVault);

  const [dialog, setDialog] = useState<{
    scope: McpScope;
    initial: McpServerConfig;
    replaceId?: string;
  } | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    void hydrateForVault(vaultPath);
  }, [vaultPath, hydrated, hydrateForVault]);

  const byId = useMemo(() => {
    const map = new Map<string, McpServerSnapshot>();
    for (const snap of snapshots) map.set(`${snap.scope}:${snap.id}`, snap);
    return map;
  }, [snapshots]);

  const vaultIds = useMemo(
    () => new Set(vaultServers.map((s) => s.id)),
    [vaultServers],
  );

  const globalSnapshots = useMemo(() => {
    return globalServers.map((cfg) => {
      const live = byId.get(`global:${cfg.id}`);
      if (live) return live;
      if (vaultIds.has(cfg.id)) {
        return {
          ...cfg,
          scope: "global" as const,
          status: "disabled" as const,
          error: "Overridden by a vault server with the same name",
          tools: [],
        };
      }
      return {
        ...cfg,
        scope: "global" as const,
        status: cfg.enabled ? ("connecting" as const) : ("disabled" as const),
        tools: [],
      };
    });
  }, [globalServers, byId, vaultIds]);

  const vaultSnapshots = useMemo(() => {
    return vaultServers.map((cfg) => {
      const live = byId.get(`vault:${cfg.id}`);
      return (
        live ?? {
          ...cfg,
          scope: "vault" as const,
          status: cfg.enabled ? ("connecting" as const) : ("disabled" as const),
          tools: [],
        }
      );
    });
  }, [vaultServers, byId]);

  const upsert = async (
    scope: McpScope,
    next: McpServerConfig,
    replaceId?: string,
  ) => {
    const list = scope === "global" ? [...globalServers] : [...vaultServers];
    const idx = list.findIndex((s) => s.id === (replaceId ?? next.id));
    if (idx >= 0) list[idx] = next;
    else list.push(next);
    if (replaceId && replaceId !== next.id) {
      const old = list.findIndex((s) => s.id === replaceId && s.id !== next.id);
      if (old >= 0) list.splice(old, 1);
    }
    if (scope === "global") await setGlobalServers(list);
    else await setVaultServers(list);
  };

  const remove = async (scope: McpScope, id: string) => {
    if (scope === "global") {
      await setGlobalServers(globalServers.filter((s) => s.id !== id));
    } else {
      await setVaultServers(vaultServers.filter((s) => s.id !== id));
    }
  };

  const toggle = async (scope: McpScope, id: string, enabled: boolean) => {
    const list = (scope === "global" ? globalServers : vaultServers).map(
      (s) => (s.id === id ? { ...s, enabled } : s),
    );
    if (scope === "global") await setGlobalServers(list);
    else await setVaultServers(list);
  };

  const existingIds = [
    ...globalServers.map((s) => s.id),
    ...vaultServers.map((s) => s.id),
  ];

  return (
    <div className="sync-panel mcp-panel">
      <div className="mcp-panel-header">
        <p className="sync-panel-lead">
          Connect MCP servers so Agent can call their tools. Only connected
          servers are sent to the model. Vault servers override a machine server
          with the same name.
        </p>
        <button
          type="button"
          className="tree-toolbar-btn"
          title="Reload MCP servers"
          aria-label="Reload MCP servers"
          disabled={reloading}
          onClick={() => void reloadAll()}
        >
          <RefreshIcon spinning={reloading} />
        </button>
      </div>

      <section className="sync-block">
        <div className="mcp-section-title-row">
          <h3 className="sync-block-title">This machine</h3>
          <button
            type="button"
            className="app-dialog-btn"
            onClick={() =>
              setDialog({
                scope: "global",
                initial: emptyMcpServerConfig(),
              })
            }
          >
            Add MCP server
          </button>
        </div>
        <p className="sync-block-desc">
          Stored on this computer (not in the vault). Use for tokens and local
          stdio commands.
        </p>
        {globalSnapshots.length === 0 ? (
          <p className="sync-block-desc">No machine MCP servers yet.</p>
        ) : (
          <ul className="mcp-server-list">
            {globalSnapshots.map((snap) => (
              <McpServerRow
                key={`global:${snap.id}`}
                snapshot={snap}
                reloading={reloading || reloadingId === snap.id}
                onEdit={() =>
                  setDialog({
                    scope: "global",
                    initial: snap,
                    replaceId: snap.id,
                  })
                }
                onRemove={() => void remove("global", snap.id)}
                onToggle={(enabled) => void toggle("global", snap.id, enabled)}
                onReload={() => void reloadServer(snap.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="sync-block">
        <div className="mcp-section-title-row">
          <h3 className="sync-block-title">This vault</h3>
          <button
            type="button"
            className="app-dialog-btn"
            disabled={!vaultPath}
            onClick={() =>
              setDialog({
                scope: "vault",
                initial: emptyMcpServerConfig(),
              })
            }
          >
            Add MCP server
          </button>
        </div>
        {vaultPath ? (
          <>
            <p className="sync-block-desc">
              Saved in <code>.markspace/mcp.json</code>. Environment values and
              headers will sync with the vault (including GitHub Sync).
            </p>
            {vaultSnapshots.length === 0 ? (
              <p className="sync-block-desc">No vault MCP servers yet.</p>
            ) : (
              <ul className="mcp-server-list">
                {vaultSnapshots.map((snap) => (
                  <McpServerRow
                    key={`vault:${snap.id}`}
                    snapshot={snap}
                    reloading={reloading || reloadingId === snap.id}
                    onEdit={() =>
                      setDialog({
                        scope: "vault",
                        initial: snap,
                        replaceId: snap.id,
                      })
                    }
                    onRemove={() => void remove("vault", snap.id)}
                    onToggle={(enabled) =>
                      void toggle("vault", snap.id, enabled)
                    }
                    onReload={() => void reloadServer(snap.id)}
                  />
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="sync-block-desc">Open a vault to add vault MCP servers.</p>
        )}
      </section>

      {dialog ? (
        <McpServerDialog
          open
          title={dialog.replaceId ? "Edit MCP server" : "Add MCP server"}
          initial={dialog.initial}
          existingIds={existingIds}
          onCancel={() => setDialog(null)}
          onSave={(cfg) => {
            void upsert(dialog.scope, cfg, dialog.replaceId).then(() =>
              setDialog(null),
            );
          }}
        />
      ) : null}
    </div>
  );
}
