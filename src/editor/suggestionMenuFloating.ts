import { flip, offset, shift, size } from "@floating-ui/react";
import type { FloatingUIOptions } from "@blocknote/react";

/** Flip above the caret when the viewport edge is close; shrink to remaining space. */
export const suggestionMenuFloatingOptions: FloatingUIOptions = {
  useFloatingOptions: {
    middleware: [
      offset(8),
      flip({
        fallbackPlacements: ["top-start"],
        padding: 96,
        rootBoundary: "viewport",
      }),
      shift({ padding: 8, rootBoundary: "viewport" }),
      size({
        apply({ elements, availableHeight }) {
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
        padding: 8,
        rootBoundary: "viewport",
      }),
    ],
  },
};
