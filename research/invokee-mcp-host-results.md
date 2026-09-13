# MCP calls into the actual production host

Status: researched and independently validated, 2026-09-13. This changes no
Dalph production code, supported command surface, or deployment arrangement.

Alice's orchestrator uses a normal MCP client to launch a disposable stdio
bridge. A separately owned production host is already delivering one task, held
at the controlled executor response. The bridge forwards state and capacity
requests to a disposable local HTTP adapter over that same host.

The current `ProductionHostObservation` deliberately exposes observations and
Exit, not capacity commands. The production graph composition retains the
`JournaledRunBootstrap` service; this experiment will capture that same service
from the graph's existing composition seam, without constructing another
bootstrap or adding a production export. Failure to obtain that service is an
experimental limitation, not permission to implement a command API.

Chronology to validate:

1. Build unchanged host with real Git/SQLite/delivery adapters and controlled
   GitHub/Codex edges; hold executor result. Capture existing bootstrap.
2. Initialize actual MCP stdio child, list tools, read current graph and capacity
   through it. Require matching Run and one task.
3. Send exact revision-aware capacity change through MCP; hold backend handling
   before service invocation. Close MCP child and await process exit.
4. Release host-owned command; require actual capacity revision acceptance in
   the host's journal. A fresh MCP child must read the same Run, graph and new
   capacity; replay must return revision conflict with no additional change.
5. Close the replacement MCP child and release executor. Require durable actual
   delivery completion, one Run beginning, one coordinator and zero Exit calls.
6. Join host, close adapter, await all client children and remove exact fixture.

The adapter deliberately owns accepted command effects in its scope; it does
not infer this guarantee from MCP cancellation. This probes composition, not
host-crash recovery or a selected request-admission protocol. Graph observation
here is an MCP tool snapshot; streaming and dynamic topology have separate
experiments. The MCP client itself runs in the Vitest harness; its stdio server
children are distinct OS processes from the production host in that harness.

## Observed result

The first complete focused execution passed in 10.19 seconds (4.75 seconds in
the test). After making absence of the retained bootstrap an explicit failure,
an independent agent run passed in 22.76 seconds (6.00 seconds in the test),
with no blocking review findings. The actual production graph retained its original bootstrap, so no
replacement runtime or journal service was needed. The client saw one task and
capacity revision 1. After the first MCP child's verified exit, gate release
applied capacity 2 at revision 2. The replacement MCP child read the same Run
and revision; exact replay returned `TaskWorkCapacityPolicyRevisionConflict`.
The SQLite journal contained exactly one capacity-change record and one
`WorkflowRunBegan`. Actual workflow delivery reached `Completed`, with target
promotion and confirmed tracker completion present. One coordinator acquisition
and zero application Exit requests were observed. Both MCP child exits were
verified before releasing the executor to finish delivery.

The first attempted run failed before collecting tests because the fixture's
branded source SHA requires a full commit hash. Correcting that harness input
allowed execution; it was not a Dalph behavior failure or a passing test.

## Source boundaries

- [Production host](../packages/dalph/src/application/production-host.ts):
  `ProductionHostObservation` is an observation-only callback apart from Exit;
  `productionRepositoryHostGraph` composes the workflow with `provideMerge`,
  retaining its existing services; `withDecodedProductionRepositoryHost` builds
  one foundation and Run graph. The probe captures the retained bootstrap from
  that construction, not from a supported remote command export.
- [Bootstrap control](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts):
  `operatorControl.readTaskWorkCapacity` and `setTaskWorkCapacity` use the real
  active runtime control lease. The held executor keeps this runtime active
  during the command; inactive-Run capacity behavior is outside this case.
- [Capacity protocol](../packages/orchestrator/src/control/task-work-capacity.ts):
  expected revision and accepted-policy reconstruction govern retry.
- [Previous MCP process probe](./invokee-mcp-process-results.md): installed SDK
  1.29.0 initialization/stdio shutdown and verified child cleanup are reused.

## Reproduction and acceptance mapping

```sh
pnpm exec vitest run --config research/prototypes/invokee-mcp-host/vitest.config.ts --reporter verbose
```

The test `MCP child exits while the actual host accepts capacity and completes
delivery` covers steps 1–6 above. It asserts Run identity, initial and updated
capacity, request rejection after child death, live host before gate release,
revision conflict, one capacity-change record, one Run beginning, one
coordinator acquisition, zero Exit requests, durable promotion/tracker
confirmation, completed Run and verified child exits.

The fixture's real Git operations and SQLite storage are disposable. GitHub
requests and Codex provider results are controlled, with the unchanged executor
and integrator adapters interpreting them. This is neither a live provider run
nor the public CLI binary nor a production MCP feature. The MCP client imports
the already-installed sibling SDK; no package or lockfile is changed.

The command belongs to the enclosing disposable adapter/test scope, which stays
open alongside the production host. It is independent of the MCP request and
child process; this is not proof that the current production host already owns
remote command fibers. The separate complete-command recovery probe checks the
bootstrap callback boundary with the real owner.
