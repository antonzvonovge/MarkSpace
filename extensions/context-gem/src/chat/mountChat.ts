import { GeminiError, streamGeminiChat, toGeminiContents } from "../lib/gemini";
import {
  renderMarkdownToHtml,
  renderStreamingMarkdownParts,
} from "../lib/markdown";
import {
  buildInitialAnalysisUserMessage,
  buildSystemPrompt,
} from "../lib/prompts";
import { loadSettingsInPage } from "../lib/storageClient";
import { analysisModeMenuLabel, freeChatModeMenuLabel } from "../lib/chatMenu";
import type { ChatMessage, ChatSessionPayload, AnalysisMode, ExplanationLanguage, FreeChatKind } from "../lib/types";
import {
  setupHorizontalOverlayScrollbar,
} from "./overlayScrollbar";
import { setupNewTabMenu } from "./newTabMenu";
import { getPageSelectionText } from "../content/panelPosition";
import {
  CHAT_TAB_ICON_SVG,
  CLOSE_ICON_SVG,
  COPY_ICON_SVG,
  NEW_CHAT_ICON_SVG,
  SEND_ICON_SVG,
  STOP_ICON_SVG,
} from "./icons";

const COMPOSER_MIN_HEIGHT = 24;
const COMPOSER_MAX_HEIGHT = 160;

type ChatTab = {
  id: string;
  ariaLabel: string;
  tabBtn: HTMLButtonElement;
  paneEl: HTMLElement;
  messagesEl: HTMLElement;
  modeIslandEl: HTMLElement | null;
  sessionPayload: ChatSessionPayload | null;
  analysisMode: AnalysisMode | null;
  freeChatKind: FreeChatKind | null;
  visibleHistory: ChatMessage[];
  composerDraft: string;
  streaming: boolean;
  abortController: AbortController | null;
};

type ChatRefs = {
  themeRoot: HTMLElement;
  tabScrollEl: HTMLElement;
  tabListEl: HTMLElement;
  tabScrollbarEl: HTMLElement;
  tabScrollbarThumbEl: HTMLElement;
  tabPanesEl: HTMLElement;
  newTabBtn: HTMLButtonElement;
  newTabMenuEl: HTMLElement;
  composerEl: HTMLElement;
  composerInput: HTMLTextAreaElement;
  sendBtn: HTMLButtonElement;
};

export type MountChatOptions = {
  payload?: ChatSessionPayload | null;
  freeChatKind?: FreeChatKind;
  analysisMode?: AnalysisMode;
  onClose: () => void;
};

type CreateTabOptions = {
  ariaLabel: string;
  sessionPayload: ChatSessionPayload | null;
  analysisMode?: AnalysisMode | null;
  freeChatKind?: FreeChatKind | null;
  autoAnalyze?: boolean;
};

let nextTabId = 1;

function makeTabId(): string {
  return `tab-${nextTabId++}`;
}

function tabAriaLabel(payload: ChatSessionPayload): string {
  return tabAriaLabelForMode(payload.mode);
}

function tabAriaLabelForMode(mode: AnalysisMode): string {
  if (mode === "professional") return "Expert analysis";
  if (mode === "student") return "IELTS student";
  return "Class explanation";
}

function analysisModeForTab(tab: ChatTab): AnalysisMode {
  return tab.sessionPayload?.mode ?? tab.analysisMode ?? "teaching";
}

function isFreeChatTab(tab: ChatTab): boolean {
  return tab.sessionPayload == null && tab.analysisMode == null;
}

function freeChatKindForTab(tab: ChatTab): FreeChatKind | undefined {
  if (!isFreeChatTab(tab)) return undefined;
  return tab.freeChatKind ?? "general";
}

function composerPlaceholderForTab(tab: ChatTab | undefined): string {
  if (!tab || isFreeChatTab(tab)) {
    if (tab?.freeChatKind === "dictionary") return "Word or phrase…";
    return tab ? "Ask about English…" : "Message…";
  }
  if (tab.analysisMode === "professional") {
    return "Paste English or describe your question…";
  }
  if (tab.analysisMode === "student") {
    return "Paste English or ask your question…";
  }
  if (tab.analysisMode === "teaching") {
    return "Paste English or describe what to explain…";
  }
  return "Message…";
}

