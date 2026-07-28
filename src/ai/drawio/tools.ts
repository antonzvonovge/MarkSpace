import { tool } from "ai";
import { z } from "zod";
import { createDrawio, readNote, writeNote } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import type { ChatMode } from "../types";
import {
  addEdge,
  addNode,
  removeElement,
  summarizeDrawio,
  updateElement,
  type DrawioShape,
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
  useVaultStore.setState({ content, dirty: false });
  state.markExternalWrite();
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
}

export function buildDrawioTools(mode: ChatMode) {
  const readTools = {
    read_diagram: tool({
      description:
        "Read a .drawio diagram as a semantic summary (pages, nodes, edges with ids/labels/geometry). Prefer this over read_note for diagrams — raw XML is huge and hard to edit.",
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
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            path,
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
        "Create a new empty .drawio diagram in the vault (adds .drawio if missing).",
      inputSchema: z.object({
        path: z.string().describe("Desired path, e.g. Diagrams/Auth.drawio"),
      }),
      execute: async ({ path }) => {
        try {
          const created = await createDrawio(path);
          return { ok: true as const, path: created };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            path,
          };
        }
      },
    }),
    add_diagram_node: tool({
      description:
        "Add a labeled shape (vertex) to a .drawio diagram. Returns the new cell id. Call read_diagram first if you need existing ids.",
      inputSchema: z.object({
        path: z.string(),
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
        page: z.string().optional(),
        id: z.string().optional().describe("Optional explicit cell id"),
      }),
      execute: async (input) => {
        try {
          const xml = await loadXml(input.path);
          const result = await addNode(xml, {
            label: input.label,
            shape: input.shape as DrawioShape | undefined,
            x: input.x,
            y: input.y,
            width: input.width,
            height: input.height,
            style: input.style,
            fill_color: input.fill_color,
            stroke_color: input.stroke_color,
            font_color: input.font_color,
            page: input.page,
            id: input.id,
          });
          await saveXml(input.path, result.xml);
          return {
            ok: true as const,
            path: assertDrawioPath(input.path),
            id: result.id,
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            path: input.path,
          };
        }
      },
    }),
    add_diagram_edge: tool({
      description:
        "Connect two existing nodes in a .drawio diagram with an edge. source/target are cell ids from read_diagram.",
      inputSchema: z.object({
        path: z.string(),
        source: z.string().min(1),
        target: z.string().min(1),
        label: z.string().optional(),
        style: z.string().optional(),
        ...colorFields,
        page: z.string().optional(),
        id: z.string().optional(),
      }),
      execute: async (input) => {
        try {
          const xml = await loadXml(input.path);
          const result = await addEdge(xml, input);
          await saveXml(input.path, result.xml);
          return {
            ok: true as const,
            path: assertDrawioPath(input.path),
            id: result.id,
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            path: input.path,
          };
        }
      },
    }),
    update_diagram_element: tool({
      description:
        "Update label, geometry, colors (fill/stroke/font), style, or edge endpoints of a node/edge by cell id.",
      inputSchema: z.object({
        path: z.string(),
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
        page: z.string().optional(),
      }),
      execute: async (input) => {
        try {
          const xml = await loadXml(input.path);
          const result = await updateElement(xml, input);
          await saveXml(input.path, result.xml);
          return {
            ok: true as const,
            path: assertDrawioPath(input.path),
            id: result.id,
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            path: input.path,
          };
        }
      },
    }),
    remove_diagram_element: tool({
      description:
        "Remove a node or edge by cell id. Removing a node also removes connected edges.",
      inputSchema: z.object({
        path: z.string(),
        id: z.string().min(1),
        page: z.string().optional(),
      }),
      execute: async (input) => {
        try {
          const xml = await loadXml(input.path);
          const result = await removeElement(xml, input);
          await saveXml(input.path, result.xml);
          return {
            ok: true as const,
            path: assertDrawioPath(input.path),
            id: result.id,
            removed: result.removed,
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            path: input.path,
          };
        }
      },
    }),
  };
}
