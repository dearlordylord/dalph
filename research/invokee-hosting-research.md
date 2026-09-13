# Invokee hosting boundary research

Status: source-grounded recommendation for a throwaway attachment prototype.
This note changes no Dalph runtime behavior and does not select a production
wire protocol.

## Finding

The smallest viable owner is the existing production repository host. Alice
starts that host separately for one repository and root task. The host acquires
the repository coordinator lock, selects or establishes one Run, builds its
delivery runtime, and keeps the resulting Effect scope alive. CLI and per-agent
MCP processes attach as clients; ending one client does not return from the host
callback and does not request application Exit.

This is a narrow refactoring of an existing composition rather than a second
scheduler. `withDecodedProductionRepositoryHost` already builds the foundation
and Run layers, waits for the Run beginning, and gives its callback a scoped
observation. Returning from that callback finalizes the Run and foundation and
releases coordinator ownership
([production-host.ts](../packages/dalph/src/application/production-host.ts#L556)).
The shipped CLI currently owns that callback, installs SIGINT/SIGTERM as
application Exit requests, and presents the Run until that invocation ends
([live-cli.ts](../packages/dalph/src/application/live-cli.ts#L111)). That
lifetime coupling is the concrete attachment gap.

The required capabilities already coexist inside the built Run context:

- `JournaledRunObservationSource` supplies current-first runtime observation,
  accepted Journal position, and terminal result
  ([journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L1150)).
- `JournaledRunBootstrap.operatorControl` already exposes Pause/Unpause and
  revision-aware capacity read/set operations
  ([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L188)).
- `RunReactivationOwner.hint` already accepts ephemeral wake and tracker-refresh
  hints ([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L77)).

The production host currently extracts only the observation source from that
context and exposes status/history/termination plus application Exit
([production-host.ts](../packages/dalph/src/application/production-host.ts#L74)).
Therefore the first application seam can be assembled from the already-built
context. It must not build another Run layer per client.

## Recommended shape

Create one transport-neutral application-operations value inside the host
scope, then inject that same value into every transport adapter. The prototype
needs only these behaviors:

| Operation | Existing basis | Prototype behavior |
| --- | --- | --- |
| Inspect Run | `current`, `acceptedHistory`, `runTermination` | Return one coherent Run identity, accepted position, task graph/frontier projection, and optional opaque executor association. Do not expose the raw runtime evaluation as the public contract. |
| Watch Run | current-first `CurrentSignal` | Attach to the same source and stream later projections. Closing a watch closes only that subscription. |
| Read capacity | `operatorControl.readTaskWorkCapacity` | Return capacity and `RunPolicyRevision`. |
| Set capacity | `operatorControl.setTaskWorkCapacity` | Require the caller's `expectedRevision`; return the new complete policy or the typed current-policy conflict. |
| Wake | `RunReactivationOwner.hint(OperatorWake)` | Ask an already-unpaused Run to enter its ordinary activation. Do not clear a durable Pause. |
| Unpause | `operatorControl.applyControlDirection` | Durably apply explicit Run Unpause. The accepted-control observer already starts the timer and queues one ordinary activation. |
| Refresh | `RunReactivationOwner.hint(TrackerNotification)` | Accept whole-graph or task-ID advisory scope and initially perform a sufficient full-root active tracker refresh. The request carries no graph facts. |
| Exit host | existing application Exit request boundary | Remain an explicit host-management operation. Transport disconnect never invokes it. |

The current runtime observation contains a coherent `trackerGraph` and proposed
frontier in one `DeliveryRuntimeEvaluation`
([relations.ts](../packages/orchestrator/src/coordination/delivery/relations.ts#L583)).
Existing delivery status is already a passive projection: its signal attaches
to the runtime source and maps values without gaining an authority or mutation
service ([delivery-status.ts](../packages/orchestrator/src/coordination/delivery/delivery-status.ts#L115)).
A first graph/frontier projection should follow that pattern. Reusing the raw
internal value as a wire schema would expose admission witnesses, proposal
internals, and future refactoring details that the accepted task-level view does
not need.

### Wake and Unpause are different requests

An agent asking Dalph to look for work must not silently override Alice's
durable Pause. For the prototype, expose the distinction directly:

- If the Run is unpaused, `wake` sends `OperatorWake`. It asks the ordinary Run
  entry to reconsider current accepted facts.
- If the Run is paused, `wake` reports that no activation was admitted. Alice
  or her instructed agent must explicitly apply `Unpause`.
- Accepted `Unpause` already starts the timer and queues exactly one ordinary
  activation ([run-reactivation-owner.ts](../packages/orchestrator/src/coordination/run/run-reactivation-owner.ts#L318)).

The existing `hint` method returns `void` and drops hints when the owner is
paused or stopped. A production-facing operation therefore needs a typed
response such as accepted, paused, or closed. The prototype may wrap an
instrumented owner to establish this desired behavior; it must not claim the
current method already proves the response.

Tracker refresh is also suppressed while paused, by the same owner gate. The
prototype should report that condition rather than claim a fresh graph. The
current tracker hint is payload-free. The application operation may accept a
whole-graph request or task IDs while initially satisfying both with a
sufficient full-root reread; the IDs remain an advisory scope, never supplied
graph facts. The first prototype can exercise only whole-root refresh, provided
it records this narrower experiment rather than removing the accepted targeted
notification capability from the plan.

### Capacity response loss

Capacity already uses compare-and-set semantics. A request includes `runId`,
`capacity`, and `expectedRevision`; stale requests fail with the complete
current policy, and no second change is appended
([task-work-capacity.ts](../packages/orchestrator/src/control/task-work-capacity.ts#L23),
[task-work-capacity.test.ts](../packages/orchestrator/src/control/task-work-capacity.test.ts#L172)).

When the response is lost, a client may resend the exact same request. If the
first call committed, the repeated request returns a revision conflict and the
current policy. Observing the requested capacity establishes that the desired
state is current. It does **not** prove that this caller's first request won: a
competing caller could have written the same value. The adapter must return
that evidence without fabricating an idempotent receipt. It must also never
increment `expectedRevision` and retry automatically, because that would make a
new capacity decision after an unseen competing write. Existing tests also
prove that a competing writer at the requested revision is reread and returned
as the conflict's current policy
([task-work-capacity.test.ts](../packages/orchestrator/src/control/task-work-capacity.test.ts#L206)).

Exact request provenance would require a separately designed durable request
identity/result. It is unnecessary for a prototype whose acceptance condition
is safe state convergence, but the limitation must remain visible.

### Client cancellation after command admission

A client connection and an accepted mutation cannot share one cancellation
scope. After the host admits a capacity/control request, losing the socket may
cancel only that client's wait for the response. It must not interrupt the
shared Run or silently abandon the admitted Journal append. A production
adapter can hand the decoded command to a host-scoped command runner and await
its result through a one-request completion value; disconnect detaches that
wait while the host-owned command reaches its ordinary result or recoverable
ambiguity boundary. Reads and watches remain client-scoped.

The prototype's dropped-response lane must model this ordering explicitly:
admit the command, finish the state transition, then destroy the response
connection. It proves survival of client disconnection only. Killing the host
mid-command is a different crash/reconstruction scenario governed by Dalph's
existing intent, observation, and reconcile-before-retry rules, and is outside
this attachment experiment.

## Transport comparison

| Candidate | What it proves | Cost or limitation |
| --- | --- | --- |
| In-process adapter only | Shared operations and client-independent scopes | Does not prove that separately launched CLI/MCP processes can attach. Useful as the first deterministic test layer, insufficient as the whole prototype. |
| Loopback HTTP | Real multi-process attachment, request/response controls, and a streaming or long-poll watch using Node's existing platform support | Needs an address, error schema, connection shutdown rules, and an explicit decision about which local processes may connect. Any later exposure beyond loopback requires a separate access design. |
| Unix-domain socket with framed JSON | Local-only addressing and filesystem permissions without a TCP port | Creates a custom framing/protocol implementation and a platform-specific locator. It does not directly provide MCP transport. |
| MCP HTTP hosted beside the Run | Agents with remote-MCP support could attach directly | Couples the application owner experiment to MCP lifecycle and SDK choices; CLI either proxies through MCP or needs a second adapter. Each agent's ordinary stdio MCP process still needs to connect rather than own the Run. |
| Journal/filesystem command inbox | Survives processes and looks superficially simple | Makes commands, derived state, polling, claim/retry rules, and cleanup into a new persisted coordination system. It conflicts with the Journal's workflow-history authority and should not be prototyped. |

Use loopback HTTP for the process-boundary experiment, with an ephemeral port
reported by the test harness. Keep HTTP below the shared application operations.
A per-agent stdio MCP adapter and the CLI can then be thin clients of the same
host API. For production, a Unix socket may later replace loopback TCP if local
access and endpoint discovery outweigh portability; the application contract
does not need to change.

This recommendation does not include daemonization or automatic startup. The
accepted first version requires Dalph to be started separately. The prototype
can pass its address explicitly; stable endpoint discovery, supervisor units,
credentials, and background startup remain later operational design.

## Precedent limits

Hulymcp demonstrates the useful adapter split: its CLI invokes shared operation
registry entries directly and does not proxy through MCP
(`/workspace/typescript/hulymcp/docs/cli-parity-contract.md` and
`/workspace/typescript/hulymcp/packages/huly-cli/src/runner.ts`). This supports one Dalph
operations contract with CLI and MCP projections, but Hulymcp's shared code does
not itself share an in-memory scheduler between processes.

Dnd demonstrates that MCP can be an independently hosted application: its
public HTTP and local stdio entries compose the same MCP tool/application
catalog while the public Node container owns server lifetime
(`/workspace/typescript/dnd/docs/adr/0008-public-mcp-runs-in-a-provider-neutral-node-container.md`).
Its default stdio and public HTTP processes do not automatically share one live
session owner. For Dalph, “standalone MCP,” “shared CLI/MCP operations,” and “one
Run survives client exit” remain three separate properties.

## Concrete prototype

Use controlled tracker, executor, Git, and Journal boundaries. The prototype
should exercise this chronology through one independently scoped host and two
separately scoped clients:

1. Start one host for Run R at capacity one. Its controlled executor starts A;
   B remains eligible and waiting for capacity.
2. Client 1 and client 2 attach and receive the same R, accepted position, graph,
   frontier, and capacity revision. A second coordinator/Run is never built.
3. Client 1 opens a watch. Client 2 uses the returned revision to set capacity
   two. B starts through the existing accepted-fact publication/reactivation
   path, and both clients observe the new state.
4. Close client 1, including its watch, without invoking Exit. Advance the
   controlled executor. Client 2 observes progress and the host still owns the
   coordinator.
5. Disconnect client 2. Attach client 3 and observe the current-first state for
   the same R without the prior clients' memory.
6. Apply Pause, prove `wake` does not start work, then apply Unpause and prove
   exactly one ordinary activation occurs.
7. Send whole-root refresh and prove the host performs an authority read while
   the request payload supplies no graph facts.
8. Simulate a lost capacity response. Repeat the exact stale request and prove
   conflict/current evidence is returned without another append. As a negative
   control, let another writer set a different value and prove the adapter does
   not retry with a newer revision.
9. Explicitly request host Exit. Only this final request closes the host and
   releases its scope.

The in-process version should first establish lifetime and operation semantics.
Then place the same operations behind a throwaway loopback HTTP adapter and run
steps 2–5 with distinct client connections. That second layer is what answers
the independent attachment question.

## Remaining design gaps after the prototype

- A stable public task-graph/frontier schema and whether real-time delivery uses
  streaming, long polling, or repeated snapshots.
- Typed wake/refresh admission results; the current ephemeral owner accepts no
  request identity and returns no disposition.
- Targeted refresh optimization and result detail. Current production's hint is
  payload-free; a sufficient full-root reread can initially serve an ID-scoped
  request without treating those IDs as tracker facts.
- Endpoint discovery, access control, and host supervision. These are not needed
  to test a separately started host on loopback.
- Exact redelivery provenance for mutations beyond capacity state convergence.
- Operator attribution for agent-issued instructions. Current durable events
  record the logical actor class `Operator`; the first prototype should preserve
  that behavior without introducing authentication identities.
