// Regression test for the tree expand/collapse reset bug.
//
// FileTree scopes HTML5Backend to the sidebar via a rootElement held in state.
// An inline ref callback (`ref={(n) => { if (n !== root) setRoot(n) }}`) gets a
// new identity every render, so React detaches it with null on each re-render,
// which set the root to null, unmounted the Tree and remounted it with
// initialOpen — silently resetting open state whenever anything re-rendered
// FileTree (e.g. onChangeOpen writing expandedPaths to the store).
//
// The harness below mirrors FileTree.tsx: scoped backend, memoized initialOpen
// (recomputed only on vault change / remount after rename), onChangeOpen writing
// to parent state, and a STABLE ref (`ref={setDndRoot}`).
import { useMemo, useState } from "react";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Tree, type NodeModel } from "@minoru/react-dnd-treeview";

afterEach(cleanup);

const TREE_ROOT = "__tree_root__";
const VAULT_ID = "__vault__";

type NodeData = { path: string; isDir: boolean };

const flatTree: NodeModel<NodeData>[] = [
  {
    id: VAULT_ID,
    parent: TREE_ROOT,
    text: "Vault",
    droppable: true,
    data: { path: "", isDir: true },
  },
  {
    id: "Folder",
    parent: VAULT_ID,
    text: "Folder",
    droppable: true,
    data: { path: "Folder", isDir: true },
  },
  {
    id: "Folder/note.md",
    parent: "Folder",
    text: "note",
    droppable: false,
    data: { path: "Folder/note.md", isDir: false },
  },
];

const renamedFlatTree: NodeModel<NodeData>[] = [
  {
    id: VAULT_ID,
    parent: TREE_ROOT,
    text: "Vault",
    droppable: true,
    data: { path: "", isDir: true },
  },
  {
    id: "Renamed",
    parent: VAULT_ID,
    text: "Renamed",
    droppable: true,
    data: { path: "Renamed", isDir: true },
  },
  {
    id: "Renamed/note.md",
    parent: "Renamed",
    text: "note",
    droppable: false,
    data: { path: "Renamed/note.md", isDir: false },
  },
];

function remapExpanded(expanded: string[], from: string, to: string): string[] {
  return expanded.map((p) => {
    if (p === from) return to;
    if (p.startsWith(`${from}/`)) return `${to}${p.slice(from.length)}`;
    return p;
  });
}