function buildGeminiMessages(
  tab: ChatTab,
  explanationLanguage: ExplanationLanguage,
): ChatMessage[] {
  const seed: ChatMessage[] = [];
  if (tab.sessionPayload) {
    seed.push({
      role: "user",
      content: buildInitialAnalysisUserMessage(
        tab.sessionPayload,
        explanationLanguage,
      ),
    });
  }
  return [...seed, ...tab.visibleHistory];
}

export type ChatMountHandle = {
  dispose: () => void;
  openSelectionTab: (payload: ChatSessionPayload) => void;
  openAnalysisModeTab: (mode: AnalysisMode) => void;
  openGeneralTab: () => void;
  openDictionaryTab: () => void;
};

function resolveModeIslandLabel(options: {
  sessionPayload?: ChatSessionPayload | null;
  analysisMode?: AnalysisMode | null;
  freeChatKind?: FreeChatKind | null;
}): string | null {
  if (options.freeChatKind === "dictionary") {
    return freeChatModeMenuLabel("dictionary");
  }
  if (options.sessionPayload?.selection.trim()) {
    return analysisModeMenuLabel(options.sessionPayload.mode);
  }
  return null;
}

function selectionPreview(selection: string, max = 48): string {
  const preview = selection.trim().replace(/\s+/g, " ");
  if (!preview) return "";
  return preview.length > max ? `${preview.slice(0, max - 1)}…` : preview;
}

