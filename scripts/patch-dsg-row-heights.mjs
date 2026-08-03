#!/usr/bin/env node
/**
 * Re-apply after `npm install`: fixes react-datasheet-grid variable row heights
 * (stale cache + one-row-per-frame remount jerk).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  root,
  "node_modules/react-datasheet-grid/dist/hooks/useRowHeights.js",
);

const patched = `"use strict";
/**
 * Patched react-datasheet-grid useRowHeights (see scripts/patch-dsg-row-heights.mjs).
 * Fixes: stale height cache; one-row-per-frame fill on remount; empty-cache crash.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.useRowHeights = void 0;
const react_1 = require("react");
const useRowHeights = ({ value, rowHeight }) => {
  const calculatedHeights = (0, react_1.useRef)([]);
  const [, rerender] = (0, react_1.useState)(0);
  const prevRowHeight = (0, react_1.useRef)(rowHeight);
  const prevValue = (0, react_1.useRef)(value);
  if (prevRowHeight.current !== rowHeight || prevValue.current !== value) {
    calculatedHeights.current = [];
    prevRowHeight.current = rowHeight;
    prevValue.current = value;
  }
  return (0, react_1.useMemo)(() => {
    const getRowIndex = (top) => {
      if (typeof rowHeight === "number") {
        return Math.min(
          value.length - 1,
          Math.max(-1, Math.floor(top / rowHeight)),
        );
      }
      let l = 0;
      let r = calculatedHeights.current.length - 1;
      while (l <= r) {
        const m = Math.floor((l + r) / 2);
        if (calculatedHeights.current[m].top < top) {
          l = m + 1;
        } else if (calculatedHeights.current[m].top > top) {
          r = m - 1;
        } else {
          return m;
        }
      }
      if (
        r === calculatedHeights.current.length - 1 &&
        value.length > calculatedHeights.current.length &&
        (!calculatedHeights.current.length ||
          top >=
            calculatedHeights.current[r].top +
              calculatedHeights.current[r].height)
      ) {
        let lastBottom =
          r === -1
            ? 0
            : calculatedHeights.current[r].top +
              calculatedHeights.current[r].height;
        do {
          r++;
          const height = rowHeight({ rowIndex: r, rowData: value[r] });
          calculatedHeights.current.push({
            height,
            top: lastBottom,
          });
          lastBottom += height;
        } while (lastBottom <= top && r < value.length - 1);
      }
      return r;
    };
    return {
      resetAfter: (index) => {
        calculatedHeights.current = calculatedHeights.current.slice(0, index);
        rerender((x) => x + 1);
      },
      getRowSize: (index) => {
        if (typeof rowHeight === "number") {
          return { height: rowHeight, top: rowHeight * index };
        }
        if (index >= value.length) {
          return { height: 0, top: 0 };
        }
        if (index < calculatedHeights.current.length) {
          return calculatedHeights.current[index];
        }
        let lastBottom = 0;
        if (calculatedHeights.current.length > 0) {
          const last =
            calculatedHeights.current[calculatedHeights.current.length - 1];
          lastBottom = last.top + last.height;
        }
        for (let i = calculatedHeights.current.length; i <= index; i++) {
          const height = rowHeight({ rowIndex: i, rowData: value[i] });
          calculatedHeights.current.push({ height, top: lastBottom });
          lastBottom += height;
        }
        return calculatedHeights.current[index];
      },
      getRowIndex,
      totalSize: (maxHeight) => {
        if (typeof rowHeight === "number") {
          return value.length * rowHeight;
        }
        if (value.length === 0) return 0;
        const index = getRowIndex(maxHeight);
        if (index < 0 || !calculatedHeights.current[index]) return 0;
        return (
          calculatedHeights.current[index].top +
          calculatedHeights.current[index].height
        );
      },
    };
  }, [rowHeight, value]);
};
exports.useRowHeights = useRowHeights;
//# sourceMappingURL=useRowHeights.js.map
`;

if (!fs.existsSync(target)) {
  console.warn("[patch-dsg-row-heights] skip: file not found", target);
  process.exit(0);
}
fs.writeFileSync(target, patched);
console.log("[patch-dsg-row-heights] patched", path.relative(root, target));
