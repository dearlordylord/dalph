# Alice adds F and G while B, C, and D hold capacity

Accepted authority: [#275](https://github.com/dearlordylord/dalph/issues/275),
the superseding Decisions 02/03 amendment of [#256](https://github.com/dearlordylord/dalph/issues/256),
and DS-20 of [the delivery story](../DELIVERY-STORY.md#the-beats).

## Governing behavior

This composes [#266's notification/timer refresh](issue-266-active-work-authority-refresh.md#alice-changes-b-while-a1-b1-and-c1-execute-autonomously)
with [#218's one trailing check](issue-218-reactivate-incomplete-runs.md#several-hints-produce-one-activation-and-one-optional-trailing-check),
#53's complete graph traversal and #164's journal-first observation.
It preserves [D12/D13 capacity](../DELIVERY-INVARIANTS.md#admission-and-capacity),
[D23 uncertainty](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence), and
[D29 authority separation](../DELIVERY-INVARIANTS.md#process-and-durability).
The later [#194 finality read](issue-194-stabilize-each-run.md#g2-is-requested-only-after-g1-is-quiescent-and-reveals-b)
has its own cause and cannot be supplied by this active refresh.
No Quint law or transition changes: existing `activeRefreshUnreadableAuthorizesNoExecutorAction`
in `taskFactReconciliation.qnt` and capacity admission laws continue to govern.

## Starting facts and ordered events

Alice has reopened C and raised capacity from two to three. B1, C1, and D1
have exact accepted Executing reports, their original claims, planned Base
SHAs and worktrees, and occupy all three task-work positions. E is open and
unstarted. F/G are absent from the last accepted graph G4. The Journal owns
the reports and read history; the tracker owns graph membership, Git owns
worktrees, and the executor owns current lifecycle observations.

1. C's real Resume and passive observation finish. The sole Run owner is
   finishing the ordinary activation's return handoff, with accepted G4 and
   B/C/D's exact occupied positions. The controlled cassette holds that
   return handoff; it does not hold a tracker result or infer graph authority.
2. Alice adds F and G to the target closure before the qualifying trailing
   read. One accepted publication hint, tracker notification, and configured
   timer tick reach the owner before that handoff ends. Duplicate timer hints
   retain one trailing refresh. No concurrent graph read or activation
   starts. Executor publication on its own causes zero graph reads.
3. The handoff completes. Dalph records one trailing complete read intent.
   The tracker returns G5 containing F/G; Dalph records that normalized
   observation before publishing its graph consequences. B/C/D's ordinary
   focused tracker and Git checks return unchanged exact facts.
4. Alice can see F/G in the graph. B/C/D still hold the same three exact
   positions. The refresh consumes none and sends no Begin, Resume, or Suspend;
   it creates no F/G claim, plan, worktree, or executor responsibility.

Fresh graph candidates waiting behind exact occupied positions are an
admission wait, not evidence of tracker quiescence or finality. With no live
action and no other runnable proposal, the active refresh returns the existing
`TaskWorkAdmissionStalledRuntimeQuiescence` and its unsettled proof. It neither
adds a G2 read nor claims normal termination. An active refresh already at the
separately typed Suspend/reconciliation boundary retains its existing G2 and
observer behavior; the new capacity-wait classification does not replace it.

A failed or unreadable G5 supplies no graph authority and no permission to
admit F/G or suspend B/C/D. The existing owner waits for a later independent
hint; it does not immediately repeat the failed read. Incomplete or
contradictory provider data is rejected at the normalized graph boundary.
No crash is injected in this slice: #266/#164 own ordinary read-intent and
observation recovery. A crash loses process-local hints and ownership, and
restart uses their existing journal-first read recovery. DS-21 owns the exact
terminal report that releases a position and later admits E/F/G; DS-22 owns
normal termination. The uninterrupted 22-beat composition is #279.

The maintained controlled continuation reuses #274's actual recovery slice
from DS-13: A's accepted result is still an unsettled integration obligation
there. DS-14–17's separately maintained cassette proves A's settlement; this
DS-20 slice proves F/G discovery and exact B/C/D capacity without claiming
that those separate recordings are already one uninterrupted history. #279
owns that composition.

## Scenario-to-test mapping

| Scenario | Acceptance evidence |
| --- | --- |
| C resumes, then Alice adds F/G behind exact B/C/D occupancy | `observes F and G without admitting either while B C and D retain every exact position` in `issue-275-active-graph-refresh.test.ts` |
| Publication, notification, and timer retain one trailing graph read | The same maintained cassette counts provider calls, maximum concurrency, accepted graph observations, and executor commands |
| Executor publications alone cause no graph reads | Production active-refresh report-variant tests in `production-reactivation.test.ts` |
| Failed graph observation retains work and waits for an independent hint | `unreadable F G discovery preserves B C D and waits for another independent tracker hint` plus the production uncertainty matrix in `production-reactivation.test.ts` |
| Capacity wait is based on exact occupancy; available capacity admits the same candidate; a graph read and its live owner do not become a capacity wait | The three phase-specific `classifies a capacity-blocked fresh candidate as stalled without creating a proposal in ...` tests in `run-delivery-runtime.test.ts` execute all three contrasts |
| Active refresh does not replace finality | `active-work refresh and post-quiescence finality perform cause-ordered separate complete graph reads` in `run-stabilization.test.ts` |

## Review and handoff scope

The domain/spec pass keeps graph discovery separate from admission, executor
reports, and finality. It reuses `TaskWorkAdmissionStalledRuntimeQuiescence`;
no new tracker authority, journal event, report-coverage rule, or durable state
is introduced. The architecture/connascence pass keeps the existing live
admission controller as the single capacity authority and does not change
the protected delivery compositions or workflow algebra.

The code-review pass checks the exact G5 intent, provider-call count,
accepted membership, unchanged B/C/D identities and occupancy, and absence
of claims/plans/worktrees/executor commands. A broader exclusion of fresh
candidates from active phases was rejected: the existing DS-01–13 execution
requires admitting D when exact Safe evidence releases B's position. Applying
the capacity wait to the captured Suspend/reconciliation boundary was also
rejected: that boundary must preserve its live observer and separate G2
protocol. The final change leaves both behaviors intact and the retained-C
and stabilization suites remain passing.

Validation uses focused tests and `pnpm check:fast`, as requested for this
slice. No Quint model or executable conformance adapter changes, so no Quint
gate is run here. DS-21, DS-22, and #279's uninterrupted composition remain
explicitly deferred to their owning tickets; no blocker edge is removed.
