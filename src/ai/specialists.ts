import {
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  credentialsFromSettings,
  pickWorkerModelId,
  resolveLanguageModel,
} from "./languageModel";
import {
  isSpecialistKind,
  pickTools,
  SPECIALIST_PRESETS,
  type SpecialistKind,
} from "./toolPacks";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { helperModelCallParams } from "../store/vaultAiSettingsStore";
import { hostOsSystemPromptLine } from "../lib/hostOs";
import { isAgentTerminalEnabled } from "./terminalTool";
import {
  beginSpecialistWave,
  waitingStatusForDeps,
  withPredecessorContext,
  type SpecialistDepResult,
  type SpecialistWaveHandle,
} from "./specialistDeps";

export const SPECIALIST_WORKER_MAX_STEPS = 8;

export type SpecialistLiveState = {
  toolCallId: string;
  kind: SpecialistKind;
  title: string;
  status: string;
  running: boolean;
  steps: SpecialistStep[];
};

export type SpecialistStep = {
  toolName: string;
  input?: unknown;
  output?: unknown;
  error?: string;
};

type Listener = () => void;

const liveById = new Map<string, SpecialistLiveState>();
const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

export function getSpecialistLive(
  toolCallId: string,
): SpecialistLiveState | undefined {
  return liveById.get(toolCallId);
}

export function subscribeSpecialistLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setLive(state: SpecialistLiveState) {
  liveById.set(state.toolCallId, { ...state, steps: [...state.steps] });
  notify();
}

function patchLive(
  toolCallId: string,
  patch: Partial<Omit<SpecialistLiveState, "toolCallId">>,
) {
  const prev = liveById.get(toolCallId);
  if (!prev) return;
  setLive({ ...prev, ...patch, steps: patch.steps ?? prev.steps });
}

function clearLive(toolCallId: string) {
  liveById.delete(toolCallId);
  notify();
}

/** @internal test helper */
export function _resetSpecialistLiveForTests() {
  liveById.clear();
  notify();
}

// --- write path mutex (concurrent writers OK when paths don't overlap) ---

type MutexWaiter = {
  paths: string[];
  resolve: () => void;
  reject: (e: Error) => void;
};

type WriterHolder = { id: string; paths: string[] };
const writeHolders: WriterHolder[] = [];
const writeWaiters: MutexWaiter[] = [];

function pathsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) {
    // Unknown paths: serialize against any other writer to be safe.
    return true;
  }
  const setB = new Set(b.map(normalizePathKey));
  for (const p of a) {
    const key = normalizePathKey(p);
    if (setB.has(key)) return true;
    for (const other of setB) {
      if (key.startsWith(`${other}/`) || other.startsWith(`${key}/`)) {
        return true;
      }
    }
  }
  return false;
}

