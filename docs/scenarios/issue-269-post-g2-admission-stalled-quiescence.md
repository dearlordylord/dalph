# Return from exact post-G2 capacity stall without losing later work

Owning behavior family: [#269](https://github.com/dearlordylord/dalph/issues/269)

Status: accepted #269 behavior amendment supporting the #268 vertical story.
In the current conversation, the repository owner authorized production
changes that pass
[#268's two-judge gate](issue-268-delivery-story-capstone.md#two-judge-gate-for-a-production-behavior-change-discovered-by-the-capstone).
The main agent thread (the orchestrator) and the unbiased sub-agent reviewer
each recorded **YES** for this standalone correctness/liveness behavior and
**NO** for rejected candidate `f77c743f4`. The documentation commit containing
those reviewed decisions activates the gate and accepts this behavior for
test-first implementation. It does not reopen the closed issue or accept an
implementation. #309 still blocks the complete #268 capstone composition.

The rejected commit
[`f77c743f4`](https://github.com/dearlordylord/dalph/commit/f77c743f411be95c062519956dc697c640e7a905)
is characterization evidence only. Its test exposed the missing return and a
causally later evaluation, but its predicate was not accepted and must not be
integrated or treated as implementation authority.

## Governing behavior and authority

[The accepted #269 full-capacity handoff](issue-269-independent-work-retained-priority.md#full-capacity-yields-to-one-queued-active-refresh-without-losing-d-or-e)
already requires an ordinary delivery phase to return
`TaskWorkAdmissionStalledRuntimeQuiescence` when exact retained work fills the
capacity and only exact `ReserveOrReuse` proposals remain. This amendment owns
the distinct later cut after a tracker-notification or timer activation has
already accepted G2: one action newly admitted during that post-G2 phase fills
the position released by B, no action owner remains, and E cannot start.

[D12 and D13](../DELIVERY-INVARIANTS.md#admission-and-capacity) require exact
Safe-or-terminal release and a non-evicting capacity ceiling. [D29 and
D33-D36](../DELIVERY-INVARIANTS.md#progress) keep positions and runtime queues
process-local, prohibit dropping E, distinguish quiescence from completion,
keep unsettled responsibility active, and permit at most the already-consumed
G2 read. [D40](../DELIVERY-INVARIANTS.md#run-boundaries) reconstructs durable
policy and responsibility without persisting a position map.

The tracker remains authority for the complete task graph and task lifecycle.
The Journal remains authority for accepted B and D executor reports and the
latest durable control policy. The planned-attempt protocol remains authority
for exact `(RunId, AttemptId)` executor-work correlation. The delivery runtime
alone owns process-local admission positions, action owners, and event
application. A capacity-stall observation adds no persisted fact, graph fact,
Journal event, retry token, priority, or eviction authority.

The canonical name for this process-local phenomenon is **post-G2
exact-capacity stall**. Its distinct result is
`PostG2TaskWorkAdmissionStalledRuntimeQuiescence`. The result carries the exact
effective A/C/D held basis and the non-empty exact E proposal frontier. It must
not be represented as generic `TrackerReconfirmationQuiescence`, and it must
not erase E into an empty proposal array. It is not the ordinary pre-G2
admission-stalled result and it is not finality: it proves that this already-G2
phase has no action capable of freeing capacity while exact denied work must
remain available to a later activation.

## Starting facts and concrete trigger

No person triggers this in-process cut. Alice's earlier actions are already
durable. Run R has configured task-work capacity three. Exact attempts A, B,
C, D, and E belong to R. A and C hold exact positions. B's accepted `Safe`
report released B's exact position under D12. D has unfinished responsibility
but did not hold a position before this `ActiveRefreshPostG2` phase. E has a
prepared exact `ReserveOrReuse` Begin proposal and has not begun.

The reactivation owner has already entered an active refresh and accepted its
one complete post-quiescence graph reread, G2. That graph still contains the
unsettled responsibilities relevant to D and E. There is no further tracker
change, Git change, claim mutation, executor notification, or timer tick in the
causal cut described here.

The concrete trigger is delivery applying the complete G2 evaluation and
selecting D's exact proposal while capacity made available by B's release is
available.

## Ordered runtime chronology and visible result

1. Delivery consumes the complete G2 evaluation in
   `ActiveRefreshPostG2`. The evaluation names R and the exact correlations for
   A, C, D, and E; it does not copy admission ownership into tracker facts.
2. The admission controller reserves one newly available position for D and
   binds it to D's exact `(RunId, AttemptId)` before D's executor boundary
   begins. A, C, and D now hold the three positions. Dalph neither reuses B's
   correlation nor exceeds capacity three.
3. D's action returns its exact successful ordinary outcome. The accepted-fact
   publication boundary proves the corresponding accepted Journal prefix, and
   delivery applies that exact D completion once during this phase. D's live
   action owner settles once; D's unfinished responsibility and exact bound
   position remain. A position that was merely bound at some historical time
   is not a substitute for this applied successful outcome.
4. Delivery evaluates E's still-prepared exact `ReserveOrReuse` proposal
   against the effective A/C/D admission snapshot. The one reserve attempt is
   denied with `TaskWorkPositionUnavailable`. E receives no executor call and
   remains in the descriptive frontier for a later activation.
5. Delivery records E's actual `TaskWorkPositionUnavailable` denial for this
   exact proposal in the current admission pass. If more than one exact
   `ReserveOrReuse` proposal remains, every proposal in the retained frontier
   must have an actual current denial. A denial from an earlier evaluation or a
   historical held-position provenance does not qualify.
6. Only after D's exact successful outcome and every retained proposal's exact
   current denial are causally applied, and after every causally prior runtime
   event described in the next section is applied, delivery observes no live
   action owner.
7. Waiting in this same post-G2 phase cannot free a position: A, C, and D are
   unfinished executor responsibilities outside any remaining live delivery
   action. Delivery returns
   `PostG2TaskWorkAdmissionStalledRuntimeQuiescence` with held A/C/D and the
   exact non-empty frontier containing E. Stabilization performs no G3 graph
   read and returns `RunMustRemainActive(UnsettledResponsibility)`.
8. The reactivation call returns. E remains prepared and unbegun. A later
   ordinary activation may reconsider E after exact Safe or terminal evidence
   releases a position; the current activation does not evict A, C, or D,
   invent capacity four, retry E, or wait forever.

The Operator or maintainer sees the active activation return normally with
`RunMustRemainActive(UnsettledResponsibility)`. The forbidden visible result is
an activation that remains pending after D settled and E was denied even
though no live action can create the missing position. It is also forbidden to
return `RunMayTerminate`, to report E as begun, or to hide a causally prior
Pause/control decision.

## Causal observation cut, not scheduler timing

Queue emptiness sampled at an arbitrary fiber turn is not proof that the
chronology above is complete. Implementation must establish one process-local
causal cut across events already offered to the activation:

- Once both the exact successful D completion and every retained proposal's
  actual current `TaskWorkPositionUnavailable` denial have been applied, the
  runtime creates one branded activation-local
  `PostG2AdmissionStallCutToken` and offers one `PostG2AdmissionStallCut`
  marker carrying that token and a `Deferred` acknowledgement through the
  existing runtime event queue. It records a candidate but does not return
  from the event handler that offered the marker.
- Queue offer linearization is the cut. When the runtime later consumes the
  marker, it has already applied every evaluation, action completion,
  ownership-conflict evaluation, and relation-failure event offered before
  that marker. It reevaluates the complete stall predicate at the marker; a
  changed frontier, held set, owner set, denial set, failure, conflict, or
  cancellation direction discards the candidate. Only an unchanged exact
  basis may complete the acknowledgement and return. An outside event
  linearized afterward belongs to the next ordinary owner turn and cannot make
  this phase wait without bound.
- The exact Journal prefix in `DeliveryAcceptedPublicationBoundary` remains the
  authority proof for D's accepted outcome. `RunPolicyRevision` remains the
  durable capacity revision. `PostG2AdmissionStallCutToken` only correlates one
  marker with its acknowledgement: it is never placed in
  `DeliveryRuntimeEvaluation`, never persisted, and never compared with
  tracker revisions or Journal positions. It must not recreate the rejected
  `DeliveryRelationRevision`, general invalidation, per-event revision ledger,
  or a second current-fact authority. The token and `Deferred` disappear with
  the activation.
- Accepted Pause/control and accepted-fact-publication callbacks use the
  reactivation owner's existing command gate, activation generation, and
  trailing-activation obligation. This amendment adds no parallel callback or
  observation revision. A callback accepted into the current generation first
  is applied first. An accepted capacity-policy publication either reaches the
  current evaluation before the cut or retains the exact trailing activation
  that reads its newer durable `RunPolicyRevision`. A callback linearized only
  after result publication belongs to the ordinary next generation.

If Pause is accepted before the nonterminal return is published, the visible
activation result remains exact
`RunMustRemainActive(UnsettledResponsibility)`; Pause does not rewrite it into
termination or failure. Alice observes the accepted Pause through the existing
control boundary; the owner is `RunPaused`, its timer is stopped, and neither a
queued hint nor the retained trailing activation begins until a later accepted
Unpause. Unpause uses the existing wake/generation rule; it does not recreate E
from the discarded process-local frontier.

Direct tests control this cut with Effect `Deferred`s. A production trace seam
signals after the exact D completion and current E denial have been applied but
before the candidate marker is offered. The test offers a later evaluation,
conflict, completion, or failure event, or invokes an accepted owner callback,
then releases the trace seam. It finally awaits the exact
`PostG2AdmissionStallCutToken` acknowledgement. The runtime must apply the
earlier event and recheck the predicate before returning; the owner test must
observe the existing generation/Pause consequence above. Tests must not use
`Effect.sleep`, `yieldNow`, polling, fiber status, timeouts widened to win a
race, or assumptions about fiber scheduling. Production must not add a sleep,
timer, polling loop, or unbounded drain.

## Exact negative cases and failures

The September 2026 two-judge review disagreed about making all delivery phases
validate every executor/proposal identity. The main review favored that broad
defense; the independent production-architecture review rejected changing the
contract of unrelated phases without their own scenarios. Therefore the
runtime globally retains only the identities it owns directly (the requested
Run versus the accepted-publication Run, and the completing proposal versus
the published result proposal). The route/planned-attempt, executor report,
admission correlation, proposal order, and task-work position checks apply
only while forming this post-G2 successful-outcome witness. A mismatch names
the expected and observed source identities, forms no witness or stall, and
releases the exact reservation through the existing failed-completion cleanup.
A universal injected-executor defense remains outside this amendment and needs
a separate compatibility scenario before changing other phases.

| Starting difference | Required result |
|---|---|
| One full-capacity position belongs to an attempt outside the current exact G2 responsibility/admission basis | It cannot prove post-G2 exact-capacity stall. This is a current identity mismatch, not a historical-provenance test; delivery does not return merely because some unrelated position exists. |
| Fewer than three exact positions are held | E has available capacity. Ordinary admission must reserve or return the exact admission failure; the stall classifier cannot fire. |
| The remaining frontier is empty | Use ordinary post-G2 quiescence/finality. Do not manufacture a capacity-stall witness. |
| Any locally runnable proposal does not require task work, or requires a mode other than exact `ReserveOrReuse` | Use that proposal's ordinary admission/ownership rule. Do not generalize this amendment into a no-work or reuse-only scheduler shortcut. |
| E's proposal correlation, D's outcome, the held position, accepted-publication Run, or phase subject mismatches the exact Run/Attempt identity | Fail closed through the owning typed mismatch and retain every unrelated owner/position. Do not reinterpret the mismatch as capacity pressure. |
| Any live action owner remains | The runtime is not quiescent. Await or apply that exact owner's outcome; do not return the stall result. |
| D is currently held but no exact successful D outcome was applied in this post-G2 phase | Historical binding does not qualify. Await/apply the current outcome or follow its exact failure/rollback path. |
| E was denied in an older evaluation, one retained proposal was never tried, or a denial reason is not exact `TaskWorkPositionUnavailable` | No current complete denial set exists. Preserve the frontier and ordinary reason; do not classify the stall. |
| A relation evaluation, action completion, ownership conflict, or relation failure was offered before the `PostG2AdmissionStallCut` marker | Apply it first. A new executable frontier, conflict, changed held/denial set, failure, or cancellation direction invalidates the candidate and is handled ordinarily. |
| Pause/control or an accepted policy publication enters the current reactivation generation before result publication | Apply the existing generation/trailing-obligation behavior and the exact Pause consequence above. Do not add a competing revision or let stale unpaused/capacity-three state overtake it. |
| The relation stream, admission snapshot, accepted-publication boundary, executor, Journal append/read, or finality computation fails | Preserve the exact typed failure/cause and existing cleanup. Do not convert failure to quiescence, retry it, call E, evict a holder, or issue a second G2 read. |
| D is interrupted or fails before its exact outcome is applied | Run the existing reservation rollback or retained-responsibility protocol for that exact exit. It cannot contribute a successful D outcome to this stall proof. |
| E is denied for any reason other than exact `TaskWorkPositionUnavailable` | Preserve that reason and its ordinary rule. It cannot contribute to this stall proof. |

These controls deliberately reject the broad predicate in rejected
`f77c743f4`: “runtime-bound at some time” alone does not establish the actual
successful D outcome, the current complete denial set, or the causal cut. An
unrelated holder cannot make a pending evaluation, failure, conflict, or Pause
disappear.

## Crash and retry

If the process dies before the return, the causal-cut token, its `Deferred`,
candidate witness, queue, owners, and positions disappear. Restart reduces the
Journal and latest control policy. If D's exact
accepted outcome is durable, the normal planned-attempt protocol reconstructs
D's unfinished responsibility; if the executor command outcome was ambiguous,
the owning protocol reconciles before retry. E is reconstructed only from
durable facts and the current graph, not from a persisted deferred proposal.

If the process dies after the return, the same reconstruction applies. No
`PostG2TaskWorkAdmissionStalledRuntimeQuiescence`, admission snapshot, position
map, frontier, causal-cut token, `Deferred`, or return token is written to the
Journal. A later activation makes a fresh current decision and may start E
only after exact capacity is available.

## Scenario-to-test mapping

Every concurrency proof uses deterministic `Deferred` gates and exact typed
token acknowledgements. Aggregate test totals or the #268 cassette passing
cannot substitute for these direct production-boundary proofs.

| Chronological result | Required direct proof |
|---|---|
| B Safe leaves A/C held; complete G2 admits and binds D; D's exact successful outcome is applied; exact E is actually denied at A/C/D capacity three; no owner remains | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts` — `applies D success and current E capacity denial after B releases post-G2 capacity` |
| The distinct post-G2 result retains exact held A/C/D and the non-empty exact E frontier; it is never generic `TrackerReconfirmationQuiescence` with empty proposals | Same file — `returns typed post-G2 admission-stalled quiescence retaining E` |
| A prior offered evaluation/completion/conflict/failure is applied before the cut; unrelated current holder, partial capacity, empty/non-ReserveOrReuse frontier, missing/currently mismatched D success or denial, live owner, and non-capacity denial each reject the classifier | Same file — `rejects post-G2 admission-stalled quiescence outside its complete current causal basis`, `invalidates a post-G2 cut whose complete predicate changed before acknowledgement`, `applies a post-G2 ownership conflict offered before the cut marker`, `applies a post-G2 relation failure offered before the cut marker`, and `continues waiting after G2 while an in-flight action can free retained capacity` |
| A causally prior Pause/control callback and accepted capacity-policy publication use the existing generation/trailing obligation; Pause preserves the exact nonterminal result, stops the timer, and begins no later activation until Unpause | `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts` — `preserves a paused nonterminal post-G2 return in the existing activation generation` |
| A branded activation-local token and Deferred acknowledgement prove the bounded Queue cut without a scheduler race, relation revision, parallel reactivation revision, per-event ledger, or persisted witness | Same file — `acknowledges the bounded post-G2 event cut without relation version authority` |
| Stabilization maps the accepted post-G2 stall to `RunMustRemainActive(UnsettledResponsibility)` and performs no G3 read | `packages/orchestrator/src/coordination/run/run-stabilization.test.ts` — `returns unsettled responsibility for exact post-G2 capacity stall without another tracker read` |
| Failures retain their exact tags/causes and D ambiguity follows reconcile-before-retry | Production-boundary table tests in `run-delivery-runtime.test.ts` and the existing planned-attempt protocol conformance tests — `preserves post-G2 stall boundary failures without retry or fabricated quiescence` |
| Restart persists no stall witness or position map and reconstructs D/E only from Journal, policy, and tracker facts | `packages/orchestrator/src/coordination/run/recovery-activation.test.ts` — `reconstructs after post-G2 capacity stall without persisted admission state` |
| The accepted standalone behavior composes into DS01-DS13 without a cassette flag, provenance branch, or changed authority | `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `emits the exact DS01 through DS13 delivery checkpoint table` |

The runtime tests must first fail for the missing or stale-cut behavior and then
pass through one bounded production predicate. For the recorded independent
judgment, the unbiased sub-agent reviewer received the standalone chronology,
its invariants, and the rejected production candidate without the cassette-pass
objective or the main agent thread's conclusion. Any implementation diff must
receive the same blind review before integration.
