# Issue 315: preserve bounded admission until executor-work handoff

Status: accepted product invariant; scenario and formal type shape under review

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
Existing ready responsibilities are considered before fresh entry. D and E can
remain pure proposed actions, but runtime cannot admit, materialize, or perform
them.

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
3. accepted focused task-work specification;
4. immutable attempt plan recorded;
5. worktree-reconciliation intent without outcome;
6. exact planned worktree ready;
7. `PlannedAttemptExecutorWorkResponsibilityBegan` accepted before the Begin
   command intent.

After each restart, Dalph reduces the complete Journal history. The first six
prefixes reconstruct A as occupying one pre-attempt admission; the seventh
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
action proposals. A delivery action proposal remains a pure description. An
opaque fresh-task admission decision is required before runtime can materialize
an operation and establish delivery live action ownership.

## Acceptance-test mapping

| Scenario | Concrete result | Required test seam |
| --- | --- | --- |
| Three enter; two remain outside | A/B/C may cross every pre-Begin boundary; D/E cross none | Production-algebra acceptance test over A-E at capacity three; proposal/admission unit tests |
| Independent response order | Legal A/B/C completion permutations preserve the same admitted subjects | State-machine/property test with controlled response readiness |
| Executor-responsibility handoff | C changes from pre-attempt commitment to exact held position without a capacity gap | Admission-controller test that observes no fourth authorization at the handoff |
| Confirmed foreign claim | Exact rejection ends only A; D alone can enter; foreign claim is untouched | Journaled claim-conflict acceptance test plus admission projection test |
| Ambiguous claim | Exact A retry/reconciliation retains occupancy; D/E remain denied | Existing claim-protocol fixtures composed with the admission controller |
| Later ambiguous boundary | Failed reads/appends and ambiguous worktree creation retain A and create no duplicate | Prefix tests at graph/specification/plan/worktree boundaries |
| Restart prefixes | Prefixes 1-6 reconstruct pre-attempt occupancy; prefix 7 reconstructs exact held occupancy | Table-driven Run-establishment/conformance test over all seven prefixes |
| B releases | With no ready Resume responsibility, accepted Safe or Terminal evidence admits D alone | Production-algebra acceptance test while B remains tracker-open |
| Contraction | Existing occupancy is retained; no entrant at or above the new ceiling | Generated capacity/admission property test |
| Expansion | Exactly the next free-capacity prefix enters | Generated capacity/admission property test |
| Invalid states | Outside authorization, overlap, duplicate occupancy, over-ranked entry, and gap handoff cannot be constructed | Schema/constructor tests and Quint invariants with negative controls |
| End-to-end return | The cassette-free #268 C2b tracer passes DS-01/DS-02 without a strict cursor | Existing controlled tracer on the exact integrated candidate |

Focused #54, #193, and #264 through #269 tests remain regression requirements.
Aggregate test totals do not replace this mapping.

## Formal ownership and limitations

A new governed subject model owns fresh-task admission accounting from
process-local entry reservation through durable commitment and exact
executor-responsibility handoff or conclusive pre-ownership rejection. The
`runActivation` model continues to own Run establishment and the
`plannedAttemptExecutor` model continues to own Begin and exact attempt-position
lifecycle after the handoff. The new executable conformance adapter must invoke
the real production planning/admission/runtime decision seam. A research-only
model or an abstraction bound to no code is insufficient.

The model does not own tracker graph construction, claim-provider internals,
Git worktree correctness, executor lifecycle internals, integration admission,
or Run termination. It consumes their typed observations only where they
change admission occupancy. Post-ownership pre-Begin relinquishment is retained
fail-closed and deferred to #316. It models independent boundary results as
unordered choices unless an accepted causal rule requires an order.
