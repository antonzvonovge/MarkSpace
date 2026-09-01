import { createContext, useContext, type ReactNode, type RefObject } from "react";
import type { TasksComposerDraft } from "../TasksComposer";

export type TaskTreeAddComposerState = {
  addComposerParentPath: string | null;
  draft: TasksComposerDraft;
  lists: string[];
  listColors: Record<string, string>;
  labelCatalog: string[];
  titleRef: RefObject<HTMLInputElement | null>;
  indentationWidth: number;
  onPatchDraft: (patch: Partial<TasksComposerDraft>) => void;
  onSubmit: (parentPath: string) => void;
  onCancel: () => void;
  onStartAddSubtask: (parentPath: string) => void;
};

const AddComposerContext = createContext<TaskTreeAddComposerState | null>(null);

export function TaskTreeAddComposerProvider({
  value,
  children,
}: {
  value: TaskTreeAddComposerState | null;
  children: ReactNode;
}) {
  return (
    <AddComposerContext.Provider value={value}>
      {children}
    </AddComposerContext.Provider>
  );
}

export function useTaskTreeAddComposer(): TaskTreeAddComposerState | null {
  return useContext(AddComposerContext);
}
