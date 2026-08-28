import { loadPanelGeometry, loadSettings, saveChatSession, savePanelGeometry } from "../lib/storage";
import type { AnalysisMode, ExtensionSettings, PanelGeometry } from "../lib/types";

const MENU_TEACHING = "context-gem-teaching";
const MENU_PROFESSIONAL = "context-gem-professional";
const MENU_STUDENT = "context-gem-student";
const MENU_SEPARATOR = "context-gem-separator";
const MENU_GENERAL_CHAT = "context-gem-general-chat";
const MENU_DICTIONARY_CHAT = "context-gem-dictionary-chat";
const MENU_CONTEXTS = ["page", "selection"] as const;

type GetSettingsMessage = { type: "GET_SETTINGS" };
type SettingsResponse = { settings: ExtensionSettings };
type GetPanelGeometryMessage = { type: "GET_PANEL_GEOMETRY" };
type SavePanelGeometryMessage = {
  type: "SAVE_PANEL_GEOMETRY";
  geometry: PanelGeometry;
};

function registerContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_TEACHING,
      title: "Explain for class",
      contexts: [...MENU_CONTEXTS],
    });
    chrome.contextMenus.create({
      id: MENU_PROFESSIONAL,
      title: "Expert analysis for teacher",
      contexts: [...MENU_CONTEXTS],
    });
    chrome.contextMenus.create({
      id: MENU_STUDENT,
      title: "Explain for IELTS student",
      contexts: [...MENU_CONTEXTS],
    });
    chrome.contextMenus.create({
      id: MENU_SEPARATOR,
      type: "separator",
      contexts: [...MENU_CONTEXTS],
    });
    chrome.contextMenus.create({
      id: MENU_GENERAL_CHAT,
      title: "New chat",
      contexts: [...MENU_CONTEXTS],
    });
    chrome.contextMenus.create({
      id: MENU_DICTIONARY_CHAT,
      title: "Dictionary chat",
      contexts: [...MENU_CONTEXTS],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  registerContextMenus();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener(
  (
    message:
      | GetSettingsMessage
      | GetPanelGeometryMessage
      | SavePanelGeometryMessage,
    _sender,
    sendResponse,
  ) => {
    if (message?.type === "GET_SETTINGS") {
      void loadSettings().then((settings) => {
        sendResponse({ settings } satisfies SettingsResponse);
      });
      return true;
    }

    if (message?.type === "GET_PANEL_GEOMETRY") {
      void loadPanelGeometry().then((geometry) => {
        sendResponse({ geometry });
      });
      return true;
    }

    if (message?.type === "SAVE_PANEL_GEOMETRY" && message.geometry) {
      void savePanelGeometry(message.geometry).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    return undefined;
  },
);

async function openChatPanel(
  tabId: number,
  frameId: number,
  sessionId: string,
  payload: {
    selection: string;
    pageUrl: string;
    pageTitle: string;
    mode: AnalysisMode;
  },
): Promise<void> {
  await chrome.tabs.sendMessage(
    tabId,
    {
      type: "OPEN_CHAT" as const,
      sessionId,
      payload,
    },
    { frameId },
  );
}

async function openFreeChatPanel(
  tabId: number,
  frameId: number,
  kind: "general" | "dictionary",
): Promise<void> {
  await chrome.tabs.sendMessage(
    tabId,
    kind === "dictionary"
      ? ({ type: "OPEN_DICTIONARY_CHAT" } as const)
      : ({ type: "OPEN_GENERAL_CHAT" } as const),
    { frameId },
  );
}

async function openAnalysisModePanel(
  tabId: number,
  frameId: number,
  mode: AnalysisMode,
): Promise<void> {
  await chrome.tabs.sendMessage(
    tabId,
    { type: "OPEN_ANALYSIS_CHAT" as const, mode },
    { frameId },
  );
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuId = info.menuItemId;
  if (tab?.id == null) return;

  if (menuId === MENU_GENERAL_CHAT) {
    try {
      await openFreeChatPanel(tab.id, info.frameId ?? 0, "general");
    } catch (error) {
      console.error("ContextGem: could not open general chat", error);
    }
    return;
  }

  if (menuId === MENU_DICTIONARY_CHAT) {
    try {
      await openFreeChatPanel(tab.id, info.frameId ?? 0, "dictionary");
    } catch (error) {
      console.error("ContextGem: could not open dictionary chat", error);
    }
    return;
  }

  if (
    menuId !== MENU_TEACHING &&
    menuId !== MENU_PROFESSIONAL &&
    menuId !== MENU_STUDENT
  ) {
    return;
  }

  const mode: AnalysisMode =
    menuId === MENU_PROFESSIONAL
      ? "professional"
      : menuId === MENU_STUDENT
        ? "student"
        : "teaching";

  const selection = info.selectionText?.trim() ?? "";
  if (!selection) {
    try {
      await openAnalysisModePanel(tab.id, info.frameId ?? 0, mode);
    } catch (error) {
      console.error("ContextGem: could not open analysis chat", error);
    }
    return;
  }

  const sessionId = crypto.randomUUID();
  const payload = {
    selection,
    pageUrl: tab.url ?? info.pageUrl ?? "",
    pageTitle: tab.title ?? "",
    mode,
  };

  await saveChatSession(sessionId, payload);

  try {
    await openChatPanel(tab.id, info.frameId ?? 0, sessionId, payload);
  } catch (error) {
    console.error("ContextGem: could not open panel", error);
  }
});
