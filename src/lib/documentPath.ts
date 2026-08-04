/**
 * Format a vault-relative path for the document toolbar.
 * Long intermediate segments are shortened with …; the filename is kept as
 * complete as the character budget allows.
 */
export function formatToolbarPath(path: string, maxLen = 72): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return path;
  if (normalized.length <= maxLen) return normalized;

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return normalized;
  if (parts.length === 1) return ellipsizeMiddle(parts[0]!, maxLen);

  const file = parts[parts.length - 1]!;
  const dirs = parts.slice(0, -1);

  // Prefer a full filename; shrink dirs first.
  const fileBudget = Math.min(file.length, Math.max(24, Math.floor(maxLen * 0.55)));
  const fileShown = file.length <= fileBudget ? file : ellipsizeMiddle(file, fileBudget);
  let budget = maxLen - fileShown.length - 1; // trailing "/"

  if (dirs.length === 0) return fileShown;
  if (budget < 3) return `…/${fileShown}`;

  const shortened = dirs.map((seg) =>
    seg.length > 18 ? ellipsizeEnd(seg, 16) : seg,
  );

  let joined = shortened.join("/");
  if (joined.length <= budget) return `${joined}/${fileShown}`;

  // Drop middle directories until it fits (keep first + last dir when possible).
  if (shortened.length >= 3) {
    for (let keep = shortened.length - 2; keep >= 1; keep--) {
      const head = shortened.slice(0, keep);
      const tail = shortened[shortened.length - 1]!;
      const candidate = `${head.join("/")}/…/${tail}`;
      if (candidate.length <= budget) return `${candidate}/${fileShown}`;
    }
  }

  if (shortened.length >= 2) {
    const first = ellipsizeEnd(shortened[0]!, Math.max(4, budget - 4));
    return `${first}/…/${fileShown}`;
  }

  const only = ellipsizeEnd(shortened[0]!, Math.max(4, budget - 2));
  return `${only}/…/${fileShown}`.replace(/\/…\/…\//, "/…/");
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
