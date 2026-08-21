#!/usr/bin/env node
/**
 * Build markspace-embeddings and stage it for Tauri externalBin.
 * Output: src-tauri/binaries/markspace-embeddings-<target-triple>[.exe]
 */
import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const tauriDir = join(root, "src-tauri");
const binariesDir = join(tauriDir, "binaries");

function rustcHost() {
  const out = execSync("rustc -vV", { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("Could not detect rustc host triple");
  return line.slice("host:".length).trim();
}

const target = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || rustcHost();
const release = process.argv.includes("--release") || process.env.NODE_ENV === "production";
const profile = release ? "release" : "debug";
const exeName =
  process.platform === "win32" ? "markspace-embeddings.exe" : "markspace-embeddings";
const stagedName =
  process.platform === "win32"
    ? `markspace-embeddings-${target}.exe`
    : `markspace-embeddings-${target}`;

mkdirSync(binariesDir, { recursive: true });

const dest = join(binariesDir, stagedName);
// Stub so tauri-build accepts externalBin while we compile the real binary.
if (!existsSync(dest)) {
  writeFileSync(dest, "");
  if (process.platform !== "win32") chmodSync(dest, 0o755);
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

const targetDir = process.env.CARGO_TARGET_DIR || join(tauriDir, "target");
const builtCandidates = [
  join(targetDir, target, profile, exeName),
  join(targetDir, profile, exeName),
];
const built = builtCandidates.find((p) => existsSync(p));
if (!built) {
  throw new Error(
    `Built sidecar not found. Tried:\n${builtCandidates.join("\n")}`,
  );
}

copyFileSync(built, dest);
if (process.platform !== "win32") {
  chmodSync(dest, 0o755);
}
console.log(`[sidecar] staged ${dest}`);
