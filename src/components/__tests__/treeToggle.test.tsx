/**
 * Regression: expand/collapse must survive parent re-renders (selection,
 * expandedPaths writes). The old @minoru Tree remounted when the DnD root
 * ref callback identity flipped; the new model is pure `expandedPaths` +
 * flattenVisibleWorkspace — no remount.
 */
import { useState } from "react";
import { cleanup, render, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TreeNode } from "../../lib/vaultApi";
import { flattenVisibleWorkspace } from "../sidebar/vaultTreeFlatten";

afterEach(cleanup);

const sample: TreeNode = {
  path: "",
  name: "Vault",
  isDir: true,
  children: [
    {
      path: "Folder",
      name: "Folder",
      isDir: true,
      children: [
        { path: "Folder/note.md", name: "note.md", isDir: false, children: [] },
      ],
    },
  ],
};

function Harness() {
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const rows = flattenVisibleWorkspace(sample, expandedPaths);

  return (
    <div>
      <button type="button" data-testid="rerender" onClick={() => setTick((t) => t + 1)}>
        re-render parent ({tick})
      </button>
      <ul>
        {rows.map((row) => (
          <li key={row.path || "__vault__"}>
            <button
              type="button"
              data-testid={`row-${row.path || "vault"}`}
              onClick={() => {
                if (row.isDir && row.path) {
                  setExpandedPaths((prev) =>
                    prev.includes(row.path)
                      ? prev.filter((p) => p !== row.path)
                      : [...prev, row.path],
                  );
                }
              }}
            >
              {row.name}
              {row.isDir
                ? expandedPaths.includes(row.path) || row.path === ""
                  ? " open"
                  : " closed"
                : ""}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

describe("workspace tree expand persistence", () => {
  it("keeps Folder expanded after unrelated parent re-render", () => {
    render(<Harness />);
    expect(screen.queryByTestId("row-Folder/note.md")).toBeNull();
    fireEvent.click(screen.getByTestId("row-Folder"));
    expect(screen.getByTestId("row-Folder/note.md")).toBeTruthy();
    fireEvent.click(screen.getByTestId("rerender"));
    expect(screen.getByTestId("row-Folder/note.md")).toBeTruthy();
    expect(screen.getByTestId("row-Folder").textContent).toContain("open");
  });
});
