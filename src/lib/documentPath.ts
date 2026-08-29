/**
 * Format a vault-relative path for the document toolbar.
 * Long intermediate segments are shortened with …; the filename is kept as
 * complete as the character budget allows.
 */

export type ToolbarPathPart =
  | { kind: "folder"; /** Vault-relative folder path. */ path: string; label: string }
  | { kind: "file"; label: string }
  | { kind: "ellipsis" };

/**
 * Split a vault-relative path into toolbar segments. Folder parts keep full
 * vault paths for navigation; labels may be shortened to fit `maxLen`.
 */
export function toolbarPathParts(path: string, maxLen = 72): ToolbarPathPart[] {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return [{ kind: "file", label: path }];

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return [{ kind: "file", label: normalized }];
  if (parts.length === 1) {
    return [{ kind: "file", label: ellipsizeMiddle(parts[0]!, maxLen) }];
  }

  const file = parts[parts.length - 1]!;
  const dirs = parts.slice(0, -1);

  // Prefer a full filename; shrink dirs first.
  const fileBudget = Math.min(file.length, Math.max(24, Math.floor(maxLen * 0.55)));
  const fileShown = file.length <= fileBudget ? file : ellipsizeMiddle(file, fileBudget);
  let budget = maxLen - fileShown.length - 1; // trailing "/"

  const dirPaths = dirs.map((_, i) => dirs.slice(0, i + 1).join("/"));
  const shortenedLabels = dirs.map((seg) =>
    seg.length > 18 ? ellipsizeEnd(seg, 16) : seg,
  );

  const asParts = (
    labels: string[],
    paths: string[],
    withEllipsis: boolean,
  ): ToolbarPathPart[] => {
    const out: ToolbarPathPart[] = [];
    for (let i = 0; i < labels.length; i++) {
      out.push({ kind: "folder", path: paths[i]!, label: labels[i]! });
    }
    if (withEllipsis) out.push({ kind: "ellipsis" });
    out.push({ kind: "file", label: fileShown });
    return out;
  };

  const joinedLen = (labels: string[], ellipsis: boolean) =>
    labels.join("/").length + (ellipsis ? 2 : 0); // "/…"

  if (budget < 3) {
    return [{ kind: "ellipsis" }, { kind: "file", label: fileShown }];
  }

  if (joinedLen(shortenedLabels, false) <= budget) {
    return asParts(shortenedLabels, dirPaths, false);
  }

  // Drop middle directories until it fits (keep first + last dir when possible).
  if (shortenedLabels.length >= 3) {
    for (let keep = shortenedLabels.length - 2; keep >= 1; keep--) {
      const headLabels = shortenedLabels.slice(0, keep);
      const headPaths = dirPaths.slice(0, keep);
      const tailLabel = shortenedLabels[shortenedLabels.length - 1]!;
      const tailPath = dirPaths[dirPaths.length - 1]!;
      const candidateLen =
        headLabels.join("/").length + 1 + 1 + 1 + tailLabel.length; // /…/
      if (candidateLen <= budget) {
        return [
          ...headLabels.map((label, i) => ({
            kind: "folder" as const,
            path: headPaths[i]!,
            label,
          })),
          { kind: "ellipsis" },
          { kind: "folder", path: tailPath, label: tailLabel },
          { kind: "file", label: fileShown },
        ];
      }
    }
  }

  if (shortenedLabels.length >= 2) {
    const firstBudget = Math.max(4, budget - 4);
    const first = ellipsizeEnd(shortenedLabels[0]!, firstBudget);
    return [
      { kind: "folder", path: dirPaths[0]!, label: first },
      { kind: "ellipsis" },
      { kind: "file", label: fileShown },
    ];
  }

  const only = ellipsizeEnd(shortenedLabels[0]!, Math.max(4, budget - 2));
  return [
    { kind: "folder", path: dirPaths[0]!, label: only },
    { kind: "ellipsis" },
    { kind: "file", label: fileShown },
  ];
}

/** Flatten toolbar path parts to a display string (tests / title). */
export function formatToolbarPath(path: string, maxLen = 72): string {
  const parts = toolbarPathParts(path, maxLen);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i > 0) out += "/";
    if (part.kind === "ellipsis") out += "…";
    else out += part.label;
  }
  return out.replace(/\/…\/…\//, "/…/");
}

function ellipsizeEnd(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  return `${s.slice(0, max - 1)}…`;
}

function ellipsizeMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  if (max === 2) return `${s[0]}…`;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}
