import type { ProjectProperties, TreeNode } from "./vaultApi";
import { joinPath } from "./vaultApi";

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** First path segment = vault project folder, or null for vault root. */
export function vaultProjectRootOf(path: string): string | null {
  const cleaned = path.replace(/^\/+|\/+$/g, "");
  if (!cleaned) return null;
  const slash = cleaned.indexOf("/");
  return slash === -1 ? cleaned : cleaned.slice(0, slash);
}

/** Diary project root containing `path`, or null if not under a diary project. */
export function diaryProjectRootForPath(
  path: string,
  projectPropertiesByPath: Record<string, ProjectProperties>,
): string | null {
  const root = vaultProjectRootOf(path);
  if (!root) return null;
  return projectPropertiesByPath[root]?.projectType === "diary" ? root : null;
}

export function isUnderDiaryProject(
  path: string,
  projectPropertiesByPath: Record<string, ProjectProperties>,
): boolean {
  return diaryProjectRootForPath(path, projectPropertiesByPath) !== null;
}

/** Local calendar date at midnight (year/month/day only). */
export function startOfLocalDay(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Parse a calendar day from `YYYY-MM-DD` (local). Returns null if invalid.
 */
export function parseIsoDateOnly(input: string): Date | null {
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Note stem in `dd.MMM.yyyy` form (English month abbreviations). */
export function formatDailyNoteStem(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mmm = MONTH_ABBR[date.getMonth()];
  const yyyy = String(date.getFullYear());
  return `${dd}.${mmm}.${yyyy}`;
}

/**
 * Relative path for a daily note:
 * `{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md`
 */
export function dailyNotePath(
  projectRoot: string,
  date: Date = new Date(),
): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const stem = formatDailyNoteStem(date);
  return joinPath(joinPath(joinPath(projectRoot, yyyy), mm), `${stem}.md`);
}

/** Year and month folder paths that should be expanded after creating a daily note. */
export function dailyNoteFolderPaths(
  projectRoot: string,
  date: Date = new Date(),
): string[] {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yearPath = joinPath(projectRoot, yyyy);
  return [projectRoot, yearPath, joinPath(yearPath, mm)];
}

/** Parse `{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md` → local date, or null. */
export function parseDailyNoteDate(path: string): Date | null {
  const m = path
    .replace(/^\/+/, "")
    .match(
      /^([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\.([A-Za-z]{3})\.(\d{4})\.md$/i,
    );
  if (!m) return null;
  const folderYear = Number(m[2]);
  const folderMonth = Number(m[3]);
  const day = Number(m[4]);
  const monthAbbr = m[5];
  const year = Number(m[6]);
  const monthIdx = MONTH_ABBR.findIndex(
    (a) => a.toLowerCase() === monthAbbr.toLowerCase(),
  );
  if (
    monthIdx < 0 ||
    !Number.isFinite(day) ||
    !Number.isFinite(year) ||
    folderYear !== year ||
    folderMonth !== monthIdx + 1
  ) {
    return null;
  }
  const date = new Date(year, monthIdx, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIdx ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** All diary project roots, sorted by path. */
export function listDiaryProjectRoots(
  projectPropertiesByPath: Record<string, ProjectProperties>,
): string[] {
  return Object.values(projectPropertiesByPath)
    .filter((p) => p.projectType === "diary" && p.path)
    .map((p) => p.path)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Pick a diary project for calendar / daily-note actions:
 * selected folder → active note → chat project → sole diary project.
 */
export function resolveDiaryProjectRoot(opts: {
  selectedFolderPath: string;
  activePath: string | null | undefined;
  chatProjectPath: string | null | undefined;
  projectPropertiesByPath: Record<string, ProjectProperties>;
}): string | null {
  const { projectPropertiesByPath } = opts;
  for (const path of [
    opts.selectedFolderPath,
    opts.activePath ?? "",
    opts.chatProjectPath ?? "",
  ]) {
    const root = diaryProjectRootForPath(path, projectPropertiesByPath);
    if (root) return root;
  }
  const diaries = listDiaryProjectRoots(projectPropertiesByPath);
  return diaries.length === 1 ? diaries[0]! : null;
}

/** Stable key for a local calendar day (`YYYY-M-D`, month 0-based). */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Collect day keys for daily notes under a diary project in the vault tree. */
export function collectDailyNoteDayKeys(
  tree: TreeNode | null | undefined,
  projectRoot: string,
): Set<string> {
  const keys = new Set<string>();
  if (!tree || !projectRoot) return keys;

  const findProject = (node: TreeNode): TreeNode | null => {
    if (node.path === projectRoot) return node;
    for (const child of node.children ?? []) {
      const found = findProject(child);
      if (found) return found;
    }
    return null;
  };

  const project = findProject(tree);
  if (!project) return keys;

  const walk = (node: TreeNode) => {
    if (!node.isDir) {
      const date = parseDailyNoteDate(node.path);
      if (date) keys.add(dayKey(date));
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(project);
  return keys;
}
