/** Parse the filesystem path out of a Tauri `convertFileSrc` URL. */
export function filePathFromAssetSrc(src: string): string | null {
  const trimmed = src.trim();
  const match = trimmed.match(
    /^(?:asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)([^?#]+)/i,
  );
  if (!match?.[1]) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  // `encodeURIComponent("/home/...")` may surface as "//home/..." after decode.
  if (path.startsWith("//") && !/^[A-Za-z]:/.test(path.slice(2))) {
    path = path.slice(1);
  }
  return path || null;
}

/** Vault-relative path for an absolute file inside `vaultRoot`, or null. */
export function vaultRelFromAbsolute(
  abs: string,
  vaultRoot: string,
): string | null {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const a = norm(abs);
  const r = norm(vaultRoot);
  if (!a || !r) return null;
  const prefix = `${r}/`;
  const ignoreCase = /^[A-Za-z]:\//.test(r);
  const starts = ignoreCase
    ? a.toLowerCase().startsWith(prefix.toLowerCase())
    : a.startsWith(prefix);
  if (!starts) return null;
  const rel = a.slice(prefix.length);
  return rel || null;
}
