import { formatToolbarPath } from "../lib/documentPath";
import { useVaultStore, type ViewMode } from "../store/vaultStore";

const MODES: { mode: ViewMode; label: string }[] = [
  { mode: "live", label: "Live" },
  { mode: "source", label: "Source" },
];

function OutlineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 3.5h10M3 8h7M3 12.5h10"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="1.5" cy="3.5" r="0.85" fill="currentColor" />
      <circle cx="1.5" cy="8" r="0.85" fill="currentColor" />
      <circle cx="1.5" cy="12.5" r="0.85" fill="currentColor" />
    </svg>
  );
}

type Props = {
  /** Show outline toggle in Live mode (markdown only). Default true. */
  showOutlineToggle?: boolean;
};

export function DocumentToolbar({ showOutlineToggle = true }: Props) {
  const activePath = useVaultStore((s) => s.activePath);
  const viewMode = useVaultStore((s) => s.viewMode);
  const setViewMode = useVaultStore((s) => s.setViewMode);
  const showOutline = useVaultStore((s) => s.showOutline);
  const toggleOutline = useVaultStore((s) => s.toggleOutline);

  const pathLabel =
    activePath && !activePath.startsWith("markspace:")
      ? formatToolbarPath(activePath)
      : null;

  return (
    <div className="document-toolbar">
      {pathLabel ? (
        <div className="document-toolbar-path" title={activePath ?? undefined}>
          {pathLabel}
        </div>
      ) : (
        <div className="document-toolbar-path is-empty" />
      )}
      <div className="document-toolbar-actions">
        {showOutlineToggle && viewMode === "live" ? (
          <button
            type="button"
            className={
              showOutline ? "document-toolbar-btn is-active" : "document-toolbar-btn"
            }
            title="Outline"
            aria-label="Toggle outline"
            aria-pressed={showOutline}
            onClick={() => toggleOutline()}
          >
            <OutlineIcon />
          </button>
        ) : null}
        <div
          className="view-mode-switch"
          role="radiogroup"
          aria-label="Editor view mode"
        >
          {MODES.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={viewMode === mode}
              className={[
                "view-mode-switch-segment",
                viewMode === mode ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setViewMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
