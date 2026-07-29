/** Inject MarkSpace tweaks into the same-origin draw.io iframe. */

const STYLE_ID = "markspace-drawio-tweaks";
const PATCH_FLAG = "__markspaceMxKeyPatch";

const FORMAT_CSS = `
/* Do not force width here — draw.io collapses the format panel via width:0;
   !important would lock it open. Width is set via formatWidth in JS instead. */
div.geFormatContainer {
  font-size: 12px !important;
}
.geFormatSection select,
.geFormatEntry select,
.geFormatSection input:not([type="checkbox"], [type="radio"]),
.geFormatEntry input:not([type="checkbox"], [type="radio"]),
.geFormatSection button:not(.geColorBtn) {
  box-sizing: border-box !important;
  height: 24px !important;
  min-height: 24px !important;
  max-height: 24px !important;
  font-size: 11px !important;
  line-height: 22px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  vertical-align: middle !important;
}
.geFormatSection select,
.geFormatEntry select {
  min-width: 110px !important;
  text-align: center !important;
  text-align-last: center !important;
  /* WebKit: keep the value visually centered in the fixed-height control */
  -webkit-appearance: menulist !important;
  appearance: menulist !important;
}
.geFormatSection input:not([type="checkbox"], [type="radio"]),
.geFormatEntry input:not([type="checkbox"], [type="radio"]) {
  min-width: 68px !important;
  text-align: right !important;
  padding-left: 4px !important;
  padding-right: 4px !important;
}
/* Fill/line style selects are absolutely positioned with a tight inline width. */
.geFormatSection select[style*="width: 90px"],
.geFormatEntry select[style*="width: 90px"] {
  width: 120px !important;
}
.geFormatSection select[style*="width: 98px"],
.geFormatEntry select[style*="width: 98px"] {
  width: 124px !important;
}
.geFormatSection input[style*="width: 52px"],
.geFormatEntry input[style*="width: 52px"],
.geFormatSection input[style*="width: 50px"],
.geFormatEntry input[style*="width: 50px"] {
  width: 68px !important;
}
`;

type MxKeyHandlerProto = {
  getFunction?: (evt: KeyboardEvent) => ((evt: KeyboardEvent) => void) | null;
};

function injectCss(doc: Document): void {
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = FORMAT_CSS;
}

/**
 * mxKeyHandler binds Ctrl+Z via keyCode 90. On non-Latin layouts some WebViews
 * report a different keyCode for the physical Z key. Remap via event.code.
 */
function patchMxKeyHandler(win: Window): void {
  const flagged = win as Window & { [PATCH_FLAG]?: boolean };
  if (flagged[PATCH_FLAG]) return;

  const mxKeyHandler = (
    win as unknown as { mxKeyHandler?: { prototype: MxKeyHandlerProto } }
  ).mxKeyHandler;
  const proto = mxKeyHandler?.prototype;
  if (!proto?.getFunction) return;

  flagged[PATCH_FLAG] = true;
  const original = proto.getFunction;
  proto.getFunction = function patchedGetFunction(this: unknown, evt: KeyboardEvent) {
    if (evt && (evt.ctrlKey || evt.metaKey) && !evt.altKey) {
      const want =
        evt.code === "KeyZ" ? 90 : evt.code === "KeyY" ? 89 : null;
      if (want != null && evt.keyCode !== want) {
        const remapped = new Proxy(evt, {
          get(target, prop, receiver) {
            if (prop === "keyCode" || prop === "which" || prop === "charCode") {
              return want;
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return original.call(this, remapped);
      }
    }
    return original.call(this, evt);
  };
}

function bumpFormatWidth(win: Window): void {
  const EditorUi = (
    win as unknown as { EditorUi?: { prototype: { formatWidth?: number } } }
  ).EditorUi;
  // Raise default open width only; never overwrite 0 (collapsed).
  if (
    EditorUi?.prototype &&
    typeof EditorUi.prototype.formatWidth === "number" &&
    EditorUi.prototype.formatWidth > 0 &&
    EditorUi.prototype.formatWidth < 300
  ) {
    EditorUi.prototype.formatWidth = 300;
  }

  const mxSettings = (
    win as unknown as {
      mxSettings?: {
        setFormatWidth?: (n: number) => void;
        getFormatWidth?: () => number;
      };
    }
  ).mxSettings;
  const settingsWidth = mxSettings?.getFormatWidth?.() ?? 0;
  if (mxSettings?.setFormatWidth && settingsWidth > 0 && settingsWidth < 300) {
    mxSettings.setFormatWidth(300);
  }

  // Prefer the live App/EditorUi instance if draw.io exposed it.
  const candidates = [
    (win as unknown as { editorUi?: FormatUi }).editorUi,
    (win as unknown as { ui?: FormatUi }).ui,
  ];
  for (const ui of candidates) {
    if (!ui) continue;
    if (
      typeof ui.formatWidth === "number" &&
      ui.formatWidth > 0 &&
      ui.formatWidth < 300
    ) {
      ui.formatWidth = 300;
      if (ui.formatContainer) ui.formatContainer.style.width = "300px";
      ui.refresh?.(true);
    }
  }
}

type FormatUi = {
  formatWidth?: number;
  formatContainer?: HTMLElement;
  refresh?: (force?: boolean) => void;
};

/** Apply CSS + layout-agnostic undo/redo inside the draw.io iframe. */
export function applyDrawioIframeTweaks(iframe: HTMLIFrameElement | null): void {
  const win = iframe?.contentWindow;
  const doc = iframe?.contentDocument;
  if (!win || !doc?.head) return;
  try {
    injectCss(doc);
    patchMxKeyHandler(win);
    bumpFormatWidth(win);
  } catch {
    // Not ready / transient access error.
  }
}
