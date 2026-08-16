#!/usr/bin/env node
/**
 * Copies browser-safe files from the official @drawio/mcp package into
 * src/ai/drawio/vendor/. Does not install the stdio MCP server.
 *
 * Re-run when bumping DRAWIO_MCP_VERSION.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DRAWIO_MCP_VERSION = "1.5.0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "src", "ai", "drawio", "vendor");
const BASE = `https://unpkg.com/@drawio/mcp@${DRAWIO_MCP_VERSION}/src`;

const FILES = [
  "xml-reference.md",
  "mermaid-reference.md",
  "shape-search.js",
];

async function download(name) {
  const url = `${BASE}/${name}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "MarkSpace-drawio-mcp-sync" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const name of FILES) {
    const body = await download(name);
    const dest = path.join(OUT_DIR, name);
    await writeFile(dest, body, "utf8");
    console.log(`wrote ${path.relative(ROOT, dest)} (${body.length} bytes)`);
  }
  await writeFile(
    path.join(OUT_DIR, "VERSION"),
    `${DRAWIO_MCP_VERSION}\n`,
    "utf8",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
