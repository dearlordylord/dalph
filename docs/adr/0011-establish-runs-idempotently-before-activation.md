# Establish Runs idempotently before one bounded activation

Status: Accepted in the maintainer conversation on 2026-08-09

Dalph exposes one application entry for an exact Run instead of asking a caller
to choose fresh initialization or restoration. That entry establishes the Run
idempotently from Journal facts—append the beginning when history is absent,
otherwise validate complete history and reconstruct the exact target and latest
policy—and then feeds the established state to one bounded activation. A
brand-new Run identity may still be allocated by a separate creation step.

## Decision

Run establishment reads the Journal while Dalph holds coordinator ownership.
If the exact Run has no history, establishment evaluates a lazy initial-policy
source and atomically appends one `WorkflowRunBegan` containing the exact Run,
target, and decoded policy. If history exists, establishment does not evaluate
or accept replacement initial values. It decodes and reduces the complete
history, checks the exact Run and target, and reconstructs the latest durable
policy and every exact responsibility needed by admission.

The Journal continues to reject a direct second beginning. Application-level
idempotence comes from rereading an ambiguous append and taking the existing
valid beginning path, not from making duplicate records legal. Invalid,
mismatched, or terminated history fails before activation. Discovery of more
than one unfinished Run fails closed naming all of them rather than selecting
one by recency, position, or a caller's label.

Every successful establishment constructs the same activation interface.
Whether establishment just appended the beginning or reconstructed older
history does not change delivery, admission, executor reconciliation,
stabilization, or finality. One invocation owns one bounded activation,
reconstructs held task-work positions from exact unfinished responsibilities
before new admission, performs the ordinary reconcile-before-retry protocols,
and receives at most one post-quiescence tracker reconfirmation.

## Rejected alternatives

- Keep separate `fresh` and `recovered` application entries: rejected because
  the caller's chosen label duplicates a fact the Journal already owns and
  permits the same valid history to receive different runtime behavior.
- Make `beginRun` silently accept a duplicate record: rejected because lower
  storage and lifecycle boundaries must still expose double-admission defects
  and contradictory beginning payloads.
- Always evaluate a supplied initial policy and compare it with history:
  rejected because an existing Run's policy is durable history, not current
  process configuration, and evaluating an unused source can itself fail or
  perform unrelated work.
- Allocate every Run identity inside establishment: not required. Creation may
  allocate a fresh identity separately as long as allocation is not confused
  with a durable beginning and retries submit the exact retained identity to
  the idempotent entry.

## Consequences

The application boundary and its tests must stop exposing caller-selected
restoration startup. Run establishment, Run activation, initial-policy
evaluation, complete-history reduction, startup discovery, admission
reconstruction, and finality must change together. The accepted chronology is
[`run-establishment-and-activation.md`](../scenarios/run-establishment-and-activation.md).

The future Run-establishment model must distinguish absent, exact unfinished,
mismatched or invalid, multiple unfinished, and terminated histories. It must
compose with the existing planned-attempt executor model for ambiguous executor
outcomes rather than inventing a second recovery protocol.
