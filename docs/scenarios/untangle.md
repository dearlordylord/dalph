# Issue 378: preserve executor diagnostics and stop tracker request storms

## Full dogfood delivery gate

The [direct remote publication specification for acceptance](direct-remote-publication.md)
adds publication before local promotion and tracker completion. The normal
workflow records Git's exact push acknowledgement; dogfood independently checks
the hosted branch and retains that evidence alongside local Git and cleanup
evidence. The local-only chronology below
records the current contract; it does not prove that proposed remote delivery
requirement. Its extension is owned by the linked specification.

Alice runs the shipped production CLI against one fresh issue in the dedicated
disposable dogfood repository. Before the command starts, the issue is open and
eligible, the repository is at the declared Base SHA, no claim label or task
worktree exists, and no executor session or Run record exists for this task.

The command uses either the configured `executor:kimi/for-coding` profile or
`codex:production`; the selected provider is part of the acceptance evidence.
Dalph reads the issue, records the Run, creates the exact task worktree from
Base, claims the issue, starts that provider in the worktree, and sends the
authored one-sentence task. After the provider returns, Dalph checks the exact
worktree commit and accepted-result evidence, creates and validates the
Integrator candidate, updates the local integration ref, removes only proven
temporary resources, and closes the GitHub issue. The visible result is one
completed Run, one task commit integrated on the local ref, and a closed task.

This gate is a real end-to-end dogfood observation, not a controlled fixture or
ACP smoke probe. A provider/session handshake without a task claim, worktree
commit, integration, and task closure does not satisfy it. No crash or retry is
part of the successful gate; if one occurs, the run is retained for the
existing reconciliation protocol and the gate remains unproven.

### Acceptance-test mapping

- `dearlordylord/dalph-dogfood-2026-09#<fresh issue>` records the exact open
  starting issue and task text.
- The captured production NDJSON and SQLite/GitHub/Git evidence must show, in
  order: `RunSelected`, claim, task worktree, selected executor, accepted task
  commit, Integrator candidate/integration, cleanup, and issue closure.
- The same gate accepts either Kimi or Codex, but the selected executor and
  model/profile must be named in the evidence; a smoke prompt alone is not
  acceptance.

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

## Executor child runs in Dalph's unattended production mode

When Alice runs the production command, Dalph starts the configured Codex
executable as a child app-server. Dalph supplies Codex's supported
`--dangerously-bypass-approvals-and-sandbox` global option before the
`app-server` subcommand. The child therefore does not stop for an approval
request when it needs to inspect or edit the exact task worktree, and it does
not try to create the container's unavailable bwrap namespace for each shell
command.

The child command and its exact process identity are recorded before the
transport handshake. If the child exits or the process identity changes,
Dalph reports the typed app-server failure and preserves the recoverable Run;
it does not silently fall back to an approval prompt or launch a second child.
The forbidden result is an unattended production Run waiting forever for an
unanswerable `item/commandExecution/requestApproval` request.

## Output and graceful Exit

While the task is executing, the production CLI must keep status and history
publication bounded. A Ctrl-C request must produce the existing precise
`Succeeded`, `Failed`, or `TimedOut` Exit disposition. If a drain fails, the
process log retains the concrete drain diagnostic while the public NDJSON keeps
its redacted stable lifecycle code.

## Acceptance-test mapping

- `logs the concrete executor boundary when projection becomes unreadable`
  proves the process log contains the typed failure boundary and the journal
  still contains the fail-closed observation.
- `opens the GitHub request circuit after the bounded window and closes it after cooldown`
  proves excess requests are rejected locally and a later request is allowed;
  the generic tests `rejects before running the wrapped outbound transport` and
  `admits a request after cooldown and starts a fresh window` exercise the
  reusable boundary, while `production GitHub wrapper rejects before its
  transport after the bounded window` exercises composition-root wiring.
- `preserves a locally opened provider circuit as a distinct read failure`
  proves the tracker authority sees the breaker rather than a fabricated graph.
- `rejects initialize before the app-server transport runs when composition admission is open`
  proves the host-supplied request boundary rejects initialization before the
  JSON-RPC transport effect runs and retains the typed `initialize` operation.
- `rate-limits a rapid passive status source before it reaches stdout` proves
  that a hot current-status source cannot emit every intermediate value to the
  production CLI; the first value remains immediate, later values are limited
  to a one-second publication window, and the terminal synchronized status
  remains visible.
- `launches the Codex child with unattended production flags` proves the child
  receives the YOLO flag before `app-server` and that the durable launch
  command records the same arguments.
- Existing production CLI and application Exit tests continue to prove public
  redaction and exact lifecycle dispositions.
