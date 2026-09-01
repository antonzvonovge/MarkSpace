import { create } from "zustand";

export type CaptureDraft = {
  body: string;
  quote?: string;
  sourcePath?: string;
};

type CaptureState = {
  open: boolean;
  draft: CaptureDraft;
  openCapture: (draft?: Partial<CaptureDraft>) => void;
  closeCapture: () => void;
};

const EMPTY_DRAFT: CaptureDraft = { body: "" };

export const useCaptureStore = create<CaptureState>((set) => ({
  open: false,
  draft: EMPTY_DRAFT,
  openCapture: (draft) => {
    set({
      open: true,
      draft: {
        body: draft?.body?.trim() ?? "",
        quote: draft?.quote?.trim() || undefined,
        sourcePath: draft?.sourcePath?.trim() || undefined,
      },
    });
  },
  closeCapture: () => {
    set({ open: false, draft: EMPTY_DRAFT });
  },
}));

/** Open capture from hotkeys/handlers without subscribing to the store. */
export function openCaptureDialog(draft?: Partial<CaptureDraft>): void {
  useCaptureStore.getState().openCapture(draft);
}
