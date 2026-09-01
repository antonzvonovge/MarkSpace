import {
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { TaskIndexEntry } from "../../../lib/taskNotes";
import { taskEntriesToTreeItems } from "./buildTreeItems";
import { StaticTaskTreeRow } from "./TaskTreeRow";
import {
  TaskTreeActionsProvider,
  type TaskTreeActions,
  type TaskTreeEditState,
} from "./TaskTreeActionsContext";
import {
  TaskTreeAddComposerProvider,
  type TaskTreeAddComposerState,
} from "./TaskTreeAddComposerContext";
import { buildTaskTreeDisplayRows } from "./taskTreeDisplayRows";
import type { TaskTreeItems } from "./types";
import { flattenTree, removeChildrenOf } from "./utilities";
import type { TasksComposerDraft } from "../TasksComposer";

const INDENTATION_WIDTH = 28;

export const TasksPlainTree = memo(function TasksPlainTree({
  entries,
  expanded,
  selectedPath,
  actions,
  edit,
  completingPaths,
  todayYmd,
  showListChip = false,
  listColors = {},
  addComposerParentPath = null,
  addDraft,
  addTitleRef,
  addLists = [],
  addListColors = {},
  addLabelCatalog = [],
  onPatchAddDraft,
  onSubmitAddSubtask,
  onCancelAddSubtask,
  onStartAddSubtask,
}: {
  entries: readonly TaskIndexEntry[];
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  actions: TaskTreeActions;
  edit: TaskTreeEditState | null;
  completingPaths: ReadonlySet<string>;
  todayYmd: string;
  showListChip?: boolean;
  listColors?: Record<string, string>;
  addComposerParentPath?: string | null;
  addDraft?: TasksComposerDraft;
  addTitleRef?: RefObject<HTMLTextAreaElement | null>;
  addLists?: string[];
  addListColors?: Record<string, string>;
  addLabelCatalog?: string[];
  onPatchAddDraft?: (patch: Partial<TasksComposerDraft>) => void;
  onSubmitAddSubtask?: (parentPath: string) => void;
  onCancelAddSubtask?: () => void;
  onStartAddSubtask?: (parentPath: string) => void;
}): ReactNode {
  const [items, setItems] = useState<TaskTreeItems>(() =>
    taskEntriesToTreeItems(entries, expanded),
  );

  useEffect(() => {
    setItems(taskEntriesToTreeItems(entries, expanded));
  }, [entries, expanded]);

  const flattenedItems = useMemo(() => {
    const flattenedTree = flattenTree(items);
    const collapsedItems = flattenedTree.reduce<typeof flattenedTree[0]["id"][]>(
      (acc, { children, collapsed, id }) =>
        collapsed && children.length ? [...acc, id] : acc,
      [],
    );
    return removeChildrenOf(flattenedTree, collapsedItems);
  }, [items]);

  const displayItems = useMemo(
    () => buildTaskTreeDisplayRows(flattenedItems, addComposerParentPath),
    [flattenedItems, addComposerParentPath],
  );

  const addComposerState = useMemo((): TaskTreeAddComposerState | null => {
    if (
      !addDraft ||
      !addTitleRef ||
      !onPatchAddDraft ||
      !onSubmitAddSubtask ||
      !onCancelAddSubtask ||
      !onStartAddSubtask
    ) {
      return null;
    }
    return {
      addComposerParentPath,
      draft: addDraft,
      lists: addLists,
      listColors: addListColors,
      labelCatalog: addLabelCatalog,
      titleRef: addTitleRef,
      indentationWidth: INDENTATION_WIDTH,
      onPatchDraft: onPatchAddDraft,
      onSubmit: onSubmitAddSubtask,
      onCancel: onCancelAddSubtask,
      onStartAddSubtask,
    };
  }, [
    addComposerParentPath,
    addDraft,
    addTitleRef,
    addLists,
    addListColors,
    addLabelCatalog,
    onPatchAddDraft,
    onSubmitAddSubtask,
    onCancelAddSubtask,
    onStartAddSubtask,
  ]);

  return (
    <TaskTreeActionsProvider actions={actions}>
      <TaskTreeAddComposerProvider value={addComposerState}>
        <ul className="tasks-list tasks-tree-list">
          {displayItems.map((item) => {
            const itemId = String(item.id);
            const isEditing = edit != null && String(edit.editingId) === itemId;
            const selected = item.kind === "task" && selectedPath === item.path;
            return (
              <StaticTaskTreeRow
                key={itemId}
                item={item}
                depth={item.depth}
                indentationWidth={INDENTATION_WIDTH}
                selected={selected}
                isCompleting={completingPaths.has(item.path)}
                isEditing={isEditing}
                edit={isEditing && edit ? edit : null}
                todayYmd={todayYmd}
                showListChip={showListChip}
                listColors={listColors}
              />
            );
          })}
        </ul>
      </TaskTreeAddComposerProvider>
    </TaskTreeActionsProvider>
  );
});
