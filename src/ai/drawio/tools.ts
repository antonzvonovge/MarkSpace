import { tool } from "ai";
import { z } from "zod";
import { createDrawio, readNote, writeNote } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import type { ChatMode } from "../types";
import {
  mutateDiagram,
  summarizeDrawio,
  type DrawioShape,
  type MutateDiagramInput,
} from "./model";

const shapeSchema = z
  .enum(["rectangle", "rounded", "ellipse", "rhombus", "cylinder", "actor"])
  .describe("Preset shape style");

const colorSchema = z
  .string()
  .min(1)
  .describe("CSS-like color: #RGB, #RRGGBB, or none");

const colorFields = {
  fill_color: colorSchema.optional().describe("Shape/edge fill (mx fillColor)"),
  stroke_color: colorSchema
    .optional()
    .describe("Border/line color (mx strokeColor)"),
  font_color: colorSchema.optional().describe("Label color (mx fontColor)"),
};

const nodeFields = {
  label: z.string().min(1),
  shape: shapeSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  style: z
    .string()
    .optional()
    .describe("Raw mxGraph style string; overrides shape preset"),
  ...colorFields,
  id: z.string().optional().describe("Optional explicit cell id"),
  temp_id: z
    .string()
    .optional()
    .describe(
      "Alias for this node within the same mutate_diagram call; use as edge source/target",
    ),
};

const edgeFields = {
  source: z
    .string()
    .min(1)
    .describe("Cell id or temp_id from add_nodes in the same mutate call"),
  target: z
    .string()
    .min(1)
    .describe("Cell id or temp_id from add_nodes in the same mutate call"),
  label: z.string().optional(),
  style: z.string().optional(),
  ...colorFields,
  id: z.string().optional(),
};

const updateFields = {
  id: z.string().min(1),
  label: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  style: z.string().optional(),
  ...colorFields,
  source: z.string().optional(),
  target: z.string().optional(),
};

/** Serialize load→mutate→save per path so parallel tool calls cannot clobber each other. */
const pathLocks = new Map<string, Promise<unknown>>();

async function withPathLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const key = assertDrawioPath(path);
  const prev = pathLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.then(() => done);
  pathLocks.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function assertDrawioPath(path: string): string {
  const p = path.trim();
  if (!p.toLowerCase().endsWith(".drawio")) {
    throw new Error(`Expected a .drawio path, got: ${path}`);
  }
  return p;
}

function syncOpenEditor(path: string, content: string) {
  const state = useVaultStore.getState();
  if (state.activePath !== path) return;
  // Defer iframe/XML push so chat UI stays responsive during agent edits.
  window.setTimeout(() => {
    const latest = useVaultStore.getState();
    if (latest.activePath !== path) return;
    useVaultStore.setState({ content, dirty: false });
    latest.markExternalWrite();
  }, 0);
}

async function loadXml(path: string): Promise<string> {
  const p = assertDrawioPath(path);
  const { activePath, content } = useVaultStore.getState();
  if (activePath === p && content) return content;
  return readNote(p);
}

