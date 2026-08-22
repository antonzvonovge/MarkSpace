import { tool } from "ai";
import { z } from "zod";
import { createToolWait } from "./toolWait";

export const pickVaultFolderInputSchema = z.object({
  prompt: z
    .string()
    .optional()
    .describe("Short question, e.g. Where should I save this session?"),
  suggested: z
    .string()
    .optional()
    .describe(
      "Optional vault-relative folder hint. The UI prefers the user's last chosen folder across chats.",
    ),
});

export type PickVaultFolderInput = z.infer<typeof pickVaultFolderInputSchema>;

export type PickVaultFolderAnswer = {
  folder: string;
};

const folderWait = createToolWait<PickVaultFolderAnswer>("Folder pick");

export function waitForPickVaultFolder(
  toolCallId: string,
  signal?: AbortSignal,
): Promise<PickVaultFolderAnswer> {
  return folderWait.wait(toolCallId, signal);
}

export function resolvePickVaultFolder(
  toolCallId: string,
  answer: PickVaultFolderAnswer,
): boolean {
  return folderWait.resolve(toolCallId, answer);
}

export function cancelAllPendingPickVaultFolder(reason?: string): void {
  folderWait.cancelAll(reason);
}

export function hasPendingPickVaultFolder(toolCallId?: string): boolean {
  return folderWait.has(toolCallId);
}

export function parsePickVaultFolderInput(
  input: unknown,
): PickVaultFolderInput | null {
  const parsed = pickVaultFolderInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parsePickVaultFolderOutput(
  output: unknown,
): { folder?: string } | null {
  if (!output || typeof output !== "object") return null;
  const folder = (output as { folder?: unknown }).folder;
  if (typeof folder !== "string") return null;
  return { folder };
}

export function buildPickVaultFolderTool() {
  return tool({
    description:
      "Ask the user to pick a vault folder (save location). The UI preselects the last folder they used in any chat and has Browse for a compact folder tree. Use this instead of ask_user when you need a folder path. Blocks until they confirm.",
    inputSchema: pickVaultFolderInputSchema,
    execute: async (input, { toolCallId, abortSignal }) => {
      const answer = await waitForPickVaultFolder(toolCallId, abortSignal);
      const folder = answer.folder.replace(/^\/+|\/+$/g, "");
      return {
        ok: true as const,
        folder,
        prompt: input.prompt?.trim() || null,
      };
    },
  });
}
