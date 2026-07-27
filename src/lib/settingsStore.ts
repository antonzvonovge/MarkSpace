import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "settings.json";

export async function loadLastVault(): Promise<string | null> {
  const store = await Store.load(STORE_FILE);
  return (await store.get<string>("lastVault")) ?? null;
}

export async function saveLastVault(path: string): Promise<void> {
  const store = await Store.load(STORE_FILE);
  await store.set("lastVault", path);
  await store.save();
}

export async function loadExpandedPaths(vaultPath: string): Promise<string[]> {
  const store = await Store.load(STORE_FILE);
  const map = (await store.get<Record<string, string[]>>("expandedByVault")) ?? {};
  return map[vaultPath] ?? [];
}

export async function saveExpandedPaths(
  vaultPath: string,
  expanded: string[],
): Promise<void> {
  const store = await Store.load(STORE_FILE);
  const map = (await store.get<Record<string, string[]>>("expandedByVault")) ?? {};
  map[vaultPath] = expanded.filter((p) => p !== "");
  await store.set("expandedByVault", map);
  await store.save();
}
