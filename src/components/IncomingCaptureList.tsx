import { memo, useCallback } from "react";
import type { IncomingCaptureEntry } from "../lib/incomingCaptureIndex";
import { formatCaptureListTime } from "../lib/incomingCaptureIndex";
import { useVaultStore } from "../store/vaultStore";
import { IncomingSectionIcon } from "./treeIcons";

function rowPad(depth: number): string {
  return `calc(var(--tree-pad-x) + ${depth + 1} * var(--tree-indent))`;
}

const IncomingCaptureRow = memo(function IncomingCaptureRow({
  entry,
  onOpen,
}: {
  entry: IncomingCaptureEntry;
  onOpen: (path: string) => void;
}) {
  const label = entry.snippet || entry.path.split("/").pop()?.replace(/\.md$/i, "") || entry.path;
  return (
    <button
      type="button"
      className="incoming-capture-row"
      style={{ paddingLeft: rowPad(0) }}
      title={entry.source ? `${label}\n${entry.source}` : label}
      onClick={() => onOpen(entry.path)}
    >
      <span className="incoming-capture-row-icon" aria-hidden>
        <IncomingSectionIcon />
      </span>
      <span className="incoming-capture-snippet">{label}</span>
      <span className="incoming-capture-time">
        {formatCaptureListTime(entry.captured)}
      </span>
    </button>
  );
});

export const IncomingCaptureList = memo(function IncomingCaptureList({
  entries,
}: {
  entries: IncomingCaptureEntry[];
}) {
  const openNote = useVaultStore((s) => s.openNote);
  const onOpen = useCallback(
    (path: string) => {
      void openNote(path, { preview: true });
    },
    [openNote],
  );

  if (entries.length === 0) {
    return <p className="incoming-capture-empty">No captures yet</p>;
  }

  return (
    <>
      {entries.map((entry) => (
        <IncomingCaptureRow key={entry.path} entry={entry} onOpen={onOpen} />
      ))}
    </>
  );
});
