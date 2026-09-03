import { useEffect, useMemo, useState } from "react";
import {
  MCP_HOST_DEFAULT_PORT,
  mcpHostCursorSnippet,
} from "../../lib/mcpHostSettingsStore";
import { useMcpHostStore } from "../../store/mcpHostStore";
import { useVaultStore } from "../../store/vaultStore";

function HostSwitch({
  checked,
  label,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`mcp-switch${checked ? " is-on" : ""}${disabled ? " is-disabled" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="mcp-switch-track" aria-hidden="true">
        <span className="mcp-switch-thumb" />
      </span>
    </label>
  );
}

export function McpHostSettingsPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const vaultOpen = Boolean(vaultPath);
  const config = useMcpHostStore((s) => s.config);
  const status = useMcpHostStore((s) => s.status);
  const busy = useMcpHostStore((s) => s.busy);
  const hydrated = useMcpHostStore((s) => s.hydrated);
  const hydrate = useMcpHostStore((s) => s.hydrate);
  const setEnabled = useMcpHostStore((s) => s.setEnabled);
  const setPort = useMcpHostStore((s) => s.setPort);
  const regenerateToken = useMcpHostStore((s) => s.regenerateToken);
  const [portDraft, setPortDraft] = useState(String(MCP_HOST_DEFAULT_PORT));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated) setPortDraft(String(config.port));
  }, [hydrated, config.port]);

  const statusText = !vaultOpen
    ? "Open a vault to expose Tasks over MCP"
    : status?.listening
      ? status.bridgeReady
        ? `Listening on ${status.url}`
        : `Listening (waiting for UI bridge)…`
      : config.enabled
        ? status?.error
          ? `Error: ${status.error}`
          : "Starting…"
        : "Stopped";

  const snippetPort = useMemo(() => {
    const n = Number.parseInt(portDraft, 10);
    if (Number.isFinite(n) && n >= 1024 && n <= 65535) return n;
    return config.port;
  }, [portDraft, config.port]);

  const connectionJson = useMemo(
    () => mcpHostCursorSnippet({ ...config, port: snippetPort }),
    [config, snippetPort],
  );

  const commitPort = () => {
    const n = Number.parseInt(portDraft, 10);
    if (!Number.isFinite(n) || n < 1024 || n > 65535) {
      setPortDraft(String(config.port));
      return;
    }
    if (n !== config.port) void setPort(n, vaultOpen);
  };

  return (
    <div className="sync-panel mcp-panel mcp-host-panel">
      <p className="sync-panel-lead">
        Expose MarkSpace Tasks as an MCP server on localhost while the app is
        running. External clients (Cursor, Claude Desktop, …) can create and
        edit tasks over Streamable HTTP.
      </p>

      <section className="sync-block">
        <div className="mcp-section-title-row">
          <h3 className="sync-block-title">Enable host</h3>
          <HostSwitch
            checked={config.enabled}
            disabled={busy || !hydrated}
            onChange={(on) => void setEnabled(on, vaultOpen)}
            label={config.enabled ? "On" : "Off"}
          />
        </div>
        <p className="mcp-host-status" role="status">
          {statusText}
        </p>
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Port</h3>
        <p className="sync-block-desc">
          Local TCP port for the Streamable HTTP endpoint (1024–65535). Default
          is {MCP_HOST_DEFAULT_PORT}.
        </p>
        <label className="app-dialog-label" htmlFor="mcp-host-port">
          Port
        </label>
        <div className="mcp-host-port-row">
          <input
            id="mcp-host-port"
            className="app-dialog-input"
            type="number"
            min={1024}
            max={65535}
            value={portDraft}
            disabled={busy}
            onChange={(e) => setPortDraft(e.target.value)}
            onBlur={commitPort}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
          />
          <button
            type="button"
            className="app-dialog-btn"
            disabled={busy || Number.parseInt(portDraft, 10) === config.port}
            onClick={commitPort}
          >
            Apply
          </button>
        </div>

        <label className="app-dialog-label" htmlFor="mcp-host-snippet">
          Connection JSON (Cursor)
        </label>
        <p className="sync-block-desc">
          Paste into Cursor MCP settings. Uses the port above and the current
          access token.
        </p>
        <textarea
          id="mcp-host-snippet"
          className="app-dialog-input app-dialog-textarea mcp-dialog-textarea mcp-host-snippet"
          readOnly
          value={connectionJson}
          rows={14}
          aria-label="Cursor MCP connection JSON"
        />
        <button
          type="button"
          className="app-dialog-btn"
          onClick={() => {
            void navigator.clipboard.writeText(connectionJson).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Access token</h3>
        <p className="sync-block-desc">
          Clients must send this token as{" "}
          <code>Authorization: Bearer …</code>. Regenerate if it may have been
          shared — then copy the connection JSON again.
        </p>
        <button
          type="button"
          className="app-dialog-btn"
          disabled={busy}
          onClick={() => void regenerateToken(vaultOpen)}
        >
          Regenerate token
        </button>
      </section>
    </div>
  );
}
