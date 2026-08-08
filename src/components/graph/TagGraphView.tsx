import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import type { Attributes } from "graphology-types";
import { createNodeBorderProgram } from "@sigma/node-border";
import Sigma from "sigma";
import type { SigmaNodeEventPayload } from "sigma/types";
import { animateNodes } from "sigma/utils";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { circlepack } from "graphology-layout";
import louvain from "graphology-communities-louvain";
import {
  DEFAULT_GRAPH_UI_SETTINGS,
  loadGraphUiSettings,
  saveGraphUiSettings,
  type GraphCameraState,
  type GraphUiSettings,
} from "../../lib/settingsStore";
import type { TagGraphData, TagGraphNode } from "../../lib/tagGraph";
import { listVaultProjects } from "../../lib/vaultApi";
import { vaultProjectRootOf } from "../../lib/diaryNotes";
import { useVaultStore } from "../../store/vaultStore";
import { GraphControls } from "./GraphControls";
import {
  mixColors,
  readGraphTheme,
  scaleAlpha,
  webglAvailable,
  type GraphTheme,
} from "./graphTheme";
import { createNodeLabelRenderers } from "./nodeLabels";
import { useTagGraph } from "./useTagGraph";
import "./TagGraphView.css";

type NodeAttrs = Attributes & {
  label: string;
  size: number;
  color: string;
  kind: "note" | "tag";
  key: string;
  x: number;
  y: number;
  /** Sigma node program key — PDFs use a 1px black border circle. */
  type?: string;
  community?: number;
  untagged?: boolean;
  highlighted?: boolean;
  /** Pinned while dragged: ForceAtlas2 leaves such nodes where they are. */
  fixed?: boolean;
};

function noteNodeType(kind: TagGraphNode["kind"], key: string): string {
  if (kind !== "note") return "circle";
  if (/\.pdf$/i.test(key)) return "pdf";
  return "circle";
}

type EdgeAttrs = Attributes & {
  color: string;
  size: number;
};

/** First paint unfolds the seeded cluster into the settled layout. */
const INTRO_ANIMATION_MS = 900;
/** Focus/filter changes morph the surviving nodes into their new places. */
const FOCUS_ANIMATION_MS = 620;
/** Nodes leaving the view shrink away before the layout re-settles. */
const EXIT_ANIMATION_MS = 180;
/** Re-solve after the spacing slider settles. */
const SPREAD_ANIMATION_MS = 520;
const SPREAD_DEBOUNCE_MS = 140;
/** How long the graph keeps relaxing after a node is dropped. */
const DRAG_SETTLE_MS = 900;
/** Camera glide onto the focused subgraph after a structure change. */
const CAMERA_FOCUS_MS = 500;
const HOVER_FADE_IN_MS = 170;
const HOVER_FADE_OUT_MS = 140;
/** How much of their opacity unrelated items lose at full hover. */
const HOVER_DIM = 0.88;
const EDGE_SIZE = 1.1;

type HoverState = {
  node: string | null;
  neighbors: Set<string>;
  progress: number;
};

type Positions = Record<string, { x: number; y: number }>;

/** Keeps the graph from drifting away; spacing is handled by repulsion. */
const LAYOUT_GRAVITY = 0.85;

/**
 * Slider position (0 … 1) → ForceAtlas2 repulsion. This is the real link
 * length knob: node sizes stay put while the gap between neighbours grows.
 */
function repulsionForSpread(spread: number): number {
  const s = Math.min(1, Math.max(0, spread));
  return 90 * Math.pow(44.4, s);
}

/**
 * ForceAtlas2 settles at a size proportional to √repulsion (and √order).
 * Measured constant for our node sizes; used to warm-start the solver so the
 * iteration budget is spent on the shape rather than on travelling there.
 */
function predictedSpan(order: number, spread: number): number {
  return 3.4 * Math.sqrt(Math.max(1, order) * repulsionForSpread(spread));
}

function fa2Settings(graph: Graph<NodeAttrs, EdgeAttrs>, spread: number) {
  return {
    ...forceAtlas2.inferSettings(graph),
    // Exact repulsion collapses everything into one hairball; Barnes-Hut keeps
    // communities readable and is cheaper.
    barnesHutOptimize: true,
    gravity: LAYOUT_GRAVITY,
    scalingRatio: repulsionForSpread(spread),
    slowDown: 1,
    adjustSizes: true,
  };
}

/** Iteration budget for the off-screen layout pass; small graphs can afford more. */
function layoutIterations(order: number): number {
  if (order > 1200) return 90;
  if (order > 500) return 160;
  if (order > 150) return 260;
  return 400;
}

function nodeSize(node: TagGraphNode): number {
  if (node.kind === "tag") {
    return Math.min(28, 9 + Math.sqrt(Math.max(1, node.degree)) * 3.2);
  }
  return Math.min(17, 6 + Math.sqrt(Math.max(1, node.degree)) * 1.8);
}

