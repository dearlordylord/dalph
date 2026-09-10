# Alice sees one normally completed seven-task Run

## Governing behavior

This independent fixture implements [#278](https://github.com/dearlordylord/dalph/issues/278)
and [#256 DS-22](https://github.com/dearlordylord/dalph/issues/256). When ordinary
delivery stops proposing work, it preserves [GitHub confirms every current task
succeeded](issue-102-terminate-settled-run.md#github-confirms-that-every-current-task-succeeded)
and D34–D36. The model is [runActivation.qnt](../../specs/runActivation.qnt):
`finalityReadRequiresQuiescence`, `terminationRequiresExactFreshGraphEvidence`,
`terminationRequiresNoRetainedResponsibilityOrPosition`, and `terminatedRunIsFinal`.
The production protocol remains unchanged. The activation model is refined to
distinguish the durable termination commit from its lost local acknowledgement
and measure attempted reappends after reentry. The uninterrupted story and its
catalog, manifest, and presentation evidence remain owned by #279.

## Starting facts and chronological boundaries

Alice observes Run R rooted at A. Git owns one exact target ref and the accepted
commits; the tracker owns the seven tasks and their exact claim records. A has
an independently validated ordinary settled Journal/evidence/claim-cleanup prefix.
Its single ordinary Integrator session has no quarantined predecessor candidate,
so predecessor candidate cleanup does not apply to this prefix. It is not
proved by #277, which starts with A successful but no A delivery history.
B–G use the neutral controlled runtime and ordinary finality boundaries shared
with #277; this fixture does not invoke #277's recording or interrupt at G.

Each exact delivery records focused tracker success, independently releases
its original claim, deletes its completion marker, checks both owning records,
and settles. No person triggers these controlled executor/Integrator responses.
After seven settlements, no executable proposal, live action owner, held
position, retained executor/integration/finality/cleanup responsibility, or
isolated conflict remains. Only then does stabilization record its new complete
read intent and call the tracker for Gfinal. The fixture correlates the actual
target-only provider call with that exact pending durable
`PostQuiescenceReconfirmation` operation. Gfinal has different lifecycle content
from G5 and reports all seven exact tasks successful. It contains no claim facts.
The controlled tracker starts with A successful and B–G open. Only successful
`CompletionTaskBoundary.completeTask` calls change its lifecycle state; every
graph response is projected from that state, never from Journal settlements.
The Journal supplies read-intent correlation and independently checked finality
history, not tracker lifecycle authority.

The termination boundary validates that exact read and current empty
responsibilities, then appends one `WorkflowRunTerminated(Completed)`. Alice sees
one completed Run. This does not request application Exit or process termination.

## Crash and forbidden results

A crash after the Gfinal observation but before termination preserves the
prefix. Restart obtains a distinct later read intent and observation before
termination; old freshness is insufficient. If termination appended but its
acknowledgement was lost, restart reconstructs the final record with zero new
termination append attempts, tracker reads, or delivery effects.

Dalph must not borrow G5 as final evidence, infer claim absence from graph
success, terminate with any named outstanding work, append termination twice,
or turn normal Completed into application Exit. No live provider or clock retry
is required: controlled queues and exact append cut points expose the boundaries.

## Scenario-to-test mapping and implementation plan

The four normal/recovery tests live in
`packages/dalph/test/cassettes/issue-278-normal-termination.test.ts`.
The two outstanding-work tests live in
`packages/dalph/test/cassettes/issue-278-outstanding-work.test.ts`.

| Scenario | Acceptance test |
| --- | --- |
| Seven exact successful tasks and separate claim absence | `proves seven tracker successes from Gfinal and seven exact claim absences` |
| Empty work and one normal termination, distinct from Exit | `records Completed once only after Gfinal and no remaining work` |
| Gfinal crash loses process-local freshness | `obtains a distinct later Gfinal after a crash before termination` |
| Successful termination append loses acknowledgement | `reconstructs lost termination acknowledgement without another append attempt or boundary call` |
| Actual proposal, live owner, held/executor work, integration, finality, and pending exact claim cleanup forbid termination | `keeps proposals live owners held executor integration finality and claim-cleanup work nonterminal` |
| Another exact executor's report cannot settle B | `keeps an exact executor correlation conflict and its retained position nonterminal` |
| Deferred #256 capstone: A FullRerun predecessor cleanup and lost-response reconciliation | #337/#279 must add the downstream acceptance test `completes the uninterrupted seven-task run after reconciling A FullRerun predecessor cleanup`: exact predecessor candidate cleanup, preserved predecessor history/evidence, and cleanup crash reconciliation must precede terminal proof. It composes the FullRerun cleanup seam with B–G delivery and this termination seam; the ordinary singleton A prefix here does not satisfy that future test. |

The shared runtime now provides explicit tracker-reader injection and records
actual ordinary append and `terminateRun` calls separately. A's existing
singleton fixture is factored into test support and cut at its exact settlement;
both the production reducer and recorded-cassette projection/fold validate it.
Recreated immutable evidence bytes must match its retained reference before the
prefix is seeded. Its original Run identity and target remain exact; B–G use
distinct #278 operation identities and the same integration target.

The two crash tests reuse that Journal and the same outside boundaries while
creating a fresh application scope. The final read captures the runtime's last
Ready observation at the actual provider boundary, before any scope teardown.
The negative controls stop real delivery at B's executing report, admitted
Integrator call, exact replacement claim, and pending marker deletion. A foreign
report carries A's already-observed exact terminal correlation to B's observer;
it supplies no permission to settle B. No claim is inferred from the graph.

Focused tests and `pnpm check:fast` check the adapters. The separately owned
activation-model refinement and its directed conformance test distinguish
termination commit from lost acknowledgement, including a negative duplicate
attempt control. The orchestrator owns final `check:all` and `check:quint` on the
frozen candidate; development checks do not replace those integration gates.

## Review evidence

The domain/spec pass checked that seven graph successes and seven exact
marker-plus-active-record absences have different evidence owners. A restart
keeps the same Gfinal content identity when the tracker content is unchanged;
its new operation and later observation position prove the new read. The
architecture pass retained ordinary production activation and finality, with
test-only provider controls and no derived state persisted. The correctness
pass checks actual `terminateRun` attempts independently of ordinary appends,
runtime-layer entries independently of publication counts, and both final
absence observations in their exact order before each deletion record.

The initial complete diagnostic stopped because the test had consumed C's
already-published executing event while awaiting B's settlement. The test now
checks the actual existing command before waiting for that event. No production
timeout, gate bound, or workflow behavior changed to repair that synchronization.
The extracted singleton acceptance test remains a consumer of the same helper;
#276 and #277 retain their original fixture defaults and acceptance assertions.
