import { useEffect, useId, useMemo, useRef, useState } from "react";
import { modelSupportsReasoning } from "../ai/models";
import type { AiModelOption } from "../ai/types";
import {
  deleteGem,
  upsertGem,
  type Gem,
} from "../lib/gemsApi";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { vaultChatModelId } from "../store/vaultAiSettingsStore";
import { ConfirmDialog, DialogShell } from "./AppDialog";
import { ChatModelPicker } from "./chat/ChatModelPicker";
import { ReasoningToggle } from "./chat/ReasoningToggle";

export type GemEditorDialogProps = {
  open: boolean;
  /** Null = create mode. */
  gem: Gem | null;
  onCancel: () => void;
  /** Called after successful save (created or updated). */
  onSaved: (gem: Gem) => void;
  /** Called after successful delete. */
  onDeleted?: (gemId: string) => void;
};

export function GemEditorDialog({
  open,
  gem,
  onCancel,
  onSaved,
  onDeleted,
}: GemEditorDialogProps) {
  const nameId = useId();
  const instructionsId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const settings = useAiSettingsStore((s) => s.settings);
  const models: AiModelOption[] = settings.models.length
    ? settings.models
    : [];

  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [modelId, setModelId] = useState(vaultChatModelId());
  const [enableReasoning, setEnableReasoning] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isEdit = gem != null;

  useEffect(() => {
    if (!open) return;
    const catalog = settings.models.length ? settings.models : [];
    const nextModel = gem?.modelId || vaultChatModelId();
    setName(gem?.name ?? "");
    setInstructions(gem?.instructions ?? "");
    setModelId(nextModel);
    setEnableReasoning(
      gem
        ? gem.enableReasoning !== false
        : modelSupportsReasoning(nextModel, catalog),
    );
    setSaving(false);
    setError(null);
    setConfirmDelete(false);
    const id = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, gem, settings.models]);

  const modelOptions =
    modelId && !models.some((m) => m.id === modelId)
      ? [
          {
            id: modelId,
            label: modelId,
            vendor: "openai" as const,
            kind: "chat" as const,
            tier: "flagship" as const,
          },
          ...models,
        ]
      : models;

  const reasoningSupported = useMemo(
    () => modelSupportsReasoning(modelId, modelOptions),
    [modelId, modelOptions],
  );

  const canSave =
    name.trim().length > 0 &&
    instructions.trim().length > 0 &&
    modelId.trim().length > 0 &&
    !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertGem({
        id: gem?.id,
        name: name.trim(),
        instructions: instructions.trim(),
        modelId: modelId.trim(),
        enableReasoning: reasoningSupported ? enableReasoning : false,
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!gem) return;
    setSaving(true);
    setError(null);
    try {
      await deleteGem(gem.id);
      setConfirmDelete(false);
      onDeleted?.(gem.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <DialogShell
        open={open && !confirmDelete}
        title={isEdit ? "Edit gem" : "New gem"}
        onCancel={onCancel}
        wide
        footer={
          <>
            {isEdit ? (
              <button
                type="button"
                className="app-dialog-btn is-danger"
                disabled={saving}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            ) : null}
            <span className="app-dialog-footer-spacer" />
            <button
              type="button"
              className="app-dialog-btn"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="app-dialog-btn is-primary"
              disabled={!canSave}
              onClick={() => void submit()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <div className="app-dialog-body">
          <label className="app-dialog-label" htmlFor={nameId}>
            Name
          </label>
          <input
            ref={nameRef}
            id={nameId}
            className="app-dialog-input"
            value={name}
            disabled={saving}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />

          <label className="app-dialog-label" htmlFor={instructionsId}>
            Instructions
          </label>
          <textarea
            id={instructionsId}
            className="app-dialog-input app-dialog-textarea"
            rows={8}
            value={instructions}
            disabled={saving}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="How this Gem should behave…"
          />

          <label className="app-dialog-label" id="gem-model-label">
            Model
          </label>
          <div className="gem-model-row">
            <ChatModelPicker
              models={modelOptions}
              value={modelId}
              disabled={saving}
              variant="field"
              onChange={(next) => {
                setModelId(next);
                setEnableReasoning(modelSupportsReasoning(next, modelOptions));
              }}
            />
            <ReasoningToggle
              supported={reasoningSupported}
              mode={enableReasoning ? "on" : "off"}
              allowAuto={false}
              disabled={saving}
              onChange={(next) => setEnableReasoning(next !== "off")}
            />
          </div>

          {error ? <p className="app-dialog-error">{error}</p> : null}
        </div>
      </DialogShell>

      <ConfirmDialog
        open={open && confirmDelete}
        title="Delete gem"
        description={
          gem
            ? `Delete “${gem.name}”? This cannot be undone.`
            : "Delete this gem?"
        }
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      />
    </>
  );
}
