import { afterEach, describe, expect, it } from "vitest";
import {
  _resetTerminalApprovalsForTests,
  allowAllPendingTerminal,
  cancelTerminalApproval,
  clampTerminalTimeoutMs,
  DEFAULT_TERMINAL_TIMEOUT_MS,
  getTerminalThreadAutoAllow,
  hasPendingTerminalApproval,
  listPendingTerminalApprovals,
  MAX_TERMINAL_TIMEOUT_MS,
  resolveTerminalApproval,
  setTerminalThreadAutoAllow,
  waitForTerminalApproval,
} from "./terminalTool";

afterEach(() => {
  _resetTerminalApprovalsForTests();
});

describe("terminal approval registry", () => {
  it("resolves allow from the UI", async () => {
    const pending = waitForTerminalApproval({
      toolCallId: "t1",
      command: "ls",
      cwd: "proj",
      timeoutMs: 60_000,
    });
    expect(hasPendingTerminalApproval("t1")).toBe(true);
    expect(listPendingTerminalApprovals()).toHaveLength(1);
    expect(resolveTerminalApproval("t1", "allow")).toBe(true);
    await expect(pending).resolves.toBe("allow");
    expect(hasPendingTerminalApproval("t1")).toBe(false);
  });

  it("resolves deny", async () => {
    const pending = waitForTerminalApproval({
      toolCallId: "t2",
      command: "rm -rf /",
      cwd: "",
      timeoutMs: 60_000,
    });
    resolveTerminalApproval("t2", "deny");
    await expect(pending).resolves.toBe("deny");
  });

  it("allow-for-chat resolves every pending call", async () => {
    const a = waitForTerminalApproval({
      toolCallId: "a",
      command: "echo a",
      cwd: "",
      timeoutMs: 1_000,
    });
    const b = waitForTerminalApproval({
      toolCallId: "b",
      command: "echo b",
      cwd: "",
      timeoutMs: 1_000,
    });
    allowAllPendingTerminal();
    expect(getTerminalThreadAutoAllow()).toBe(true);
    await expect(a).resolves.toBe("allow");
    await expect(b).resolves.toBe("allow");
    expect(listPendingTerminalApprovals()).toHaveLength(0);
  });

  it("rejects when cancelled", async () => {
    const pending = waitForTerminalApproval({
      toolCallId: "t3",
      command: "sleep 9",
      cwd: "",
      timeoutMs: 1_000,
    });
    cancelTerminalApproval("t3", "stopped");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects on abort signal", async () => {
    const controller = new AbortController();
    const pending = waitForTerminalApproval(
      {
        toolCallId: "t4",
        command: "pwd",
        cwd: "",
        timeoutMs: 1_000,
      },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("terminal helpers", () => {
  it("clamps timeout", () => {
    expect(clampTerminalTimeoutMs(undefined)).toBe(DEFAULT_TERMINAL_TIMEOUT_MS);
    expect(clampTerminalTimeoutMs(0)).toBe(1_000);
    expect(clampTerminalTimeoutMs(99_999_999)).toBe(MAX_TERMINAL_TIMEOUT_MS);
    expect(clampTerminalTimeoutMs(5_000)).toBe(5_000);
  });

  it("thread auto-allow flag is independent of the pending map", () => {
    setTerminalThreadAutoAllow(true);
    expect(getTerminalThreadAutoAllow()).toBe(true);
    _resetTerminalApprovalsForTests();
    expect(getTerminalThreadAutoAllow()).toBe(false);
  });
});
