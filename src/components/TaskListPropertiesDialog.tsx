import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DialogShell } from "./AppDialog";
import { ColorSelect } from "./ui/ColorSelect";
import { Select } from "./ui/Select";
import { createTaskList } from "../lib/taskNotes";
import {
  newTaskListGroupId,
  setTaskListMeta,
  upsertTaskListGroup,
  type TaskListGroup,
} from "../lib/taskListMeta";

export const NEW_TASK_LIST_GROUP = "__new_group__";

export type TaskListDialogSaveValue = {
  name: string;
  groupId: string;
  color: string;
  newGroupName?: string;
};

export function TaskListPropertiesDialog({
  open,
  mode = "edit",
  listName,
  groupId,
  color,
  groups,
  saving,
  onCancel,
  onSave,
}: {
  open: boolean;
  mode?: "create" | "edit";
  listName: string;
  groupId: string;
  color: string;
  groups: readonly TaskListGroup[];
  saving?: boolean;
  onCancel: () => void;
  onSave: (value: TaskListDialogSaveValue) => void | Promise<void>;
}) {
  const isCreate = mode === "create";
  const nameId = useId();
  const groupIdLabel = useId();
  const colorId = useId();
  const newGroupFieldId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(listName);
  const [group, setGroup] = useState(groupId);
  const [newGroupName, setNewGroupName] = useState("");
  const [listColor, setListColor] = useState(color);

  useEffect(() => {
    if (!open) return;
    setName(listName);
    setGroup(groupId);
    setNewGroupName("");
    setListColor(color);
    const id = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      if (!isCreate) nameRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, listName, groupId, color, isCreate]);

  const groupOptions = useMemo(
    () => [
      { value: "", label: "No group" },
      ...groups.map((g) => ({ value: g.id, label: g.name })),
      { value: NEW_TASK_LIST_GROUP, label: "Create new…" },
    ],
    [groups],
  );

  const showNewGroup = group === NEW_TASK_LIST_GROUP;
  const canSubmit =
    Boolean(name.trim()) &&
    (!showNewGroup || Boolean(newGroupName.trim())) &&
    !saving;

  const submit = () => {
    if (!canSubmit) return;
    void onSave({
      name: name.trim(),
      groupId: showNewGroup ? NEW_TASK_LIST_GROUP : group,
      color: listColor,
      newGroupName: showNewGroup ? newGroupName.trim() : undefined,
    });
  };

  return (
    <DialogShell
      open={open}
      title={isCreate ? "New list" : "List settings"}
      description={
        isCreate
          ? "Create a folder under Tasks. Pick a group or create a new one."
          : "Change the list name, group, and icon color."
      }
      onCancel={onCancel}
      footer={
        <>
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
            disabled={!canSubmit}
            onClick={submit}
          >
            {saving
              ? isCreate
                ? "Creating…"
                : "Saving…"
              : isCreate
                ? "Create"
                : "Save"}
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
              submit();
            }
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <label className="app-dialog-label" htmlFor={groupIdLabel}>
          Group
        </label>
        <p className="app-dialog-hint">
          Choose an existing group or create a new one.
        </p>
        <Select
          variant="field"
          aria-labelledby={groupIdLabel}
          value={group}
          disabled={saving}
          options={groupOptions}
          onChange={setGroup}
        />
        {showNewGroup ? (
          <>
            <label className="app-dialog-label" htmlFor={newGroupFieldId}>
              New group name
            </label>
            <input
              id={newGroupFieldId}
              className="app-dialog-input"
              value={newGroupName}
              disabled={saving}
              onChange={(e) => setNewGroupName(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </>
        ) : null}
        <label className="app-dialog-label" id={colorId}>
          Color
        </label>
        <ColorSelect
          variant="field"
          aria-labelledby={colorId}
          value={listColor}
          disabled={saving}
          onChange={setListColor}
        />
      </div>
    </DialogShell>
  );
}

/** Resolve group id when saving (creates a new group if needed). */
export async function resolveTaskListGroupOnSave(
  groupId: string,
  newGroupName: string | undefined,
  groups: readonly TaskListGroup[],
): Promise<string> {
  if (groupId !== NEW_TASK_LIST_GROUP) return groupId;
  const trimmed = (newGroupName ?? "").trim();
  if (!trimmed) return "";
  const maxOrder = groups.reduce((m, g) => Math.max(m, g.order), -1);
  const created = await upsertTaskListGroup(
    newTaskListGroupId(),
    trimmed,
    maxOrder + 1,
  );
  return created.id;
}

export async function saveTaskListProperties(
  currentName: string,
  value: {
    name: string;
    groupId: string;
    color: string;
    newGroupName?: string;
  },
  opts: {
    groups: readonly TaskListGroup[];
    renameList: (from: string, to: string) => Promise<string | null>;
  },
): Promise<string> {
  const resolvedGroupId = await resolveTaskListGroupOnSave(
    value.groupId,
    value.newGroupName,
    opts.groups,
  );

  let finalName = currentName;
  if (value.name !== currentName) {
    const renamed = await opts.renameList(currentName, value.name);
    if (!renamed) throw new Error("Rename failed");
    finalName = value.name;
  }

  await setTaskListMeta(finalName, {
    groupId: resolvedGroupId,
    color: value.color,
  });
  return finalName;
}

export async function createTaskListWithSettings(
  value: TaskListDialogSaveValue,
  groups: readonly TaskListGroup[],
): Promise<string> {
  const name = await createTaskList(value.name);
  const resolvedGroupId = await resolveTaskListGroupOnSave(
    value.groupId,
    value.newGroupName,
    groups,
  );
  await setTaskListMeta(name, {
    groupId: resolvedGroupId,
    color: value.color,
  });
  return name;
}
