import { Select } from "../ui/Select";

export type GraphControlsProps = {
  query: string;
  onQueryChange: (q: string) => void;
  onSearchSubmit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  projects: { path: string; name: string }[];
  projectPath: string | null;
  onProjectPathChange: (path: string | null) => void;
  linksMode: boolean;
  onLinksModeChange: (v: boolean) => void;
  tagsOnly: boolean;
  onTagsOnlyChange: (v: boolean) => void;
  showUntagged: boolean;
  onShowUntaggedChange: (v: boolean) => void;
  labelThreshold: number;
  onLabelThresholdChange: (v: number) => void;
  spread: number;
  onSpreadChange: (v: number) => void;
  focusRoot: string | null;
  onClearFocus: () => void;
  nodeCount: number;
  edgeCount: number;
};

export function GraphControls({
  query,
  onQueryChange,
  onSearchSubmit,
  onZoomIn,
  onZoomOut,
  onFit,
  projects,
  projectPath,
  onProjectPathChange,
  linksMode,
  onLinksModeChange,
  tagsOnly,
  onTagsOnlyChange,
  showUntagged,
  onShowUntaggedChange,
  labelThreshold,
  onLabelThresholdChange,
  spread,
  onSpreadChange,
  focusRoot,
  onClearFocus,
  nodeCount,
  edgeCount,
}: GraphControlsProps) {
  return (
    <div className="tag-graph-controls">
      <form
        className="tag-graph-search"
        onSubmit={(e) => {
          e.preventDefault();
          onSearchSubmit();
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={
            linksMode ? "Search notes…" : "Search tags and notes…"
          }
          aria-label={linksMode ? "Search notes" : "Search tags and notes"}
        />
      </form>

      <label className="tag-graph-project">
        <span>Project</span>
        <Select
          variant="field"
          value={projectPath ?? ""}
          aria-label="Filter graph by project"
          options={[
            { value: "", label: "Entire vault" },
            ...projects.map((project) => ({
              value: project.path,
              label: project.name,
            })),
          ]}
          onChange={(next) => onProjectPathChange(next || null)}
        />
      </label>

      <div className="tag-graph-btn-row">
        <button
          type="button"
          className="tag-graph-btn"
          title="Zoom in"
          onClick={onZoomIn}
        >
          +
        </button>
        <button
          type="button"
          className="tag-graph-btn"
          title="Zoom out"
          onClick={onZoomOut}
        >
          −
        </button>
        <button
          type="button"
          className="tag-graph-btn"
          title="Fit to view"
          onClick={onFit}
        >
          Fit
        </button>
      </div>

      <label className="tag-graph-toggle">
        <input
          type="checkbox"
          checked={linksMode}
          onChange={(e) => onLinksModeChange(e.target.checked)}
        />
        <span>Links</span>
      </label>

      <label className="tag-graph-toggle">
        <input
          type="checkbox"
          checked={tagsOnly}
          disabled={linksMode}
          onChange={(e) => onTagsOnlyChange(e.target.checked)}
        />
        <span>Tags only</span>
      </label>

      <label className="tag-graph-toggle">
        <input
          type="checkbox"
          checked={showUntagged}
          disabled={tagsOnly || linksMode}
          onChange={(e) => onShowUntaggedChange(e.target.checked)}
        />
        <span>Show untagged</span>
      </label>

      <label className="tag-graph-slider">
        <span>Label density</span>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={labelThreshold}
          onChange={(e) => onLabelThresholdChange(Number(e.target.value))}
        />
      </label>

      <label className="tag-graph-slider">
        <span>Spread</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={spread}
          onChange={(e) => onSpreadChange(Number(e.target.value))}
        />
      </label>

      {focusRoot && (
        <button
          type="button"
          className="tag-graph-btn tag-graph-focus-clear"
          onClick={onClearFocus}
        >
          Clear focus
        </button>
      )}

      <div className="tag-graph-stats" aria-live="polite">
        {nodeCount} nodes · {edgeCount} edges
      </div>
    </div>
  );
}