function normalizePathKey(path: string): string {
  return path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function tryAddConcurrentWriter(toolCallId: string, paths: string[]): boolean {
  const norm = paths.map(normalizePathKey).filter(Boolean);
  const effective = norm.length ? norm : [""];
  for (const h of writeHolders) {
    if (pathsOverlap(h.paths, effective)) return false;
  }
  writeHolders.push({ id: toolCallId, paths: effective });
  return true;
}

async function acquireWriteLock(
  toolCallId: string,
  paths: string[],
  signal?: AbortSignal,
): Promise<() => void> {
  const norm = paths.map(normalizePathKey).filter(Boolean);

  const release = () => {
    const idx = writeHolders.findIndex((h) => h.id === toolCallId);
    if (idx >= 0) writeHolders.splice(idx, 1);
    flushWriteWaiters();
  };

  if (tryAddConcurrentWriter(toolCallId, norm)) {
    return release;
  }

  if (signal?.aborted) {
    throw abortError();
  }

  await new Promise<void>((resolve, reject) => {
    const waiter: MutexWaiter = {
      paths: norm.length ? norm : [""],
      resolve: () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      reject: (e) => {
        signal?.removeEventListener("abort", onAbort);
        reject(e);
      },
    };
    const onAbort = () => {
      const i = writeWaiters.indexOf(waiter);
      if (i >= 0) writeWaiters.splice(i, 1);
      waiter.reject(abortError());
    };
    writeWaiters.push(waiter);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

  if (!tryAddConcurrentWriter(toolCallId, norm)) {
    return acquireWriteLock(toolCallId, paths, signal);
  }
  return release;
}

function flushWriteWaiters() {
  const still: MutexWaiter[] = [];
  for (const w of writeWaiters) {
    let blocked = false;
    for (const h of writeHolders) {
      if (pathsOverlap(h.paths, w.paths)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) {
      w.resolve();
    } else {
      still.push(w);
    }
  }
  writeWaiters.length = 0;
  writeWaiters.push(...still);
}

/** @internal test helper */
export function _resetWriteLocksForTests() {
  writeHolders.length = 0;
  writeWaiters.length = 0;
}

/** @internal test helper — acquire/release write lock */
export const _testWriteLock = {
  acquire: acquireWriteLock,
  holders: () => writeHolders.map((h) => ({ ...h, paths: [...h.paths] })),
};

function abortError(message = "Specialist cancelled"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

const STEP_IO_CAP = 2_000;

function slimIo(value: unknown): unknown {
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= STEP_IO_CAP) return value;
    return `${raw.slice(0, STEP_IO_CAP)}…[+${raw.length - STEP_IO_CAP}]`;
  } catch {
    return String(value).slice(0, STEP_IO_CAP);
  }
}

function humanStatus(toolName: string): string {
  const map: Record<string, string> = {
    read_note: "Reading note…",
    search_notes: "Searching…",
    semantic_search: "Semantic search…",
    list_folder: "Listing folder…",
    list_notes: "Listing notes…",
    web_search: "Searching the web…",
    fetch_url: "Fetching URL…",
    scrape_url: "Scraping page…",
    read_file: "Reading file…",
    edit_note: "Editing note…",
    write_note: "Writing note…",
    create_note: "Creating note…",
    mutate_diagram: "Editing diagram…",
    create_diagram: "Creating diagram…",
    read_diagram: "Reading diagram…",
    add_link: "Adding link…",
    add_entry: "Adding entry…",
    clip_article: "Clipping article…",
    translate_note: "Translating…",
    auto_tag_note: "Tagging note…",
    run_terminal: "Waiting for terminal…",
  };
  return map[toolName] ?? `Running ${toolName}…`;
}

function extractChangedPaths(steps: SpecialistStep[]): string[] {
  const paths = new Set<string>();
  for (const step of steps) {
    const out = step.output;
    if (!out || typeof out !== "object") continue;
    const o = out as Record<string, unknown>;
    if (typeof o.path === "string" && o.path) paths.add(o.path);
    if (typeof o.note_path === "string" && o.note_path) paths.add(o.note_path);
    if (Array.isArray(o.changedPaths)) {
      for (const p of o.changedPaths) {
        if (typeof p === "string" && p) paths.add(p);
      }
    }
  }
  return [...paths];
}

function summarizeFromText(text: string, max = 600): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "Done.";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export type RunSpecialistContext = {
  projectPath?: string | null;
  projectAbout?: string | null;
  projectType?: string | null;
  projectLearningLanguage?: string | null;
  /** Override model id (defaults to settings). */
  modelId?: string | null;
};

export type RunSpecialistResult = {
  ok: boolean;
  kind: SpecialistKind;
  title: string;
  summary: string;
  changedPaths: string[];
  needsClarification?: string;
  steps: SpecialistStep[];
  error?: string;
};

export async function runSpecialist(params: {
  toolCallId: string;
  kind: SpecialistKind;
  title: string;
  task: string;
  paths?: string[];
  abortSignal?: AbortSignal;
  ctx: RunSpecialistContext;
}): Promise<RunSpecialistResult> {
  const preset = SPECIALIST_PRESETS[params.kind];
  const title = params.title.trim() || preset.label;
  const paths = (params.paths ?? []).map((p) => p.trim()).filter(Boolean);

  setLive({
    toolCallId: params.toolCallId,
    kind: params.kind,
    title,
    status: "Starting…",
    running: true,
    steps: [],
  });

  let releaseLock: (() => void) | null = null;
  const steps: SpecialistStep[] = [];

  try {
    if (preset.writes) {
      patchLive(params.toolCallId, { status: "Waiting for write lock…" });
      releaseLock = await acquireWriteLock(
        params.toolCallId,
        paths,
        params.abortSignal,
      );
    }

    if (params.abortSignal?.aborted) throw abortError();

    const { buildVaultTools } = await import("./vaultTools");
    const { applySlidingWindow } = await import("./slidingWindow");
    const { estimateTokensFromText, estimateToolSchemaTokens } = await import(
      "./estimateTokens"
    );
    const { contextWindowForModel } = await import("./types");
    const tools = buildVaultTools("agent", {
      projectPath: params.ctx.projectPath,
      getMessages: () => [] as UIMessage[],
      toolNames: [...preset.toolNames],
    });

    const settings = useAiSettingsStore.getState().settings;
    const helper = helperModelCallParams();
    const keys = credentialsFromSettings(settings);
    const modelId = pickWorkerModelId({
      keys,
      modelId: helper.modelId,
      fallbackModelId: helper.fallbackModelId,
    });
    const resolved = resolveLanguageModel({
      modelId,
      keys,
      enableReasoning: false,
    });

    const contextLines: string[] = [preset.system];
    if (params.kind === "terminal") {
      contextLines.push(hostOsSystemPromptLine(undefined, { terminalEnabled: true }));
    }
    if (params.ctx.projectPath) {
      contextLines.push(`Active project: ${params.ctx.projectPath}`);
      if (params.ctx.projectAbout?.trim()) {
        contextLines.push(`Project about: ${params.ctx.projectAbout.trim()}`);
      }
    }
    contextLines.push(
      "When finished, reply with a concise plain-text summary of what you found or changed.",
      "If you need a user decision, say what clarification you need (the parent will ask the user).",
    );

    const userParts = [
      params.task.trim(),
      paths.length ? `Focus paths:\n${paths.map((p) => `- ${p}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    patchLive(params.toolCallId, { status: "Working…" });

    const system = contextLines.join("\n");
    const contextWindow = contextWindowForModel(settings, modelId);
    const extraTokens =
      estimateTokensFromText(system) +
      estimateToolSchemaTokens("agent", [...preset.toolNames]);

    const result = streamText({
      model: resolved.model,
      system,
      messages: [{ role: "user", content: userParts }],
      tools,
      stopWhen: stepCountIs(SPECIALIST_WORKER_MAX_STEPS),
      abortSignal: params.abortSignal,
      prepareStep: ({ messages }) => {
        if (contextWindow <= 0) return {};
        return {
          messages: applySlidingWindow({
            messages,
            contextWindow,
            extraTokens,
          }),
        };
      },
      ...(resolved.providerOptions
        ? { providerOptions: resolved.providerOptions }
        : {}),
    });

    let finalText = "";
    for await (const part of result.fullStream) {
      if (params.abortSignal?.aborted) throw abortError();
      switch (part.type) {
        case "tool-call": {
          const step: SpecialistStep = {
            toolName: part.toolName,
            input: slimIo(part.input),
          };
          steps.push(step);
          patchLive(params.toolCallId, {
            status: humanStatus(part.toolName),
            steps: [...steps],
          });
          break;
        }
        case "tool-result": {
          const idx = [...steps]
            .reverse()
            .findIndex(
              (s) => s.toolName === part.toolName && s.output === undefined,
            );
          const realIdx = idx >= 0 ? steps.length - 1 - idx : -1;
          if (realIdx >= 0) {
            steps[realIdx] = {
              ...steps[realIdx]!,
              output: slimIo(part.output),
            };
          } else {
            steps.push({
              toolName: part.toolName,
              output: slimIo(part.output),
            });
          }
          patchLive(params.toolCallId, { steps: [...steps] });
          break;
        }
        case "tool-error": {
          steps.push({
            toolName: part.toolName,
            error:
              typeof part.error === "string"
                ? part.error
                : part.error instanceof Error
                  ? part.error.message
                  : String(part.error),
          });
          patchLive(params.toolCallId, {
            status: `Error in ${part.toolName}`,
            steps: [...steps],
          });
          break;
        }
        case "text-delta": {
          finalText += part.text;
          break;
        }
        default:
          break;
      }
    }

    const text = (await result.text).trim() || finalText.trim();
    const summary = summarizeFromText(text);
    const changedPaths = extractChangedPaths(steps);
    const needsClarification = /need(s)?\s+(clarification|more info|to ask)/i.test(
      text,
    )
      ? summarizeFromText(text, 400)
      : undefined;

    const out: RunSpecialistResult = {
      ok: true,
      kind: params.kind,
      title,
      summary,
      changedPaths,
      ...(needsClarification ? { needsClarification } : {}),
      steps: steps.map((s) => ({
        toolName: s.toolName,
        input: s.input,
        output: s.output,
        ...(s.error ? { error: s.error } : {}),
      })),
    };

    patchLive(params.toolCallId, {
      running: false,
      status: summary,
      steps: out.steps,
    });
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const aborted = e instanceof Error && e.name === "AbortError";
    const out: RunSpecialistResult = {
      ok: false,
      kind: params.kind,
      title,
      summary: aborted ? "Cancelled." : message,
      changedPaths: extractChangedPaths(steps),
      steps,
      error: message,
    };
    patchLive(params.toolCallId, {
      running: false,
      status: out.summary,
      steps,
    });
    return out;
  } finally {
    releaseLock?.();
    // Keep live state briefly for UI; clear on next tick after output is painted.
    window.setTimeout(() => clearLive(params.toolCallId), 30_000);
  }
}

function runSpecialistDescription(terminalOn: boolean): string {
  const kinds = terminalOn
    ? "research (vault/web), note editing, Draw.io diagrams, .mdlnks links files, .mddict dictionaries, .mdhabit habit trackers, or a terminal command sequence"
    : "research (vault/web), note editing, Draw.io diagrams, .mdlnks links files, .mddict dictionaries, or .mdhabit habit trackers";
  return [
    `Delegate a focused subtask to a specialist worker with a limited tool set. Use for ${kinds}.`,
    "Independent tasks: emit multiple run_specialist calls in ONE response.",
    "Dependent tasks: one specialist, or the same response with id + depends_on (the later worker waits and receives the earlier summary).",
    "Never split create and edits of one .drawio across diagram specialists — one kind=diagram does create_diagram and all mutate_diagram.",
    "Give each a short title for the UI. Pass a self-contained task brief (do not rely on chat history). For write specialists, pass paths you will touch when known.",
  ].join(" ");
}

function toDepResult(result: RunSpecialistResult): SpecialistDepResult {
  return {
    ok: result.ok,
    kind: result.kind,
    title: result.title,
    summary: result.summary,
    changedPaths: result.changedPaths,
    ...(result.error ? { error: result.error } : {}),
  };
}

function specialistFailResult(
  kind: SpecialistKind,
  title: string,
  message: string,
): RunSpecialistResult {
  return {
    ok: false,
    kind,
    title,
    summary: message,
    changedPaths: [],
    steps: [],
    error: message,
  };
}

export function buildRunSpecialistTool(ctx: RunSpecialistContext) {
  const terminalOn = isAgentTerminalEnabled();
  const kindEnum = terminalOn
    ? z.enum([
        "research",
        "edit_notes",
        "diagram",
        "links",
        "dict",
        "habits",
        "terminal",
      ])
    : z.enum(["research", "edit_notes", "diagram", "links", "dict", "habits"]);

  return tool({
    description: runSpecialistDescription(terminalOn),
    inputSchema: z.object({
      kind: kindEnum.describe("Specialist preset"),
      title: z
        .string()
        .min(1)
        .max(120)
        .describe("Short card title shown in the chat UI"),
      task: z
        .string()
        .min(1)
        .describe("Self-contained instructions for the worker"),
      paths: z
        .array(z.string())
        .optional()
        .describe("Optional focus / write paths (vault-relative)"),
      id: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe(
          "Short id for this call so other specialists in THIS response can wait via depends_on (e.g. diag)",
        ),
      depends_on: z
        .array(z.string())
        .optional()
        .describe(
          "Ids of specialists in this same response that must finish first. Their summaries and changedPaths are prepended to the task.",
        ),
    }),
    execute: async (
      { kind, title, task, paths, id, depends_on },
      { toolCallId, abortSignal },
    ) => {
      const cardTitle = title.trim();
      const waveId = id?.trim() || toolCallId;
      const dependsOn = depends_on ?? [];
      let handle: SpecialistWaveHandle;
      try {
        handle = beginSpecialistWave({
          id: waveId,
          title: cardTitle,
          dependsOn,
          signal: abortSignal,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          ok: false as const,
          error: message,
        };
      }

      const releaseFail = (result: RunSpecialistResult) => {
        handle.release(toDepResult(result));
        return result;
      };

      if (!isSpecialistKind(kind)) {
        return releaseFail(
          specialistFailResult(
            "research",
            cardTitle || "Specialist",
            `Unknown specialist kind: ${kind}`,
          ),
        );
      }
      if (String(kind) === "terminal" && !isAgentTerminalEnabled()) {
        return releaseFail(
          specialistFailResult(
            kind,
            cardTitle || SPECIALIST_PRESETS[kind].label,
            "Terminal is disabled. The user can enable it in Settings → AI → Allow agent terminal.",
          ),
        );
      }

      const liveTitle = cardTitle || SPECIALIST_PRESETS[kind].label;
      let workTask = task;
      try {
        if (dependsOn.length > 0) {
          setLive({
            toolCallId,
            kind,
            title: liveTitle,
            status: waitingStatusForDeps(handle.depTitles()),
            running: true,
            steps: [],
          });
          const preds = await handle.waitForDeps();
          workTask = withPredecessorContext(task, preds);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const aborted = e instanceof Error && e.name === "AbortError";
        const summary = aborted ? "Cancelled." : message;
        patchLive(toolCallId, { running: false, status: summary });
        window.setTimeout(() => clearLive(toolCallId), 30_000);
        return releaseFail(specialistFailResult(kind, liveTitle, summary));
      }

      const result = await runSpecialist({
        toolCallId,
        kind,
        title,
        task: workTask,
        paths,
        abortSignal,
        ctx,
      });
      handle.release(toDepResult(result));
      return result;
    },
  });
}

/** Re-export pickTools for tests that build filtered maps. */
export { pickTools };
