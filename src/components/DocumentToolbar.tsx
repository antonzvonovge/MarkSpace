import { useVaultStore, type ViewMode } from "../store/vaultStore";

const MODES: { mode: ViewMode; label: string }[] = [
  { mode: "live", label: "Live" },
  { mode: "source", label: "Source" },
];

export function DocumentToolbar() {
  const viewMode = useVaultStore((s) => s.viewMode);
  const setViewMode = useVaultStore((s) => s.setViewMode);

  return (
    <div className="document-toolbar">
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
  );
}
