import { createExtension } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { AudioPlayer } from "../../components/audio/AudioPlayer";
import { joinPath, parentPath } from "../../lib/vaultApi";
import { parseAudioFenceBody } from "../../lib/wikiMarkdown";
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

function parseAudioElement(element: HTMLElement): { src: string } | undefined {
  if (element.tagName !== "PRE") return undefined;
  if (
    element.childElementCount !== 1 ||
    element.firstElementChild?.tagName !== "CODE"
  ) {
    return undefined;
  }
  const codeEl = element.firstElementChild!;
  const language =
    codeEl.getAttribute("data-language") ||
    codeEl.className
      .split(/\s+/)
      .find((name) => name.startsWith("language-"))
      ?.replace("language-", "");
  if (language !== "audio") return undefined;
  const src = parseAudioFenceBody(codeEl.textContent ?? "");
  if (!src) return undefined;
  return { src };
}

function AudioEmbedView(props: {
  block: { id: string; props: { src: string } };
  editor: {
    isEditable: boolean;
    prosemirrorView?: import("prosemirror-view").EditorView;
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

export const createAudioBlock = createReactBlockSpec(
  {
    type: "audio",
    propSchema: {
      src: { default: "" },
    },
    content: "none",
  },
  {
    meta: {
      isolating: true,
    },
    runsBefore: ["codeBlock"],
    parse: (element) => parseAudioElement(element),
    toExternalHTML: ({ block }) => (
      <pre>
        <code data-language="audio">{block.props.src}</code>
      </pre>
    ),
    render: (props) => <AudioEmbedView {...props} />,
  },
  [
    createExtension({
      key: "audio-input-rule",
      runsBefore: ["code-block-keyboard-shortcuts"],
      inputRules: [
        {
          find: /^```audio\s$/,
          replace: () => ({
            type: "audio",
            props: { src: "" },
          }),
        },
      ],
    }),
  ],
);
