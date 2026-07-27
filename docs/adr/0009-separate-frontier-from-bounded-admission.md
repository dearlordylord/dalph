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
task preparation. Each executor outer invocation declares whether it uses one
task-work capacity position. Generic orchestration applies that resource use
without knowing whether the selected executor is implementing, restoring,
reviewing, or handling artifacts internally. Capacity waits, reservations, and
frontier values are recomputed after restart and are never journal authority.

When the process-local controller's snapshot changes so future admission may be
possible—including after it records fresh provider evidence of non-consumption
or releases/cancels a reservation—the Dalph coordinator reads the current
reconstructed managed-run state and controller snapshot and derives the
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
