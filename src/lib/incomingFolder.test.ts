import { describe, expect, it } from "vitest";
import {
  INCOMING_FOLDER,
  isIncomingFolder,
  isIncomingPath,
} from "./incomingFolder";
import { isVaultProjectFolder } from "./vaultApi";

describe("Incoming folder helpers", () => {
  it("identifies the reserved Incoming folder", () => {
    expect(isIncomingFolder(INCOMING_FOLDER, true)).toBe(true);
    expect(isIncomingFolder(INCOMING_FOLDER, false)).toBe(false);
    expect(isIncomingFolder("Inbox", true)).toBe(false);
    expect(isIncomingPath("Incoming/scratch.md")).toBe(true);
    expect(isIncomingPath("Journal/02.Aug.2026.md")).toBe(false);
  });

  it("is not a vault project", () => {
    expect(isVaultProjectFolder(INCOMING_FOLDER, true)).toBe(false);
    expect(isVaultProjectFolder("Work", true)).toBe(true);
  });
});
