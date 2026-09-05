import { AudioPlayer } from "../../components/audio/AudioPlayer";
import { joinPath, parentPath } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import { selectAtomBlockOnMouseDown } from "../selectAtomBlock";

export function resolveAudioEmbedPath(
  src: string,
  notePath: string | null | undefined,
): string {
  const trimmed = src.trim().replace(/^\/+/, "");
  if (!trimmed) return "";
  if (trimmed.includes("/")) return trimmed;
  if (!notePath) return trimmed;
  const folder = parentPath(notePath);
  return folder ? joinPath(folder, trimmed) : trimmed;
}

export function AudioEmbedView(props: {
  block: { id: string; props: { src: string } };
  editor: {
    isEditable: boolean;
    prosemirrorView?: import("@tiptap/pm/view").EditorView;
  };
}) {
  const { block, editor } = props;
  const notePath = useVaultStore((s) => s.activePath);
  const resolved = resolveAudioEmbedPath(block.props.src, notePath);

  return (
    <div
      className="audio-embed"
      onMouseDown={(e) => selectAtomBlockOnMouseDown(e, editor, block.id)}
    >
      {resolved ? (
        <AudioPlayer path={resolved} />
      ) : (
        <div className="diagram-block__empty">Choose an audio file to embed</div>
      )}
    </div>
  );
}
