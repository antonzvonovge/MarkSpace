/** Max entries in the in-session document browse history. */
export const NAV_HISTORY_LIMIT = 50;

export type NavHistoryState = {
  paths: string[];
  /** Index of the current entry; `-1` when empty. */
  index: number;
};

export function emptyNavHistory(): NavHistoryState {
  return { paths: [], index: -1 };
}

export function canGoBack(state: NavHistoryState): boolean {
  return state.index > 0;
}

export function canGoForward(state: NavHistoryState): boolean {
  return state.index >= 0 && state.index < state.paths.length - 1;
}

export function currentNavPath(state: NavHistoryState): string | null {
  if (state.index < 0 || state.index >= state.paths.length) return null;
  return state.paths[state.index] ?? null;
}

/**
 * Record a visit after `activePath` changes. Same path as current → no-op.
 * Truncates any forward entries, then appends (capped from the front).
 */
export function pushNavVisit(
  state: NavHistoryState,
  path: string,
): NavHistoryState {
  if (!path) return state;
  if (state.index >= 0 && state.paths[state.index] === path) return state;

  const truncated =
    state.index >= 0 ? state.paths.slice(0, state.index + 1) : [];
  truncated.push(path);

  if (truncated.length <= NAV_HISTORY_LIMIT) {
    return { paths: truncated, index: truncated.length - 1 };
  }

  const drop = truncated.length - NAV_HISTORY_LIMIT;
  const paths = truncated.slice(drop);
  return { paths, index: paths.length - 1 };
}

export function moveNavBack(state: NavHistoryState): NavHistoryState | null {
  if (!canGoBack(state)) return null;
  return { paths: state.paths, index: state.index - 1 };
}

export function moveNavForward(state: NavHistoryState): NavHistoryState | null {
  if (!canGoForward(state)) return null;
  return { paths: state.paths, index: state.index + 1 };
}

function remapOnePath(path: string, from: string, to: string | null): string | null {
  if (path === from || path.startsWith(`${from}/`)) {
    if (to == null) return null;
    return path === from ? to : `${to}${path.slice(from.length)}`;
  }
  return path;
}

/**
 * Remap or drop history paths after move/rename/delete (`to` null = delete).
 * Collapses consecutive duplicates; adjusts `index` when entries before/at
 * the cursor are removed.
 */
export function remapNavHistory(
  state: NavHistoryState,
  from: string,
  to: string | null,
): NavHistoryState {
  if (!from || state.paths.length === 0) return state;

  const paths: string[] = [];
  let index = state.index;

  for (let i = 0; i < state.paths.length; i++) {
    const next = remapOnePath(state.paths[i]!, from, to);
    if (next == null) {
      if (i <= state.index) index -= 1;
      continue;
    }
    if (paths.length > 0 && paths[paths.length - 1] === next) {
      if (i <= state.index) index -= 1;
      continue;
    }
    paths.push(next);
  }

  if (paths.length === 0) return emptyNavHistory();
  if (index < 0) index = 0;
  if (index >= paths.length) index = paths.length - 1;

  if (
    paths.length === state.paths.length &&
    index === state.index &&
    paths.every((p, i) => p === state.paths[i])
  ) {
    return state;
  }

  return { paths, index };
}