/** Non-empty project path → Material hex. */
type ProjectColorMap = Record<string, string>;

function resolveNoteColor(
  key: string,
  untagged: boolean | undefined,
  theme: GraphTheme,
  projectColors: ProjectColorMap,
): string {
  const root = vaultProjectRootOf(key);
  const projectColor = root ? projectColors[root] : undefined;
  if (projectColor) {
    return untagged ? mixColors(projectColor, theme.muted, 0.62) : projectColor;
  }
  return untagged ? theme.noteQuiet : theme.note;
}

function applyThemeColors(
  graph: Graph<NodeAttrs, EdgeAttrs>,
  theme: GraphTheme,
  projectColors: ProjectColorMap,
): void {
  graph.forEachNode((id, attrs) => {
    if (attrs.kind === "tag") {
      graph.setNodeAttribute(id, "color", theme.tag);
    } else {
      graph.setNodeAttribute(
        id,
        "color",
        resolveNoteColor(attrs.key, attrs.untagged, theme, projectColors),
      );
    }
  });
  graph.forEachEdge((id) => {
    graph.setEdgeAttribute(id, "color", theme.edge);
    graph.setEdgeAttribute(id, "size", EDGE_SIZE);
  });
}

/**
 * Sync serializable TagGraphData into a graphology Graph, preserving x/y of
 * surviving nodes so layout does not jump on live refresh.
 */
function syncGraphology(
  graph: Graph<NodeAttrs, EdgeAttrs>,
  data: TagGraphData,
  theme: GraphTheme,
  previousPositions: Map<string, { x: number; y: number }>,
  projectColors: ProjectColorMap,
): void {
  const nextIds = new Set(data.nodes.map((n) => n.id));
  const nextEdgeIds = new Set(data.edges.map((e) => e.id));
  const fresh = new Set<string>();

  for (const id of graph.nodes()) {
    if (!nextIds.has(id)) graph.dropNode(id);
  }
  for (const id of graph.edges()) {
    if (!nextEdgeIds.has(id)) graph.dropEdge(id);
  }

  for (const node of data.nodes) {
    const pos = previousPositions.get(node.id);
    if (!pos) fresh.add(node.id);
    const x = pos?.x ?? (Math.random() - 0.5) * 40;
    const y = pos?.y ?? (Math.random() - 0.5) * 40;
    const type = noteNodeType(node.kind, node.key);
    if (graph.hasNode(node.id)) {
      graph.mergeNodeAttributes(node.id, {
        label: node.label,
        size: nodeSize(node),
        kind: node.kind,
        key: node.key,
        type,
        untagged: Boolean(node.untagged),
      });
    } else {
      graph.addNode(node.id, {
        label: node.label,
        size: nodeSize(node),
        color:
          node.kind === "tag"
            ? theme.tag
            : resolveNoteColor(
                node.key,
                node.untagged,
                theme,
                projectColors,
              ),
        kind: node.kind,
        key: node.key,
        type,
        x,
        y,
        untagged: Boolean(node.untagged),
      });
    }
  }

  for (const edge of data.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    if (graph.hasEdge(edge.id)) continue;
    if (graph.hasEdge(edge.source, edge.target)) continue;
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      color: theme.edge,
      size: EDGE_SIZE,
    });
  }

  // Drop newcomers next to a settled neighbour so a refresh does not fling
  // them in from a random corner before the layout catches up.
  for (const id of fresh) {
    const anchors = graph.neighbors(id).filter((n) => !fresh.has(n));
    if (!anchors.length) continue;
    let x = 0;
    let y = 0;
    for (const anchor of anchors) {
      x += graph.getNodeAttribute(anchor, "x");
      y += graph.getNodeAttribute(anchor, "y");
    }
    graph.mergeNodeAttributes(id, {
      x: x / anchors.length + (Math.random() - 0.5) * 2,
      y: y / anchors.length + (Math.random() - 0.5) * 2,
    });
  }

  try {
    louvain.assign(graph, { nodeCommunityAttribute: "community" });
  } catch {
    /* tiny / empty graphs */
  }
  applyThemeColors(graph, theme, projectColors);
}

/**
 * Merge current coordinates into the running memory. Positions of nodes that
 * a filter dropped are kept, so clearing the filter puts them back where they
 * were instead of throwing them in from a random spot.
 */
function rememberPositions(
  graph: Graph<NodeAttrs, EdgeAttrs>,
  known: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  graph.forEachNode((id, attrs) => {
    known.set(id, { x: attrs.x, y: attrs.y });
  });
  return known;
}

