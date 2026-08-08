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

One process-local capacity controller stores at most one position for each
task. Dalph decides whether a workflow transition needs zero or one task-work
position; the executor does not request, acquire, declare, or release it.
Generic orchestration applies that requirement to the executor's complete work
for one planned task attempt, identified by its `RunId` and `AttemptId`.

After admission, task A keeps its position until the executor returns a
terminal result for that complete planned attempt or proves the complete
attempt safely suspended after Dalph asked it to stop for later resume.
Executor-internal operations, waits, process observations, or identities
cannot release or multiply the position. A completed executor attempt does not
prove the task tracker marks task A completed.

Journal reconstruction must reject two unfinished planned-attempt executor
responsibilities for one task before frontier derivation. Capacity positions
and frontier values are recomputed after restart and are never journal
authority.

When the process-local controller's snapshot changes so future admission may be
possible—including after a complete planned attempt becomes terminal, becomes
safely suspended, or a pre-start reservation is cancelled—the Dalph
coordinator reads the current
reconstructed run state and controller snapshot and derives the
frontier and admission set again. It performs a workflow-selected external
boundary read only when the decision's required knowledge is unavailable; this
controller change alone does not require complete restart reconstruction. A
dormant `awaitAdmission` fiber does not own the next position. The controller
retains no second ready-work order and cannot replace the frontier's
responsibility-first choice with task- or operation-identity ordering. Fresh
facts may change the newly derived choice; exact recreation of the lost
pre-crash frontier is not required.

The controller returns an atomic admission decision and exact reserved task
admission positions; it does not expose a dormant `awaitAdmission` operation.
One scoped activation coordinator receives order-free triggers, derives again,
and atomically registers one activation owner while starting an
owned-operation runner for the exact first admitted transition. The coordinator
derives again after the handoff without waiting for that runner's final result;
several runners may overlap within capacity N and other resource bounds.
Before asking the controller to apply capacity, the activation coordinator
excludes exact transitions already represented by live activation ownership
and preserves the selector's order for the remainder. The controller receives
only that filtered frontier.
Reservation, ownership registration, and scoped-runner start form one
interruption-masked handoff. An unsuccessful handoff makes its exact newly
reserved position available before returning or dying.
Trigger callers cannot submit transitions or obtain the owned capability, so
the public API cannot represent duplicate ownership. This keeps capacity
accounting in the controller, workflow order in the selector, and execution
uniqueness in the activation coordinator.

Tracker read and mutation results update durable graph knowledge rather than
enqueueing downstream tasks. The default read assembles the complete bounded
task-tracker target closure; a narrower read is legal only when its declared
coverage proves every fact needed by the affected transition. Missing evidence
never proves that a blocker is absent.

A retryable failure while creating a GitHub task claim record retries the exact
recorded request and retains its admission position. Exhausted shared-boundary
failure stops fresh admission, while a confirmed conflict for only one task
leaves that task alone and permits unrelated work to continue.
