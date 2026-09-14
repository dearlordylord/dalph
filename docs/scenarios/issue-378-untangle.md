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
  proves excess requests are rejected locally and a later request is allowed.
- `maps a circuit-open GitHub read to a typed tracker adapter reason without an HTTP call`
  proves the tracker authority sees the breaker rather than a fabricated graph.
- Existing production CLI and application Exit tests continue to prove public
  redaction and exact lifecycle dispositions.
