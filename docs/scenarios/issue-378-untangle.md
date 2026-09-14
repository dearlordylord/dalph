# Issue 378: preserve executor diagnostics and stop tracker request storms

## Starting situation

Alice runs the production command against a GitHub issue. Dalph has allocated
one Run, acquired its task claim, prepared the exact worktree, and asked the
executor to begin one task turn. The executor reports that the turn is
executing. No tracker mutation is pending and no Run termination has been
recorded.

## Executor observation failure

When Dalph passively asks the executor for the current state, the app-server
transport or response may fail. Dalph records the generic durable
`ExecutorStateUnreadable` observation so the workflow cannot infer a safe
state, but it also writes the typed operation, failure kind, and safe detail to
the process log. The person can therefore identify the failed boundary without
turning private provider payloads into workflow authority.

If the same unreadable observation reaches Run activation again, Dalph does not
immediately create an unbounded sequence of tracker reads. The production
GitHub adapter opens a process-local request circuit after a bounded request
rate, rejects further requests during a short cooldown, and reports the typed
circuit-open reason. The next ordinary activation may observe the circuit
without contacting GitHub; it may contact GitHub again only after the cooldown.

## Executor initialization admission

Alice's production Run has selected the Codex executor. The host has spawned
one child app-server process, recorded its exact process identity, and is
building the scoped executor service; no JSON-RPC `initialize` request has been
sent yet. The host composition root has already created the independent
executor request-admission state for this process, while the child transport
and the app-server driver remain ordinary transport services.

When app-server layer construction tries to send `initialize`, the composition
boundary first calls the generic request boundary with operation
`initialize` and the JSON-RPC request effect. If that executor instance is in
its local cooldown, the boundary returns the typed
`CodexAppServerFailure(kind = CircuitOpen, operation = initialize)` before the
request effect runs. Layer acquisition fails closed, the child receives no
`initialize` message and no `initialized` notification is sent, and the
executor's normal typed diagnostics remain available to the caller. A
different provider or separately constructed executor instance has independent
admission state.

The forbidden result is a child transport send after local deferral, a generic
unreadable observation with the operation erased, or an app-server driver
import of the request-circuit implementation. Cleanup may still close the
owned child; `close` is not admitted through the request circuit. Qualification
app-server factories receive the same boundary as an optional second argument,
but a factory that ignores it and performs a raw construction-time request is
outside this host-owned boundary and must be treated as an explicit bypass.

## Output and graceful Exit

While the task is executing, the production CLI must keep status and history
publication bounded. A Ctrl-C request must produce the existing precise
`Succeeded`, `Failed`, or `TimedOut` Exit disposition. If a drain fails, the
process log retains the concrete drain diagnostic while the public NDJSON keeps
its redacted stable lifecycle code.

## Acceptance-test mapping

- `records the executor operation and failure detail while retaining the generic durable unreadable observation`
  proves the process log contains the typed failure boundary and the journal
  still contains the fail-closed observation.
- `opens the GitHub request circuit after the bounded window and closes it after cooldown`
  proves excess requests are rejected locally and a later request is allowed;
  the generic tests `rejects before running the wrapped outbound transport` and
  `admits a request after cooldown and starts a fresh window` exercise the
  reusable boundary, while `production GitHub wrapper rejects before its
  transport after the bounded window` exercises composition-root wiring.
- `maps a circuit-open GitHub read to a typed tracker adapter reason without an HTTP call`
  proves the tracker authority sees the breaker rather than a fabricated graph.
- `rejects initialize before the app-server transport runs when composition admission is open`
  proves the host-supplied request boundary rejects initialization before the
  JSON-RPC transport effect runs and retains the typed `initialize` operation.
- Existing production CLI and application Exit tests continue to prove public
  redaction and exact lifecycle dispositions.
