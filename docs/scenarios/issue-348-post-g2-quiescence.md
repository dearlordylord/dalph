# Alice closes C and the active refresh returns after G2

Owning issue: [#348](https://github.com/dearlordylord/dalph/issues/348).

Status: implemented with focused acceptance coverage; final integration
verification and #337 composition remain pending.
This repair blocks [#337](https://github.com/dearlordylord/dalph/issues/337)'s
uninterrupted DS01--DS22 cassette and preserves [#256](https://github.com/dearlordylord/dalph/issues/256)
and [#279](https://github.com/dearlordylord/dalph/issues/279) acceptance. It
does not include [#338](https://github.com/dearlordylord/dalph/issues/338)
status or browser work.

## Governing behavior

When Alice closes C while A0 and D0 occupy the two usable task-work positions,
the decision is whether the active refresh may return after it has accepted its
mandatory complete G2 tracker read. The accepted [#266 subject-local refresh
and safe-suspension behavior](issue-266-active-work-authority-refresh.md#governing-behavior)
records current facts and suspends only the exact changed subject. The accepted
[#275 capacity-blocked fresh-task handoff](issue-275-discover-f-g-at-capacity.md#governing-behavior)
keeps a fresh task behind exact occupied positions and does not use the active
refresh as finality. The accepted [#218 one-owner and trailing-check
behavior](issue-218-reactivate-incomplete-runs.md#several-hints-produce-one-activation-and-one-optional-trailing-check)
continues to coalesce hints behind one activation.

This scenario preserves and refines those behaviors. It preserves
[D12--D15 admission and capacity](../DELIVERY-INVARIANTS.md#admission-and-capacity)
and [D34--D36 progress and bounded
quiescence](../DELIVERY-INVARIANTS.md#progress): the existing admission-stalled
result remains forbidden while G2 is pending, and becomes the bounded return
after G2 when no admitted action can release capacity. In particular, #275's
captured-subject exclusion applies only until the mandatory G2 is accepted;
#348 is the post-G2 refinement and does not replace the pre-G2 boundary or its
observer. It adds no workflow event, authority fact, persisted scheduler state,
executor command, retry rule, or public API.

The component decisions remain constrained by the existing formal sources:
`activeRefreshUnreadableAuthorizesNoExecutorAction`,
`healthyActiveRefreshAuthorizesNoExecutorAction`, and
`activeRefreshSourceIsTrackerOrTimer` in
[`taskFactReconciliation.qnt`](../../specs/taskFactReconciliation.qnt);
`everyEntryWasWithinItsObservedCapacity` in
[`freshTaskAdmission.qnt`](../../specs/freshTaskAdmission.qnt); and
`finalityReadRequiresQuiescence` plus
`establishmentSourceDoesNotChangeActivationBounds` in
[`runActivation.qnt`](../../specs/runActivation.qnt). No Quint model currently
owns the complete runtime-phase, capacity, and trailing-activation composition,
so these laws do not claim to prove this liveness edge and no modeled rule is
changed by this scenario.

## Starting facts and concrete trigger

Alice is the affected person. Dalph, the task tracker, the Run Journal, Git,
the executor, and the process-local reactivation owner are the relevant
systems.

Before Alice's edit, exact Run R has five tasks A--E and one valid Journal
beginning. The task-work capacity was durably reduced from three to two; that
policy change did not preempt existing work. B2 is safely suspended after
Alice changed B's instructions, and its immutable attempt and preserved
work remain. A0, C1, and D0 each have an exact accepted `Executing` report,
their claims, planned Base SHAs, and worktrees. They still hold their three
exact task-work positions even though the current capacity is two. E is open
and unstarted. Git lineage, refs, and worktrees do not change in this
chronology.

Alice closes C without success in the task tracker. The tracker notification
reaches the sole Run owner and starts one active-work authority refresh. This
notification is the concrete trigger; the tracker edit does not itself grant
admission or authorize an executor command.

## Ordered boundary calls and visible result

1. Dalph records the complete graph-read intent, asks the tracker for the
   current graph, and records the accepted result before using its graph
   consequences. A0 and D0's focused authority checks remain healthy.
2. Dalph records C1's exact `Suspend` intent, calls C1 through the executor,
   and accepts exact `Safe` evidence. C1's position is released only after
   that evidence. C1's claim, immutable attempt, worktree, and preserved work
   remain available for later recovery; A0 and D0 are not released.
3. Dalph performs and accepts the existing mandatory complete post-suspension
   tracker read, G2. G2 has a distinct operation identity from the earlier
   notification read even when both return identical graph content.
4. After G2, A0 and D0 occupy the two available positions. C1 is the
   reconciled subject. E is a fresh candidate, but there is no executable
   proposal and no admitted delivery-action owner left that can release a
   position.
5. Only now does Dalph apply the existing
   `TaskWorkAdmissionStalledRuntimeQuiescence` classification against the
   live admission snapshot. Before returning, Dalph captures the current
   accepted journal position and waits for its relation publication through
   `DeliveryAcceptedFactPublication.awaitCurrent`. The returned boundary must
   name this exact Run before its position can be compared. A foreign Run's
   boundary fails with `DeliveryRuntimeRunMismatch`, without consuming or
   waiting for a queued evaluation. If that position is newer
   than the evaluated position, it consumes the publication and retries
   admission and classification. It retains E and the exact admission snapshot,
   then returns `RunMustRemainActive(RunnableTransition)`. The one
   reactivation owner completes this activation's handoff.

Alice sees the Run remain active. E remains unclaimed until admission actually
permits it. If a tracker or timer hint arrives while this activation is
finishing, the owner retains one coalesced trailing activation and starts it
only after the current activation returns. Without another hint or accepted
publication, no new activation begins.

### Alice's Continue is already accepted while G2 is being published

In the existing #268 chronology, A1 and D1 occupy both P2 positions and C1's
Safe report has been accepted. G2 is durably reconfirmed at position 116.
While its publication observer is completing, Alice's exact Continue for
retained B1 is accepted at position 117. Dalph must not return a capacity wait
from the older position-116 evaluation and discard this already accepted
control. The publication boundary captures position 117, awaits that prefix,
and the runtime consumes its changed evaluation before trying admission again.
B's current-authority checks can then execute without a task-work position.
The existing DS12 checkpoint releases the later A1 terminal report; its accepted
position release permits exact B1 Resume before fresh E. No extra hint, process
death, or frozen occurrence-oracle change is introduced.

The freshness boundary waits only for the prefix captured when called, not for
a future control, executor report, or tracker notification. With no newer fact,
one freshness check returns the unchanged capacity wait. If an accepted-publication
notice arrives after that cut, the production reactivation owner retains one
trailing ordinary activation, starts it only after this activation returns,
and coalesces duplicate notices. The focused owner test controls this notice
boundary; it does not fabricate a tracker lifecycle change or another journal fact.
This process-local synchronization writes no new workflow event, so a crash
uses the existing durable-prefix reconstruction rather than a new retry protocol.

## Crash, retry, and forbidden results

A process crash can occur before or after either tracker-read intent or result,
C1's suspension intent or executor report, G2 observation, or the bounded
return. The existing tracker and planned-attempt protocols reconcile an
ambiguous boundary result before retrying it. If C1's exact `Safe` evidence was
accepted, recovery reuses that durable fact and does not repeat C1's
`Suspend` merely because process ownership was lost. After G2, this activation
does not reread its captured subjects or issue another same-activation
finality read. The bounded return records no new workflow fact and grants no
retry authority. A later activation reconstructs durable facts and current
outside observations through the existing one-owner protocol; it does not
restore a process-local admission snapshot or E proposal.

Dalph must not:

- wait forever for an event that no remaining admitted action can produce;
- return `TaskWorkAdmissionStalledRuntimeQuiescence` before G2 is accepted;
- drop E from the descriptive frontier to manufacture empty quiescence;
- release A0 or D0, increase capacity, broaden the captured subject set, or
  inject process death into the chronology;
- repeat C1's suspension or reread captured subjects after G2 within this
  activation;
- perform an additional same-activation finality read, record Run termination,
  or report graceful application Exit;
- return while a live admitted action can still release capacity;
- stall instead of executing positionless work or work that can reuse its exact
  held position;
- claim E, create its plan or worktree, call its executor, invent a second
  capacity classifier, or infer capacity only from the descriptive relation;
- persist the admission snapshot, scheduler state, retry token, or a new
  workflow event; or
- start a concurrent activation or second reactivation owner.

## Scenario-to-test mapping

The focused production regression exercises the A/C/D/E path that owns this
classification. B2 is already safely suspended, has no held position, and is
not a refreshed subject in this cut, so its preserved history is not replayed
by the narrow fixture; [#337](https://github.com/dearlordylord/dalph/issues/337)'s
full cassette retains that coverage.

| Chronological outcome | Acceptance test |
| --- | --- |
| After G2, A0/D0 fill live capacity, E is fresh, no owner remains, and the result retains E and the exact admission snapshot without an executor call | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`: `returns admission-stalled after G2 when other exact attempts fill capacity` |
| Before G2, the captured-boundary phase does not return admission-stalled; this is the scope of #275's exclusion | `packages/orchestrator/src/coordination/run/run-stabilization.test.ts`: `does not return admission-stalled before the mandatory G2 observation` |
| The public handoff returns `RunMustRemainActive(RunnableTransition)` and starts at most one queued trailing activation after the current activation returns, with no extra finality read | `packages/dalph/src/application/production-reactivation.test.ts`: `returns RunMustRemainActive RunnableTransition and starts one queued trailing activation only after the current activation returns` |
| Already accepted control publication advances the evaluation before a capacity wait; current facts require one check and no future event | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`: `consumes an already accepted publication before returning a post-G2 capacity wait`; `returns admission-stalled after G2 when other exact attempts fill capacity` |
| A foreign publication boundary cannot authorize a return or event consumption, even when its numeric position is newer | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`: `rejects a foreign capacity-wait publication at 1 with queued change false`; `rejects a foreign capacity-wait publication at 2 with queued change false`; `rejects a foreign capacity-wait publication at 2 with queued change true` |
| A publication notice after the freshness cut coalesces into one later ordinary activation, with no concurrent activation or spontaneous retry | `packages/dalph/src/application/production-reactivation.test.ts`: `hands a publication after the capacity-wait freshness cut to one nonconcurrent trailing activation` |
| Alice's accepted Continue during G2 publication preserves DS01–DS13, including B1 Resume after A1 releases capacity, without changing the frozen oracle | `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts`: `emits the exact DS01 through DS13 delivery checkpoint table` |
| A live admitted action that can release capacity keeps the phase pending and admission continues after its exact release | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`: `continues waiting after G2 while an in-flight action can free retained capacity` |
| Positionless work proceeds before an admission-stalled return | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`: `does not report admission-stalled quiescence while a local owner can finish or for work that needs no task position` |
| Exact held-position reuse proceeds before an admission-stalled return, including after G2 with a different reconciled subject | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`: `reuses a full-capacity exact position after G2 despite a different reconciled subject` |
| One free position admits E exactly once | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`: `returns admission-stalled after G2 when other exact attempts fill capacity` (the same controlled case releases one position and asserts one executor call) |
| An accepted Pause after the capacity-stalled phase retains exact G2 and does no executor work | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`: `retains exact G2 and accepts Pause after capacity-stalled phase two without executor work` |
| A crash after G2 preserves A0/D0/C1/E identities and does not repeat C1's suspension | `packages/dalph/src/application/production-reactivation.test.ts`: `restart after accepted G2 preserves A0 D0 C1 E identities and does not repeat C1 Suspend` |
| The accepted behavior composes into the maintained DS01--DS22 history without artificial process death | [#337](https://github.com/dearlordylord/dalph/issues/337)'s `maintained deliveryInvariantStoryCapstone executes all 22 beats in one exact Run` cassette. |

The focused tests must prove the G2 gate, exact live occupancy, retained E
frontier, bounded public handoff, and crash/retry behavior. Aggregate test or
coverage totals and the broader cassette alone do not replace these direct
scenario checks.
