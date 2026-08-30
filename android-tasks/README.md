# MarkSpace Tasks (Android companion)

Native Kotlin / Jetpack Compose app for MarkSpace **Tasks/** notes. Shares the vault format and GitHub sync with the desktop MarkSpace client — not a WebView or Tauri port.

## Requirements

- JDK 17+
- Android SDK 35 (`ANDROID_HOME` / `local.properties` `sdk.dir`)
- A GitHub repo that already holds your MarkSpace vault (same remote as desktop Settings → Sync)

## Build

```bash
cd android-tasks
./gradlew :app:assembleDebug
# install
./gradlew :app:installDebug
```

JVM parser tests (shared fixtures under `../fixtures/task-notes/`):

```bash
./gradlew :tasknotes:test
```

## Pair with desktop

1. On desktop: Settings → Sync → connect vault to GitHub (PAT with `repo`).
2. On phone: open **Sync**, paste the same `owner/repo` (or HTTPS URL) and PAT → **Clone**.
3. Edit tasks offline; **Sync Now** (or autosync) commits, pulls, and pushes the **full vault** (same as desktop — not Tasks-only).

Commit author matches desktop: `MarkSpace <markspace@local>`.

## Layout

| Module | Role |
|--------|------|
| `app` | Compose UI (desktop-matched Tasks chrome) |
| `tasknotes` | Pure JVM parse/serialize/index/filters |
| `sync` | JGit clone / sync / conflict helpers |

Format contract: [`docs/task-notes-format.md`](../docs/task-notes-format.md).
