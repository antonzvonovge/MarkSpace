import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import type { TasksComposerDraft } from "../TasksComposer";
import type { FlattenedTaskItem, TaskTreeItem } from "./types";

export type TaskTreeActions = {
  onSelect: (path: string) => void;
  onOpenComments: (path: string) => void;
  onToggleStatus: (item: FlattenedTaskItem) => void;
  onToggleCollapse: (path: string) => void;
  onEditTitle: (item: TaskTreeItem) => void;
  onDueChange: (path: string, due: string | null) => void;
  onPickDue: (path: string, clientX: number, clientY: number) => void;
  onEditDraftChange: (patch: Partial<TasksComposerDraft>) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onStartAddSubtask: (parentPath: string) => void;
};

export type TaskTreeEditState = {
  editingId: string;
  editDraft: TasksComposerDraft;
  editLists: string[];
  editListColors: Record<string, string>;
  editLabelCatalog: string[];
  editTitleRef: RefObject<HTMLInputElement | null>;
};

const ActionsContext = createContext<TaskTreeActions | null>(null);

/** Stable context value — row memo is not busted when the parent rebuilds actions. */
export function TaskTreeActionsProvider({
  actions,
  children,
}: {
  actions: TaskTreeActions;
  children: ReactNode;
}) {
  const ref = useRef(actions);
  ref.current = actions;
  const stable = useMemo<TaskTreeActions>(
    () => ({
      onSelect: (path) => ref.current.onSelect(path),
      onOpenComments: (path) => ref.current.onOpenComments(path),
      onToggleStatus: (item) => ref.current.onToggleStatus(item),
      onToggleCollapse: (path) => ref.current.onToggleCollapse(path),
      onEditTitle: (item) => ref.current.onEditTitle(item),
      onDueChange: (path, due) => ref.current.onDueChange(path, due),
      onPickDue: (path, x, y) => ref.current.onPickDue(path, x, y),
      onEditDraftChange: (patch) => ref.current.onEditDraftChange(patch),
      onCommitEdit: () => ref.current.onCommitEdit(),
      onCancelEdit: () => ref.current.onCancelEdit(),
      onStartAddSubtask: (path) => ref.current.onStartAddSubtask(path),
    }),
    [],
  );
  return (
    <ActionsContext.Provider value={stable}>{children}</ActionsContext.Provider>
  );
}

export function useTaskTreeActions(): TaskTreeActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) {
    throw new Error("useTaskTreeActions outside TaskTreeActionsProvider");
  }
  return ctx;
}
