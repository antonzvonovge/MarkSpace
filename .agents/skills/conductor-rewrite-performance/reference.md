# Conductor rewrite — tactics (code)

Companion to `SKILL.md`. Read only the section you need.

## Shim Tauri bridge for Chrome profiling

```typescript
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if ("__TAURI_INTERNALS__" in window) return tauriInvoke<T>(cmd, args);
  return fetch(`/__backend__/${cmd}`, {
    method: "POST",
    body: JSON.stringify(args ?? {}),
  }).then((r) => r.json());
}
```

1. Identify the single bridge (`invoke`)
2. Production → native; dev → proxy/mock
3. Boot client in Chrome → React DevTools Profiler

## Stable router references (TanStack vs react-router)

**Before** (`useSearchParams` → new object every render → cascade):

```tsx
const [searchParams] = useSearchParams();
const filters = {
  agent: searchParams.get("agent"),
  status: searchParams.get("status"),
};
useEffect(() => { refetchAgents(filters); }, [filters]);
```

**After** (structural sharing):

```tsx
export const Route = createFileRoute("/workspace")({
  validateSearch: (s): { agent?: string; status?: string } => ({
    agent: s.agent as string | undefined,
    status: s.status as string | undefined,
  }),
});

function WorkspaceView() {
  const filters = Route.useSearch();
  useEffect(() => { refetchAgents(filters); }, [filters]);
  return <AgentList filters={filters} />;
}
```

## Virtualize + memoize streaming lists

```tsx
const Message = React.memo(function Message({ message }) {
  return <MarkdownContent text={message.content} />;
});

function Chat({ messages }) {
  return (
    <VirtuosoMessageList
      data={messages}
      itemContent={(_, m) => <Message message={m} />}
    />
  );
}
```

## Off critical path

User action → UI/network first → expensive sync work (checkpoints, heavy I/O) in background. Resume via persisted id if needed.

## Idle child processes

Track last activity → kill after idle threshold → persist `--resume` → respawn on return.
