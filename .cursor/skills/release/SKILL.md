---
name: release
description: >-
  Ships a MarkSpace GitHub release: bumps version, commits Ship, tags vX.Y.Z,
  and pushes so Actions builds Linux/Windows installers. Use when the user asks
  to release, ship, publish, cut a version, сделать релиз, новый релиз, or
  запуш и сделай релиз.
---

# MarkSpace release

Не создавать GitHub Release вручную (`gh release create`). Релиз делает `.github/workflows/release.yml` по пушу тега `v*`.

Платформы: Ubuntu + Windows. macOS нет. Сборка обычно 15–20 минут.

## Когда запускать

Только если пользователь явно просит релиз/ship/publish. Коммит бампа версии — часть релиза, его можно делать без отдельной просьбы «закоммить». Остальной продуктовый код коммитить только если пользователь это имел в виду (например «запуш и сделай релиз» при уже готовых фичах).

## Шаги

1. **Проверить состояние**
   - Ветка `main`.
   - Нет лишнего грязного дерева: либо закоммитить то, что входит в релиз, либо остановиться и спросить.
   - Текущая версия: `package.json` / `src-tauri/tauri.conf.json`.
   - Последний тег: `git tag --sort=-v:refname | head -5`.
   - Что войдёт: `git log origin/main..HEAD` и незакоммиченные фичи.

2. **Выбрать версию**
   - По умолчанию минор: `1.N.0` → `1.(N+1).0`.
   - Патч (`1.N.M+1`) — только hotfix или если пользователь так сказал.
   - Тег `vX.Y.Z` ещё не должен существовать.

3. **Бампнуть ровно эти 5 файлов** (одинаковая версия, без лишнего):
   - `package.json` → `"version"`
   - `package-lock.json` → корневой `"version"` и `packages[""].version`
   - `src-tauri/tauri.conf.json` → `"version"`
   - `src-tauri/Cargo.toml` → `version = "X.Y.Z"` (**без запятой**, это TOML)
   - `src-tauri/Cargo.lock` → только пакет `name = "markspace"`, его `version`

   Не трогать версии чужих крейтов в `Cargo.lock`. Не использовать `npm version` (лишние теги/коммиты).

4. **Закоммитить** только эти 5 файлов. Сообщение:

   ```
   Ship X.Y.Z with <краткое описание фич>.

   Bump version for a new GitHub release; vPREV is already published.
   ```

   Первая строка — как в истории: коротко, по-английски, про *зачем* релиз.

   Примеры:
   - `Ship 1.20.0 with in-note find and saving chat messages as notes.`
   - `Ship 1.19.0 with MCP settings and stronger Draw.io tools.`

5. **Тег** — lightweight, на ship-коммите:

   ```bash
   git tag vX.Y.Z
   ```

6. **Пуш**

   ```bash
   git push origin main
   git push origin vX.Y.Z
   ```

   Не `--force` тег/main, пока пользователь явно не попросил.

7. **Проверить, что workflow стартанул**

   ```bash
   gh run list --workflow=release.yml --limit 3
   ```

   Пользователю отдать:
   - URL рана: `https://github.com/antonzvonovge/MarkSpace/actions/runs/<id>`
   - URL релиза (появится после публикации): `https://github.com/antonzvonovge/MarkSpace/releases/tag/vX.Y.Z`

   Дожидаться конца сборки не нужно, если пользователь не просил.

## Если CI упал

Исправить компиляцию отдельным коммитом на `main`. Двигать тег (`git tag -f` + force-push) **только после явной просьбы** пользователя. Иначе новый патч-релиз (`1.N.1`).

## Не делать

- `gh release create` / править body релиза вручную — body задаёт `tauri-action`.
- Пушить тег, пока версия в 5 файлах не совпадает с тегом.
- Релизить с `main`, который не запушен или расходится с origin.
- Бамп только части файлов.
