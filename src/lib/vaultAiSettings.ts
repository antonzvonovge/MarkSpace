/** Vault AI model defaults — `.markspace/ai.json`. Keys stay in app settings. */

export const DEFAULT_WORKER_MODEL_ID = "openai/gpt-4.1-mini";

export type VaultAiSettings = {
  version: number;
  /** `null` = inherit app `AiSettings.modelId`. */
  chatModelId: string | null;
  /** `null` = inherit `DEFAULT_WORKER_MODEL_ID`. */
  workerModelId: string | null;
};

export const EMPTY_VAULT_AI_SETTINGS: VaultAiSettings = {
  version: 1,
  chatModelId: null,
  workerModelId: null,
};

function normalizeModelId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > 160 || !id.includes("/")) return null;
  if (!/^[\x21-\x7E]+$/.test(id) || /[<>"]/.test(id)) return null;
  return id;
}

export function normalizeVaultAiSettings(
  raw: Partial<VaultAiSettings> | null | undefined,
): VaultAiSettings {
  if (!raw || typeof raw !== "object") return { ...EMPTY_VAULT_AI_SETTINGS };
  return {
    version: 1,
    chatModelId: normalizeModelId(raw.chatModelId),
    workerModelId: normalizeModelId(raw.workerModelId),
  };
}

export function effectiveChatModelId(
  doc: VaultAiSettings,
  appModelId: string,
): string {
  return doc.chatModelId?.trim() || appModelId.trim() || "anthropic/claude-sonnet-5";
}

export function effectiveWorkerModelId(doc: VaultAiSettings): string {
  return doc.workerModelId?.trim() || DEFAULT_WORKER_MODEL_ID;
}
