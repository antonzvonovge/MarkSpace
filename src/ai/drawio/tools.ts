import { tool } from "ai";
import { z } from "zod";
import { createDrawio, readNote, writeNote } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import type { ChatMode } from "../types";
import { DRAWIO_MERMAID_REFERENCE, DRAWIO_XML_REFERENCE } from "./format";
import { convertMermaidToMxfile } from "./importMermaid";
import {
  mutateDiagram,
  summarizeDrawio,
  type DrawioShape,
  type DrawioRelation,
  type MutateDiagramInput,
} from "./model";
import {
  listPageMeta,
  mxfilePageIsEmpty,
  readPageXmlFromText,
  wrapContentAsMxfile,
  writePageXmlInText,
} from "./pages";
import { searchDrawioShapes } from "./shapeSearch";
import { DRAWIO_RELATIONS, DRAWIO_SHAPES } from "./shapes";

const shapeSchema = z
  .enum(DRAWIO_SHAPES as unknown as [DrawioShape, ...DrawioShape[]])
  .describe(
    "Preset shape: basic (rectangle/rounded/ellipse/rhombus/cylinder/actor/text/group/swimlane) or ArchiMate 3.2 (archimate.application_component, archimate.business_actor, …)",
  );

const relationSchema = z
  .enum(DRAWIO_RELATIONS as unknown as [DrawioRelation, ...DrawioRelation[]])
  .describe(
    "Edge relation preset: default/orthogonal or ArchiMate (serving, realization, assignment, composition, …)",
  );

const colorSchema = z
  .string()
  .min(1)
  .describe("CSS-like color: #RGB, #RRGGBB, or none");

const styleFields = {
  fill_color: colorSchema.optional().describe("Shape/edge fill (mx fillColor)"),
  stroke_color: colorSchema
    .optional()
    .describe("Border/line color (mx strokeColor)"),
  font_color: colorSchema.optional().describe("Label color (mx fontColor)"),
  align: z
    .enum(["left", "center", "right"])
    .optional()
    .describe("Horizontal text align inside shape"),
  vertical_align: z
    .enum(["top", "middle", "bottom"])
    .optional()
    .describe("Vertical text align inside shape"),
  font_size: z.number().positive().optional(),
  font_bold: z.boolean().optional(),
  font_italic: z.boolean().optional(),
  font_underline: z.boolean().optional(),
  opacity: z.number().min(0).max(100).optional().describe("0–100"),
  dashed: z.boolean().optional(),
  rounded: z.boolean().optional(),
  sketch: z.boolean().optional().describe("Hand-drawn sketch style on this cell"),
  exit_x: z.number().min(0).max(1).optional().describe("Edge exit port X 0–1"),
  exit_y: z.number().min(0).max(1).optional().describe("Edge exit port Y 0–1"),
  entry_x: z.number().min(0).max(1).optional().describe("Edge entry port X 0–1"),
  entry_y: z.number().min(0).max(1).optional().describe("Edge entry port Y 0–1"),
};

const waypointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

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
  parent: z
    .string()
    .optional()
    .describe("Parent cell id or temp_id (group/swimlane); default page root"),
  container: z
    .boolean()
    .optional()
    .describe("Mark as container so children can nest inside"),
  locked: z.boolean().optional(),
  z_order: z.enum(["front", "back"]).optional(),
  ...styleFields,
  id: z.string().optional().describe("Optional explicit cell id"),
  temp_id: z
    .string()
    .optional()
    .describe(
      "Alias for this node within the same mutate_diagram call; use as edge source/target or child parent",
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
  relation: relationSchema.optional(),
  style: z.string().optional(),
  waypoints: z
    .array(waypointSchema)
    .optional()
    .describe("Orthogonal bend points in diagram coordinates"),
  ...styleFields,
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
  relation: relationSchema.optional(),
  source: z.string().optional(),
  target: z.string().optional(),
  parent: z.string().optional(),
  waypoints: z.array(waypointSchema).optional(),
  locked: z.boolean().optional(),
  z_order: z.enum(["front", "back"]).optional(),
  ...styleFields,
};