/**
 * The layout lives in a fixed coordinate frame instead of sigma's default
 * "normalize to the current node extent". Without this the renderer rescales
 * every layout back into the viewport, so longer edges would be cancelled out
 * on screen and every node add/remove would jump.
 */
const LAYOUT_FRAME = 1000;
const LAYOUT_BBOX = {
  x: [-LAYOUT_FRAME / 2, LAYOUT_FRAME / 2] as [number, number],
  y: [-LAYOUT_FRAME / 2, LAYOUT_FRAME / 2] as [number, number],
};

/** Re-center a layout on the frame origin, keeping its own scale. */
function centerPositions(positions: Positions): Positions {
  const values = Object.values(positions);
  if (!values.length) return positions;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of values) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const out: Positions = {};
  for (const [id, p] of Object.entries(positions)) {
    out[id] = { x: p.x - cx, y: p.y - cy };
  }
  return out;
}

/**
 * Solve the layout from a seed already scaled to the expected result, then put
 * the graph back where it was so the caller can animate into the new shape.
 */
function solveLayout(
  graph: Graph<NodeAttrs, EdgeAttrs>,
  spread: number,
): Positions {
  const before: Positions = {};
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  graph.forEachNode((id, attrs) => {
    before[id] = { x: attrs.x, y: attrs.y };
    minX = Math.min(minX, attrs.x);
    maxX = Math.max(maxX, attrs.x);
    minY = Math.min(minY, attrs.y);
    maxY = Math.max(maxY, attrs.y);
  });

  const span = Math.max(maxX - minX, maxY - minY);
  const k = span > 1e-6 ? predictedSpan(graph.order, spread) / span : 1;
  if (Number.isFinite(k) && Math.abs(k - 1) > 0.05) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    graph.forEachNode((id, attrs) => {
      graph.mergeNodeAttributes(id, {
        x: cx + (attrs.x - cx) * k,
        y: cy + (attrs.y - cy) * k,
      });
    });
  }

  const solved = forceAtlas2(graph, {
    iterations: layoutIterations(graph.order),
    settings: fa2Settings(graph, spread),
  }) as Positions;

  for (const [id, pos] of Object.entries(before)) {
    graph.mergeNodeAttributes(id, pos);
  }
  return centerPositions(solved);
}

/** Camera state that frames every visible node inside the current bbox. */
function cameraStateToFit(
  sigma: Sigma<NodeAttrs, EdgeAttrs>,
  padding = 1.4,
): { x: number; y: number; ratio: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;
  sigma.getGraph().forEachNode((id) => {
    const data = sigma.getNodeDisplayData(id);
    if (!data || data.hidden) return;
    minX = Math.min(minX, data.x);
    maxX = Math.max(maxX, data.x);
    minY = Math.min(minY, data.y);
    maxY = Math.max(maxY, data.y);
    count++;
  });
  if (!count || !Number.isFinite(minX)) {
    return { x: 0.5, y: 0.5, ratio: 1 };
  }
  const span = Math.max(maxX - minX, maxY - minY, 0.04);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    ratio: Math.max(0.08, span * padding),
  };
}

/** Glide the camera onto the current content. */
function frameCameraToContent(
  sigma: Sigma<NodeAttrs, EdgeAttrs>,
  durationMs: number,
): void {
  sigma.refresh();
  void sigma.getCamera().animate(cameraStateToFit(sigma), {
    duration: durationMs,
    easing: "quadraticInOut",
  });
}

function snapshotCamera(
  state: { x: number; y: number; ratio: number; angle: number },
): GraphCameraState {
  return {
    x: state.x,
    y: state.y,
    ratio: state.ratio,
    angle: state.angle,
  };
}

