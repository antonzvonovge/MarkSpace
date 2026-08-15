import { describe, expect, it } from "vitest";
import { detectHostOs, hostOsSystemPromptLine } from "./hostOs";

describe("detectHostOs", () => {
  it("classifies Windows as the Windows family with cmd.exe", () => {
    expect(
      detectHostOs({
        platform: "Win32",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
    ).toEqual({
      family: "windows",
      os: "windows",
      shell: "cmd.exe /C",
    });
  });

  it("classifies macOS as Unix with /bin/sh", () => {
    expect(
      detectHostOs({
        platform: "MacIntel",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
    ).toEqual({ family: "unix", os: "macos", shell: "/bin/sh -c" });
  });

  it("classifies Linux as Unix with /bin/sh", () => {
    expect(
      detectHostOs({
        platform: "Linux x86_64",
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      }),
    ).toEqual({ family: "unix", os: "linux", shell: "/bin/sh -c" });
  });

  it("treats unknown non-Windows as Unix-like /bin/sh", () => {
    expect(detectHostOs({ platform: "", userAgent: "" })).toEqual({
      family: "unix",
      os: "unknown",
      shell: "/bin/sh -c",
    });
  });
});

describe("hostOsSystemPromptLine", () => {
  const linux = detectHostOs({
    platform: "Linux x86_64",
    userAgent: "X11; Linux x86_64",
  });
  const windows = detectHostOs({
    platform: "Win32",
    userAgent: "Windows NT 10.0",
  });

  it("names the family without mentioning run_terminal when terminal is off", () => {
    expect(hostOsSystemPromptLine(linux)).toBe("Host OS: Linux (Unix family).");
    expect(hostOsSystemPromptLine(windows, { terminalEnabled: false })).toBe(
      "Host OS: Windows (Windows family).",
    );
  });

  it("states the shell when terminal is on", () => {
    expect(hostOsSystemPromptLine(linux, { terminalEnabled: true })).toBe(
      "Host OS: Linux (Unix family). run_terminal uses /bin/sh -c. Write commands for that shell — do not guess the other family.",
    );
    expect(hostOsSystemPromptLine(windows, { terminalEnabled: true })).toBe(
      "Host OS: Windows (Windows family). run_terminal uses cmd.exe /C. Write commands for that shell — do not guess the other family.",
    );
  });
});
