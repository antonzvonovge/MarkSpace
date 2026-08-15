/** Parse OS file-manager clipboard / paste payloads into absolute paths + File blobs. */

function fileUrlToPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "file:") return null;
    let path = decodeURIComponent(url.pathname);
    // Windows: file:///C:/Users/... → /C:/Users/... → C:/Users/...
    if (/^\/[A-Za-z]:\//.test(path)) {
      path = path.slice(1);
    }
    // UNC: file://server/share → //server/share
    if (url.host && url.host !== "localhost") {
      path = `//${url.host}${path}`;
    }
    return path;
  } catch {
    return null;
  }
}

function looksLikeAbsolutePath(line: string): boolean {
  const t = line.trim();
  if (!t || t.startsWith("#")) return false;
  if (t.startsWith("file:")) return true;
  // Unix
  if (t.startsWith("/")) return true;
  // Windows drive / UNC
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (t.startsWith("\\\\")) return true;
  return false;
}

function pathFromLine(line: string): string | null {
  const t = line.trim().replace(/^["']|["']$/g, "");
  if (!t) return null;
  if (t.startsWith("file:")) return fileUrlToPath(t);
  if (looksLikeAbsolutePath(t)) return t;
  return null;
}

/** Absolute paths from text/uri-list and text/plain (Explorer / Nautilus / Dolphin). */
export function pathsFromClipboardData(data: DataTransfer): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string | null) => {
    if (!p) return;
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };

  const uriList = data.getData("text/uri-list");
  if (uriList) {
    for (const line of uriList.split(/\r?\n/)) push(pathFromLine(line));
  }

  const plain = data.getData("text/plain");
  if (plain) {
    for (const line of plain.split(/\r?\n/)) {
      if (looksLikeAbsolutePath(line) || line.trim().startsWith("file:")) {
        push(pathFromLine(line));
      }
    }
  }

  return out;
}

export function isVaultDocumentName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".md") ||
    lower.endsWith(".drawio") ||
    lower.endsWith(".mdlnks") ||
    lower.endsWith(".mddict") ||
    lower.endsWith(".mdhabit") ||
    lower.endsWith(".pdf")
  );
}

/** Files from clipboardData.files + items (when the OS exposes blobs, not paths). */
export function collectVaultDocumentFiles(data: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null | undefined) => {
    if (!file || !file.name || !isVaultDocumentName(file.name)) return;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };

  if (data.files?.length) {
    for (let i = 0; i < data.files.length; i++) push(data.files[i]);
  }
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") push(item.getAsFile());
    }
  }
  return out;
}

export function clipboardHasOsFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  const types = Array.from(data.types as ArrayLike<string>);
  if (types.includes("Files") || types.includes("text/uri-list")) return true;
  if (types.includes("text/plain")) {
    const plain = data.getData("text/plain");
    if (plain && plain.split(/\r?\n/).some((l) => looksLikeAbsolutePath(l))) {
      return true;
    }
  }
  return false;
}

/** Last path segment from an OS absolute path (Unix or Windows). */
export function basenameFromOsPath(path: string): string {
  const cleaned = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const i = cleaned.lastIndexOf("/");
  return i === -1 ? cleaned : cleaned.slice(i + 1);
}

/** Top-level entry names that import will place under `parent`. */
export function importEntryNames(paths: string[], files: File[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  for (const p of paths) push(basenameFromOsPath(p));
  for (const f of files) {
    if (isVaultDocumentName(f.name)) push(f.name);
  }
  return out;
}

/** Names that already exist under `parent` in the vault tree. */
export function conflictingImportNames(
  parent: string,
  names: string[],
  exists: (vaultRelPath: string) => boolean,
): string[] {
  const prefix = parent.replace(/\/$/, "");
  return names.filter((name) => {
    const dest = prefix ? `${prefix}/${name}` : name;
    return exists(dest);
  });
}
