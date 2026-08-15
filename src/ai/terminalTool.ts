import { tool } from "ai";
import { z } from "zod";
import {
  killTerminalCommand,
  runTerminalCommand,
  type RunTerminalResult,
} from "../lib/vaultApi";
import { useAiSettingsStore } from "../store/aiSettingsStore";

export const DEFAULT_TERMINAL_TIMEOUT_MS = 60_000;
export const MIN_TERMINAL_TIMEOUT_MS = 1_000;
export const MAX_TERMINAL_TIMEOUT_MS = 10 * 60 * 1_000;

export function isAgentTerminalEnabled(): boolean {
  return useAiSettingsStore.getState().settings.agentTerminalEnabled === true;
}

export function clampTerminalTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TERMINAL_TIMEOUT_MS;
  }
  return Math.min(
    MAX_TERMINAL_TIMEOUT_MS,
    Math.max(MIN_TERMINAL_TIMEOUT_MS, Math.round(value)),
  );
}

export type TerminalApprovalDecision = "allow" | "deny";

export type TerminalApprovalRequest = {
  toolCallId: string;
  command: string;
  cwd: string;
  timeoutMs: number;
};

type Pending = {
  request: TerminalApprovalRequest;
  resolve: (value: TerminalApprovalDecision) => void;
  reject: (error: Error) => void;
};

const pending = new Map<string, Pending>();
const listeners = new Set<() => void>();
const runningJobIds = new Set<string>();
let pendingSnapshot: TerminalApprovalRequest[] = [];

/** Synced from the active chat thread; not a Settings toggle. */
let threadAutoAllow = false;

export function getTerminalThreadAutoAllow(): boolean {
  return threadAutoAllow;
}

export function setTerminalThreadAutoAllow(value: boolean): void {
  threadAutoAllow = value;
}

function notify() {
  pendingSnapshot = [...pending.values()].map((p) => p.request);
  for (const l of listeners) l();
}

