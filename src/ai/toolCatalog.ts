import type { ChatMode } from "./types";
import { buildVaultTools } from "./vaultTools";

export type ToolMeta = {
  id: string;
  description: string;
};

/** Tools available in the current chat mode (for composer @ menu). */
export function listChatTools(mode: ChatMode): ToolMeta[] {
  const tools = buildVaultTools(mode);
  const out: ToolMeta[] = [];
  for (const [id, t] of Object.entries(tools)) {
    const description =
      typeof t.description === "string" ? t.description.trim() : "";
    out.push({ id, description });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** System-prompt lines when the user pinned tools via @ chips. */
export function formatForcedToolsLines(ids: string[] | null | undefined): string[] {
  const cleaned = (ids ?? []).map((id) => id.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const unique = [...new Set(cleaned)];
  return [
    `User requested tool(s) for this turn: ${unique.map((id) => `@${id}`).join(", ")}. Prefer calling them when relevant for this turn.`,
  ];
}