const pageSettingsFields = {
  grid: z.boolean().optional().describe("Show grid"),
  grid_size: z.number().positive().optional(),
  guides: z.boolean().optional(),
  page: z.boolean().optional().describe("Show page breaks / page view"),
  page_width: z.number().positive().optional(),
  page_height: z.number().positive().optional(),
  page_scale: z.number().positive().optional(),
  shadow: z.boolean().optional(),
  math: z.boolean().optional(),
  sketch: z
    .boolean()
    .optional()
    .describe("Apply/remove sketch style on all shapes and edges on the page"),
};

const layoutFields = {
  type: z
    .enum(["auto", "none", "grid", "hierarchical", "archimate"])
    .describe(
      "auto=pick from content (default for multi-node adds); archimate=layer rows top-down; hierarchical=by edges; none=keep x/y",
    ),
  direction: z
    .enum(["top_down", "left_right"])
    .optional()
    .describe("Default top_down (ArchiMate/flow stacks vertically)"),
  columns: z.number().int().positive().optional(),
  origin_x: z.number().optional(),
  origin_y: z.number().optional(),
  gap_x: z.number().optional(),
  gap_y: z.number().optional(),
  ids: z
    .array(z.string())
    .optional()
    .describe("Limit layout to these vertex ids; default all top-level vertices"),
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
  window.setTimeout(() => {
    const latest = useVaultStore.getState();
    if (latest.activePath !== path) return;
    latest.applyExternalContent(path, content, { force: true });
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

export const EMPTY_FIRST_PAINT_ERROR =
  "This diagram page is empty. First paint must use create_diagram with mermaid (flowcharts, sequence, ER, org charts) or xml — not mutate_diagram.";

function isContentMutation(input: MutateDiagramInput): boolean {
  return (
    (input.remove?.length ?? 0) > 0 ||
    (input.updates?.length ?? 0) > 0 ||
    (input.add_nodes?.length ?? 0) > 0 ||
    (input.add_edges?.length ?? 0) > 0
  );
}

export async function assertNotEmptyContentMutate(
  xml: string,
  input: MutateDiagramInput,
): Promise<void> {
  if (!isContentMutation(input)) return;
  const pageRef = input.page?.trim() || "0";
  if (await mxfilePageIsEmpty(xml, pageRef)) {
    throw new Error(EMPTY_FIRST_PAINT_ERROR);
  }
}

async function firstPaintMxfile(opts: {
  mermaid?: string;
  xml?: string;
}): Promise<string | null> {
  const mermaid = opts.mermaid?.trim();
  const xml = opts.xml?.trim();
  if (mermaid && xml) {
    throw new Error("Pass mermaid or xml, not both");
  }
  if (mermaid) return convertMermaidToMxfile(mermaid);
  if (xml) return wrapContentAsMxfile(xml);
  return null;
}

async function runMutate(path: string, input: MutateDiagramInput) {
  return withPathLock(path, async () => {
    const xml = await loadXml(path);
    await assertNotEmptyContentMutate(xml, input);
    const result = await mutateDiagram(xml, input);
    await saveXml(path, result.xml);
    return {
      ok: true as const,
      path: assertDrawioPath(path),
      removed: result.removed,
      updated: result.updated,
      added_nodes: result.added_nodes,
      added_edges: result.added_edges,
      added_pages: result.added_pages,
      renamed_pages: result.renamed_pages,
      page_settings_applied: result.page_settings_applied,
      layout_applied: result.layout_applied,
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

function mapNode<T extends { shape?: string }>(n: T) {
  return {
    ...n,
    shape: n.shape as DrawioShape | undefined,
  };
}

export function buildDrawioTools(mode: ChatMode) {
  const readTools = {
    read_drawio_format: tool({
      description:
        "Draw.io generation guide from the official xml/mermaid references. Call section=mermaid before create_diagram(mermaid); section=xml before writing mxGraph XML (create_diagram xml or set_page).",
      inputSchema: z.object({
        section: z
          .enum(["xml", "mermaid"])
          .describe("Which reference to return"),
      }),
      execute: async ({ section }) => ({
        section,
        guide:
          section === "mermaid"
            ? DRAWIO_MERMAID_REFERENCE
            : DRAWIO_XML_REFERENCE,
      }),
    }),
    read_diagram: tool({
      description:
        "Read a .drawio diagram as a semantic summary (pages + settings, nodes/edges with ids/labels/geometry/colors/align/sketch, ArchiMate styles, waypoints). Prefer this over read_note for diagrams. Use before mutate_diagram so you have cell ids.",
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
              settings: p.settings,
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
    list_pages: tool({
      description:
        "List pages in a vault .drawio (index, id, name, size) without loading page XML. Call before get_page/set_page on multi-page files.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .drawio path"),
      }),
      execute: async ({ path }) => {
        try {
          const xml = await loadXml(path);
          return {
            ok: true as const,
            path: assertDrawioPath(path),
            pages: listPageMeta(xml),
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
    get_page: tool({
      description:
        "Read one page of a .drawio as raw mxGraphModel XML (decompresses if needed). Prefer read_diagram for incremental edits.",
      inputSchema: z.object({
        path: z.string(),
        page: z
          .string()
          .describe("Zero-based index, exact page name, or page id"),
      }),
      execute: async ({ path, page }) => {
        try {
          const file = await loadXml(path);
          const result = await readPageXmlFromText(file, page);
          return {
            ok: true as const,
            path: assertDrawioPath(path),
            ...result,
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
    search_shapes: tool({
      description:
        "Search the draw.io shape library (~10,000 stencils: AWS, Azure, Cisco, Kubernetes, BPMN, …). Returns style/w/h/title for mxCell styles. Use ONLY before XML first paint that needs industry/branded icons. Skip for flowcharts, UML, ERD, org charts.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Space-separated keywords, e.g. aws lambda"),
        limit: z.number().int().positive().optional(),
      }),
      execute: async ({ query, limit }) => {
        try {
          const results = await searchDrawioShapes(query, limit ?? 10);
          if (results.length === 0) {
            return { ok: true as const, results, message: `No shapes found for query: ${query}` };
          }
          return { ok: true as const, results };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            query,
          };
        }
      },
    }),
  };

  if (mode === "ask") return readTools;

  return {
    ...readTools,
    create_diagram: tool({
      description:
        "Create a new .drawio in the vault. FIRST PAINT belongs here: pass mermaid (preferred for flowcharts, sequence, ER, org charts) or xml (mxGraphModel or mxfile; use for precise layout, ArchiMate, cloud icons after search_shapes). Do not create an empty file and fill it with mutate_diagram. Adds .drawio if missing.",
      inputSchema: z.object({
        path: z.string().describe("Desired path, e.g. Diagrams/Auth.drawio"),
        mermaid: z
          .string()
          .optional()
          .describe("Mermaid source for first paint (not together with xml)"),
        xml: z
          .string()
          .optional()
          .describe("mxGraphModel or mxfile XML for first paint (not together with mermaid)"),
      }),
      execute: async ({ path, mermaid, xml }) => {
        try {
          const painted = await firstPaintMxfile({ mermaid, xml });
          const created = await createDrawio(path);
          if (painted) await saveXml(created, painted);
          await useVaultStore.getState().refreshTree();
          return {
            ok: true as const,
            path: created,
            painted: painted != null,
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
    set_page: tool({
      description:
        "Replace one page's mxGraphModel XML, leaving other pages untouched. Rare full redraw — prefer mutate_diagram for incremental edits. Content must be a single <mxGraphModel>, not an mxfile.",
      inputSchema: z.object({
        path: z.string(),
        page: z
          .string()
          .describe("Zero-based index, exact page name, or page id"),
        content: z.string().describe("Plain <mxGraphModel> XML for that page"),
      }),
      execute: async ({ path, page, content }) => {
        try {
          return await withPathLock(path, async () => {
            const file = await loadXml(path);
            const result = await writePageXmlInText(file, page, content);
            await saveXml(path, result.xml);
            return {
              ok: true as const,
              path: assertDrawioPath(path),
              index: result.index,
              id: result.id,
              name: result.name,
            };
          });
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
    mutate_diagram: tool({
      description:
        "Incremental edit of an ALREADY DRAWN diagram (not first paint). Rejects add/update/remove on an empty page — use create_diagram(mermaid|xml) instead. Order: add_pages/rename_pages → page_settings → remove → updates → add_nodes → add_edges → layout. Call read_diagram first for ids.",
      inputSchema: z.object({
        path: z.string(),
        page: z.string().optional(),
        page_settings: z.object(pageSettingsFields).optional(),
        add_pages: z
          .array(z.object({ name: z.string().min(1), id: z.string().optional() }))
          .optional(),
        rename_pages: z
          .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
          .optional(),
        remove: z.array(z.string().min(1)).optional(),
        updates: z.array(z.object(updateFields)).optional(),
        add_nodes: z.array(z.object(nodeFields)).optional(),
        add_edges: z.array(z.object(edgeFields)).optional(),
        layout: z.object(layoutFields).optional(),
      }),
      execute: async (input) => {
        try {
          const hasWork =
            (input.add_pages?.length ?? 0) > 0 ||
            (input.rename_pages?.length ?? 0) > 0 ||
            input.page_settings != null ||
            (input.remove?.length ?? 0) > 0 ||
            (input.updates?.length ?? 0) > 0 ||
            (input.add_nodes?.length ?? 0) > 0 ||
            (input.add_edges?.length ?? 0) > 0 ||
            input.layout != null;
          if (!hasWork) {
            return {
              ok: false as const,
              error:
                "Provide at least one of add_pages/rename_pages/page_settings/remove/updates/add_nodes/add_edges/layout",
              path: input.path,
            };
          }
          return await runMutate(input.path, {
            page: input.page,
            page_settings: input.page_settings,
            add_pages: input.add_pages,
            rename_pages: input.rename_pages,
            remove: input.remove,
            updates: input.updates?.map((u) => ({
              ...u,
              relation: u.relation as DrawioRelation | undefined,
            })),
            add_nodes: input.add_nodes?.map((n) => mapNode(n)),
            add_edges: input.add_edges?.map((e) => ({
              ...e,
              relation: e.relation as DrawioRelation | undefined,
            })),
            layout: input.layout,
          });
        } catch (e) {
          return fail(input.path, e);
        }
      },
    }),
    add_diagram_node: tool({
      description:
        "Add one shape (including ArchiMate). Prefer mutate_diagram with add_nodes[] when adding several.",
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
            add_nodes: [mapNode(node)],
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
        "Add one edge (optionally ArchiMate relation). Prefer mutate_diagram with add_edges[].",
      inputSchema: z.object({
        path: z.string(),
        page: z.string().optional(),
        ...edgeFields,
      }),
      execute: async (input) => {
        try {
          const { path, page, ...edge } = input;
          const result = await runMutate(path, {
            page,
            add_edges: [
              {
                ...edge,
                relation: edge.relation as DrawioRelation | undefined,
              },
            ],
          });
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
        "Update one element (label, geometry, colors, align, sketch, relation, parent, waypoints). Prefer mutate_diagram with updates[].",
      inputSchema: z.object({
        path: z.string(),
        page: z.string().optional(),
        ...updateFields,
      }),
      execute: async (input) => {
        try {
          const { path, page, ...update } = input;
          const result = await runMutate(path, {
            page,
            updates: [
              {
                ...update,
                relation: update.relation as DrawioRelation | undefined,
              },
            ],
          });
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
        "Remove one node/edge (nodes cascade children and connected edges). Prefer mutate_diagram with remove[].",
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
