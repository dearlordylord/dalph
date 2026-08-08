# Govern verification with subject-scoped Quint models

Status: accepted

Dalph keeps one Quint model per subject-scoped decision boundary, each with its
own executable conformance adapter under
`packages/dalph/test/conformance/*.mbt.test.ts`. Six exist:

| Model | Owns | Issues |
|---|---|---|
| `specs/taskFactReconciliation.qnt` | subject-local decisions after tracker facts change while one exact planned attempt owns unfinished executor work: membership, lifecycle, specification, external success, and the missing, foreign, and unreadable claim cases | 136, 137 |
| `specs/gitReconciliation.qnt` | provider-neutral Git decisions: lineage, worktree loss, registration conflict, result-commit eligibility, and the stale and ambiguous target head | 139 |
| `specs/acceptedResultIntegration.qnt` | accepted-result admission and one fixed integration session accepting only an explicit submitted commit whose ordered direct parents are the current target head and the accepted result | 56, 57 |
| `specs/integrationFinality.qnt` | post-promotion completion-claim replacement and deletion, fresh tracker success, task-scoped settlement, and retention of unrelated Run responsibility | #141 (`integrationFinality`); executable seam: `packages/dalph/test/conformance/integration-finality.mbt.test.ts` invokes the production completion-claim protocols and Run finality decision |
| `specs/controlDirectionApplication.qnt` | receiving a Pause or Unpause as ephemeral against applying one exact run-or-task direction as a durable Operator-initiated action | 155, 166 |
| `specs/plannedAttemptExecutor.qnt` | the coarse same-process executor boundary: responsibility, running, suspension request, safe suspension, terminal, and the task-work position each holds | 158 |

## Why subject scope rather than composition scope

A model scoped to a decision boundary stays exhaustively checkable, and its
executable adapter drives the production functions that own that boundary
directly. A model scoped to composition — frontier, pause, capacity, crash
recovery, and every ambiguity-crossing boundary in one state space — cannot be
checked exhaustively at a useful size, and its adapter reaches production only
through a whole run.

The cost is that no model owns composition. Nothing checks the interaction
between capacity, pause, crash recovery, and graph change, and nothing binds
`runDeliveryRuntime` — the loop where those interactions are decided. That gap
is deliberate under this decision and is recorded as a TODO on that function.

## Adding a model

A seventh model is justified by a materially different subject boundary,
abstraction, checking profile, executable adapter, lifecycle, or implementation
consumer. Reaching for one because an existing model has grown is a signal to
narrow that model's subject instead.

A smaller proof-projection artifact may serve one exhaustive property when it
retains the same accepted scenario, maintainer, checking lifecycle, and
executable conformance seam. Such a projection is not another canonical model
and not another source of runtime behavior.

## Consequences

Every model exports a closed action and state projection. A test-only executable
adapter maps those actions to deterministic controls that invoke callable
production seams. A modeled behavior change updates the owning model, its
adapter, and the invariants in `../DELIVERY-INVARIANTS.md` that the model
projects, together. The adapter, projections, and controls remain test support;
they are not production package APIs, workflow stages, or states.

`pnpm check:quint` runs the exhaustive checks. It is not part of `pnpm check:ci`,
so a change to a model or to behavior a model governs must run it before
integration.

`../DELIVERY-INVARIANTS.md` is the specification these models project from, and
`research/verification-bakeoff/INVARIANTS.md` is a separate benchmark for
comparing verification tools rather than a source of Dalph behavior.
