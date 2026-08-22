import { memo, useEffect, useMemo, useState } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import {
  parsePickVaultFolderInput,
  parsePickVaultFolderOutput,
  resolvePickVaultFolder,
} from "../../ai/pickVaultFolder";
import {
  folderExistsInTree,
  getLastVaultFolder,
  setLastVaultFolder,
} from "../../lib/lastVaultFolder";
import { useVaultStore } from "../../store/vaultStore";
import { VaultFolderBrowseDialog } from "../VaultFolderBrowseDialog";

type Props = {
  part: UIMessage["parts"][number];
};

function toolNameOf(part: UIMessage["parts"][number]): string {
  if ("toolName" in part && typeof part.toolName === "string") return part.toolName;
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  return part.type;
}

function toolCallIdOf(part: UIMessage["parts"][number]): string | null {
  if ("toolCallId" in part && typeof part.toolCallId === "string" && part.toolCallId) {
    return part.toolCallId;
  }
  const rec = part as { callId?: unknown };
  if (typeof rec.callId === "string" && rec.callId) return rec.callId;
  return null;
}

function ChatPickVaultFolderInner({ part }: Props) {
  const isPick =
    isToolUIPart(part) && toolNameOf(part) === "pick_vault_folder";
  const state = isPick && "state" in part ? String(part.state) : "unknown";
  const toolCallId = isPick ? toolCallIdOf(part) : null;
  const input = isPick
    ? parsePickVaultFolderInput("input" in part ? part.input : undefined)
    : null;
  const output = isPick
    ? parsePickVaultFolderOutput("output" in part ? part.output : undefined)
    : null;
  const err =
    isPick && state === "output-error" && "errorText" in part
      ? String(part.errorText ?? "Error")
      : null;
  const awaiting =
    state === "input-available" ||
    state === "input-streaming" ||
    state === "approval-requested";

  const tree = useVaultStore((s) => s.tree);
  const [folder, setFolder] = useState("");
  const [browse, setBrowse] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const initial = useMemo(() => {
    const last = getLastVaultFolder();
    if (last && folderExistsInTree(tree, last)) return last;
    const suggested = input?.suggested?.replace(/^\/+|\/+$/g, "") ?? "";
    if (suggested && folderExistsInTree(tree, suggested)) return suggested;
    return last || suggested;
  }, [tree, input?.suggested]);

  useEffect(() => {
    setFolder(initial);
  }, [toolCallId, initial]);

  useEffect(() => {
    setSubmitting(false);
  }, [toolCallId]);

  const submit = (raw?: string) => {
    const path = typeof raw === "string" ? raw : folder;
    const rel = path.replace(/^\/+|\/+$/g, "");
    if (!rel || submitting) return;
    setSubmitting(true);
    setLastVaultFolder(rel);
    resolvePickVaultFolder(toolCallId ?? "__folder__", { folder: rel });
  };

  if (!isPick) return null;

  if (!awaiting && output?.folder) {
    return (
      <div className="chat-ask-user is-done">
        <div className="chat-ask-user-title">Folder</div>
        <p className="chat-pick-folder-path">{output.folder}</p>
      </div>
    );
  }

  if (!awaiting) {
    return (
      <div className={`chat-ask-user${err ? " is-error" : ""}`}>
        <div className="chat-ask-user-title">Folder</div>
        {err ? <div className="chat-ask-user-error">{err}</div> : null}
      </div>
    );
  }

  return (
    <div className="chat-ask-user">
      <div className="chat-ask-user-title">
        {input?.prompt?.trim() || "Where should I save this?"}
      </div>
      <p className="chat-pick-folder-path">
        {folder || "No folder selected"}
      </p>
      <div className="chat-ask-user-actions chat-pick-folder-actions">
        <button
          type="button"
          className="app-dialog-btn"
          onClick={() => setBrowse(true)}
        >
          Browse
        </button>
        <button
          type="button"
          className="chat-ask-user-submit"
          disabled={!folder.trim() || submitting}
          onClick={() => submit()}
        >
          Use folder
        </button>
      </div>
      <VaultFolderBrowseDialog
        open={browse}
        selectedPath={folder}
        onCancel={() => setBrowse(false)}
        onChoose={(next) => {
          setFolder(next);
          setBrowse(false);
          submit(next);
        }}
      />
    </div>
  );
}

export const ChatPickVaultFolder = memo(ChatPickVaultFolderInner);