async function saveXml(path: string, xml: string) {
  const p = assertDrawioPath(path);
  await writeNote(p, xml);
  syncOpenEditor(p, xml);
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

async function runMutate(path: string, input: MutateDiagramInput) {
  return withPathLock(path, async () => {
    const xml = await loadXml(path);
    const result = await mutateDiagram(xml, input);
    await saveXml(path, result.xml);
    return {
      ok: true as const,
      path: assertDrawioPath(path),
      removed: result.removed,
      updated: result.updated,
      added_nodes: result.added_nodes,
      added_edges: result.added_edges,
    };
  });
}

function fail(path: string, e: unknown) {
  return {
    ok: false as const,
    error: e instanceof Error ? e.message : String(e),
    path,
  };
}

export function buildDrawioTools(mode: ChatMode) {
  const readTools = {
    read_diagram: tool({
      description:
        "Read a .drawio diagram as a semantic summary (pages, nodes, edges with ids/labels/geometry/colors). Prefer this over read_note for diagrams.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .drawio path"),
        page: z
          .string()
          .optional()
          .describe("Optional page name or id; omit to include all pages"),
      }),
      execute: async ({ path, page }) => {
        try {
          const xml = await loadXml(path);
          const summary = await summarizeDrawio(xml);
          const pages = page
            ? summary.pages.filter((p) => p.name === page || p.id === page)
            : summary.pages;
          if (page && pages.length === 0) {
            return {
              ok: false as const,
              error: `Page not found: ${page}`,
              available: summary.pages.map((p) => ({ id: p.id, name: p.name })),
            };
          }
          return {
            ok: true as const,
            path: assertDrawioPath(path),
            pages: pages.map((p) => ({
              id: p.id,
              name: p.name,
              node_count: p.nodes.length,
              edge_count: p.edges.length,
              nodes: p.nodes,
              edges: p.edges,
            })),
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
  };

  if (mode === "ask") return readTools;

  return {
    ...readTools,
    create_diagram: tool({
      description:
        "Create a new empty .drawio diagram in the vault (adds .drawio if missing).",
      inputSchema: z.object({
        path: z.string().describe("Desired path, e.g. Diagrams/Auth.drawio"),
      }),
      execute: async ({ path }) => {
        try {
          const created = await createDrawio(path);
          return { ok: true as const, path: created };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
    mutate_diagram: tool({
      description:
        "PREFERRED diagram editor: apply many removes/updates/add_nodes/add_edges in ONE atomic write. Use this instead of many parallel single-element calls (those used to drop edits). Order: remove → update → add_nodes → add_edges. Edge source/target may be temp_id from add_nodes in the same call.",
      inputSchema: z.object({
        path: z.string(),
        page: z.string().optional(),
        remove: z.array(z.string().min(1)).optional(),
        updates: z.array(z.object(updateFields)).optional(),
        add_nodes: z.array(z.object(nodeFields)).optional(),
        add_edges: z.array(z.object(edgeFields)).optional(),
      }),
      execute: async (input) => {
        try {
          const hasWork =
            (input.remove?.length ?? 0) > 0 ||
            (input.updates?.length ?? 0) > 0 ||
            (input.add_nodes?.length ?? 0) > 0 ||
            (input.add_edges?.length ?? 0) > 0;
          if (!hasWork) {
            return {
              ok: false as const,
              error: "Provide at least one of remove/updates/add_nodes/add_edges",
              path: input.path,
            };
          }
          return await runMutate(input.path, {
            page: input.page,
            remove: input.remove,
            updates: input.updates,
            add_nodes: input.add_nodes?.map((n) => ({
              ...n,
              shape: n.shape as DrawioShape | undefined,
            })),
            add_edges: input.add_edges,
          });
        } catch (e) {
          return fail(input.path, e);
        }
      },
    }),
    add_diagram_node: tool({
      description:
        "Add one shape. Prefer mutate_diagram with add_nodes[] when adding several.",
      inputSchema: z.object({
        path: z.string(),
        page: z.string().optional(),
        ...nodeFields,
      }),
      execute: async (input) => {
        try {
          const { path, page, ...node } = input;
          const result = await runMutate(path, {
            page,
            add_nodes: [
              { ...node, shape: node.shape as DrawioShape | undefined },
            ],
          });
          return {
            ...result,
            id: result.added_nodes[0]?.id,
          };
        } catch (e) {
          return fail(input.path, e);
        }
      },
    }),
    add_diagram_edge: tool({
      description:
        "Add one edge. Prefer mutate_diagram with add_edges[] when adding several.",
      inputSchema: z.object({
        path: z.string(),
        page: z.string().optional(),
        ...edgeFields,
      }),
      execute: async (input) => {
        try {
          const { path, page, ...edge } = input;
          const result = await runMutate(path, { page, add_edges: [edge] });
          return {
            ...result,
            id: result.added_edges[0]?.id,
          };
        } catch (e) {
          return fail(input.path, e);
        }
      },
    }),
    update_diagram_element: tool({
      description:
        "Update one element. Prefer mutate_diagram with updates[] to recolor/move many cells at once.",
      inputSchema: z.object({
        path: z.string(),
        page: z.string().optional(),
        ...updateFields,
      }),
      execute: async (input) => {
        try {
          const { path, page, ...update } = input;
          const result = await runMutate(path, { page, updates: [update] });
          return {
            ...result,
            id: result.updated[0],
          };
        } catch (e) {
          return fail(input.path, e);
        }
      },
    }),
    remove_diagram_element: tool({
      description:
        "Remove one node/edge (nodes cascade connected edges). Prefer mutate_diagram with remove[].",
      inputSchema: z.object({
        path: z.string(),
        id: z.string().min(1),
        page: z.string().optional(),
      }),
      execute: async (input) => {
        try {
          const result = await runMutate(input.path, {
            page: input.page,
            remove: [input.id],
          });
          return {
            ...result,
            id: input.id,
          };
        } catch (e) {
          return fail(input.path, e);
        }
      },
    }),
  };
}