function Harness() {
  // Mimics the vault store: onChangeOpen re-renders this component, and
  // selecting a folder (row click) also re-renders it.
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [dndRoot, setDndRoot] = useState<HTMLDivElement | null>(null);

  const backendOptions = useMemo(
    () => (dndRoot ? { rootElement: dndRoot } : null),
    [dndRoot],
  );

  const initialOpen = useMemo(
    () => [VAULT_ID, ...expandedPaths],
    // Matches FileTree: only recomputed on vault change / remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ["vault"],
  );

  return (
    <div ref={setDndRoot} data-selected={selectedFolder}>
      {backendOptions ? (
        <DndProvider backend={HTML5Backend} options={backendOptions}>
          <Tree
            key="vault"
            tree={flatTree}
            rootId={TREE_ROOT}
            sort={false}
            insertDroppableFirst={false}
            dropTargetOffset={10}
            initialOpen={initialOpen}
            canDrag={(node) => node?.id !== VAULT_ID}
            onChangeOpen={(openIds) => {
              setExpandedPaths(
                openIds.map(String).filter((id) => id !== VAULT_ID),
              );
            }}
            onDrop={() => {}}
            render={(node, { isOpen, onToggle }) => {
              const isDir = Boolean(node.droppable);
              const isVault = node.id === VAULT_ID;
              return (
                <div
                  data-testid={`row-${node.id}`}
                  onClick={() => {
                    if (isDir) {
                      setSelectedFolder(String(node.id));
                      if (!isVault) onToggle();
                    }
                  }}
                >
                  {isDir ? (
                    <span
                      role="button"
                      tabIndex={0}
                      data-testid={`chevron-${node.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle();
                      }}
                    >
                      {isOpen ? "v" : ">"}
                    </span>
                  ) : null}
                  <span>{node.text}</span>
                </div>
              );
            }}
          />
        </DndProvider>
      ) : null}
    </div>
  );
}

/** Mirrors FileTree after rename: remount Tree with remapped initialOpen. */
function RenameHarness() {
  const [expandedPaths, setExpandedPaths] = useState<string[]>(["Folder"]);
  const [tree, setTree] = useState(flatTree);
  const [treeEpoch, setTreeEpoch] = useState(0);
  const [dndRoot, setDndRoot] = useState<HTMLDivElement | null>(null);

  const backendOptions = useMemo(
    () => (dndRoot ? { rootElement: dndRoot } : null),
    [dndRoot],
  );

  const initialOpen = useMemo(
    () => [VAULT_ID, ...expandedPaths],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [treeEpoch],
  );

  return (
    <div ref={setDndRoot}>
      <button
        type="button"
        data-testid="rename"
        onClick={() => {
          setExpandedPaths((prev) => remapExpanded(prev, "Folder", "Renamed"));
          setTree(renamedFlatTree);
          setTreeEpoch((n) => n + 1);
        }}
      >
        Rename
      </button>
      {backendOptions ? (
        <DndProvider backend={HTML5Backend} options={backendOptions}>
          <Tree
            key={`vault:${treeEpoch}`}
            tree={tree}
            rootId={TREE_ROOT}
            sort={false}
            insertDroppableFirst={false}
            dropTargetOffset={10}
            initialOpen={initialOpen}
            canDrag={(node) => node?.id !== VAULT_ID}
            onChangeOpen={(openIds) => {
              setExpandedPaths(
                openIds.map(String).filter((id) => id !== VAULT_ID),
              );
            }}
            onDrop={() => {}}
            render={(node, { isOpen, onToggle }) => {
              const isDir = Boolean(node.droppable);
              return (
                <div data-testid={`row-${node.id}`}>
                  {isDir ? (
                    <span
                      role="button"
                      tabIndex={0}
                      data-testid={`chevron-${node.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle();
                      }}
                    >
                      {isOpen ? "v" : ">"}
                    </span>
                  ) : null}
                  <span>{node.text}</span>
                </div>
              );
            }}
          />
        </DndProvider>
      ) : null}
    </div>
  );
}

describe("tree expand/collapse", () => {
  it("expands and collapses via chevron click", () => {
    const { queryByTestId, getByTestId } = render(<Harness />);

    expect(queryByTestId("row-Folder/note.md")).toBeNull();

    fireEvent.click(getByTestId("chevron-Folder"));
    expect(queryByTestId("row-Folder/note.md")).not.toBeNull();

    fireEvent.click(getByTestId("chevron-Folder"));
    expect(queryByTestId("row-Folder/note.md")).toBeNull();
  });

  it("expands and collapses via row click (also selects the folder)", () => {
    const { queryByTestId, getByTestId } = render(<Harness />);

    fireEvent.click(getByTestId("row-Folder"));
    expect(queryByTestId("row-Folder/note.md")).not.toBeNull();

    fireEvent.click(getByTestId("row-Folder"));
    expect(queryByTestId("row-Folder/note.md")).toBeNull();
  });

  it("keeps open state across repeated toggles and re-renders", () => {
    const { queryByTestId, getByTestId } = render(<Harness />);

    fireEvent.click(getByTestId("chevron-Folder"));
    expect(queryByTestId("row-Folder/note.md")).not.toBeNull();

    fireEvent.click(getByTestId("chevron-Folder"));
    expect(queryByTestId("row-Folder/note.md")).toBeNull();

    fireEvent.click(getByTestId("chevron-Folder"));
    expect(queryByTestId("row-Folder/note.md")).not.toBeNull();
  });

  it("keeps a folder expanded after its path is remapped", () => {
    const { queryByTestId, getByTestId } = render(<RenameHarness />);

    expect(queryByTestId("row-Folder/note.md")).not.toBeNull();

    fireEvent.click(getByTestId("rename"));

    expect(queryByTestId("row-Folder/note.md")).toBeNull();
    expect(queryByTestId("row-Renamed/note.md")).not.toBeNull();
  });
});
