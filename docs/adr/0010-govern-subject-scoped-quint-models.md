# Govern verification with subject-scoped Quint models

Status: accepted

Dalph keeps one Quint model per subject-scoped decision boundary, each with its
own executable conformance adapter under
`packages/dalph/test/conformance/*.mbt.test.ts`. Eight exist:

| Model | Owns | Issues |
|---|---|---|
| `specs/taskFactReconciliation.qnt` | subject-local decisions after tracker facts change while one exact planned attempt owns unfinished executor work: membership, lifecycle, specification, external success, Continue/Restart/Stop choice identity and cutoff, fresh Continue authority for the immutable attempt, clean replacement from exact Restart plus the latest accepted Safe report with no later command intent and fresh task/Git facts, absorbing Terminal, and exact/absent/foreign/unreadable stopped-claim disposition. Executable seam: `packages/dalph/test/conformance/task-fact-reconciliation.mbt.test.ts` invokes `AttemptChoiceControl`, recovery/frontier reads, the Resume and accepted-report protocols, clean replacement, and stopped-claim observation/release protocols. | 65, 66, 136, 137, 264 |
| `specs/gitReconciliation.qnt` | provider-neutral Git decisions: lineage, worktree loss, registration conflict, result-commit eligibility, and the stale and ambiguous target head | 139 |
| `specs/acceptedResultIntegration.qnt` | accepted-result admission and one fixed integration session accepting only an explicit submitted commit whose ordered direct parents are the current target head and the accepted result | 56, 57 |
| `specs/integrationFinality.qnt` | post-promotion completion-claim replacement and deletion, focused task-completion success, task-scoped settlement, and retention of unrelated Run responsibility | #141 (`integrationFinality`); executable seam: `packages/dalph/test/conformance/integration-finality.mbt.test.ts` invokes the production completion-claim protocols and Run finality decision |
| `specs/controlDirectionApplication.qnt` | receiving a Pause or Unpause as ephemeral against applying one exact run-or-task direction as a durable Operator-initiated action | 155, 166 |
| `specs/plannedAttemptExecutor.qnt` | the same-process executor boundary: responsibility, durable Begin, Suspend, and Resume command intent, passive Observe evidence, exact response versus command/state projection evidence, correlation and ordinal settlement, the retained three-command Suspend bound, Safe-authorized Resume, recovery reconciliation, and task-work position ownership. Executable seam: `packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts` invokes the production executor protocol and admission controller. | 65, 158, 264 |
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

Its `historicalTaskFactStopRecoveryProof` module deliberately retains the
pre-#264 `StartOrContinue` chronology only as negative design-history evidence:
accepted executing evidence must break the old Stop quiescence premise. The
current journal and cassette schemas do not decode that command, and the proof
cannot authorize runtime behavior or an offline migration. Keeping the finite
TLC graph spends model-gate time to guard against reintroducing the rejected
authority rule; that explicit regression value is the trade-off for retaining
otherwise non-runtime vocabulary.

The same proof projection also owns the narrow active-work authority-refresh
slice accepted by issues #218 and #281. Its `Running` establishment is a
separate action from the later `TrackerNotification`/`Timer` offer; source
provenance is explicit, healthy and unreadable observations retain the exact
Running position without an executor action, and ordinary unreadable facts
still select the existing safe-suspension route. The canonical
`taskFactReconciliation` model and its production-backed MBT remain the source
of runtime behavior; the projection's positive/negative tests, witnesses, and
exhaustive check only measure this accepted proof slice. The runtime keeps a
successful Git read's refresh source process-local and persists only the typed
failure outcome; its operation/ordinal chronology is covered by the Dalph
journal tests rather than by an additional proof-state cardinality claim.

`specs/plannedAttemptExecutor_proof.qnt` applies the same exception to the
canonical executor model's evidence and bounded-suspension cycles. One finite
graph keeps exact Begin, passive Observe, Suspend, and safe-authorized Resume
intent/call/evidence chronology; a separate finite graph owns the retained
three-command Suspend bound and post-limit read-only recovery. Passive
observations and Resume have no shared command budget. The canonical model
still owns their shared vocabulary and
`packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts` remains
the production seam. The projections have collected positive and negative
tests, sampled witnesses, and complete TLC enumeration without a depth token.

This proof projection is deliberately a stage/counter abstraction. It does not
duplicate tracker targets or executor correlation: the canonical
`plannedAttemptExecutor.qnt` model owns the RunId, AttemptId, command-ordinal,
and foreign-value negative controls, while
`plannedAttemptExecutor_proof.qnt` proves the corresponding stage and counter
properties. The obligation manifest records both projection profiles, so
removing an identity or ordinal obligation cannot silently leave mutation
analysis or conformance checking on a stale list.

Issue #264's tracker-read freshness outcomes are deliberately not encoded as a
second finite state machine in `taskFactReconciliation.qnt`. That model keeps
the successful fresh-authority branch; `pending`, `TaskTrackerFactsReadFailed`,
and unreadable outcomes depend on journal operation IDs, predecessor plans,
task coverage, and immutable targets owned by continuation authorization and
recovery. The executable obligation for that omitted state is the exact
Graph/Specification/Claim pending-and-failed-or-unreadable matrix in
`packages/orchestrator/src/coordination/run/recovery-activation.test.ts` and
the zero-contact authority matrix in
`packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts`.
This keeps the formal state finite without weakening the production
fail-closed rule. The same model does encode the controller race: a held
process-local Resume owner is canceled before its durable `commitIntent`, while
the controller append-boundary test proves that choice-before-commit produces
no Resume intent or contact and that a Resume winner excludes the choice.

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

`pnpm check:quint` runs the exhaustive checks and reports per-command and
phase timing against its provisional 600-second internal regression budget.
Repeated Node 22/24 phase and frozen-install measurements are recorded in
[`../../research/quint-hosted-equivalent-profile.md`](../../research/quint-hosted-equivalent-profile.md);
they are local Linux arm64 evidence and explicitly reserve 300 seconds for
hosted checkout/action/network setup until a pushed workflow supplies direct
hosted timing. The complete hosted contract is `pnpm check:ci`, which composes the independent
`check:ci:quality` and `check:ci:formal` subgates. The GitHub workflow runs the
quality and formal subgates as separate jobs on every supported Node version;
the formal job invokes `pnpm check:quint` with a 16-minute job timeout. The
local `pnpm check:all` gate remains non-exhaustive and therefore does not
duplicate formal model checking. A change to a model or to behavior a model
governs must run `pnpm check:quint` before integration.

`../DELIVERY-INVARIANTS.md` is the specification these models project from, and
`research/verification-bakeoff/INVARIANTS.md` is a separate benchmark for
comparing verification tools rather than a source of Dalph behavior.
