export type HostOsFamily = "windows" | "unix";
export type HostOsName = "windows" | "macos" | "linux" | "unknown";

export type HostOsInfo = {
  family: HostOsFamily;
  os: HostOsName;
  /** How the Rust `run_terminal` backend invokes the command string. */
  shell: "cmd.exe /C" | "/bin/sh -c";
};

function readNavigator(): { platform: string; userAgent: string } {
  if (typeof navigator === "undefined") {
    return { platform: "", userAgent: "" };
  }
  return {
    platform: navigator.platform || "",
    userAgent: navigator.userAgent || "",
  };
}

/** Detect the desktop OS family the agent terminal will actually spawn. */
export function detectHostOs(input?: {
  platform?: string;
  userAgent?: string;
}): HostOsInfo {
  const nav = input ?? readNavigator();
  const platform = nav.platform || "";
  const userAgent = nav.userAgent || "";
  const hay = `${platform} ${userAgent}`;

  if (/Win/i.test(hay)) {
    return { family: "windows", os: "windows", shell: "cmd.exe /C" };
  }
  if (
    /Mac|iPhone|iPad|iPod/i.test(platform) ||
    /Mac OS X|iPhone OS|Macintosh/i.test(userAgent)
  ) {
    return { family: "unix", os: "macos", shell: "/bin/sh -c" };
  }
  if (/Linux|X11/i.test(hay)) {
    return { family: "unix", os: "linux", shell: "/bin/sh -c" };
  }
  // Matches Rust `#[cfg(not(windows))]` → `/bin/sh -c`.
  return { family: "unix", os: "unknown", shell: "/bin/sh -c" };
}

const OS_LABEL: Record<HostOsName, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  unknown: "Unix-like",
};

/** One system-prompt line so the agent does not guess Windows vs Unix. */
export function hostOsSystemPromptLine(
  info = detectHostOs(),
  opts?: { terminalEnabled?: boolean },
): string {
  const family = info.family === "windows" ? "Windows" : "Unix";
  const named = OS_LABEL[info.os];
  const base = `Host OS: ${named} (${family} family).`;
  if (!opts?.terminalEnabled) return base;
  return `${base} run_terminal uses ${info.shell}. Write commands for that shell — do not guess the other family.`;
}
