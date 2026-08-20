import { NoteEditor } from "../editor/NoteEditor";
import { INCOMING_TAB_PATH } from "../store/vaultStore";

export function IncomingView({
  path,
  content,
  isActive,
  keepLiveMounted,
  onChange,
}: {
  path: string;
  content: string;
  isActive: boolean;
  keepLiveMounted: boolean;
  onChange: (markdown: string) => void;
}) {
  if (path === INCOMING_TAB_PATH) {
    return (
      <div className="document-editor-slot is-active incoming-empty-wrap">
        <div className="incoming-empty empty-state">
          <h1>Incoming</h1>
          <p>
            Set a project type to Diary to keep today&apos;s daily note in this
            editor.
          </p>
        </div>
      </div>
    );
  }

  if (!keepLiveMounted) return null;

  return (
    <div className="document-editor-slot is-active">
      <NoteEditor
        path={path}
        content={content}
        isActive={isActive}
        onChange={onChange}
      />
    </div>
  );
}
