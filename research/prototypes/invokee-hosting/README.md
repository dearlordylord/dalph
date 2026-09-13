# Throwaway independent-host experiment

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dalph/orchestrator... build
node research/prototypes/invokee-hosting/run.mjs
```

For this prepared worktree, only the last command is needed. It starts a scratch
host and separate clients, prints JSON evidence, and closes its child processes.
Host startup has a 60-second allowance for loading the built Dalph modules.
No provider credentials or live GitHub, Git, or agent operations are used.

The host uses HTTP over a disposable Unix socket. Its capacity operations call
Dalph's real `TaskWorkCapacityControl` through a host-owned Effect runtime and
in-memory journal. Its task graph, work progression and status shape are
synthetic. This is not a production host, MCP server, or shipped CLI.

The checks cover shared observation, a lost capacity response and exact replay,
competing revision-aware writes, client termination and reconnection, and a
faulty client-owned host used as a negative control. `source-seams.mjs` also
checks the exported capacity and NotReady status primitives directly.

- [Operational scenarios and check mapping](../../../docs/scenarios/prototype-invokee-hosting.md)
- [Research recommendation](../../invokee-hosting-research.md)
- [Executed evidence and limitations](../../invokee-hosting-results.md)

Keep this code on the research branch. Its purpose is to identify the next
production application boundary; it is not an implementation to merge as-is.