export function mountChat(
  mountRoot: HTMLElement,
  options: MountChatOptions,
): ChatMountHandle {
  const refs = buildChatDom(mountRoot, options.onClose);
  const disposers: (() => void)[] = [];
  let destroyed = false;
  const tabs: ChatTab[] = [];
  let activeTabId = "";

  const getActiveTab = (): ChatTab | undefined =>
    tabs.find((tab) => tab.id === activeTabId);

  const applyTheme = (): void => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    refs.themeRoot.dataset.theme = prefersDark ? "dark" : "light";
  };

  const syncComposerHeight = (): void => {
    const el = refs.composerInput;
    if (!el.value.trim() && el.clientWidth > 0) {
      el.style.height = `${COMPOSER_MIN_HEIGHT}px`;
      el.style.overflowY = "hidden";
      return;
    }

    el.style.height = "0px";
    el.style.overflowY = "hidden";
    const contentHeight = Math.max(el.scrollHeight, COMPOSER_MIN_HEIGHT);
    const next = Math.min(contentHeight, COMPOSER_MAX_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY =
      contentHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  };

  const isActiveTabStreaming = (): boolean =>
    getActiveTab()?.streaming ?? false;

  const syncComposerUI = (): void => {
    const tabStreaming = isActiveTabStreaming();
    refs.composerInput.disabled = tabStreaming;
    refs.composerEl.classList.toggle("is-disabled", tabStreaming);
    updateSendButton();
  };

  const updateSendButton = (): void => {
    if (isActiveTabStreaming()) {
      refs.sendBtn.classList.add("is-stop");
      refs.sendBtn.disabled = false;
      refs.sendBtn.innerHTML = STOP_ICON_SVG;
      refs.sendBtn.title = "Stop";
      refs.sendBtn.setAttribute("aria-label", "Stop");
      return;
    }

    refs.sendBtn.classList.remove("is-stop");
    refs.sendBtn.innerHTML = SEND_ICON_SVG;
    refs.sendBtn.title = "Send";
    refs.sendBtn.setAttribute("aria-label", "Send");
    refs.sendBtn.disabled = !refs.composerInput.value.trim();
  };

  const setTabStreaming = (tab: ChatTab, streaming: boolean): void => {
    tab.streaming = streaming;
    if (getActiveTab()?.id === tab.id) {
      syncComposerUI();
    }
  };

  let tabScrollbar: ReturnType<typeof setupHorizontalOverlayScrollbar> | null =
    null;

  const syncTabScrollbar = (): void => {
    tabScrollbar?.sync();
  };

  const scrollActiveTabIntoView = (): void => {
    const tab = getActiveTab();
    const list = refs.tabListEl;
    if (!tab || !list) return;

    const tabEl = tab.tabBtn;
    const tabLeft = tabEl.offsetLeft;
    const tabRight = tabLeft + tabEl.offsetWidth;
    const viewLeft = list.scrollLeft;
    const viewRight = viewLeft + list.clientWidth;

    if (tabLeft < viewLeft) {
      list.scrollLeft = tabLeft;
    } else if (tabRight > viewRight) {
      list.scrollLeft = tabRight - list.clientWidth;
    }
    syncTabScrollbar();
  };

  const setupTabBarScrolling = (): void => {
    const list = refs.tabListEl;
    const scroll = refs.tabScrollEl;
    const track = refs.tabScrollbarEl;
    const thumb = refs.tabScrollbarThumbEl;
    if (!list || !scroll || !track || !thumb) return;

    tabScrollbar = setupHorizontalOverlayScrollbar({
      wrapEl: scroll,
      scrollEl: list,
      trackEl: track,
      thumbEl: thumb,
    });
    disposers.push(() => tabScrollbar?.dispose());
  };

  const updateTabCloseButtons = (): void => {
    const canClose = tabs.length > 1;
    for (const tab of tabs) {
      tab.tabBtn.classList.toggle("has-close", canClose);
      const closeBtn = tab.tabBtn.querySelector(".chat-tab-close") as
        | HTMLElement
        | null;
      if (!closeBtn) continue;
      closeBtn.hidden = !canClose;
    }
    syncTabScrollbar();
  };

  const persistComposerDraft = (): void => {
    const tab = getActiveTab();
    if (!tab) return;
    tab.composerDraft = refs.composerInput.value;
  };

  const restoreComposerDraft = (): void => {
    const tab = getActiveTab();
    refs.composerInput.value = tab?.composerDraft ?? "";
    refs.composerInput.placeholder = composerPlaceholderForTab(tab);
    syncComposerHeight();
    syncComposerUI();
  };

  const switchTab = (tabId: string): void => {
    if (tabId === activeTabId) return;
    persistComposerDraft();

    activeTabId = tabId;
    for (const tab of tabs) {
      const active = tab.id === tabId;
      tab.tabBtn.classList.toggle("is-active", active);
      tab.paneEl.classList.toggle("is-active", active);
    }
    restoreComposerDraft();
    scrollActiveTabIntoView();
  };

  const appendUserBubble = (tab: ChatTab, text: string): void => {
    const row = document.createElement("div");
    row.className = "chat-msg chat-msg-user";
    const wrap = document.createElement("div");
    wrap.className = "chat-bubble-wrap";
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = text;
    wrap.appendChild(bubble);
    row.appendChild(wrap);
    tab.messagesEl.appendChild(row);
  };

  const attachCopyAction = (row: HTMLElement, markdown: string): void => {
    const actions = document.createElement("div");
    actions.className = "chat-msg-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "chat-msg-action-btn";
    copyBtn.title = "Copy";
    copyBtn.setAttribute("aria-label", "Copy");
    copyBtn.innerHTML = COPY_ICON_SVG;

    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(markdown);
        copyBtn.classList.add("is-copied");
        copyBtn.title = "Copied";
        copyBtn.setAttribute("aria-label", "Copied");
        window.setTimeout(() => {
          copyBtn.classList.remove("is-copied");
          copyBtn.title = "Copy";
          copyBtn.setAttribute("aria-label", "Copy");
        }, 1500);
      } catch {
        /* ignore clipboard errors */
      }
    });

    actions.appendChild(copyBtn);
    row.appendChild(actions);
  };

  const createAssistantContainer = (messagesEl: HTMLElement) => {
    const row = document.createElement("div");
    row.className = "chat-msg chat-msg-assistant";

    const waiting = document.createElement("div");
    waiting.className = "chat-waiting";
    waiting.innerHTML =
      '<span class="chat-waiting-spinner" aria-hidden="true"></span>' +
      '<span class="chat-waiting-label">Analyzing…</span>';

    const assistantText = document.createElement("div");
    assistantText.className = "chat-assistant-text";

    const stableEl = document.createElement("div");
    stableEl.className = "chat-md chat-md-stable";

    const tailEl = document.createElement("span");
    tailEl.className = "chat-md-tail";

    const caretEl = document.createElement("span");
    caretEl.className = "chat-caret";
    caretEl.setAttribute("aria-hidden", "true");
    caretEl.hidden = true;

    assistantText.append(stableEl, tailEl, caretEl);
    row.append(waiting, assistantText);
    messagesEl.appendChild(row);

    return { row, assistantText, stableEl, tailEl, caretEl };
  };

  const applyStreamingMarkdown = (
    stableEl: HTMLElement,
    tailEl: HTMLElement,
    markdown: string,
  ): void => {
    const { stableHtml, tail } = renderStreamingMarkdownParts(markdown);
    stableEl.innerHTML = stableHtml;
    tailEl.textContent = tail;
    stableEl.hidden = !stableHtml;
    tailEl.hidden = !tail;
  };

  const finishAssistantStream = (
    assistantText: HTMLElement,
    caretEl: HTMLElement,
    row: HTMLElement,
    markdown: string,
  ): void => {
    row.querySelector(".chat-waiting")?.remove();
    caretEl.remove();
    assistantText.replaceChildren();
    const contentEl = document.createElement("div");
    contentEl.className = "chat-md";
    contentEl.innerHTML = renderMarkdownToHtml(markdown);
    assistantText.appendChild(contentEl);
    attachCopyAction(row, markdown);
  };

  const showAssistantError = (
    messagesEl: HTMLElement,
    message: string,
  ): void => {
    const row = document.createElement("div");
    row.className = "chat-msg chat-msg-assistant";
    const error = document.createElement("div");
    error.className = "chat-error-inthread";
    error.textContent = message;
    row.appendChild(error);
    messagesEl.appendChild(row);
  };

  const showMissingKeyState = (messagesEl: HTMLElement): void => {
    const empty = document.createElement("div");
    empty.className = "chat-messages-empty";
    empty.style.flex = "0";
    empty.style.padding = "24px 0";
    empty.innerHTML =
      "<p>Google AI API key is not set.</p>" +
      '<button type="button" class="chat-settings-link" id="open-settings">Open settings</button>';
    messagesEl.appendChild(empty);
    empty.querySelector("#open-settings")?.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
    syncComposerUI();
  };

  const streamAssistantReply = async (tab: ChatTab): Promise<string | null> => {
    const settings = await loadSettingsInPage();
    if (!settings.googleApiKey) return null;

    const messages = buildGeminiMessages(tab, settings.explanationLanguage);
    if (messages.length === 0) return null;

    tab.abortController?.abort();
    tab.abortController = new AbortController();
    const signal = tab.abortController.signal;

    const { row, assistantText, stableEl, tailEl, caretEl } =
      createAssistantContainer(tab.messagesEl);
    let accumulated = "";
    let renderScheduled = false;
    let streamEnded = false;

    const flushStreamingMarkdown = (): void => {
      renderScheduled = false;
      if (streamEnded) return;
      applyStreamingMarkdown(stableEl, tailEl, accumulated);
      caretEl.hidden = false;
    };

    const scheduleStreamingMarkdown = (): void => {
      if (renderScheduled) return;
      renderScheduled = true;
      requestAnimationFrame(flushStreamingMarkdown);
    };

    setTabStreaming(tab, true);

    try {
      const stream = streamGeminiChat({
        apiKey: settings.googleApiKey,
        model: settings.model,
        systemInstruction: buildSystemPrompt(
          settings.explanationLanguage,
          analysisModeForTab(tab),
          { freeChatKind: freeChatKindForTab(tab) },
        ),
        contents: toGeminiContents(messages),
        signal,
      });

      for await (const chunk of stream) {
        if (destroyed || signal.aborted) return null;
        accumulated += chunk;
        row.querySelector(".chat-waiting")?.remove();
        assistantText.hidden = false;
        scheduleStreamingMarkdown();
      }

      streamEnded = true;
      flushStreamingMarkdown();

      if (signal.aborted) {
        if (accumulated.trim()) {
          finishAssistantStream(assistantText, caretEl, row, accumulated);
          return accumulated;
        }
        return null;
      }

      finishAssistantStream(assistantText, caretEl, row, accumulated);
      return accumulated;
    } catch (error) {
      streamEnded = true;
      if (accumulated.trim()) {
        finishAssistantStream(assistantText, caretEl, row, accumulated);
        return accumulated;
      }
      row.remove();
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      const message =
        error instanceof GeminiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Something went wrong.";
      showAssistantError(tab.messagesEl, message);
      return null;
    } finally {
      setTabStreaming(tab, false);
      if (tab.abortController?.signal === signal) {
        tab.abortController = null;
      }
    }
  };

  const startInitialAnalysis = async (tab: ChatTab): Promise<void> => {
    if (!tab.sessionPayload) return;
    const reply = await streamAssistantReply(tab);
    if (reply) tab.visibleHistory.push({ role: "assistant", content: reply });
  };

  const mountModeIsland = (paneEl: HTMLElement, label: string): HTMLElement => {
    const islandEl = document.createElement("div");
    islandEl.className = "chat-mode-island";
    islandEl.textContent = label;
    islandEl.setAttribute("aria-label", `Chat mode: ${label}`);
    paneEl.appendChild(islandEl);
    return islandEl;
  };

  const updateTabPresentation = (
    tab: ChatTab,
    payload: ChatSessionPayload,
  ): void => {
    const preview = selectionPreview(payload.selection);
    const ariaLabel = tabAriaLabel(payload);
    const tabTitle = preview ? `${ariaLabel} · ${preview}` : ariaLabel;
    tab.ariaLabel = ariaLabel;
    tab.tabBtn.title = tabTitle;
    tab.tabBtn.setAttribute("aria-label", tabTitle);
    const labelEl = tab.tabBtn.querySelector(".chat-tab-label");
    if (labelEl) labelEl.textContent = preview || ariaLabel;
  };

  const sendFollowUp = async (): Promise<void> => {
    const tab = getActiveTab();
    if (!tab) return;

    const text = refs.composerInput.value.trim();
    if (!text || tab.streaming) return;

    tab.composerDraft = "";
    refs.composerInput.value = "";
    syncComposerHeight();
    syncComposerUI();

    if (!tab.sessionPayload && tab.analysisMode) {
      const payload: ChatSessionPayload = {
        selection: text,
        pageUrl: window.location.href,
        pageTitle: document.title,
        mode: tab.analysisMode,
      };
      tab.sessionPayload = payload;
      tab.analysisMode = null;
      if (!tab.modeIslandEl) {
        tab.modeIslandEl = mountModeIsland(
          tab.paneEl,
          analysisModeMenuLabel(payload.mode),
        );
        tab.paneEl.classList.add("has-mode-island");
      }
      updateTabPresentation(tab, payload);

      appendUserBubble(tab, text);

      const reply = await streamAssistantReply(tab);
      if (reply) tab.visibleHistory.push({ role: "assistant", content: reply });
      return;
    }

    appendUserBubble(tab, text);
    tab.visibleHistory.push({ role: "user", content: text });

    const reply = await streamAssistantReply(tab);
    if (reply) {
      tab.visibleHistory.push({ role: "assistant", content: reply });
    } else {
      tab.visibleHistory.pop();
    }
  };

  const stopStreaming = (): void => {
    const tab = getActiveTab();
    if (!tab?.streaming) return;
    tab.abortController?.abort();
  };

  const createTab = (options: CreateTabOptions): ChatTab => {
    const id = makeTabId();
    const ariaLabel = options.sessionPayload
      ? tabAriaLabel(options.sessionPayload)
      : options.ariaLabel;
    const preview = options.sessionPayload
      ? selectionPreview(options.sessionPayload.selection)
      : "";
    const tabTitle = preview ? `${ariaLabel} · ${preview}` : ariaLabel;
    const paneEl = document.createElement("div");
    paneEl.className = "chat-tab-pane";
    paneEl.dataset.tabId = id;

    const messagesEl = document.createElement("div");
    messagesEl.className = "chat-messages";
    paneEl.appendChild(messagesEl);

    const modeIslandLabel = resolveModeIslandLabel({
      sessionPayload: options.sessionPayload,
      analysisMode: options.analysisMode,
      freeChatKind:
        options.sessionPayload || options.analysisMode
          ? null
          : options.freeChatKind,
    });
    const modeIslandEl = modeIslandLabel
      ? mountModeIsland(paneEl, modeIslandLabel)
      : null;
    if (modeIslandEl) {
      paneEl.classList.add("has-mode-island");
    }

    refs.tabPanesEl.appendChild(paneEl);

    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.className = "chat-tab";
    tabBtn.dataset.tabId = id;
    tabBtn.title = tabTitle;
    tabBtn.setAttribute("aria-label", tabTitle);

    const iconEl = document.createElement("span");
    iconEl.className = "chat-tab-icon";
    iconEl.innerHTML = CHAT_TAB_ICON_SVG;

    const labelEl = document.createElement("span");
    labelEl.className = "chat-tab-label";
    labelEl.textContent = preview || ariaLabel;

    const closeEl = document.createElement("span");
    closeEl.className = "chat-tab-close";
    closeEl.setAttribute("role", "button");
    closeEl.setAttribute("tabindex", "-1");
    closeEl.setAttribute("aria-label", "Close tab");
    closeEl.hidden = true;
    closeEl.innerHTML = CLOSE_ICON_SVG;

    tabBtn.append(iconEl, labelEl, closeEl);

    tabBtn.addEventListener("click", (event) => {
      if ((event.target as Element).closest(".chat-tab-close")) return;
      switchTab(id);
    });

    tabBtn.querySelector(".chat-tab-close")?.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(id);
    });

    refs.tabListEl.appendChild(tabBtn);
    syncTabScrollbar();

    const tab: ChatTab = {
      id,
      ariaLabel,
      tabBtn,
      paneEl,
      messagesEl,
      modeIslandEl,
      sessionPayload: options.sessionPayload,
      analysisMode: options.sessionPayload
        ? null
        : (options.analysisMode ?? null),
      freeChatKind:
        options.sessionPayload || options.analysisMode
          ? null
          : (options.freeChatKind ?? "general"),
      visibleHistory: [],
      composerDraft: "",
      streaming: false,
      abortController: null,
    };
    tabs.push(tab);
    switchTab(id);
    updateTabCloseButtons();

    if (options.autoAnalyze) {
      void (async () => {
        const settings = await loadSettingsInPage();
        if (destroyed) return;
        if (!settings.googleApiKey) {
          showMissingKeyState(messagesEl);
          return;
        }
        const selection = tab.sessionPayload?.selection.trim();
        if (selection) appendUserBubble(tab, selection);
        await startInitialAnalysis(tab);
      })();
    }

    return tab;
  };

  const closeTab = (tabId: string): void => {
    if (tabs.length <= 1) return;
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;

    const closing = tabs[index];
    closing.abortController?.abort();

    const [removed] = tabs.splice(index, 1);
    removed.tabBtn.remove();
    removed.paneEl.remove();

    if (activeTabId === tabId) {
      const next = tabs[Math.min(index, tabs.length - 1)];
      activeTabId = "";
      switchTab(next.id);
    }

    updateTabCloseButtons();
  };

  const onInput = (): void => {
    syncComposerHeight();
    const tab = getActiveTab();
    if (tab) tab.composerDraft = refs.composerInput.value;
    if (!isActiveTabStreaming()) updateSendButton();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isActiveTabStreaming()) return;
      void sendFollowUp();
    }
  };

  const openAnalysisTab = (mode: AnalysisMode, selection: string): void => {
    if (destroyed) return;
    if (selection) {
      const payload: ChatSessionPayload = {
        selection,
        pageUrl: window.location.href,
        pageTitle: document.title,
        mode,
      };
      createTab({
        ariaLabel: tabAriaLabel(payload),
        sessionPayload: payload,
        autoAnalyze: true,
      });
    } else {
      createTab({
        ariaLabel: tabAriaLabelForMode(mode),
        sessionPayload: null,
        analysisMode: mode,
      });
    }
    refs.composerInput.focus();
  };

  const openAnalysisModeTab = (mode: AnalysisMode): void => {
    if (destroyed) return;
    createTab({
      ariaLabel: tabAriaLabelForMode(mode),
      sessionPayload: null,
      analysisMode: mode,
    });
    refs.composerInput.focus();
  };

  const openSelectionTab = (payload: ChatSessionPayload): void => {
    if (destroyed) return;
    createTab({
      ariaLabel: tabAriaLabel(payload),
      sessionPayload: payload,
      autoAnalyze: true,
    });
  };

  const openGeneralTab = (): void => {
    if (destroyed) return;
    createTab({
      ariaLabel: `Chat ${tabs.length + 1}`,
      sessionPayload: null,
      freeChatKind: "general",
    });
    refs.composerInput.focus();
  };

  const openDictionaryTab = (): void => {
    if (destroyed) return;
    createTab({
      ariaLabel: "Dictionary",
      sessionPayload: null,
      freeChatKind: "dictionary",
    });
    refs.composerInput.focus();
  };

  applyTheme();
  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  const onThemeChange = (): void => applyTheme();
  darkMq.addEventListener("change", onThemeChange);
  disposers.push(() => darkMq.removeEventListener("change", onThemeChange));

  disposers.push(
    setupNewTabMenu(
      refs.newTabBtn,
      refs.newTabMenuEl,
      getPageSelectionText,
      {
        onAnalysis: openAnalysisTab,
        onFreeChat: (kind) => {
          if (kind === "dictionary") openDictionaryTab();
          else openGeneralTab();
        },
      },
    ),
  );
  setupTabBarScrolling();
  refs.composerInput.addEventListener("input", onInput);
  refs.composerInput.addEventListener("keydown", onKeydown);
  refs.sendBtn.addEventListener("click", () => {
    if (isActiveTabStreaming()) {
      stopStreaming();
      return;
    }
    void sendFollowUp();
  });
  disposers.push(() => refs.composerInput.removeEventListener("input", onInput));
  disposers.push(() =>
    refs.composerInput.removeEventListener("keydown", onKeydown),
  );

  const onTabBarResize = (): void => syncTabScrollbar();
  window.addEventListener("resize", onTabBarResize);
  disposers.push(() => window.removeEventListener("resize", onTabBarResize));

  syncComposerHeight();
  updateSendButton();
  syncTabScrollbar();

  if (options.payload) {
    createTab({
      ariaLabel: tabAriaLabel(options.payload),
      sessionPayload: options.payload,
      autoAnalyze: true,
    });
  } else if (options.analysisMode) {
    createTab({
      ariaLabel: tabAriaLabelForMode(options.analysisMode),
      sessionPayload: null,
      analysisMode: options.analysisMode,
    });
  } else {
    createTab({
      ariaLabel: "New chat",
      sessionPayload: null,
      freeChatKind: options.freeChatKind ?? "general",
    });
  }

  const dispose = (): void => {
    destroyed = true;
    for (const tab of tabs) tab.abortController?.abort();
    for (const d of disposers) d();
  };

  return {
    dispose,
    openSelectionTab,
    openAnalysisModeTab,
    openGeneralTab,
    openDictionaryTab,
  };
}

