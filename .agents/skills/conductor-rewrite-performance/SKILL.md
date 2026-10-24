---
name: conductor-rewrite-performance
description: >-
  Local-first desktop React performance: re-render cascades, streaming chat/lists,
  Tauri profiling without Chrome DevTools. Use for MarkSpace UI jank, navigation
  re-renders, Virtuoso lists, or Tauri invoke shims.
---

# Conductor-style React performance

## When to use

- Cascading re-renders on navigation / shared state
- Streaming chat or long lists feel sluggish
- Tauri webview — need Chrome Profiler
- Many heavy views mounted; unstable references fan out

## Principles

1. Local-first moves the bottleneck to **rendering** — every extra re-render is user-visible.
2. **Unstable references** (new objects from router/hooks) cascade through the tree.
3. Streaming lists need **virtualization + memo** (visible rows only; only the changing item updates).
4. Keep expensive sync work **off the critical path** (first token / first paint first).

## Checklist

- [ ] Profile in Chrome (shim `invoke` if needed) — see [reference.md](reference.md)
- [ ] Stabilize search/params (structural sharing / narrow subscriptions)
- [ ] Virtualize long/streaming lists; `memo` row components
- [ ] No sync git/I/O before first UI response
- [ ] Idle shutdown for heavyweight child processes

## Anti-patterns

- Wrapping every unstable ref in `useMemo` instead of fixing the source
- Rendering all list items with CSS scroll only
- Blocking the UI thread on the critical path
- Letting child processes accumulate forever
- Skipping profiling because “webview has no DevTools”

## Details

Code patterns: [reference.md](reference.md)

Source: [The Conductor Rewrite](https://performance.dev/the-conductor-rewrite)
