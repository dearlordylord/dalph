# Separate the runnable frontier from bounded task admission

Status: Accepted

Dalph derives every currently allowed workflow transition before applying
task-work capacity, then deterministically chooses a bounded admission set.
Observing a task or placing its transition in the runnable frontier creates no
workflow responsibility; recording the exact first operation intent commits a
fresh choice. This separation prevents tracker observation, scheduler choice,
capacity, and responsibility from collapsing into one state.

## Consequences

Existing ready responsibility is admitted before fresh work and is ordered by
the earliest journal position that began a still-outstanding responsibility
needed by the ready transition, with normalized task identity as the final
tie-breaker. Fresh tasks use normalized task identity as their stable order.
External response and completion timing may change the state seen by a later
decision, but the admission set is deterministic for one exact derived state.

One process-local capacity controller reserves positions for freshly committed
task preparation and occupies positions for implementation, review, handback,
and resumed task-work invocations. Capacity waits, reservations, and frontier
values are recomputed after restart and are never journal authority.

Tracker read and mutation results update durable graph knowledge rather than
enqueueing downstream tasks. The default read assembles the complete bounded
task-tracker target closure; a narrower read is legal only when its declared
coverage proves every fact needed by the affected transition. Missing evidence
never proves that a blocker is absent.

A retryable failure while creating a GitHub task claim record retries the exact
recorded request and retains its admission position. Exhausted shared-boundary
failure stops fresh admission, while a confirmed conflict for only one task
leaves that task alone and permits unrelated work to continue.
