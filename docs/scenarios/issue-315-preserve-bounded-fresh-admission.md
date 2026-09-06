# Issue 315: preserve bounded admission until executor-work handoff

Status: accepted product invariant, operational scenario, and formal type shape

## Governing behavior

This scenario composes existing admission behavior rather than choosing new
capacity policy.

- [ADR 0009](../adr/0009-separate-frontier-from-bounded-admission.md) requires
  Dalph to choose a deterministic bounded admission set, says that recording
  the first operation intent commits a fresh choice, retains that admission
  through retryable claim failure, and permits unrelated work only after a
  confirmed task-local conflict.
- [D6 Bound](../DELIVERY-INVARIANTS.md#graph-and-selection) defines the first
  `capacity` eligible tasks in deterministic graph order.
- [D12 through D15](../DELIVERY-INVARIANTS.md#admission-and-capacity) distinguish
  exact attempt-held task-work positions from admission and make admission the
  only entry to work.
- [D13a Fresh-task admission continuity](../DELIVERY-INVARIANTS.md#admission-and-capacity)
  owns the core forbidden result: an intermediate transition, ambiguity,
  capacity change, or process death cannot open a position between fresh entry
  and exact executor-responsibility handoff.
- [Issue 54](issue-54-resize-task-admission.md) requires an outside task to
  remain unclaimed and unplanned while current usage reaches the ceiling,
  retains existing work during contraction, and reconstructs durable capacity
  facts and exact unfinished work after restart.
- [ADR 0010](../adr/0010-govern-subject-scoped-quint-models.md) records the
  current verification gap: no governed model owns this composition or binds
  `runDeliveryRuntime`. Issue 315 narrows and supersedes that deliberate gap
  only for fresh-task admission accounting and its exact executor-responsibility
  handoff. Existing models retain claim-provider, Run-activation, and executor
  command semantics.

This issue fills one previously ungoverned composition boundary: the interval
from a fresh task's runtime admission through its
`TaskClaimAcquisitionIntended` record under `TaskSelectionAuthority`, claim and
specification reads, immutable attempt plan, worktree
reconciliation, and handoff to one exact executor-work responsibility. It does
not change graph eligibility, exact attempt position lifetime, claim retry,
worktree reconciliation, executor behavior, integration capacity, or Run
termination.

## Three tasks enter; two tasks remain outside

### Starting situation

Dalph derives one deterministic order A through E from five independent open
tracker tasks. Tracker enumeration order is not an input. Alice starts one
Dalph Run over those tasks. The Run has task-execution capacity three. No task has a Dalph claim, immutable
attempt plan, Git worktree, executor-work responsibility, or held task-work
position. The Journal contains the Run beginning and accepted complete graph
observation, but no operation for A through E.

The tracker, Journal, Git, and executor implementations can complete independent
requests for A, B, and C in any legal causal order. They do not promise one
total response order.

### Dalph action and boundary calls

Dalph describes A, B, and C as `Selected` bounded parallel tickets and D and E
as `EligibleOutsideBound`. Those placements are descriptive and grant no
runtime capability. One coherent fresh-task admission basis combines the
complete ordered eligible set with current policy, live entry reservations,
journal-derived pre-attempt commitments, exact held attempts, and existing
ready responsibilities.

Under the runtime selection gate, repeated atomic evaluations can reserve one
fresh entry each for A, B, and C. The gate counts every earlier reservation in
the next evaluation. It does not reserve a persisted or fixed three-task batch.
Existing ready responsibilities are considered before fresh entry. D and E
remain graph candidates only. Runtime cannot materialize a delivery action
proposal or perform an operation for either task.

For each admitted task, Dalph can first perform the already-authorized current
graph read; that read creates no durable fresh-task admission commitment. Dalph
then records one exact `TaskClaimAcquisitionIntended` under
`TaskSelectionAuthority` before asking the tracker to create the claim.
Recording that exact claim intent converts
the process-local pre-intent reservation into a choice reconstructible from the
Journal. A successful claim response does not make the admission available to
another task. Dalph continues the same task through its required post-claim
graph read, focused task-work specification read, immutable attempt plan, and
exact worktree reconciliation.

When one prepared task is ready for the executor, Dalph durably accepts the
exact `PlannedAttemptExecutorWorkResponsibilityBegan` event. That one atomic
admission handoff replaces the task's pre-attempt commitment with its exact
attempt-held task-work position. The existing executor protocol then owns the
separate Begin command intent, Begin call, response, and reconciliation. There
is no intermediate scheduling observation in which neither form occupies
capacity, and the same task is never counted twice.

The independent A, B, and C pipelines may interleave. Their completion order
does not change the admitted task identities. Before one of those tasks
conclusively releases its admission or exact attempt-held position, Dalph does
not record a claim intent, read a focused specification, record an attempt
plan, reconcile or create a worktree, or send Begin for D or E.

### Visible and forbidden results

Alice can see A, B, and C become claimed, prepared, and started in any legal
response order. D and E remain without Dalph claims, plans, worktrees, or
executor starts.

Dalph must not treat completion of one claim, graph read, specification read,
plan append, or worktree operation as release of that task's admission. It must
not authorize D or E because a temporary process reservation disappeared. It
must not persist a queue, graph placement, semaphore token, or derived capacity
snapshot as Journal authority.

If the first claim-intent append is conclusively not accepted, the existing
unsuccessful runtime handoff rule releases only its exact process-local entry
reservation. If whether the append committed is ambiguous, Dalph fails closed
until the Journal proves the exact record present or absent. If the
executor-responsibility append fails, the pre-attempt commitment remains; a
failed handoff cannot create a free-capacity observation.

## One exact executor-responsibility handoff has no capacity gap

### Starting situation

A and B already hold exact executor-work positions. C has an acquired Dalph
claim, immutable attempt plan, and ready exact worktree, but no executor-work
responsibility yet. D is the next open eligible task. Capacity remains three.

### Dalph action and visible result

Dalph admits only C's exact executor-responsibility handoff. Durably accepting
`PlannedAttemptExecutorWorkResponsibilityBegan` and binding C's exact task-work
position occur as one admission transition for scheduling purposes. D cannot
enter between the end of C's pre-attempt preparation and the beginning of C's
exact attempt-held position. Begin has not yet been sent at this boundary.

Alice sees A, B, and C occupy the three admissions or positions. Dalph must not create a
fourth concurrent admission, send Begin twice for C, allocate a second attempt
identity, or expose a zero-occupancy intermediate publication.

No tracker retry or Git retry occurs in this scenario because all of C's
pre-Begin boundaries already settled.

## A confirmed foreign claim releases only that task

### Starting situation

A, B, and C have been admitted at capacity three. Dalph has recorded A's exact
claim-acquisition intent but has not observed an owned claim. B and C are
continuing their independent admitted pipelines. D is the next eligible task.

### Outside event and Dalph action

The tracker freshly reports a different exact active claim for A. Dalph records
`TaskClaimAcquisitionRejected` for A's exact operation and preserves the
foreign claim. This conclusive task-local rejection ends A's admission. Dalph
does not retry A's rejected request, edit the foreign claim, plan A, or create
an A worktree.

The rejection makes A ineligible for fresh entry while current tracker facts
still show the foreign claim. A can become fresh-entry-capable again only after
a later authoritative tracker observation removes that constraint. The next
scheduling evaluation keeps B and C committed and may admit D as the next
entry-capable task even if graph-only bounded placement still describes D as
`EligibleOutsideBound`. A shared tracker failure, unreadable response, timeout,
process death, or unknown request outcome is not this event and does not
release A's admission.

### Visible and forbidden results

Alice sees A left alone with its existing foreign claim while unrelated B, C,
and D can progress. Dalph must not release B or C, mutate A's foreign claim,
admit both D and E into one newly available position, or treat a provider error
as a conclusive rejection.

No cleanup boundary applies because Dalph never acquired A's claim or created
an A plan or worktree.

## Ambiguous outcomes retain the same admitted task

### Starting situation

A, B, and C occupy all three admissions. For A, Dalph has recorded the first
claim intent. The tracker may have created A's exact claim, but Dalph has not
recorded an outcome. D and E remain outside the bound.

### Retry without process death

Dalph follows the existing bounded claim protocol. It reads the tracker before
another request, retries only the exact recorded request when a fresh unclaimed
observation permits it, and performs the final authoritative read after an
ambiguous last request. The unresolved or retrying A operation continues to
occupy A's admission. D and E do not enter during the retry sequence.

If the protocol observes A's exact claim, Dalph records acquisition and
continues A. If it observes a foreign claim, the preceding conclusive-conflict
scenario applies. If it remains unreadable or does not converge, Dalph keeps
the exact unresolved responsibility and fails closed; elapsed time alone does
not release the admission.

### Later ambiguous boundaries

After A's owned claim is recorded, failure of its post-claim graph read,
specification read, plan append, or worktree request does not admit D or E.
Dalph continues or reconciles A only through the existing exact boundary
protocol. After a lost worktree response, it reads Git for A's exact planned
worktree before another create. A failure cannot create a second plan,
AttemptId, Base SHA, branch, or worktree.

Alice can see A wait or report the typed boundary problem. She must not see an
outside task run ahead merely because A is uncertain.

A later authoritative observation that A is closed, removed, blocked, or
otherwise unable to continue also does not release the owned-claim commitment
by itself. Issue #316 owns the missing phase-specific cleanup and eventual
relinquishment protocol. Until that protocol is accepted, #315 retains the
commitment and fails closed; it does not invent an automatic release path.

## Restart reconstructs the same occupancy

### Before the first intent

If Dalph dies after atomically reserving A but before recording A's first claim
intent, the process-local reservation disappears. No durable choice exists.
The next Run establishment reads the Journal, current graph, and current
policy, then derives a new deterministic bounded set. It does not restore a
saved queue or reservation.

### After a durable boundary

Drive separate process deaths after each of these A facts:

1. claim-acquisition intent without outcome;
2. exact claim acquired;
3. accepted complete post-claim graph observation;
4. accepted focused task-work specification;
5. immutable attempt plan recorded;
6. worktree-reconciliation intent without outcome;
7. exact planned worktree ready;
8. `PlannedAttemptExecutorWorkResponsibilityBegan` accepted before the Begin
   command intent.

After each restart, Dalph reduces the complete Journal history. The first seven
prefixes reconstruct A as occupying one pre-attempt admission; the eighth
reconstructs A's exact attempt-held position. Existing claim and worktree
protocols reread their owning systems before retry after an ambiguous outcome.
The reconstructed occupied set still excludes D and E when A, B, and C consume
capacity three.

Repeated restart creates no second claim, plan, attempt, worktree, executor
responsibility, or task-work position. Process death, by itself, releases
nothing durable and proves no boundary outcome.

## Position release admits exactly the next task

### Starting situation

A, B, and C have reached exact executor-work responsibilities and hold the
three task-work positions. D and E remain open eligible tasks without Dalph
claims or plans. B then reports the exact `ExecutorWorkSafelySuspended` or
terminal condition that the existing executor protocol accepts as releasing
B's position. No accepted rule has yet selected B for Resume, so B is a
retained but not ready responsibility at this scheduling cut.

### Dalph action and visible result

The next scheduling evaluation counts A and C as occupied and has one available
admission. It admits D alone. D may then record its first claim intent and
continue through its ordinary pipeline. E remains outside until another exact
release.

Alice sees D progress after B's accepted safe or terminal report. Dalph must not
infer release from an unchanged executing observation, an executor-internal
process exit, a timeout, a missing response, or B remaining graph-open while
tracker completion and integration lag.

## Capacity contraction and expansion

### Contraction

A, B, and C occupy three admissions or exact attempt-held positions when the
Operator applies capacity two. Dalph does not preempt or discard any of them.
No new task enters while occupied count is at or above two. A release that
reduces occupancy from three to two still does not admit D; a later release to
one permits only the next ranked task.

### Expansion

A occupies one admission or held position at capacity one. The Operator applies
capacity three. On the next coherent scheduling evaluation, Dalph preserves A
and admits exactly the next two deterministic fresh candidates. The capacity
change itself performs no tracker, Git, Journal workflow-operation, or executor
boundary call beyond the existing durable policy-change protocol.

After restart, the latest journaled capacity and every durable pre-attempt
choice or unfinished exact attempt are reconstructed before new admission.

## Canonical domain distinction

The **fresh-task admission commitment** is the task-level admission accounting
derived after Dalph durably records one exact
`TaskClaimAcquisitionIntended` under `TaskSelectionAuthority`. It continues
across claim, post-claim graph, specification, plan, and worktree stages. It
ends only by an atomic handoff to the exact attempt-held task-work position or
by an exact conclusive pre-ownership rejection. After Dalph owns a claim, it
remains until a future accepted phase-specific disposition proves release; #316
owns that missing liveness protocol.

The **fresh-task admission basis** is the process-local, revision-bound result
for one coherent graph, policy, Journal, and live-ownership evaluation. Live
fresh-entry reservations, pre-attempt commitments, and exact held attempts
consume capacity. Existing ready responsibilities receive their established
priority for available positions. Only the remaining free capacity can admit
the first fresh-entry-capable tasks in stable derived order.

These concepts are not tracker graph placement, persisted queue state,
task-work positions, cross-operation workflow responsibilities, or delivery
action proposals. An opaque fresh-task admission decision is required before
runtime can materialize a delivery action proposal, then establish delivery
live action ownership. A graph candidate outside the decision has no proposal.

## Acceptance-test mapping

| Scenario | Concrete result | Required production test seam | Formal evidence owner |
| --- | --- | --- | --- |
| Three enter; two remain outside | A/B/C may cross every pre-Begin boundary; D/E cross none | `packages/orchestrator/src/coordination/delivery/fresh-admission-production.acceptance.test.ts` — `admits only A, B, and C from the complete A-E production frontier across response permutations`; `keeps D and E outside every production boundary while A, B, and C reach journal-first Begin` | `specs/freshTaskAdmission_test.qnt::threeEntriesConsumeCapacityBeforeAnyOutsideTaskTest`; `specs/freshTaskAdmission_proof_test.qnt::threeOccupantsExcludeFourthTest` |
| Independent response order | Legal A/B/C completion permutations preserve the same admitted subjects | `packages/orchestrator/src/coordination/delivery/fresh-admission-production.acceptance.test.ts` — `preserves the admitted A-C set across every claim-response readiness order`; `retains A-C through independently reversed post-claim production stages` | `specs/freshTaskAdmission_test.qnt::independentPipelineProgressNeverReleasesAdmissionTest`; the capacity proof deliberately erases pipeline stage order |
| Executor-responsibility handoff | C changes from pre-attempt commitment to exact held position without a capacity gap | `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts` — `retains a locally accepted exact attempt through stale commitment synchronization`; `packages/dalph/test/conformance/fresh-task-admission.mbt.test.ts` — `rebinds a ready retained responsibility without an admission gap` | `specs/freshTaskAdmission_test.qnt::executorResponsibilityHandoffKeepsOneOccupancyTest`; `specs/freshTaskAdmission_proof_test.qnt::freshHandoffKeepsOneOccupancyTest` |
| Confirmed foreign claim | Exact rejection ends only A; D alone can enter; foreign claim is untouched | `packages/orchestrator/src/coordination/delivery/fresh-admission-production.acceptance.test.ts` — `settles A's foreign claim rejection task-locally and admits D alone while B and C continue`; `packages/orchestrator/src/coordination/admission/fresh-task-admission-projection.test.ts` — `ends only the exact pre-ownership operation rejected by the tracker` | `specs/freshTaskAdmission_test.qnt::conclusiveForeignClaimReleasesOnlyRejectedTaskTest`; `specs/freshTaskAdmission_proof_test.qnt::foreignRejectionAdmitsOnlyDTest` |
| Ambiguous claim | Exact A retry/reconciliation retains occupancy; D/E remain denied | `packages/orchestrator/src/coordination/delivery/fresh-admission-production.acceptance.test.ts` — `retains A after an ambiguous claim-provider failure and does not admit D` | `specs/freshTaskAdmission_proof_test.qnt::lostClaimResponseRequiresReadBeforeRetryTest`; `specs/freshTaskAdmission_negative_test.qnt::blindClaimIntentReappendTurnsInvariantRedTest` |
| Later boundary failure and ambiguity | Failed pre-Begin stages retain A-C; an ambiguous worktree creation is reconciled from Git before retry without a duplicate | `packages/orchestrator/src/coordination/delivery/fresh-admission-production.acceptance.test.ts` — `retains A-C admission when a later pre-Begin production stage fails` covers `ReadPostClaimGraph`, `ReadTaskWorkSpecification`, `RecordTaskAttemptPlan`, and `ReconcileTaskWorktree` failures before the live action; `packages/dalph/test/scenarios/production.test.ts` — `ticket delivery reads Git after ambiguous worktree creation and preserves the exact registration` covers the lost-response/reread production path | `specs/freshTaskAdmission_proof_test.qnt::lostWorktreeResponseRequiresReadBeforeRetryTest`; provider internals remain in their exact protocol tests |
| First intent append cuts | Conclusive absence releases only the live reservation; ambiguity retains it; accepted intent replaces it with a durable commitment | `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts` — `restores only the exact process reservation when the first bound intent was conclusively absent`; `releases a failed current-graph entry but retains an ambiguous claim-intent entry` | `specs/freshTaskAdmission_test.qnt::ambiguousFirstIntentAppendRetainsReservationTest`; `conclusiveAbsentFirstIntentReleasesReservationTest`; `lostAcceptedIntentResponseReconstructsCommitmentAfterCrashTest` |
| Responsibility append failure | Failed or ambiguous handoff retains the pre-attempt commitment and exposes no capacity gap | `packages/dalph/test/conformance/fresh-task-admission.mbt.test.ts` — `retains the worktree commitment when an absent responsibility append is observed`; `does not admit D or E while A-C commitments survive absent responsibility observation` | `specs/freshTaskAdmission_test.qnt::ambiguousExecutorResponsibilityAppendRetainsCommitmentTest`; `absentExecutorResponsibilityObservationRetainsCommitmentTest` |
| Post-ownership constraint | Closed, removed, blocked, foreign, unreadable, or failed current facts do not release the commitment automatically | `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts` — `retains a durable fresh commitment when complete current eligibility excludes its task`; this runtime fixture intentionally collapses those named tracker categories into the shared `not entry-capable` result; #316 owns later disposition and release | `specs/freshTaskAdmission_proof_test.qnt::ownedConstraintRetainsCommitmentTest` and `specs/freshTaskAdmission_negative_test.qnt::postOwnershipConstraintReleaseTurnsInvariantRedTest` distinguish post-ownership retention from foreign rejection, ambiguity, and lineage categories |
| Restart prefixes | Prefixes 1-7 reconstruct pre-attempt occupancy; prefix 8 reconstructs exact held occupancy | `packages/orchestrator/src/coordination/admission/fresh-task-admission-projection.test.ts` — `reconstructs the accepted restart prefix: claim intent without outcome`, `exact claim acquired`, `accepted complete post-claim graph`, `accepted focused task-work specification`, `immutable attempt plan recorded`, `worktree intent without outcome`, `exact planned worktree ready`, and `executor-work responsibility accepted`; `packages/orchestrator/src/coordination/admission/fresh-task-admission-reconstruction.acceptance.test.ts` — `reconstructs every accepted restart prefix through the production admission controller` | `specs/freshTaskAdmission_test.qnt::processLossAfterIntentKeepsDurableCommitmentTest`; `specs/freshTaskAdmission_proof_test.qnt::acceptedIntentAppendReconstructsCommitmentTest` |
| Restart replacement successor | After the original attempt is safely suspended and an exact Restart replacement is accepted, the successor reaches worktree reconciliation and then Begin from its exact replacement witness; it does not resurrect the original fresh commitment or mint new fresh-entry authority | `packages/orchestrator/src/coordination/run/fresh-workflow.test.ts` — `continues a valid restarted replacement successor without resurrecting its original fresh commitment` | Existing Restart/replacement protocol model and reducer acceptance; #315 adds no new fresh-admission transition for the successor |
| B releases | With no ready Resume responsibility, accepted Safe or Terminal evidence admits D alone | `packages/orchestrator/src/coordination/delivery/fresh-admission-production.acceptance.test.ts` — `admits D alone after B returns Safe or Terminal while A and C remain occupied` | `specs/freshTaskAdmission_proof_test.qnt::releasedPositionAdmitsOnlyDTest` |
| Contraction | Existing occupancy is retained; no entrant at or above the new ceiling | `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts` — `retains all holders across contraction and admits only after occupancy falls below the new capacity` | `specs/freshTaskAdmission_proof_test.qnt::contractionRetainsThreeOccupantsTest`; `specs/freshTaskAdmission_negative_test.qnt::contractionEvictionTurnsInvariantRedTest` |
| Expansion | Exactly the next free-capacity prefix enters | `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts` — `admits exactly the next two candidates after capacity expands from one to three` | `specs/freshTaskAdmission_proof_test.qnt::expansionAdmitsNextInStableOrderTest`; `specs/freshTaskAdmission_negative_test.qnt::outOfOrderEntryTurnsInvariantRedTest` |
| Invalid states | Outside authorization, overlap, duplicate occupancy, over-ranked entry, cross-Run authority, and gap handoff cannot be constructed | `packages/orchestrator/src/coordination/delivery/fresh-task-candidate.test.ts` — `preserves the graph-derived candidate order and rejects duplicate task candidates`; `rejects a reflected copy of genuine complete-frontier authority`; `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts` — `rejects a genuine other-Run basis and frontier even at the same accepted position`; `refuses a copied reservation before it can release another action's position`; `rejects a mismatched exact handoff without replacing the reserved correlation` | `specs/freshTaskAdmission_negative_test.qnt::overCapacityEntryTurnsInvariantRedTest`; `outOfOrderEntryTurnsInvariantRedTest`; `handoffGapTurnsInvariantRedTest` |
| End-to-end return | The cassette-free #268 C2b tracer passes DS-01/DS-02 without a strict cursor | `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts` — `emits the exact DS01 through DS13 delivery checkpoint table`; `retains exact Run attempt claim and resource identities across DS01 through DS13` | Completed production evidence; neither projection models cassette order or Run return |

Focused #54, #193, and #264 through #269 tests remain regression requirements.
Aggregate test totals do not replace this mapping.

## Formal ownership and limitations

The governed subject model owns fresh-task admission accounting from
process-local entry reservation through durable commitment and exact
executor-responsibility handoff or conclusive pre-ownership rejection. The
`runActivation` model continues to own Run establishment and the
`plannedAttemptExecutor` model continues to own Begin and exact attempt-position
lifecycle after the handoff. The executable conformance adapter invokes the
real production planning/admission/runtime decision seam. A research-only
model or an abstraction bound to no code is insufficient.

The model does not own tracker graph construction, claim-provider internals,
Git worktree correctness, executor lifecycle internals, integration admission,
or Run termination. It consumes their typed observations only where they
change admission occupancy. Post-ownership pre-Begin relinquishment is retained
fail-closed and deferred to #316. It models independent boundary results as
unordered choices unless an accepted causal rule requires an order.

### Exhaustive proof projections

The canonical five-task model retains the complete admission vocabulary and is
the source for deterministic scenario tests, sampled invariants and witnesses,
mutation analysis, and the production-backed conformance adapter. Its product
of five task identities, every pipeline stage, boundary ambiguity, capacity
change, and crash prefix did not finish inside the exhaustive gate budget. The
exhaustive artifact therefore splits the same accepted behavior into two
finite projections without weakening either property family.

`freshTaskAdmissionCapacityProof` retains A through E as distinct, stably
ranked subjects. Each is exactly one of candidate, occupied,
retained-not-ready, ready-existing, existing-reserved, or foreign-blocked.
`Occupied` collapses a process-local fresh reservation, every durable fresh
commitment stage, and an exact held attempt only for capacity accounting. This
projection owns bounded entry, A-E order, ready-existing priority, release of
only the rejected task, contraction without eviction, and deterministic
expansion. Keeping only an occupied count would be unsound because it could not
state that D enters before E or that a foreign rejection affects A alone.

`freshTaskAdmissionAmbiguityProof` retains one exact selected task and one
outside-task sentinel. Its closed selected-task state distinguishes candidate,
entry reservation, unknown or accepted claim-intent append, claim call and
authority observation, retry authorization, owned claim, post-claim graph,
focused specification, immutable plan lineage, worktree intent/call/authority
observation and retry, ready exact worktree, unknown or accepted responsibility
append, exact held attempt, post-ownership constraint, conclusive pre-ownership
rejection, and exact release. Process Up/Down state permits repeated crash and
recovery without a crash-count bound. This projection owns fail-closed
ambiguity, reread-before-retry, exact-lineage continuity, no handoff gap, and
the rule that the outside sentinel cannot be authorized while the selected
task remains occupied.

Both projections have their own typecheck, collected positive and negative
tests, sampled invariant/witness run, and complete finite-state verification
without an arbitrary depth token. They share the canonical model's maintainer,
accepted scenario, gate, and future conformance seam. They are proof artifacts,
not implementation inputs or alternate behavior sources.

### Canonical state refinement

The projection relation is explicit so a smaller state graph cannot silently
change the subject being proved.

| Canonical state or fact | Capacity/order projection | Continuity/handoff projection |
| --- | --- | --- |
| `Unoccupied`, graph-entry-capable, and no existing responsibility | The same A-E task is `Candidate` | The selected task is `Candidate`; other tasks are represented only by the outside sentinel |
| `FreshEntryReserved` | The same task is `Occupied` | `EntryReserved` |
| `FreshTaskCommitted(ClaimIntentRecorded)` | `Occupied` | `ClaimIntentRecorded`; accepted-but-unobserved append is the separate unknown state with Journal presence `Present` |
| `FreshTaskCommitted(ClaimRequestCalled)` | `Occupied` | `ClaimRequestCalled`; a proof-only lost-response refinement enters `ClaimOutcomeUnknown` with exact, foreign, absent, or unreadable tracker authority |
| `FreshTaskCommitted(ClaimOwned)` | `Occupied` | `ClaimOwned` |
| `FreshTaskCommitted(PostClaimGraphKnown)` | `Occupied` | `PostClaimGraphKnown` |
| `FreshTaskCommitted(SpecificationKnown)` | `Occupied` | `SpecificationKnown` |
| `FreshTaskCommitted(AttemptPlanned)` | `Occupied` | `AttemptPlanned` with the exact immutable attempt and Base SHA lineage |
| `FreshTaskCommitted(WorktreeIntentRecorded)` | `Occupied` | `WorktreeIntentRecorded` with exact lineage |
| `FreshTaskCommitted(WorktreeRequestCalled)` | `Occupied` | `WorktreeRequestCalled`; a proof-only lost-response refinement enters `WorktreeOutcomeUnknown` and retry authorization with Git authority |
| `FreshTaskCommitted(WorktreeReady)` plus `AcceptedExactWorktreeReady` evidence | `Occupied` | `WorktreeReady` with the same exact attempt, Base SHA, and locator lineage; an unknown responsibility append refines it with Journal presence |
| `ExactAttemptHeld` | `Occupied` | `ExactAttemptHeld` with the same exact lineage |
| `ExistingResponsibilityReserved` | `ExistingReserved`, which consumes capacity | Outside the selected fresh pipeline and therefore stutters |
| Unoccupied `ReadyExistingResponsibility` | `ReadyExisting` | Outside the selected fresh pipeline and therefore stutters |
| Unoccupied `RetainedNotReadyResponsibility` | `RetainedNotReady` | Outside the selected fresh pipeline and therefore stutters |
| `ForeignClaimConstraint` after conclusive rejection before ownership | The same task is `ForeignBlocked`; `graphCandidate` remains descriptive | `PreOwnershipRejected` |
| Primary or next exact claim-operation cycle | Erased after the foreign-blocked task returns to candidate | Preserved as a distinct new-cycle boundary; the rejected operation is never retried |
| `PostOwnershipConstrained` continuation constraint | The task remains `Occupied` | `PostOwnershipConstrained`; only #316 may add a later exact disposition |
| Capacity and stable task rank | Preserved exactly | Erased; the selected task plus sentinel checks only continuity-related outside authorization |
| `ProcessUp` or `ProcessDown` and saturating process-loss evidence | Erased except where loss releases a process-local reservation | Preserved as Up/Down; witness flags record first and repeated loss without limiting later crash/recovery cycles |
| Authoritative existing-responsibility order | Preserved as the exact relative ready order | Erased because existing-responsibility scheduling is outside this projection |
| Trace flags and witness counters | Erased except write-only projected violation/witness flags | Erased except write-only projected violation/witness flags; they are evidence, never authority |

### Canonical action refinement

An entry below that says **stutter** means the action changes no fact visible to
that projection; it does not mean that the canonical action is optional or
that the projection has a generic no-op transition.

| Canonical action | Capacity/order projection | Continuity/handoff projection |
| --- | --- | --- |
| `init` | Initialize capacity three and A-E as ordered candidates | Initialize the selected task as candidate, the outside sentinel unauthorized, and the process Up |
| `reserveFreshEntry` | Reserve the same lowest-ranked candidate, subject to current capacity and ready priority | Reserve the selected candidate; authorizing the outside sentinel while occupied is a negative transition only |
| `recordClaimIntent` | Stutter: the task remains occupied | Record the selected task's exact claim intent |
| `loseClaimIntentAppendResponse`; `loseAcceptedClaimIntentAppendResponse` | Stutter: the reservation remains occupied | Enter unknown append outcome with Journal presence `Absent` or `Present` |
| `observeClaimIntentPresent` | Stutter: occupied before and after | Reconcile to recorded intent |
| `observeClaimIntentAbsent` | Release only that pre-intent reservation to candidate | Reconcile to conclusive pre-intent release |
| `callClaimProvider` | Stutter | Record one exact claim request call in `ClaimRequestCalled` |
| `acceptOwnedClaim` | Stutter | Accept exact owned claim authority |
| `rejectForeignClaim` | Move only that task from occupied to foreign-blocked | Record conclusive pre-ownership rejection; the sentinel may become eligible only after release |
| `observeForeignClaimCleared` | Move only that task from foreign-blocked back to candidate | Return the rejected selected task to candidate and select its distinct next claim-operation cycle after an authoritative clearing observation |
| `acceptPostClaimGraph`; `readFocusedSpecification`; `recordAttemptPlan` | Stutter | Advance through the corresponding exact selected-task stages |
| `observePostOwnershipConstraint` | Stutter: the task stays occupied | Enter post-ownership constrained state without release |
| `recordWorktreeIntent`; `callWorktreeBoundary`; `acceptWorktreeReady` | Stutter | Advance through exact worktree intent, `WorktreeRequestCalled`, authority observation, and accepted exact ready-lineage stages |
| Proof-only lost claim/worktree response, owning-system reread, and exact retry refinements | Stutter | Move through outcome-unknown and retry-authorized states; retry is disabled until an authoritative absent observation |
| `loseExecutorResponsibilityAppendResponse`; `loseAcceptedExecutorResponsibilityAppendResponse` | Stutter: the task remains occupied | Enter unknown responsibility append with Journal presence `Absent` or `Present` |
| `observeExecutorResponsibilityAppendPresent`; `handoffToExecutorResponsibility` | Stutter: commitment and held attempt are both occupied | Atomically enter `ExactAttemptHeld`; no unoccupied state exists between them |
| `observeExecutorResponsibilityAppendAbsent` | Stutter: the pre-attempt commitment remains occupied | Return to ready exact worktree without releasing occupancy |
| `releaseHeldPositionNotReady`; `releaseHeldPositionReady` | Move the same task from occupied to retained-not-ready or ready-existing | Enter exact held release; later ready scheduling is outside this projection |
| `reserveReadyResponsibility`; `handoffReadyResponsibility` | Reserve and hand off the same earliest ready existing responsibility | Stutter: existing-responsibility scheduling is outside the selected fresh pipeline |
| `contractCapacity`; `expandCapacity` | Change capacity without evicting occupancy; later reservations use the new value | Stutter: policy size is outside the one-selected-task continuity property |
| `crash` before the first accepted intent | Release the process-local fresh reservation, or an existing-responsibility reservation back to its ready input | Change process to Down and erase only process-local ownership; no durable commitment is reconstructed |
| `crash` after an accepted durable intent or responsibility | Stutter for capacity: the same task remains occupied | Change process to Down while retaining Journal/authority facts; recovery reconstructs the matching commitment or exact held attempt |
| `recover` after process loss | Re-derive candidate/ready input or stutter for retained occupancy | Change process to Up and reconcile from the exact Journal and owning-system facts before retry |
| `step` | Nondeterministic union of only the mapped capacity/order actions above | Nondeterministic union of only the mapped continuity/handoff actions above |

The lost-response, owning-authority reread, and retry-authorized substates that
the continuity proof makes explicit are refinement detail owned by the existing
provider protocols, not new production stages. The canonical model now keeps
the exact claim-request and worktree-request calls inside its closed commitment
sum rather than consulting trace instrumentation as authority. Conversely, a
capacity stutter deliberately hides claim/specification/plan/worktree progress
because none changes occupancy.

### Exact limitations

- Neither projection proves its own correspondence to TypeScript. The
  production-backed conformance adapter and scenario tests own that link.
- The capacity/order projection proves task identity and admission policy but
  not exact provider chronology, lineage, ambiguity, or crash reconstruction.
- Foreign-claim clearing returns the task to candidate status as a new logical
  cycle. The canonical model selects a distinct next claim-operation identity;
  the proof records only that it is a new cycle. The claim protocol and the
  production conformance test must prove the concrete generated identity is
  fresh and that the rejected operation is never retried.
- The continuity/handoff projection proves one selected task against one
  outside authorization sentinel but not five-task ranking, concurrent
  completion permutations, or aggregate capacity policy.
- Tracker graph construction, provider retry bounds, Git worktree correctness,
  executor Begin and later position lifetime, integration, finality, and Run
  termination remain in their existing models and tests. The projections
  consume only typed outcomes relevant to admission.
- #315 proves safety, not eventual progress. A post-ownership constraint stays
  occupied; #316 owns the future exact cleanup/relinquishment protocol and its
  liveness evidence.
- If the first claim-intent append returns an ambiguous result and the exact
  record did not land, #315 keeps that process-local admission occupied until
  restart. A later Journal position or omission from the published prefix is
  not exact absence evidence: another append may have advanced the prefix
  before the ambiguous append acquired the serialized writer. Safe in-process
  release requires a future typed, authoritative observation of the exact
  record key, causally after that append has settled, which the current
  in-Run Journal read does not provide. Issue #318 owns that liveness gap; it
  is not permission to reopen capacity in #315.
- No formal artifact requires a strict total order for independent boundary
  completions. The #268 controlled tracer must accept legal causal
  interleavings and is not a model input.
- The finite projections do not persist a queue, graph placement, capacity
  snapshot, semaphore token, provider cache, or workflow authority. Their
  collapsed states are verification-only observations.
