import { vaultProjectRootOf } from "./diaryNotes";
import { isVaultDocumentPath, isVaultProjectFolder } from "./vaultApi";

/** Vault project folder containing `path`, or null if none / reserved root. */
export function projectPathForVaultItem(path: string): string | null {
  const cleaned = path.trim().replace(/^\/+|\/+$/g, "");
  if (!cleaned) return null;

  if (!cleaned.includes("/")) {
    if (isVaultDocumentPath(cleaned)) return null;
    if (!isVaultProjectFolder(cleaned, true)) return null;
    return cleaned;
  }

  const root = vaultProjectRootOf(cleaned);
  if (!root || !isVaultProjectFolder(root, true)) return null;
  return root;
}
