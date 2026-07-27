#!/usr/bin/env node
/**
 * Downloads the draw.io webapp into public/drawio for offline embed mode.
 * Re-run when bumping DRAWIO_VERSION.
 */
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFileSync } from "node:child_process";

const DRAWIO_VERSION = "v28.2.5";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "drawio");
const STAMP = path.join(OUT_DIR, ".drawio-version");
const TMP_DIR = path.join(ROOT, "public", ".drawio-download");

async function alreadyBundled() {
  if (!existsSync(STAMP) || !existsSync(path.join(OUT_DIR, "index.html"))) {
    return false;
  }
  const current = (await readFile(STAMP, "utf8")).trim();
  return current === DRAWIO_VERSION;
}

async function downloadArchive(url, dest) {
  const res = await fetch(url, {
    headers: { "User-Agent": "MarkSpace-drawio-bundle" },
    redirect: "follow",
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function extractTarGz(archive, destDir) {
  mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", destDir], { stdio: "inherit" });
}

async function findWebapp(extractedRoot) {
  const entries = await readdir(extractedRoot);
  for (const name of entries) {
    const candidate = path.join(extractedRoot, name, "src", "main", "webapp");
    if (existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  throw new Error("Could not find src/main/webapp/index.html in archive");
}

async function main() {
  if (await alreadyBundled()) {
    console.log(`draw.io ${DRAWIO_VERSION} already present in public/drawio`);
    return;
  }

  console.log(`Downloading draw.io ${DRAWIO_VERSION}…`);
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  const archiveUrl = `https://github.com/jgraph/drawio/archive/refs/tags/${DRAWIO_VERSION}.tar.gz`;
  const archivePath = path.join(TMP_DIR, "drawio.tar.gz");
  await downloadArchive(archiveUrl, archivePath);

  const extractDir = path.join(TMP_DIR, "extract");
  extractTarGz(archivePath, extractDir);
  const webapp = await findWebapp(extractDir);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(path.dirname(OUT_DIR), { recursive: true });
  await cp(webapp, OUT_DIR, { recursive: true });
  await writeFile(STAMP, `${DRAWIO_VERSION}\n`, "utf8");
  await rm(TMP_DIR, { recursive: true, force: true });
  console.log(`draw.io ${DRAWIO_VERSION} installed → public/drawio`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
