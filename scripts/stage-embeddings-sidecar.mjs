#!/usr/bin/env node
/**
 * Build markspace-embeddings and stage it for Tauri externalBin.
 * Output: src-tauri/binaries/markspace-embeddings-<target-triple>[.exe]
 *
 * Flags:
 *   --release     release profile
 *   --if-needed   skip cargo when a non-empty staged (or target/) binary is fresh
 *   --force       always rebuild (default without --if-needed)
 */
import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  writeFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tauriDir = join(root, "src-tauri");
const binariesDir = join(tauriDir, "binaries");

const ifNeeded = process.argv.includes("--if-needed");
const force = process.argv.includes("--force");

function rustcHost() {
  const out = execSync("rustc -vV", { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("Could not detect rustc host triple");
  return line.slice("host:".length).trim();
}

function fileMtimeMs(path) {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size === 0) return null;
    return st.mtimeMs;
  } catch {
    return null;
  }
}

function newestMtimeUnder(dir, acc = { m: 0 }) {
  if (!existsSync(dir)) return acc.m;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "target" || name.name.startsWith(".")) continue;
      newestMtimeUnder(p, acc);
    } else if (name.isFile()) {
      const m = fileMtimeMs(p);
      if (m != null && m > acc.m) acc.m = m;
    }
  }
  return acc.m;
}

function sourcesNewestMtime() {
  let newest = 0;
  const paths = [
    join(tauriDir, "Cargo.toml"),
    join(tauriDir, "Cargo.lock"),
    join(tauriDir, "src", "bin", "markspace_embeddings.rs"),
    join(tauriDir, "src", "lib.rs"),
    join(tauriDir, "src", "indexing.rs"),
    join(tauriDir, "src", "pdf_text.rs"),
  ];
  for (const p of paths) {
    const m = fileMtimeMs(p);
    if (m != null && m > newest) newest = m;
  }
  newest = Math.max(
    newest,
    newestMtimeUnder(join(tauriDir, "src", "embeddings")),
  );
  return newest;
}

const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  rustcHost();
const release =
  process.argv.includes("--release") || process.env.NODE_ENV === "production";
const profile = release ? "release" : "debug";
const exeName =
  process.platform === "win32"
    ? "markspace-embeddings.exe"
    : "markspace-embeddings";
const stagedName =
  process.platform === "win32"
    ? `markspace-embeddings-${target}.exe`
    : `markspace-embeddings-${target}`;

mkdirSync(binariesDir, { recursive: true });

const dest = join(binariesDir, stagedName);
const targetDir = process.env.CARGO_TARGET_DIR || join(tauriDir, "target");
const builtCandidates = [
  join(targetDir, target, profile, exeName),
  join(targetDir, profile, exeName),
];

function ensureStub() {
  if (!existsSync(dest)) {
    writeFileSync(dest, "");
    if (process.platform !== "win32") chmodSync(dest, 0o755);
  }
}

function stageFrom(built) {
  copyFileSync(built, dest);
  if (process.platform !== "win32") chmodSync(dest, 0o755);
  console.log(`[sidecar] staged ${dest}`);
}

// Always leave a stub so tauri-build's externalBin check passes before a real build.
ensureStub();

const srcNewest = sourcesNewestMtime();
const destMtime = fileMtimeMs(dest);
const existingBuilt = builtCandidates
  .map((p) => ({ path: p, mtime: fileMtimeMs(p) }))
  .find((x) => x.mtime != null);

const upToDate =
  !force &&
  ifNeeded &&
  ((destMtime != null && destMtime >= srcNewest) ||
    (existingBuilt != null && existingBuilt.mtime >= srcNewest));

if (upToDate) {
  if (destMtime == null && existingBuilt) {
    stageFrom(existingBuilt.path);
  } else {
    console.log("[sidecar] up to date — skipping rebuild");
  }
  process.exit(0);
}

const cargoArgs = [
  "build",
  "--manifest-path",
  join(tauriDir, "Cargo.toml"),
  "--bin",
  "markspace-embeddings",
];
if (release) cargoArgs.push("--release");
if (process.env.CARGO_BUILD_TARGET || process.env.TAURI_ENV_TARGET_TRIPLE) {
  cargoArgs.push("--target", target);
}

console.log(`[sidecar] cargo ${cargoArgs.join(" ")}`);
execSync(`cargo ${cargoArgs.join(" ")}`, { stdio: "inherit", cwd: root });

const built = builtCandidates.find((p) => fileMtimeMs(p) != null);
if (!built) {
  throw new Error(
    `Built sidecar not found. Tried:\n${builtCandidates.join("\n")}`,
  );
}

stageFrom(built);
