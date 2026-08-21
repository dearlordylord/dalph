# Govern verification with subject-scoped Quint models

Status: accepted

Dalph keeps one Quint model per subject-scoped decision boundary, each with its
own executable conformance adapter under
`packages/dalph/test/conformance/*.mbt.test.ts`. Eight exist:

| Model | Owns | Issues |
|---|---|---|
| `specs/taskFactReconciliation.qnt` | subject-local decisions after tracker facts change while one exact planned attempt owns unfinished executor work: membership, lifecycle, specification, external success, Continue/Restart/Stop choice identity and cutoff, fresh Continue authority for the immutable attempt, clean replacement from exact Restart plus current quiescence and fresh task/Git facts, and exact/absent/foreign/unreadable stopped-claim disposition. Executable seam: `packages/dalph/test/conformance/task-fact-reconciliation.mbt.test.ts` invokes `AttemptChoiceControl`, recovery/frontier reads, executor continuation/stoppage, clean replacement, and stopped-claim observation/release protocols. | 65, 66, 136, 137 |
| `specs/gitReconciliation.qnt` | provider-neutral Git decisions: lineage, worktree loss, registration conflict, result-commit eligibility, and the stale and ambiguous target head | 139 |
| `specs/acceptedResultIntegration.qnt` | accepted-result admission and one fixed integration session accepting only an explicit submitted commit whose ordered direct parents are the current target head and the accepted result | 56, 57 |
| `specs/integrationFinality.qnt` | post-promotion completion-claim replacement and deletion, focused task-completion success, task-scoped settlement, and retention of unrelated Run responsibility | #141 (`integrationFinality`); executable seam: `packages/dalph/test/conformance/integration-finality.mbt.test.ts` invokes the production completion-claim protocols and Run finality decision |
| `specs/controlDirectionApplication.qnt` | receiving a Pause or Unpause as ephemeral against applying one exact run-or-task direction as a durable Operator-initiated action | 155, 166 |
| `specs/plannedAttemptExecutor.qnt` | the same-process executor boundary: responsibility, durable command intent, exact response versus command/state projection evidence, correlation and ordinal settlement, bounded continuation and Stop suspension commands, recovery reconciliation, and task-work position ownership. Executable seam: `packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts` invokes the production executor protocol and admission controller. | 65, 158 |
| `specs/runActivation.qnt` | one idempotent Run-entry boundary: exact target and Run identity, lazy first policy versus the latest durable policy, reduction of exactly one unfinished history, independent reconstruction of every retained task-work position before new admission, and identical quiescence/finality handling after a new or reconstructed beginning. Process loss clears only process-local activation state; the same ordinary entry establishes the Run again from durable history. Executable seam: `packages/dalph/test/conformance/run-activation.mbt.test.ts` invokes production lifecycle, startup inspection, history reduction, recovery projection, the ordinary delivery relation's admission basis, admission, planned-attempt ambiguity reconciliation, and finality seams. | 195 |
| `specs/applicationExit.qnt` | one process-local graceful application Exit decision boundary: cutoff-linearized admission, joined requests, typed owner disposition, exact executor evidence, enumerated quick drain actions, five monotonic ticks, distinct success/failure/timeout/unexpected-death outcomes, forced termination, no Run-journal Exit facts, and fresh restart state. Executable seam: `packages/dalph/test/conformance/application-exit.mbt.test.ts` invokes the production lifecycle-decision kernel without becoming a second runtime. | 203 |

One additional model is accepted by issue #102 but does not exist until that
issue's Phase 2 implementation:

| Planned model | Owns | Issue |
|---|---|---|
| `specs/runCancellation.qnt` | one durable Run cancellation direction, forward-admission cutoff, settlement or durable relinquishment of exact executor, claim, integration, reconciliation, and cleanup responsibilities, crash recovery, and handoff to fresh Run classification. Its executable seam will be `packages/dalph/test/conformance/run-cancellation.mbt.test.ts`. It does not own final disposition classification or application Exit. | 102 |

`specs/runActivation.qnt` continues to own fresh final classification, terminal
history, and restart behavior. Issue #102 extends that existing ownership from
`Completed` alone to `Completed`, `Blocked`, and `Cancelled`.

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

An additional model is justified by a materially different subject boundary,
abstraction, checking profile, executable adapter, lifecycle, or implementation
consumer. Reaching for one because an existing model has grown is a signal to
narrow that model's subject instead.

A smaller proof-projection artifact may serve one exhaustive property when it
retains the same accepted scenario, maintainer, checking lifecycle, and
executable conformance seam. Such a projection is not another canonical model
and not another source of runtime behavior.

`specs/taskFactReconciliation_proof.qnt` applies that exception to the issue
#65 slice of `taskFactReconciliation`: it collapses unrelated #136/#137 facts
into three finite choice, Stop, and stopped-claim graphs. It is maintained in
the same gate and retains
`packages/dalph/test/conformance/task-fact-reconciliation.mbt.test.ts` as its
production seam; it is not an eighth model or an implementation input.

`specs/plannedAttemptExecutor_proof.qnt` applies the same exception to the
canonical executor model's resettable command cycles. Three finite graphs keep
the exact intent/call/evidence chronology, one-read-per-activation recovery,
three-command Start and Suspend bounds, and post-limit read-only recovery. The
canonical model still owns their shared vocabulary and
`packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts` remains
the production seam. The projections have collected positive and negative
tests, sampled witnesses, and complete TLC enumeration without a depth token.

`specs/applicationExit_proof.qnt` applies the exception to the canonical Exit
model's two-owner, two-attempt, five-tick, result, death, and restart product.
Four acyclic graphs retain its admission, owner-intent, executor-evidence, and
lifecycle-result decisions. The canonical model remains the only executable
behavior source and
`packages/dalph/test/conformance/application-exit.mbt.test.ts` remains the
production seam. Each projection has collected positive and negative tests,
sampled witnesses, and complete TLC enumeration without a depth token.

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