export function subscribeTerminalApprovals(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listPendingTerminalApprovals(): TerminalApprovalRequest[] {
  return pendingSnapshot;
}

export function hasPendingTerminalApproval(toolCallId?: string): boolean {
  if (toolCallId) return pending.has(toolCallId);
  return pending.size > 0;
}

function abortError(message = "Terminal cancelled"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

/** Wait until the UI allows or denies this command (or abort). */
export function waitForTerminalApproval(
  request: TerminalApprovalRequest,
  signal?: AbortSignal,
): Promise<TerminalApprovalDecision> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise<TerminalApprovalDecision>((resolve, reject) => {
    const cleanup = () => {
      pending.delete(request.toolCallId);
      signal?.removeEventListener("abort", onAbort);
      notify();
    };

    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    pending.set(request.toolCallId, {
      request,
      resolve: (value) => {
        cleanup();
        resolve(value);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    });
    notify();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveOne(toolCallId: string, decision: TerminalApprovalDecision): boolean {
  const entry = pending.get(toolCallId);
  if (!entry) return false;
  entry.resolve(decision);
  return true;
}

/** Allow or deny a pending command. */
export function resolveTerminalApproval(
  toolCallId: string,
  decision: TerminalApprovalDecision,
): boolean {
  return resolveOne(toolCallId, decision);
}

/**
 * Allow this command and every other pending one. Caller should also persist
 * auto-allow on the active chat thread.
 */
export function allowAllPendingTerminal(): void {
  threadAutoAllow = true;
  const ids = [...pending.keys()];
  for (const id of ids) resolveOne(id, "allow");
}

export function cancelTerminalApproval(toolCallId: string, reason?: string): boolean {
  const entry = pending.get(toolCallId);
  if (!entry) return false;
  entry.reject(abortError(reason ?? "Cancelled"));
  return true;
}

export function cancelAllPendingTerminal(reason?: string): void {
  const ids = [...pending.keys()];
  for (const id of ids) cancelTerminalApproval(id, reason);
}

export async function killAllRunningTerminalJobs(): Promise<void> {
  const ids = [...runningJobIds];
  await Promise.all(
    ids.map((id) => killTerminalCommand(id).catch(() => false)),
  );
}

/** @internal test helper */
export function _resetTerminalApprovalsForTests(): void {
  cancelAllPendingTerminal("reset");
  runningJobIds.clear();
  threadAutoAllow = false;
  pendingSnapshot = [];
}

function normalizeCwd(cwd: string | undefined, projectPath: string | null): string {
  const raw = (cwd?.trim() || projectPath || "").replace(/^\/+/, "");
  return raw;
}

export type BuildRunTerminalToolOpts = {
  projectPath?: string | null;
};

export function buildRunTerminalTool(opts?: BuildRunTerminalToolOpts) {
  const projectPath = opts?.projectPath?.trim() || null;

  return tool({
    description:
      "Run a one-shot shell command on the user's machine. Working directory is inside the open vault (default: selected project, else vault root). The user must approve each command unless they chose Allow for this chat. Prefer vault tools (edit_note, etc.) for notes, diagrams, links, and dictionaries. Use this for git, language CLIs, tests, and builds. No interactive TTY.",
    inputSchema: z.object({
      command: z.string().min(1).describe("Shell command to run"),
      cwd: z
        .string()
        .optional()
        .describe(
          "Vault-relative working directory. Empty = selected project or vault root.",
        ),
      timeout_ms: z
        .number()
        .int()
        .optional()
        .describe("Timeout in milliseconds (default 60000, max 600000)"),
    }),
    execute: async (
      { command, cwd, timeout_ms: timeoutMs },
      { toolCallId, abortSignal },
    ) => {
      if (!isAgentTerminalEnabled()) {
        return {
          ok: false as const,
          error:
            "Terminal is disabled. The user can enable it in Settings → AI → Allow agent terminal.",
        };
      }

      const cmd = command.trim();
      if (!cmd) {
        return { ok: false as const, error: "Command is empty" };
      }

      const resolvedCwd = normalizeCwd(cwd, projectPath);
      const resolvedTimeout = clampTerminalTimeoutMs(timeoutMs);
      const autoAllow = threadAutoAllow;

      if (!autoAllow) {
        try {
          const decision = await waitForTerminalApproval(
            {
              toolCallId,
              command: cmd,
              cwd: resolvedCwd,
              timeoutMs: resolvedTimeout,
            },
            abortSignal,
          );
          if (decision === "deny") {
            return { ok: false as const, error: "Denied by user" };
          }
        } catch (err) {
          const aborted =
            abortSignal?.aborted ||
            (err instanceof Error && err.name === "AbortError");
          return {
            ok: false as const,
            error: aborted ? "Cancelled" : err instanceof Error ? err.message : String(err),
          };
        }
      }

      if (!isAgentTerminalEnabled()) {
        return {
          ok: false as const,
          error:
            "Terminal is disabled. The user can enable it in Settings → AI → Allow agent terminal.",
        };
      }

      if (abortSignal?.aborted) {
        return { ok: false as const, error: "Cancelled" };
      }

      const onAbort = () => {
        void killTerminalCommand(toolCallId).catch(() => false);
      };
      abortSignal?.addEventListener("abort", onAbort);
      runningJobIds.add(toolCallId);
      try {
        const result: RunTerminalResult = await runTerminalCommand({
          jobId: toolCallId,
          command: cmd,
          cwd: resolvedCwd,
          timeoutMs: resolvedTimeout,
        });
        return {
          ok: result.ok,
          exit_code: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          cwd: result.cwd,
          timed_out: result.timedOut,
          truncated: result.truncated,
          killed: result.killed,
          error: result.error ?? undefined,
        };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        runningJobIds.delete(toolCallId);
        abortSignal?.removeEventListener("abort", onAbort);
      }
    },
  });
}
