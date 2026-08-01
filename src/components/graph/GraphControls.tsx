export type GraphControlsProps = {
  query: string;
  onQueryChange: (q: string) => void;
  onSearchSubmit: () => void;
  running: boolean;
  onToggleLayout: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  projects: { path: string; name: string }[];
  projectPath: string | null;
  onProjectPathChange: (path: string | null) => void;
  tagsOnly: boolean;
  onTagsOnlyChange: (v: boolean) => void;
  showUntagged: boolean;
  onShowUntaggedChange: (v: boolean) => void;
  labelThreshold: number;
  onLabelThresholdChange: (v: number) => void;
  gravity: number;
  onGravityChange: (v: number) => void;
  focusRoot: string | null;
  onClearFocus: () => void;
  nodeCount: number;
  edgeCount: number;
};

export function GraphControls({
  query,
  onQueryChange,
  onSearchSubmit,
  running,
  onToggleLayout,
  onZoomIn,
  onZoomOut,
  onFit,
  projects,
  projectPath,
  onProjectPathChange,
  tagsOnly,
  onTagsOnlyChange,
  showUntagged,
  onShowUntaggedChange,
  labelThreshold,
  onLabelThresholdChange,
  gravity,
  onGravityChange,
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
          placeholder="Search tags and notes…"
          aria-label="Search tags and notes"
        />
      </form>

      <label className="tag-graph-project">
        <span>Project</span>
        <select
          value={projectPath ?? ""}
          onChange={(e) => onProjectPathChange(e.target.value || null)}
          aria-label="Filter graph by project"
        >
          <option value="">Entire vault</option>
          {projects.map((project) => (
            <option key={project.path} value={project.path}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <div className="tag-graph-btn-row">
        <button
          type="button"
          className="tag-graph-btn"
          title={running ? "Pause layout" : "Resume layout"}
          aria-pressed={running}
          onClick={onToggleLayout}
        >
          {running ? "Pause" : "Resume"}
        </button>
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
          checked={tagsOnly}
          onChange={(e) => onTagsOnlyChange(e.target.checked)}
        />
        <span>Tags only</span>
      </label>

      <label className="tag-graph-toggle">
        <input
          type="checkbox"
          checked={showUntagged}
          disabled={tagsOnly}
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
        <span>Gravity</span>
        <input
          type="range"
          min={0.2}
          max={4}
          step={0.1}
          value={gravity}
          onChange={(e) => onGravityChange(Number(e.target.value))}
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
