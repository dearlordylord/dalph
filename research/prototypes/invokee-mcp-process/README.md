# Disposable MCP process-boundary probe

Status: passed on 2026-09-13. No Dalph production API or deployment is implemented.

A real MCP SDK client launches a stdio server child. That child forwards capacity
calls to an independently launched capacity-only backend using the existing
Dalph capacity service and live in-memory journal. There is no synthetic task
progress or real Dalph production host in this probe.

The experiment distinguishes three cuts:

1. Cancel MCP before the bridge sends anything to the backend: no policy change.
2. Close the MCP child after backend receipt but before its controlled apply gate
   is released: backend stays alive; releasing the gate applies the command;
   a fresh MCP child sees the new policy.
3. Cancel after backend success but before MCP response delivery: a fresh read
   sees the policy; exact revision replay conflicts without another record.

All cuts have explicit observed markers before cancellation. The backend gate
is outside the actual journal append, not a simulated SQLite commit midpoint.
Actual write-interruption behavior is a separate source/SQLite experiment.
No per-request durable identity or production admission contract is introduced.

```sh
node research/prototypes/invokee-mcp-process/run.mjs
```

Requires the existing built Dalph contract/orchestrator packages and installed
sibling MCP SDK. An alternate SDK package directory may be supplied as argument.
No installation or manifest changes are made.

Observed counts: revision/records 1/1 after pre-forwarding cancellation, 2/2 after
MCP child exit and backend gate release, 3/3 after post-acknowledgement
cancellation. Exact replay returned a revision conflict without a fourth record.
Three MCP child exits were verified. See
[full findings and limits](../../invokee-mcp-process-results.md).
