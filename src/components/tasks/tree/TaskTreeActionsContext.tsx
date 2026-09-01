import {
  createContext,
  useContext,
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
  onEditDraftChange: (patch: Partial<TasksComposerDraft>) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
};

export type TaskTreeEditState = {
  editingId: string | null;
  editDraft: TasksComposerDraft | null;
  editLists: string[];
  editListColors: Record<string, string>;
  editLabelCatalog: string[];
  editTitleRef: RefObject<HTMLInputElement | null>;
};

const ActionsContext = createContext<TaskTreeActions | null>(null);
const EditContext = createContext<TaskTreeEditState | null>(null);

export function TaskTreeActionsProvider({
  actions,
  edit,
  children,
}: {
  actions: TaskTreeActions;
  edit: TaskTreeEditState;
  children: ReactNode;
}) {
  return (
    <ActionsContext.Provider value={actions}>
      <EditContext.Provider value={edit}>{children}</EditContext.Provider>
    </ActionsContext.Provider>
  );
}

export function useTaskTreeActions(): TaskTreeActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) {
    throw new Error("useTaskTreeActions outside TaskTreeActionsProvider");
  }
  return ctx;
}

export function useTaskTreeEdit(): TaskTreeEditState {
  const ctx = useContext(EditContext);
  if (!ctx) {
    throw new Error("useTaskTreeEdit outside TaskTreeActionsProvider");
  }
  return ctx;
}