function buildChatDom(mountRoot: HTMLElement, onClose: () => void): ChatRefs {
  mountRoot.innerHTML = `
    <div class="chat-panel" id="app">
      <header class="chat-chrome context-gem-drag-handle">
        <div class="chat-tabbar">
          <div class="chat-tab-scroll chat-overlay-scroll" id="tab-scroll">
            <div class="chat-tab-list" id="tab-list"></div>
            <div class="chat-overlay-scrollbar" id="tab-scrollbar" aria-hidden="true">
              <div class="chat-overlay-scrollbar-thumb" id="tab-scrollbar-thumb"></div>
            </div>
          </div>
        </div>
        <div class="chat-chrome-actions">
          <div class="chat-new-tab-wrap">
            <button type="button" class="chat-icon-btn" id="new-tab-btn" title="New tab" aria-label="New tab" aria-haspopup="menu" aria-expanded="false">${NEW_CHAT_ICON_SVG}</button>
            <div class="chat-new-tab-menu" id="new-tab-menu" role="menu" hidden></div>
          </div>
          <button type="button" class="chat-icon-btn context-gem-panel-close" aria-label="Close panel">${CLOSE_ICON_SVG}</button>
        </div>
      </header>
      <div class="chat-tab-panes" id="tab-panes"></div>
      <div class="chat-composer" id="composer">
        <textarea class="chat-composer-input" id="composer-input" rows="1" placeholder="Message…" aria-label="Message"></textarea>
        <button type="button" class="chat-send-btn" id="send-btn" aria-label="Send" disabled>${SEND_ICON_SVG}</button>
      </div>
    </div>
  `;

  mountRoot
    .querySelector(".context-gem-panel-close")
    ?.addEventListener("click", onClose);

  const themeRoot = mountRoot.querySelector(".chat-panel") as HTMLElement;

  return {
    themeRoot,
    tabScrollEl: mountRoot.querySelector("#tab-scroll") as HTMLElement,
    tabListEl: mountRoot.querySelector("#tab-list") as HTMLElement,
    tabScrollbarEl: mountRoot.querySelector("#tab-scrollbar") as HTMLElement,
    tabScrollbarThumbEl: mountRoot.querySelector(
      "#tab-scrollbar-thumb",
    ) as HTMLElement,
    tabPanesEl: mountRoot.querySelector("#tab-panes") as HTMLElement,
    newTabBtn: mountRoot.querySelector("#new-tab-btn") as HTMLButtonElement,
    newTabMenuEl: mountRoot.querySelector("#new-tab-menu") as HTMLElement,
    composerEl: mountRoot.querySelector("#composer") as HTMLElement,
    composerInput: mountRoot.querySelector(
      "#composer-input",
    ) as HTMLTextAreaElement,
    sendBtn: mountRoot.querySelector("#send-btn") as HTMLButtonElement,
  };
}
