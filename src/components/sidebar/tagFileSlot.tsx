import { createContext, useContext } from "react";

export const TAG_FILES_COLUMN_WIDTH = 280;
export const TAG_FILES_MIN_WIDTH = 180;
export const TAG_FILES_MAX_WIDTH = 420;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 480;

export function clampTagFilesWidth(width: number): number {
  return Math.min(TAG_FILES_MAX_WIDTH, Math.max(TAG_FILES_MIN_WIDTH, Math.round(width)));
}

/** DOM host for the tag file list, outside the tree scroll but inside the sidebar. */
export const TagFileSlotContext = createContext<HTMLElement | null>(null);

export function useTagFileSlot(): HTMLElement | null {
  return useContext(TagFileSlotContext);
}