export function TagGraphView() {
  const openNote = useVaultStore((s) => s.openNote);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tree = useVaultStore((s) => s.tree);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph<NodeAttrs, EdgeAttrs> | null>(null);
  const sigmaRef = useRef<Sigma<NodeAttrs, EdgeAttrs> | null>(null);
  const layoutRef = useRef<FA2Layout | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const hoverRef = useRef<HoverState>({
    node: null,
    neighbors: new Set<string>(),
    progress: 0,
  });
  const hoverRafRef = useRef<number | null>(null);
  const dragRef = useRef<{
    node: string;
    moved: boolean;
    ended?: boolean;
  } | null>(null);
  const dragSimRef = useRef<{ raf: number | null; until: number | null }>({
    raf: null,
    until: null,
  });
  const animationRef = useRef<(() => void) | null>(null);
  const themeRef = useRef<GraphTheme>(readGraphTheme());
  const latestSettingsRef = useRef<{
    vaultPath: string | null;
    ready: boolean;
    settings: GraphUiSettings;
  } | null>(null);
  const spreadRef = useRef(DEFAULT_GRAPH_UI_SETTINGS.spread);
  const cameraRef = useRef<GraphCameraState | null>(
    DEFAULT_GRAPH_UI_SETTINGS.camera,
  );
  const cameraSaveTimerRef = useRef<number | null>(null);
  const signatureRef = useRef("");
  const seededRef = useRef(false);

  const [glOk] = useState(() => webglAvailable());
  const [canvasFresh, setCanvasFresh] = useState(true);
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [tagsOnly, setTagsOnly] = useState(DEFAULT_GRAPH_UI_SETTINGS.tagsOnly);
  const [showUntagged, setShowUntagged] = useState(
    DEFAULT_GRAPH_UI_SETTINGS.showUntagged,
  );
  const [labelThreshold, setLabelThreshold] = useState(
    DEFAULT_GRAPH_UI_SETTINGS.labelThreshold,
  );
  const [spread, setSpread] = useState(DEFAULT_GRAPH_UI_SETTINGS.spread);
  const [projectPath, setProjectPath] = useState<string | null>(
    DEFAULT_GRAPH_UI_SETTINGS.projectPath,
  );
  const [camera, setCamera] = useState<GraphCameraState | null>(
    DEFAULT_GRAPH_UI_SETTINGS.camera,
  );
  const [focusRoot, setFocusRoot] = useState<string | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  const projects = useMemo(() => listVaultProjects(tree), [tree]);
  const projectColors = useMemo(() => {
    const map: ProjectColorMap = {};
    for (const [path, props] of Object.entries(projectPropertiesByPath)) {
      if (props.color) map[path] = props.color;
    }
    return map;
  }, [projectPropertiesByPath]);
  const graphSettings = useMemo<GraphUiSettings>(
    () => ({
      tagsOnly,
      showUntagged,
      labelThreshold,
      spread,
      projectPath,
      camera,
    }),
    [tagsOnly, showUntagged, labelThreshold, spread, projectPath, camera],
  );
  latestSettingsRef.current = {
    vaultPath,
    ready: settingsReady,
    settings: graphSettings,
  };
  cameraRef.current = camera;

  const { data, loading, error, isActive } = useTagGraph({
    showUntagged,
    tagsOnly,
    projectPath,
    focusRoot,
  });

  // Returning from another tab: resize/repaint without rebuilding the graph.
  useEffect(() => {
    if (!isActive) return;
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.resize();
    sigma.refresh();
  }, [isActive]);

  useEffect(() => {
    if (!canvasFresh) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!reduce) return;
    setCanvasFresh(false);
  }, [canvasFresh]);

  const theme = useMemo(() => readGraphTheme(), [themeTick]);

  // Graph controls are vault-specific and survive closing the tab/app.
  useEffect(() => {
    let cancelled = false;
    setSettingsReady(false);
    setFocusRoot(null);
    seededRef.current = false;
    signatureRef.current = "";
    positionsRef.current.clear();
    if (!vaultPath) return;
    void loadGraphUiSettings(vaultPath)
      .catch(() => DEFAULT_GRAPH_UI_SETTINGS)
      .then((saved) => {
        if (cancelled) return;
        setTagsOnly(saved.tagsOnly);
        setShowUntagged(saved.showUntagged);
        setLabelThreshold(saved.labelThreshold);
        setSpread(saved.spread);
        setProjectPath(saved.projectPath);
        setCamera(saved.camera);
        cameraRef.current = saved.camera;
        spreadRef.current = saved.spread;
        setSettingsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  // Avoid a disk write on every slider tick.
  useEffect(() => {
    if (!settingsReady || !vaultPath) return;
    const timer = window.setTimeout(() => {
      void saveGraphUiSettings(vaultPath, graphSettings);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [settingsReady, vaultPath, graphSettings]);

  // Flush the latest value if the Graph tab closes during the debounce window.
  useEffect(
    () => () => {
      if (cameraSaveTimerRef.current != null) {
        window.clearTimeout(cameraSaveTimerRef.current);
        cameraSaveTimerRef.current = null;
      }
      const latest = latestSettingsRef.current;
      if (latest?.ready && latest.vaultPath) {
        void saveGraphUiSettings(latest.vaultPath, {
          ...latest.settings,
          camera: cameraRef.current,
        });
      }
    },
    [],
  );

  // A deleted/renamed project must not leave a permanently empty filter.
  useEffect(() => {
    if (
      settingsReady &&
      projectPath &&
      !projects.some((project) => project.path === projectPath)
    ) {
      setProjectPath(null);
      setFocusRoot(null);
    }
  }, [settingsReady, projectPath, projects]);

  // React to light/dark theme flips.
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1));
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const cancelAnimation = useCallback(() => {
    animationRef.current?.();
    animationRef.current = null;
  }, []);

  /** Tween the hover highlight toward `node` (or back to neutral for null). */
  const setHoveredNode = useCallback((node: string | null) => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    const hover = hoverRef.current;
    if (node && node === hover.node) return;
    if (!node && !hover.node) return;

    if (node) {
      hover.node = node;
      hover.neighbors = new Set(
        graph.hasNode(node) ? graph.neighbors(node) : [],
      );
    }

    const target = node ? 1 : 0;
    const from = hover.progress;
    const duration = node ? HOVER_FADE_IN_MS : HOVER_FADE_OUT_MS;
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease-out so the highlight lands softly.
      hover.progress = from + (target - from) * (1 - (1 - t) * (1 - t));
      if (t >= 1) {
        hover.progress = target;
        if (target === 0) {
          hover.node = null;
          hover.neighbors.clear();
        }
        hoverRafRef.current = null;
      } else {
        hoverRafRef.current = requestAnimationFrame(step);
      }
      sigmaRef.current?.refresh({ skipIndexation: true });
    };
    hoverRafRef.current = requestAnimationFrame(step);
  }, []);

  const stopLayout = useCallback(() => {
    layoutRef.current?.stop();
    setRunning(false);
    if (graphRef.current) {
      rememberPositions(graphRef.current, positionsRef.current);
    }
  }, []);

  /**
   * After a node is dropped, pin it and let the neighbourhood relax around the
   * new spot. Nothing runs while dragging — that fight made nodes feel stuck.
   */
  const settleAfterDrag = useCallback((node: string, settleMs: number) => {
    const graph = graphRef.current;
    if (!graph || !graph.hasNode(node)) return;
    if (dragSimRef.current.raf != null) {
      cancelAnimationFrame(dragSimRef.current.raf);
      dragSimRef.current = { raf: null, until: null };
    }
    graph.setNodeAttribute(node, "fixed", true);
    const until = performance.now() + settleMs;
    const step = () => {
      const g = graphRef.current;
      const sigma = sigmaRef.current;
      if (!g || !sigma || g.order === 0) {
        dragSimRef.current = { raf: null, until: null };
        return;
      }
      forceAtlas2.assign(g, {
        iterations: 1,
        settings: fa2Settings(g, spreadRef.current),
      });
      sigma.refresh();
      if (performance.now() >= until) {
        if (g.hasNode(node)) g.removeNodeAttribute(node, "fixed");
        dragSimRef.current = { raf: null, until: null };
        rememberPositions(g, positionsRef.current);
        return;
      }
      dragSimRef.current.raf = requestAnimationFrame(step);
    };
    dragSimRef.current = { raf: requestAnimationFrame(step), until };
  }, []);

  const startLayout = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    cancelAnimation();
    if (!layout.isRunning()) layout.start();
    setRunning(true);
  }, [cancelAnimation]);

  /** Rebuild the worker against current settings. Returns whether it was running. */
  const rebuildWorker = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return false;
    const wasRunning = layoutRef.current?.isRunning() ?? false;
    layoutRef.current?.kill();
    layoutRef.current = new FA2Layout(graph, {
      settings: fa2Settings(graph, spreadRef.current),
    });
    return wasRunning;
  }, []);

  /**
   * Compute the layout in one off-screen pass instead of letting the worker
   * shake the graph on screen for seconds. `animate` tweens from the current
   * positions so a refresh reads as motion rather than a jump.
   */
  const settleLayout = useCallback(
    (durationMs: number, opts?: { frameCamera?: boolean }) => {
      const graph = graphRef.current;
      const sigma = sigmaRef.current;
      if (!graph || !sigma || graph.order === 0) return;

      cancelAnimation();
      const positions = solveLayout(graph, spreadRef.current);

      const afterSettle = () => {
        rememberPositions(graph, positionsRef.current);
      };

      const runCamera = () => {
        if (!opts?.frameCamera) return;
        frameCameraToContent(sigma, Math.max(durationMs, CAMERA_FOCUS_MS));
      };

      if (durationMs <= 0) {
        for (const [id, pos] of Object.entries(positions)) {
          graph.mergeNodeAttributes(id, pos);
        }
        sigma.refresh();
        afterSettle();
        runCamera();
        return;
      }

      animationRef.current = animateNodes(
        graph,
        positions,
        { duration: durationMs, easing: "quadraticInOut" },
        () => {
          animationRef.current = null;
          afterSettle();
        },
      );
      runCamera();
    },
    [cancelAnimation],
  );

  // Create Sigma + graphology once.
  useEffect(() => {
    if (!glOk) return;
    const el = containerRef.current;
    if (!el) return;

    const graph = new Graph<NodeAttrs, EdgeAttrs>({
      multi: false,
      type: "undirected",
    });
    graphRef.current = graph;

    const labelRenderers = createNodeLabelRenderers<NodeAttrs, EdgeAttrs>(
      () => themeRef.current,
    );
    // Same fill as markdown notes, plus a black outline for PDFs.
    // Avoid 1px in "pixels" mode: the border shader drops rings where
    // borderSize <= u_correctionRatio (so value:1 never paints).
    const PdfNodeProgram = createNodeBorderProgram({
      borders: [
        { size: { value: 0.18, mode: "relative" }, color: { value: "#000000" } },
        { size: { fill: true }, color: { attribute: "color" } },
      ],
      drawLabel: labelRenderers.drawLabel,
      drawHover: labelRenderers.drawHover,
    });
    const sigma = new Sigma(graph, el, {
      allowInvalidContainer: true,
      renderLabels: true,
      labelFont: "Inter, system-ui, sans-serif",
      labelSize: 12,
      labelWeight: "500",
      labelColor: { attribute: "labelColor", color: theme.label },
      labelRenderedSizeThreshold: labelThreshold,
      defaultDrawNodeLabel: labelRenderers.drawLabel,
      defaultDrawNodeHover: labelRenderers.drawHover,
      defaultEdgeColor: theme.edge,
      defaultNodeColor: theme.note,
      defaultNodeType: "circle",
      zIndex: true,
      nodeProgramClasses: {
        pdf: PdfNodeProgram,
      },
    });
    sigmaRef.current = sigma;
    // Pin the coordinate frame: without it sigma re-normalizes to the current
    // node extent, hiding both spacing changes and focus transitions.
    sigma.setCustomBBox(LAYOUT_BBOX);

    // Persist pan/zoom so reopening the graph restores the same view.
    const onCameraUpdated = (state: {
      x: number;
      y: number;
      ratio: number;
      angle: number;
    }) => {
      if (graph.order === 0) return;
      const next = snapshotCamera(state);
      cameraRef.current = next;
      if (cameraSaveTimerRef.current != null) {
        window.clearTimeout(cameraSaveTimerRef.current);
      }
      cameraSaveTimerRef.current = window.setTimeout(() => {
        cameraSaveTimerRef.current = null;
        setCamera(next);
      }, 200);
    };
    sigma.getCamera().on("updated", onCameraUpdated);

    const layout = new FA2Layout(graph, {
      settings: fa2Settings(graph, spreadRef.current),
    });
    layoutRef.current = layout;

    // Reducers read the hover state through a ref so the highlight can be
    // tweened frame by frame instead of snapping on enter/leave.
    sigma.setSetting("nodeReducer", (node, data) => {
      const { node: hovered, neighbors, progress } = hoverRef.current;
      if (!hovered || progress <= 0) return data;
      if (node === hovered || neighbors.has(node)) {
        return { ...data, highlighted: node === hovered, zIndex: 1 };
      }
      return {
        ...data,
        color: scaleAlpha(data.color, 1 - HOVER_DIM * progress),
        labelColor: scaleAlpha(
          themeRef.current.label,
          1 - HOVER_DIM * progress,
        ),
        zIndex: 0,
      };
    });
    sigma.setSetting("edgeReducer", (edge, data) => {
      const { node: hovered, progress } = hoverRef.current;
      if (!hovered || progress <= 0) return data;
      const incident = graph.extremities(edge).includes(hovered);
      if (incident) {
        return {
          ...data,
          color: mixColors(data.color, themeRef.current.accent, progress),
          size: EDGE_SIZE * (1 + progress),
          zIndex: 1,
        };
      }
      return {
        ...data,
        color: scaleAlpha(data.color, 1 - HOVER_DIM * progress),
      };
    });

    sigma.on("enterNode", ({ node }: SigmaNodeEventPayload) => {
      setHoveredNode(node);
    });
    sigma.on("leaveNode", () => {
      setHoveredNode(null);
    });

    sigma.on("clickNode", ({ node, event }: SigmaNodeEventPayload) => {
      if (dragRef.current?.moved) return;
      event.preventSigmaDefault();
      const attrs = graph.getNodeAttributes(node);
      if (attrs.kind === "note") {
        void openNote(attrs.key, { preview: true });
        return;
      }
      // Tag click → rebuild as a local subgraph around this tag.
      setFocusRoot(node);
    });

    sigma.on("downNode", ({ node, event }: SigmaNodeEventPayload) => {
      const orig = event.original;
      if ("button" in orig && orig.button !== 0) return;
      dragRef.current = { node, moved: false };
      animationRef.current?.();
      animationRef.current = null;
      // Stop any live layout / post-drag settle so the pointer owns the node.
      if (dragSimRef.current.raf != null) {
        cancelAnimationFrame(dragSimRef.current.raf);
        dragSimRef.current = { raf: null, until: null };
      }
      if (layoutRef.current?.isRunning()) {
        layoutRef.current.stop();
        setRunning(false);
      }
      if (graph.hasNode(node) && graph.getNodeAttribute(node, "fixed")) {
        graph.removeNodeAttribute(node, "fixed");
      }
    });

    // Sigma's own move event: `preventSigmaDefault` is what stops the camera
    // from panning along with the pointer, which otherwise cancels the drag.
    sigma.on("moveBody", ({ event }) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!graph.hasNode(drag.node)) return;
      drag.moved = true;
      const pos = sigma.viewportToGraph(event);
      graph.setNodeAttribute(drag.node, "x", pos.x);
      graph.setNodeAttribute(drag.node, "y", pos.y);
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });

    const endDrag = () => {
      const drag = dragRef.current;
      if (!drag || drag.ended) return;
      drag.ended = true;
      if (drag.moved) {
        settleAfterDrag(drag.node, DRAG_SETTLE_MS);
      } else {
        rememberPositions(graph, positionsRef.current);
      }
      // Keep dragRef briefly so clickNode can see `.moved`, then clear.
      window.setTimeout(() => {
        dragRef.current = null;
      }, 0);
    };
    sigma.on("upNode", endDrag);
    sigma.on("upStage", endDrag);
    window.addEventListener("mouseup", endDrag);

    const onResize = () => sigma.refresh();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    return () => {
      window.removeEventListener("mouseup", endDrag);
      ro.disconnect();
      if (cameraSaveTimerRef.current != null) {
        window.clearTimeout(cameraSaveTimerRef.current);
        cameraSaveTimerRef.current = null;
      }
      sigma.getCamera().off("updated", onCameraUpdated);
      animationRef.current?.();
      animationRef.current = null;
      if (dragSimRef.current.raf != null) {
        cancelAnimationFrame(dragSimRef.current.raf);
        dragSimRef.current = { raf: null, until: null };
      }
      if (hoverRafRef.current != null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      hoverRef.current = { node: null, neighbors: new Set(), progress: 0 };
      // The worker is rebuilt on settings changes, so kill the current one.
      (layoutRef.current ?? layout).kill();
      layoutRef.current = null;
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
      seededRef.current = false;
    };
    // Mount once; theme/label updates happen via setters below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glOk, openNote, setHoveredNode, settleAfterDrag]);

  // Sync data → graphology.
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma || !glOk || !settingsReady) return;
    if (!data.nodes.length) {
      rememberPositions(graph, positionsRef.current);
      graph.clear();
      seededRef.current = false;
      sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
      sigma.refresh();
      return;
    }

    const first = !seededRef.current;
    const nextIds = new Set(data.nodes.map((n) => n.id));

    const apply = () => {
      syncGraphology(graph, data, theme, positionsRef.current, projectColors);

      const signature = `${graph.order}:${graph.size}`;
      const structureChanged = signature !== signatureRef.current;
      signatureRef.current = signature;

      if (first) {
        try {
          circlepack.assign(graph, { hierarchyAttributes: ["community"] });
        } catch {
          try {
            circlepack.assign(graph);
          } catch {
            /* ignore */
          }
        }
        seededRef.current = true;
        rebuildWorker();
        // Restore the last pose when we have one; otherwise frame the content.
        const savedCam = cameraRef.current;
        settleLayout(INTRO_ANIMATION_MS, { frameCamera: !savedCam });
        if (savedCam) {
          sigma.getCamera().setState(savedCam);
        }
      } else if (structureChanged && !layoutRef.current?.isRunning()) {
        settleLayout(FOCUS_ANIMATION_MS, { frameCamera: true });
      } else {
        rememberPositions(graph, positionsRef.current);
      }

      sigma.setSetting("labelColor", {
        attribute: "labelColor",
        color: theme.label,
      });
      sigma.setSetting("labelRenderedSizeThreshold", labelThreshold);
      applyThemeColors(graph, theme, projectColors);
      sigma.refresh();
    };

    // Focusing a tag drops most of the graph; shrink the leavers away first so
    // the view melts into the subgraph instead of blinking into it.
    const leaving = graph.filterNodes((id) => !nextIds.has(id));
    if (!first && leaving.length && !layoutRef.current?.isRunning()) {
      rememberPositions(graph, positionsRef.current);
      cancelAnimation();
      const targets: Record<string, { size: number }> = {};
      for (const id of leaving) targets[id] = { size: 0 };
      animationRef.current = animateNodes(
        graph,
        targets,
        { duration: EXIT_ANIMATION_MS, easing: "quadraticIn" },
        () => {
          animationRef.current = null;
          apply();
        },
      );
      return;
    }

    apply();
    // labelThreshold / spread have dedicated effects; keep this tied to data/theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    theme,
    projectColors,
    glOk,
    settingsReady,
    rebuildWorker,
    settleLayout,
  ]);

  // Live control updates.
  useEffect(() => {
    sigmaRef.current?.setSetting("labelRenderedSizeThreshold", labelThreshold);
    sigmaRef.current?.refresh();
  }, [labelThreshold]);

  // Spacing changes the solver's repulsion, so the graph genuinely re-arranges
  // (longer links, looser clusters) instead of being zoomed.
  useEffect(() => {
    if (spreadRef.current === spread) return;
    const timer = window.setTimeout(() => {
      spreadRef.current = spread;
      const wasRunning = rebuildWorker();
      if (wasRunning) startLayout();
      else if (seededRef.current) settleLayout(SPREAD_ANIMATION_MS);
    }, SPREAD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [spread, rebuildWorker, settleLayout, startLayout]);

  useEffect(() => {
    themeRef.current = theme;
    const graph = graphRef.current;
    if (!graph) return;
    applyThemeColors(graph, theme, projectColors);
    sigmaRef.current?.setSetting("labelColor", {
      attribute: "labelColor",
      color: theme.label,
    });
    sigmaRef.current?.refresh();
  }, [theme, projectColors]);

  const onToggleLayout = () => {
    if (running) stopLayout();
    else startLayout();
  };

  const onZoomIn = () => {
    const cam = sigmaRef.current?.getCamera();
    if (!cam) return;
    cam.animatedZoom({ duration: 200 });
  };
  const onZoomOut = () => {
    const cam = sigmaRef.current?.getCamera();
    if (!cam) return;
    cam.animatedUnzoom({ duration: 200 });
  };
  const onFit = () => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    frameCameraToContent(sigma, CAMERA_FOCUS_MS);
  };

  const onSearchSubmit = () => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    const q = query.trim().toLowerCase();
    if (!q) return;
    let hit: string | null = null;
    graph.forEachNode((id, attrs) => {
      if (hit) return;
      if (
        attrs.label.toLowerCase().includes(q) ||
        attrs.key.toLowerCase().includes(q)
      ) {
        hit = id;
      }
    });
    if (!hit) return;
    const display = sigma.getNodeDisplayData(hit);
    if (!display) return;
    void sigma
      .getCamera()
      .animate(
        { x: display.x, y: display.y, ratio: 0.35 },
        { duration: CAMERA_FOCUS_MS, easing: "quadraticInOut" },
      );
    setHoveredNode(hit);
  };

  const onClearFocus = () => {
    setFocusRoot(null);
  };

  const empty = settingsReady && !loading && !error && data.nodes.length === 0;

  return (
    <div className="tag-graph-view">
      {glOk && (
        <div
          ref={containerRef}
          className={
            canvasFresh ? "tag-graph-canvas is-fresh" : "tag-graph-canvas"
          }
          aria-label="Tag graph"
          onAnimationEnd={() => setCanvasFresh(false)}
        />
      )}

      {!glOk && (
        <div className="tag-graph-error">
          <h2>WebGL unavailable</h2>
          <p>
            The tag graph needs WebGL to render. Check that hardware
            acceleration is enabled for this app, then reopen the Graph tab.
          </p>
        </div>
      )}

      {glOk && (!settingsReady || loading) && data.nodes.length === 0 && (
        <div className="tag-graph-loading">Loading graph…</div>
      )}

      {glOk && error && (
        <div className="tag-graph-error">
          <h2>Could not load tags</h2>
          <p>{error}</p>
        </div>
      )}

      {glOk && empty && (
        <div className="tag-graph-empty">
          <h2>{projectPath ? "No tags in this project" : "No tags yet"}</h2>
          <p>
            {projectPath
              ? "Choose another project or add tags to its notes."
              : "Add tags in note frontmatter or write inline #tags — they will appear here as a graph."}
          </p>
        </div>
      )}

      {glOk && settingsReady && !empty && !error && (
        <>
          <GraphControls
            query={query}
            onQueryChange={setQuery}
            onSearchSubmit={onSearchSubmit}
            running={running}
            onToggleLayout={onToggleLayout}
            onZoomIn={onZoomIn}
            onZoomOut={onZoomOut}
            onFit={onFit}
            projects={projects}
            projectPath={projectPath}
            onProjectPathChange={(path) => {
              setProjectPath(path);
              setFocusRoot(null);
            }}
            tagsOnly={tagsOnly}
            onTagsOnlyChange={(v) => setTagsOnly(v)}
            showUntagged={showUntagged}
            onShowUntaggedChange={(v) => setShowUntagged(v)}
            labelThreshold={labelThreshold}
            onLabelThresholdChange={setLabelThreshold}
            spread={spread}
            onSpreadChange={setSpread}
            focusRoot={focusRoot}
            onClearFocus={onClearFocus}
            nodeCount={data.nodes.length}
            edgeCount={data.edges.length}
          />
          <div className="tag-graph-hint">
            Click a note to open · click a tag to focus
          </div>
        </>
      )}
    </div>
  );
}
