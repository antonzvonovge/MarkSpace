import { mountChat, type ChatMountHandle } from "../chat/mountChat";
import chatCss from "../chat/chat.css?inline";
import markspaceChatCss from "../chat/markspace-chat.css?inline";
import { makeDraggable } from "./drag";
import { makePanelResizable } from "./resize";
import {
  cacheSelectionRectOnContextMenu,
  clearCachedSelectionRect,
  initialPanelPosition,
} from "./panelPosition";
import {
  applyHostGeometry,
  clampPanelGeometry,
  defaultPanelGeometry,
  readHostGeometry,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
} from "./panelGeometry";
import {
  loadPanelGeometryInPage,
  savePanelGeometryInPage,
} from "../lib/storageClient";
import type { ChatSessionPayload, FreeChatKind, PanelGeometry, AnalysisMode } from "../lib/types";
import panelCss from "./panel.css?inline";

const HOST_ID = "context-gem-host";

cacheSelectionRectOnContextMenu();

type OpenChatMessage = {
  type: "OPEN_CHAT";
  sessionId: string;
  payload: ChatSessionPayload;
};

type OpenGeneralChatMessage = {
  type: "OPEN_GENERAL_CHAT";
};

type OpenDictionaryChatMessage = {
  type: "OPEN_DICTIONARY_CHAT";
};

type OpenAnalysisChatMessage = {
  type: "OPEN_ANALYSIS_CHAT";
  mode: AnalysisMode;
};

type ActivePanel = {
  host: HTMLElement;
  chat: ChatMountHandle;
  disposeListeners: () => void;
};

let activePanel: ActivePanel | null = null;
let saveGeometryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSavePanelGeometry(host: HTMLElement): void {
  if (saveGeometryTimer) clearTimeout(saveGeometryTimer);
  saveGeometryTimer = setTimeout(() => {
    saveGeometryTimer = null;
    void savePanelGeometryInPage(readHostGeometry(host));
  }, 200);
}

function removeActivePanel(): void {
  if (!activePanel) return;
  void savePanelGeometryInPage(readHostGeometry(activePanel.host));
  activePanel.chat.dispose();
  activePanel.disposeListeners();
  activePanel.host.remove();
  clearCachedSelectionRect();
  activePanel = null;
}

function injectStyles(shadow: ShadowRoot): void {
  const style = document.createElement("style");
  style.textContent = `${markspaceChatCss}\n${chatCss}\n${panelCss}`;
  shadow.appendChild(style);
}

function watchHostRemoval(host: HTMLElement, onRemoved: () => void): () => void {
  const observer = new MutationObserver(() => {
    if (!document.contains(host)) onRemoved();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}

async function resolveInitialGeometry(
  widthPx: number,
  heightPx: number,
): Promise<PanelGeometry> {
  const saved = await loadPanelGeometryInPage();
  if (saved) {
    return clampPanelGeometry(saved);
  }

  const { top, left } = initialPanelPosition(widthPx, heightPx);
  return clampPanelGeometry({ top, left, width: widthPx, height: heightPx });
}

function createPanelHost(geometry: PanelGeometry): HTMLElement {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-context-gem", "true");
  applyHostGeometry(host, geometry);
  return host;
}

function mountPanel(
  initialPayload: ChatSessionPayload | null,
  freeChatKind: FreeChatKind = "general",
  analysisMode?: AnalysisMode,
): void {
  void (async () => {
    let host: HTMLElement | null = null;
    try {
      const fallback = defaultPanelGeometry();
      const geometry = await resolveInitialGeometry(
        fallback.width,
        fallback.height,
      );

      host = createPanelHost(geometry);
      const shadow = host.attachShadow({ mode: "closed" });
      injectStyles(shadow);

      const mountRoot = document.createElement("div");
      mountRoot.className = "context-gem-mount";
      shadow.appendChild(mountRoot);

      const chat = mountChat(mountRoot, {
        payload: initialPayload,
        freeChatKind: initialPayload ? undefined : freeChatKind,
        analysisMode: initialPayload ? undefined : analysisMode,
        onClose: removeActivePanel,
      });

      (document.documentElement ?? document.body).appendChild(host);

      const disposers: (() => void)[] = [];
      const onGeometryChange = (): void => {
        if (host) scheduleSavePanelGeometry(host);
      };

      const header = shadow.querySelector(
        ".context-gem-drag-handle",
      ) as HTMLElement | null;
      if (header) {
        disposers.push(makeDraggable(host, header, onGeometryChange));
      }

      disposers.push(
        makePanelResizable(host, mountRoot, {
          minWidth: PANEL_MIN_WIDTH,
          minHeight: PANEL_MIN_HEIGHT,
          onGeometryChange,
        }),
      );

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
          event.preventDefault();
          removeActivePanel();
        }
      };
      document.addEventListener("keydown", onKeyDown, true);
      disposers.push(() =>
        document.removeEventListener("keydown", onKeyDown, true),
      );

      disposers.push(
        watchHostRemoval(host, () => {
          if (!activePanel) return;
          activePanel.chat.dispose();
          activePanel = null;
        }),
      );

      const onPageHide = (): void => removeActivePanel();
      window.addEventListener("pagehide", onPageHide);
      disposers.push(() => window.removeEventListener("pagehide", onPageHide));

      activePanel = {
        host,
        chat,
        disposeListeners: () => {
          for (const dispose of disposers) dispose();
        },
      };
    } catch (error) {
      console.error("[ContextGem] Failed to open panel:", error);
      host?.remove();
    }
  })();
}

function openPanel(payload: ChatSessionPayload): void {
  if (activePanel) {
    activePanel.chat.openSelectionTab(payload);
    return;
  }
  mountPanel(payload);
}

function openAnalysisModePanel(mode: AnalysisMode): void {
  if (activePanel) {
    activePanel.chat.openAnalysisModeTab(mode);
    return;
  }
  mountPanel(null, "general", mode);
}

function openFreePanel(kind: FreeChatKind): void {
  if (activePanel) {
    if (kind === "dictionary") {
      activePanel.chat.openDictionaryTab();
    } else {
      activePanel.chat.openGeneralTab();
    }
    return;
  }
  mountPanel(null, kind);
}

chrome.runtime.onMessage.addListener(
  (
    message:
      | OpenChatMessage
      | OpenGeneralChatMessage
      | OpenDictionaryChatMessage
      | OpenAnalysisChatMessage,
    _sender,
    sendResponse,
  ) => {
    if (message?.type === "OPEN_GENERAL_CHAT") {
      openFreePanel("general");
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "OPEN_DICTIONARY_CHAT") {
      openFreePanel("dictionary");
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === "OPEN_ANALYSIS_CHAT" && message.mode) {
      openAnalysisModePanel(message.mode);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type !== "OPEN_CHAT" || !message.payload?.selection) return;

    openPanel(message.payload);
    sendResponse({ ok: true });
    return true;
  },
);
