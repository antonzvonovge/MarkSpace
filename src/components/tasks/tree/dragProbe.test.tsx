// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent } from "@testing-library/react";
import type { TaskIndexEntry } from "../../../lib/taskNotes";

const persistSpy = vi.fn(async () => undefined);
vi.mock("./persistTaskTreeDrag", () => ({
  persistTaskTreeDrag: (...args: unknown[]) => persistSpy(...(args as [])),
}));

const ROW_H = 44;

beforeAll(() => {
  // @ts-expect-error react act env flag
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // @ts-expect-error test polyfill
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (typeof globalThis.PointerEvent === "undefined") {
    // @ts-expect-error test polyfill
    globalThis.PointerEvent = class extends MouseEvent {
      pointerId: number;
      constructor(type: string, props: PointerEventInit = {}) {
        super(type, props);
        this.pointerId = props.pointerId ?? 1;
      }
    };
  }
  // @ts-expect-error test polyfill
  Element.prototype.setPointerCapture = function () {};
  // @ts-expect-error test polyfill
  Element.prototype.releasePointerCapture = function () {};
  Element.prototype.scrollIntoView = function () {};
});

function entry(
  p: Partial<TaskIndexEntry> & Pick<TaskIndexEntry, "path" | "title" | "id">,
): TaskIndexEntry {
  return {
    status: "open",
    due: null,
    priority: null,
    labels: [],
    created: null,
    parent: null,
    list: "Inbox",
    subtaskTotal: 0,
    subtaskDone: 0,
    commentCount: 0,
    subtasks: [],
    description: "",
    ...p,
  };
}

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function stubRects(container: HTMLElement) {
  const lis = Array.from(
    container.querySelectorAll("li.tasks-tree-item"),
  ) as HTMLElement[];
  lis.forEach((li, i) => {
    const top = i * ROW_H;
    li.getBoundingClientRect = () =>
      ({
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + ROW_H,
        right: 600,
        width: 600,
        height: ROW_H,
        toJSON: () => ({}),
      }) as DOMRect;
  });
  return lis;
}

async function dragRow(
  container: HTMLElement,
  rowIndex: number,
  dx: number,
  dy: number,
) {
  const lis = stubRects(container);
  const li = lis[rowIndex]!;
  const row = li.querySelector(".tasks-row") as HTMLElement;
  await act(async () => {
    fireEvent.mouseEnter(row);
  });

  const grip = li.querySelector(".tasks-row-drag") as HTMLElement | null;
  if (!grip) throw new Error(`no drag handle on row ${rowIndex}`);

  const startX = 100;
  const startY = rowIndex * ROW_H + ROW_H / 2;

  await act(async () => {
    fireEvent.pointerDown(grip, {
      clientX: startX,
      clientY: startY,
      pointerId: 1,
      button: 0,
      isPrimary: true,
    });
  });

  for (const [x, y] of [
    [startX + 12, startY],
    [startX + dx, startY + dy],
    [startX + dx, startY + dy],
  ]) {
    await act(async () => {
      fireEvent.pointerMove(document, {
        clientX: x,
        clientY: y,
        pointerId: 1,
      });
    });
    stubRects(container);
  }

  await act(async () => {
    fireEvent.pointerUp(document, {
      clientX: startX + dx,
      clientY: startY + dy,
      pointerId: 1,
    });
  });
}

async function mountTree(expanded: string[]) {
  const { TasksSortableTree } = await import("./TasksSortableTree");
  const React = await import("react");

  const entries = [
    entry({ path: "Tasks/Inbox/a.md", id: ID_A, title: "A" }),
    entry({ path: "Tasks/Inbox/b.md", id: ID_B, title: "B" }),
    entry({ path: "Tasks/Inbox/c.md", id: ID_C, title: "C" }),
  ];

  const actions = {
    onSelect: vi.fn(),
    onToggleCollapse: vi.fn(),
    onToggleStatus: vi.fn(),
    onEditTitle: vi.fn(),
    onCommitEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onEditDraftChange: vi.fn(),
    onPickDue: vi.fn(),
    onStartAddSubtask: vi.fn(),
    onOpenComments: vi.fn(),
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(TasksSortableTree, {
        entries,
        expanded: new Set(expanded),
        selectedPath: null,
        sortable: true,
        vaultTree: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        actions: actions as any,
        edit: null,
        completingPaths: new Set<string>(),
        todayYmd: "2026-09-01",
        onExpandPath: vi.fn(),
        onPersisted: vi.fn(),
      }),
    );
  });
  return { container };
}

describe("drag probe", () => {
  it("end-to-end drag calls persist", async () => {
    persistSpy.mockClear();
    const { container } = await mountTree([]);
    expect(container.querySelectorAll("li.tasks-tree-item").length).toBe(3);
    await dragRow(container, 2, 30, 0);
    expect(persistSpy).toHaveBeenCalled();
  });

  it("nest: getProjection depth 1 for in-place right drag", async () => {
    const { getProjection, flattenTree } = await import("./utilities");
    const { taskEntriesToTreeItems } = await import("./buildTreeItems");
    const flat = flattenTree(
      taskEntriesToTreeItems(
        [
          entry({ path: "Tasks/Inbox/a.md", id: ID_A, title: "A" }),
          entry({ path: "Tasks/Inbox/b.md", id: ID_B, title: "B" }),
          entry({ path: "Tasks/Inbox/c.md", id: ID_C, title: "C" }),
        ],
        new Set(),
      ),
    );
    const c = flat.find((i) => i.title === "C")!;
    const proj = getProjection(flat, c.id, c.id, 30, 28);
    expect(proj.depth).toBe(1);
    expect(String(proj.parentId)).toContain("b.md");
  });

  it("outdent: drag subtask left", async () => {
    persistSpy.mockClear();
    const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const idC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const { TasksSortableTree } = await import("./TasksSortableTree");
    const React = await import("react");
    const entries = [
      entry({
        path: "Tasks/Inbox/a.md",
        id: idA,
        title: "A",
        subtaskTotal: 2,
      }),
      entry({
        path: "Tasks/Inbox/b.md",
        id: idB,
        title: "B",
        parent: idA,
      }),
      entry({
        path: "Tasks/Inbox/c.md",
        id: idC,
        title: "C",
        parent: idA,
      }),
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const actions = {
      onSelect: vi.fn(),
      onToggleCollapse: vi.fn(),
      onToggleStatus: vi.fn(),
      onEditTitle: vi.fn(),
      onCommitEdit: vi.fn(),
      onCancelEdit: vi.fn(),
      onEditDraftChange: vi.fn(),
      onPickDue: vi.fn(),
      onStartAddSubtask: vi.fn(),
      onOpenComments: vi.fn(),
    };
    await act(async () => {
      root.render(
        React.createElement(TasksSortableTree, {
          entries,
          expanded: new Set(["Tasks/Inbox/a.md"]),
          selectedPath: null,
          sortable: true,
          vaultTree: null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actions: actions as any,
          edit: null,
          completingPaths: new Set<string>(),
          todayYmd: "2026-09-01",
          onExpandPath: vi.fn(),
          onPersisted: vi.fn(),
        }),
      );
    });

    await dragRow(container, 1, -30, 0);

    expect(persistSpy).toHaveBeenCalled();
    const call = persistSpy.mock.calls[0]![0] as {
      projected: { depth: number; parentId: string | null };
    };
    expect(call.projected.depth).toBe(0);
    expect(call.projected.parentId).toBeNull();
  });
});
