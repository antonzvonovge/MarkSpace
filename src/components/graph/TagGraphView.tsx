import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import type { Attributes } from "graphology-types";
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
  type GraphUiSettings,
} from "../../lib/settingsStore";
import type { TagGraphData, TagGraphNode } from "../../lib/tagGraph";
import { listVaultProjects } from "../../lib/vaultApi";
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
  community?: number;
  untagged?: boolean;
  highlighted?: boolean;
};

type EdgeAttrs = Attributes & {
  color: string;
  size: number;
};

const LAYOUT_ANIMATION_MS = 450;
/** First paint unfolds the seeded cluster into the settled layout. */
const INTRO_ANIMATION_MS = 900;
/** Focus/filter changes morph the surviving nodes into their new places. */
const FOCUS_ANIMATION_MS = 620;
/** Nodes leaving the view shrink away before the layout re-settles. */
const EXIT_ANIMATION_MS = 180;
/** Camera glide onto the focused subgraph after a structure change. */
const CAMERA_FOCUS_MS = 820;
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

function fa2Settings(graph: Graph<NodeAttrs, EdgeAttrs>, gravity: number) {
  const inferred = forceAtlas2.inferSettings(graph);
  return {
    ...inferred,
    // The whole layout runs in one synchronous pass, so keep it O(n log n)
    // well before graphology's own Barnes-Hut threshold.
    barnesHutOptimize: inferred.barnesHutOptimize || graph.order > 300,
    gravity,
    slowDown: 2,
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

function applyThemeColors(
  graph: Graph<NodeAttrs, EdgeAttrs>,
  theme: GraphTheme,
): void {
  graph.forEachNode((id, attrs) => {
    if (attrs.kind === "tag") {
      graph.setNodeAttribute(id, "color", theme.tag);
    } else if (attrs.untagged) {
      graph.setNodeAttribute(id, "color", theme.noteQuiet);
    } else {
      graph.setNodeAttribute(id, "color", theme.note);
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
    if (graph.hasNode(node.id)) {
      graph.mergeNodeAttributes(node.id, {
        label: node.label,
        size: nodeSize(node),
        kind: node.kind,
        key: node.key,
        untagged: Boolean(node.untagged),
      });
    } else {
      graph.addNode(node.id, {
        label: node.label,
        size: nodeSize(node),
        color: theme.note,
        kind: node.kind,
        key: node.key,
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
  applyThemeColors(graph, theme);
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
 * Freeze the current graph extent so dropping/adding nodes cannot instantly
 * re-normalize the viewport (that snap is what feels like a hard camera cut).
 */
function freezeViewport(sigma: Sigma<NodeAttrs, EdgeAttrs>): void {
  if (sigma.getCustomBBox()) return;
  sigma.setCustomBBox(sigma.getBBox());
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

/**
 * Glide the camera onto the current content, then release the frozen bbox so
 * later interaction uses a normal full-graph framing without a visible jump.
 */
function frameCameraToContent(
  sigma: Sigma<NodeAttrs, EdgeAttrs>,
  durationMs: number,
): void {
  sigma.refresh();
  const target = cameraStateToFit(sigma);
  void sigma
    .getCamera()
    .animate(target, { duration: durationMs, easing: "quadraticInOut" })
    .then(() => {
      if (sigma.getCustomBBox()) {
        sigma.setCustomBBox(null);
        sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
        sigma.refresh();
      }
    });
}

export function TagGraphView() {
  const openNote = useVaultStore((s) => s.openNote);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tree = useVaultStore((s) => s.tree);
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
  const dragRef = useRef<{ node: string; moved: boolean } | null>(null);
  const animationRef = useRef<(() => void) | null>(null);
  const themeRef = useRef<GraphTheme>(readGraphTheme());
  const latestSettingsRef = useRef<{
    vaultPath: string | null;
    ready: boolean;
    settings: GraphUiSettings;
  } | null>(null);
  const gravityRef = useRef(1);
  const signatureRef = useRef("");
  const seededRef = useRef(false);

  const [glOk] = useState(() => webglAvailable());
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
  const [gravity, setGravity] = useState(DEFAULT_GRAPH_UI_SETTINGS.gravity);
  const [projectPath, setProjectPath] = useState<string | null>(
    DEFAULT_GRAPH_UI_SETTINGS.projectPath,
  );
  const [focusRoot, setFocusRoot] = useState<string | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  const projects = useMemo(() => listVaultProjects(tree), [tree]);
  const graphSettings = useMemo<GraphUiSettings>(
    () => ({
      tagsOnly,
      showUntagged,
      labelThreshold,
      gravity,
      projectPath,
    }),
    [tagsOnly, showUntagged, labelThreshold, gravity, projectPath],
  );
  latestSettingsRef.current = {
    vaultPath,
    ready: settingsReady,
    settings: graphSettings,
  };

  const { data, loading, error } = useTagGraph({
    showUntagged,
    tagsOnly,
    projectPath,
    focusRoot,
  });

  const theme = useMemo(() => readGraphTheme(), [themeTick]);

  // Graph controls are vault-specific and survive closing the tab/app.
  useEffect(() => {
    let cancelled = false;
    setSettingsReady(false);
    setFocusRoot(null);
    if (!vaultPath) return;
    void loadGraphUiSettings(vaultPath)
      .catch(() => DEFAULT_GRAPH_UI_SETTINGS)
      .then((saved) => {
        if (cancelled) return;
        setTagsOnly(saved.tagsOnly);
        setShowUntagged(saved.showUntagged);
        setLabelThreshold(saved.labelThreshold);
        setGravity(saved.gravity);
        setProjectPath(saved.projectPath);
        gravityRef.current = saved.gravity;
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
      const latest = latestSettingsRef.current;
      if (latest?.ready && latest.vaultPath) {
        void saveGraphUiSettings(latest.vaultPath, latest.settings);
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
      settings: fa2Settings(graph, gravityRef.current),
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
      const positions = forceAtlas2(graph, {
        iterations: layoutIterations(graph.order),
        settings: fa2Settings(graph, gravityRef.current),
      }) as Positions;

      // Peek at the settled frame so the camera can glide in parallel with the
      // node morph instead of waiting for it to finish.
      let cameraTarget: { x: number; y: number; ratio: number } | null = null;
      if (opts?.frameCamera) {
        const previous = new Map<string, { x: number; y: number }>();
        graph.forEachNode((id, attrs) => {
          previous.set(id, { x: attrs.x, y: attrs.y });
        });
        for (const [id, pos] of Object.entries(positions)) {
          graph.mergeNodeAttributes(id, pos);
        }
        sigma.refresh();
        cameraTarget = cameraStateToFit(sigma);
        for (const [id, pos] of previous) {
          graph.mergeNodeAttributes(id, pos);
        }
        sigma.refresh();
      }

      const afterSettle = () => {
        rememberPositions(graph, positionsRef.current);
      };

      const runCamera = () => {
        if (!cameraTarget) return;
        void sigma
          .getCamera()
          .animate(cameraTarget, {
            duration: Math.max(durationMs, CAMERA_FOCUS_MS),
            easing: "quadraticInOut",
          })
          .then(() => {
            if (sigmaRef.current !== sigma) return;
            if (sigma.getCustomBBox()) {
              sigma.setCustomBBox(null);
              sigma.getCamera().setState({
                x: 0.5,
                y: 0.5,
                ratio: 1,
                angle: 0,
              });
              sigma.refresh();
            }
          });
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
      zIndex: true,
    });
    sigmaRef.current = sigma;

    const layout = new FA2Layout(graph, {
      settings: fa2Settings(graph, gravityRef.current),
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
      if (layoutRef.current?.isRunning()) {
        layoutRef.current.stop();
        setRunning(false);
      }
    });

    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.moved = true;
      const rect = el.getBoundingClientRect();
      const pos = sigma.viewportToGraph({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      graph.setNodeAttribute(drag.node, "x", pos.x);
      graph.setNodeAttribute(drag.node, "y", pos.y);
      sigma.refresh();
    };
    const onUp = () => {
      if (!dragRef.current) return;
      rememberPositions(graph, positionsRef.current);
      // Keep dragRef briefly so clickNode can see `.moved`, then clear.
      window.setTimeout(() => {
        dragRef.current = null;
      }, 0);
    };
    el.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    const onResize = () => sigma.refresh();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    return () => {
      el.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      ro.disconnect();
      animationRef.current?.();
      animationRef.current = null;
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
  }, [glOk, openNote, setHoveredNode]);

  // Sync data → graphology.
  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma || !glOk || !settingsReady) return;
    if (!data.nodes.length) {
      rememberPositions(graph, positionsRef.current);
      graph.clear();
      seededRef.current = false;
      sigma.setCustomBBox(null);
      sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
      sigma.refresh();
      return;
    }

    const first = !seededRef.current;
    const nextIds = new Set(data.nodes.map((n) => n.id));
    const structureWillChange =
      !first &&
      (graph.order !== data.nodes.length ||
        graph.size !== data.edges.length ||
        graph.someNode((id) => !nextIds.has(id)) ||
        data.nodes.some((node) => !graph.hasNode(node.id)));

    // Keep the old extent while the membership changes so sigma cannot snap
    // the remaining (or returning) nodes into a new frame in a single tick.
    if (structureWillChange) freezeViewport(sigma);

    const apply = () => {
      syncGraphology(graph, data, theme, positionsRef.current);

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
        settleLayout(INTRO_ANIMATION_MS);
      } else if (structureChanged && !layoutRef.current?.isRunning()) {
        settleLayout(FOCUS_ANIMATION_MS, { frameCamera: true });
      } else {
        rememberPositions(graph, positionsRef.current);
        if (structureWillChange) {
          frameCameraToContent(sigma, CAMERA_FOCUS_MS);
        }
      }

      sigma.setSetting("labelColor", {
        attribute: "labelColor",
        color: theme.label,
      });
      sigma.setSetting("labelRenderedSizeThreshold", labelThreshold);
      applyThemeColors(graph, theme);
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
    // labelThreshold / gravity have dedicated effects; keep this tied to data/theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, theme, glOk, settingsReady, rebuildWorker, settleLayout]);

  // Live control updates.
  useEffect(() => {
    sigmaRef.current?.setSetting("labelRenderedSizeThreshold", labelThreshold);
    sigmaRef.current?.refresh();
  }, [labelThreshold]);

  useEffect(() => {
    if (gravityRef.current === gravity) return;
    gravityRef.current = gravity;
    if (!graphRef.current) return;
    const wasRunning = rebuildWorker();
    if (wasRunning) startLayout();
    else if (seededRef.current) settleLayout(LAYOUT_ANIMATION_MS);
  }, [gravity, rebuildWorker, settleLayout, startLayout]);

  useEffect(() => {
    themeRef.current = theme;
    const graph = graphRef.current;
    if (!graph) return;
    applyThemeColors(graph, theme);
    sigmaRef.current?.setSetting("labelColor", {
      attribute: "labelColor",
      color: theme.label,
    });
    sigmaRef.current?.refresh();
  }, [theme]);

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
    sigma.getCamera().animatedReset({
      duration: CAMERA_FOCUS_MS,
      easing: "quadraticInOut",
    });
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
    void sigma.getCamera().animate(
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
          className="tag-graph-canvas"
          aria-label="Tag graph"
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
            gravity={gravity}
            onGravityChange={setGravity}
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
