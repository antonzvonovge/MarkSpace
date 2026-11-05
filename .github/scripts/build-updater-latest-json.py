#!/usr/bin/env python3
"""Build a complete Tauri updater latest.json from release .sig assets.

Matrix jobs must set uploadUpdaterJson: false so they never race on this file.
This script is the single writer: download every .sig, map to platform keys,
point URLs at GitHub release asset API ids (same shape as tauri-action).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_PLATFORM_KEYS = (
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-x86_64",
    "windows-x86_64",
)


def gh_api(url: str, token: str) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "markspace-updater-manifest",
        },
    )
    with urllib.request.urlopen(req) as res:
        return json.load(res)


def download(url: str, token: str, dest: Path) -> None:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/octet-stream",
            "Authorization": f"Bearer {token}",
            "User-Agent": "markspace-updater-manifest",
        },
    )
    with urllib.request.urlopen(req) as res, dest.open("wb") as out:
        out.write(res.read())


def platform_keys_for_asset(name: str) -> list[str]:
    """Mirror tauri-action key scheme (prefer MSI for bare windows-x86_64)."""
    if name.endswith(".app.tar.gz"):
        if "_aarch64." in name or name.endswith("_aarch64.app.tar.gz"):
            return ["darwin-aarch64", "darwin-aarch64-app"]
        if "_x64." in name or name.endswith("_x64.app.tar.gz"):
            return ["darwin-x86_64", "darwin-x86_64-app"]
        return []
    if name.endswith(".AppImage"):
        if "_amd64." in name:
            return ["linux-x86_64", "linux-x86_64-appimage"]
        if "_aarch64." in name:
            return ["linux-aarch64", "linux-aarch64-appimage"]
        return []
    if name.endswith(".deb"):
        if "_amd64." in name:
            return ["linux-x86_64-deb"]
        if "_arm64." in name or "_aarch64." in name:
            return ["linux-aarch64-deb"]
        return []
    if name.endswith(".rpm"):
        if "x86_64" in name:
            return ["linux-x86_64-rpm"]
        if "aarch64" in name:
            return ["linux-aarch64-rpm"]
        return []
    if name.endswith(".msi"):
        if "_x64_" in name or "_x64." in name:
            # Bare windows-x86_64 prefers MSI (updaterJsonPreferNsis: false).
            return ["windows-x86_64", "windows-x86_64-msi"]
        return []
    if name.endswith("-setup.exe") or name.endswith(".exe"):
        if "_x64-setup.exe" in name or name.endswith("_x64-setup.exe"):
            return ["windows-x86_64-nsis"]
        return []
    return []


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="owner/name")
    parser.add_argument("--tag", required=True, help="vX.Y.Z")
    parser.add_argument("--out", required=True, help="path for latest.json")
    parser.add_argument(
        "--notes",
        default="",
        help="Release notes string (optional; falls back to release body)",
    )
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        print("GITHUB_TOKEN is required", file=sys.stderr)
        return 2

    tag = args.tag
    version = tag[1:] if tag.startswith("v") else tag
    api = f"https://api.github.com/repos/{args.repo}/releases/tags/{tag}"
    try:
        release = gh_api(api, token)
    except urllib.error.HTTPError as e:
        print(f"Failed to fetch release {tag}: {e}", file=sys.stderr)
        return 1

    assets = release.get("assets") or []
    by_name = {a["name"]: a for a in assets if isinstance(a.get("name"), str)}

    work = Path(args.out).resolve().parent / ".updater-sigs"
    work.mkdir(parents=True, exist_ok=True)

    platforms: dict[str, dict[str, str]] = {}
    for name, asset in by_name.items():
        if not name.endswith(".sig"):
            continue
        binary_name = name[: -len(".sig")]
        binary = by_name.get(binary_name)
        if not binary:
            print(f"skip {name}: missing binary {binary_name}", file=sys.stderr)
            continue
        keys = platform_keys_for_asset(binary_name)
        if not keys:
            print(f"skip {name}: no platform mapping", file=sys.stderr)
            continue
        sig_path = work / name
        download(asset["url"], token, sig_path)
        signature = sig_path.read_text(encoding="utf-8").strip() + "\n"
        # tauri-action uses the assets API URL (id-based), not browser_download_url.
        url = f"https://api.github.com/repos/{args.repo}/releases/assets/{binary['id']}"
        for key in keys:
            platforms[key] = {"signature": signature, "url": url}

    missing = [k for k in REQUIRED_PLATFORM_KEYS if k not in platforms]
    if missing:
        print(
            "Incomplete updater manifest; missing required platforms: "
            + ", ".join(missing),
            file=sys.stderr,
        )
        print("Present: " + ", ".join(sorted(platforms)) or "(none)", file=sys.stderr)
        return 1

    notes = (args.notes or "").strip() or (release.get("body") or "").strip()
    pub_date = release.get("published_at") or release.get("created_at")
    if not pub_date:
        pub_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    manifest = {
        "version": version,
        "notes": notes,
        "pub_date": pub_date,
        "platforms": dict(sorted(platforms.items())),
    }

    out = Path(args.out)
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {out} with {len(platforms)} platforms: "
        + ", ".join(sorted(platforms))
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
