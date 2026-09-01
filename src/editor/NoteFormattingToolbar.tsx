import { FormattingToolbarExtension } from "@blocknote/core/extensions";
import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useBlockNoteEditor,
  useComponentsContext,
  useExtension,
} from "@blocknote/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { RiChat3Line, RiChatQuoteLine, RiInboxLine, RiLink } from "react-icons/ri";
import { useChatStore } from "../store/chatStore";
import { useChatUiStore } from "../store/chatUiStore";

type NoteFormattingToolbarActions = {
  notePath: string;
  onComment: () => void;
  onCapture: () => void;
  onInsertNoteLink: () => void;
};

const NoteFormattingToolbarContext =
  createContext<NoteFormattingToolbarActions | null>(null);

export function NoteFormattingToolbarProvider({
  notePath,
  onComment,
  onCapture,
  onInsertNoteLink,
  children,
}: NoteFormattingToolbarActions & { children: ReactNode }) {
  const value = useMemo(
    () => ({ notePath, onComment, onCapture, onInsertNoteLink }),
    [notePath, onComment, onCapture, onInsertNoteLink],
  );
  return (
    <NoteFormattingToolbarContext.Provider value={value}>
      {children}
    </NoteFormattingToolbarContext.Provider>
  );
}

function useNoteFormattingToolbarActions(): NoteFormattingToolbarActions {
  const ctx = useContext(NoteFormattingToolbarContext);
  if (!ctx) {
    throw new Error(
      "Note formatting toolbar buttons require NoteFormattingToolbarProvider",
    );
  }
  return ctx;
}

function NoteLinkToolbarButton() {
  const Components = useComponentsContext()!;
  const { store } = useExtension(FormattingToolbarExtension);
  const { onInsertNoteLink } = useNoteFormattingToolbarActions();

  const onClick = useCallback(() => {
    onInsertNoteLink();
    store.setState(false);
  }, [onInsertNoteLink, store]);

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label="Note link"
      mainTooltip="Insert note link"
      icon={<RiLink size={18} />}
      onClick={onClick}
    />
  );
}

function AddToChatToolbarButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const { store } = useExtension(FormattingToolbarExtension);
  const { notePath } = useNoteFormattingToolbarActions();

  const onClick = useCallback(() => {
    const text = editor.getSelectedText();
    if (!text.trim()) return;
    useChatStore.getState().addSelectionToDraft(text, notePath);
    useChatUiStore.getState().setOpen(true);
    store.setState(false);
  }, [editor, notePath, store]);

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label="Add to chat"
      mainTooltip="Add selection to chat"
      icon={<RiChatQuoteLine size={18} />}
      onClick={onClick}
    />
  );
}

function CommentToolbarButton() {
  const Components = useComponentsContext()!;
  const { store } = useExtension(FormattingToolbarExtension);
  const { onComment } = useNoteFormattingToolbarActions();

  const onClick = useCallback(() => {
    onComment();
    store.setState(false);
  }, [onComment, store]);

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label="Comment"
      mainTooltip="Comment"
      icon={<RiChat3Line size={18} />}
      onClick={onClick}
    />
  );
}

function CaptureToolbarButton() {
  const Components = useComponentsContext()!;
  const { store } = useExtension(FormattingToolbarExtension);
  const { onCapture } = useNoteFormattingToolbarActions();

  const onClick = useCallback(() => {
    onCapture();
    store.setState(false);
  }, [onCapture, store]);

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label="Capture to Incoming"
      mainTooltip="Capture to Incoming"
      icon={<RiInboxLine size={18} />}
      onClick={onClick}
    />
  );
}

/** Default BlockNote formatting toolbar plus note link / Add to chat / Comment. */
export function NoteFormattingToolbar() {
  return (
    <FormattingToolbar>
      {...getFormattingToolbarItems()}
      <NoteLinkToolbarButton key="noteLinkButton" />
      <AddToChatToolbarButton key="addToChatButton" />
      <CommentToolbarButton key="commentButton" />
      <CaptureToolbarButton key="captureButton" />
    </FormattingToolbar>
  );
}
