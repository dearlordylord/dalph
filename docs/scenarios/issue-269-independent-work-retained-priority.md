# Admit independent work while preserving an exact retained attempt

Owning issue: [#269](https://github.com/dearlordylord/dalph/issues/269)

Status: complete and composed on `integrate/issues-264-268` through exact
commit `a1b81c4fbcd189d62b480d6e637c62278ca7b829`; issue #269 is closed. This
scenario's full-capacity handoff refinement below is accepted for repair on
`work/issue-269-admission-stalled-quiescence` before #268 composition. It does
not add a durable queue, another capacity counter, or task-ID authority over an
exact planned attempt.

## Governing behavior

[Issue #265's restart attachment](issue-265-passive-executor-observation-through-restart.md#a-later-dalph-process-reattaches-to-the-exact-codex-attempt)
keeps unfinished exact attempts observable without sending another work
command. [Issue #266's active-work refresh](issue-266-active-work-authority-refresh.md#alice-changes-b-while-a1-b1-and-c1-execute-autonomously)
keeps tracker and Git reads separate from executor positions. Issue #269
composes those facts with [D12 Position discipline](../DELIVERY-INVARIANTS.md#admission-and-capacity):
read-only restart obligations consume no task-work position, while an exact
attempt selected for `Continue` retains priority over fresh work at the next
available position.

The tracker continues to own task identity and current instructions. The
Journal and reconstructed planned-attempt protocol identify the exact
`(RunId, AttemptId)` selected for `Continue`. A task ID alone cannot transfer
that retained position to replacement work.

## Read-only restart obligations do not block independent D

### Starting situation and trigger

No person triggers an individual boundary call. A previous Dalph process ended
while exact attempts A1 and C1 remained unfinished. The Journal reconstructs
their exact planned-attempt responsibilities and requires current executor
projection reads. Neither obligation requests `Begin`, `Resume`, or
`Suspend`, so neither requires a task-work position. The executor owns A1's and
C1's current projections. Git and the tracker have no mutation to perform for
these reads.

Independent task D is open, unclaimed, free of unfinished prerequisites, and
has no planned attempt. The latest accepted tracker graph and the ordinary
fresh-work protocol make D's exact current-graph/claim step eligible. One
task-work position is free.

### Ordered boundary calls and result

1. Dalph starts A1's and C1's exact passive executor reconciliation reads. Both
   may remain in flight. These operations call only the executor's projection
   boundary; `Begin`, `Resume`, tracker mutation, and Git do not apply because
   each operation is reconciling already-issued exact executor work.
2. While those reads remain in flight, Dalph reserves the free task-work
   position for D's ordinary fresh pipeline and starts D's tracker boundary
   call.
3. Each returned executor projection is published only through the existing
   exact planned-attempt protocol. D continues only through its own recorded
   tracker and Git evidence.

The operator can observe D start while A1 and C1 are still being read. Dalph
must not count either read-only obligation as executing work, wait for those
reads before admitting D, send another executor work command, or use A1's or
C1's evidence for D.

If Dalph dies while a read is unresolved, its process-local owner disappears
and ordinary journal-first recovery reconstructs that exact obligation. If it
dies while D's boundary effect is ambiguous, ordinary intent/reconciliation
rules apply. Neither crash creates or persists an admission queue.

### Acceptance-test mapping

- `admits independent D while recovered A and C perform read-only restart
  obligations` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`
  holds both exact executor reconciliation proposals open, proves they require
  no task-work position, and proves D's boundary action starts with capacity
  one.
- `observes safe suspension only after exact suspend intent and releases only
  that attempt` in
  `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts`
  crosses the concrete passive executor projection boundary and makes
  `Begin`, `Resume`, and another suspension request fail the test if called.

## Exact B1 selected for Continue precedes D and replacement B2

### Starting situation and trigger

Alice has selected `Continue` for safely suspended exact attempt B1. Current
tracker, claim, planned-worktree, control, and Git evidence authorizes Resume
for B1, but all task-work positions are initially occupied. The Journal keeps
B1's exact `RunId` and `AttemptId`; no task-ID-only reservation exists.

Independent task D is eligible for fresh work. A same-task replacement B2 is
not authorized to inherit B1's position merely because both refer to tracker
task B. The runtime admission boundary nevertheless treats such a malformed
fresh B proposal fail-closed if one reaches it.

An existing attempt has just released one position; another independent
attempt A still occupies the other position in the admission snapshot. No
person performs another boundary call. Publication of that released-capacity
snapshot is the trigger that lets admission proceed.

### Ordered boundary calls and result

1. The responsibility-derived Resume proposal for exact B1 is considered
   before fresh D or any fresh B proposal.
2. Dalph binds the released position to B1's exact attempt correlation and
   sends B1's Resume command through the existing executor protocol.
3. D waits because capacity is full. Replacement B2 also waits. Before any
   attempt exists, the pure frontier admits only one fresh pipeline for a
   tracker task, and that pipeline's next step may reuse the task's temporary
   position. Once B1 exists, the frontier suppresses fresh B work and admission
   independently refuses to treat B1's exact accepted or runtime-bound
   position as a task-ID permit.
4. A later release may admit D through its own evidence. It cannot transfer
   B1's authority to B2.

Alice can observe B1 resume before fresh D. Dalph must not let D pass an
already-selected B1, let B2 use B1's position, collapse B1 and B2 to tracker
task B, or send two executor commands for B1.

If Dalph dies before Resume settles, ordinary exact-command reconciliation
uses B1's `RunId` and `AttemptId`. If it dies after B1's position is bound, the
reconstructed exact attempt retains that position. Restart does not persist or
restore a separate ordering queue; the responsibility-first frontier and exact
position correlation derive the same decision again.

### Acceptance-test mapping

- `projects Alice's exact Continue choice and current facts as Resume for the
  retained attempt` in
  `packages/orchestrator/src/coordination/run/recovery-activation.test.ts`
  starts from the accepted exact choice plus tracker, claim, worktree, and
  lineage facts and projects Resume with B1's exact `RunId` and `AttemptId`.
- `preserves existing A ahead of fresh C without consulting live positions` in
  `packages/orchestrator/src/coordination/delivery/delivery-proposal.test.ts`
  proves responsibility-derived work precedes fresh work before runtime
  capacity is consulted.
- `gives retained B1 the released position before D and rejects uncorrelated B
  replacement work` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`
  begins with both positions occupied, publishes the real relation snapshot
  after one position is released, and proves only B1 starts ahead of fresh D
  and malformed fresh B2.
- `resumes only from accepted safe work and the exact current tracker and Git
  facts` in
  `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts`
  crosses the concrete executor boundary and proves its complete Resume-request
  list contains exactly one request whose planned attempt carries B1's exact
  `RunId` and `AttemptId`; therefore no B2 or duplicate Resume is sent.
- `does not let uncorrelated replacement work reuse the exact retained attempt
  position` in
  `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts`
  proves the admission boundary rejects task-ID-only reuse while preserving
  B1's exact correlation.
- `reconciles existing, pending, and integration-backed admission positions`
  in the same file proves an uncorrelated fresh step may still reuse its own
  task's temporary pre-attempt position, while exact-bound reuse requires the
  matching correlation.
- `keeps a retained task out of fresh eligibility while independent work
  remains eligible` in
  `packages/orchestrator/src/coordination/frontier/frontier.test.ts` proves the
  production frontier cannot send a fresh same-task pipeline to admission while
  exact B1 remains a responsibility.
- `reopens Continue and performs fresh reads before admitting the same attempt`,
  `records both task fingerprints when Alice continues the exact attempt`, and
  `coalesces exact Continue redelivery and rejects request identity reuse` in
  `packages/dalph/test/cassettes/scenario.test.ts` prove the maintained
  changed-work chronology: one causal exact choice, bounded fresh authority
  reads, one immutable attempt, and no duplicate choice on redelivery.

Original closure evidence: every direct mapping above is green. The #269 full repository
gate passed before composition, and the combined #267/#269 focused suites
passed 194/194 tests at integration tip `a1b81c4fb`. Independent standards
review found no runtime or architecture interaction between exact retained
position admission and #267's exact passive lifecycle publication.

## Full capacity yields to one queued active refresh without losing D or E

### Starting situation and trigger

No person directly triggers this handoff. The running coordinator has capacity
for three task attempts. Exact attempts A1, B1, and C1 are executing in the
executor and hold all three positions under their exact `RunId` and
`AttemptId` correlations. Exact attempts D1 and E1 have prepared worktrees and
their current delivery proposals require `ReserveOrReuse`, but neither has an
available position and neither has received an executor command.

The activation that admitted A1, B1, and C1 has no local delivery-action owner
left: their executor sessions now own the unfinished work. While that
activation is still running, the coordinator's sole reactivation owner receives
a tracker notification and timer hint. The hints wait outside the activation;
they do not start another scheduler or graph-read protocol. The tracker has G1
available when the queued refresh eventually reads it. Git, claims, and a
person's command do not change at this handoff.

### Ordered runtime handoff and result

1. The ordinary delivery runtime sees A1, B1, and C1 holding all capacity, D1
   and E1 still present as exact position-gated proposals, and no local action
   owner able to release a position.
2. Instead of waiting for an event that only the outside executor or a later
   activation can supply, the runtime returns
   `TaskWorkAdmissionStalledRuntimeQuiescence`. That descriptive result keeps
   D1 and E1's proposals and every held exact-attempt correlation intact.
3. Stabilization reports `RunMustRemainActive` immediately. It does not issue a
   post-quiescence G2 tracker read because the non-empty retained frontier is
   already proof that this Run is not final.
4. The same sole reactivation owner completes that activation, coalesces the
   queued notification and timer, and starts exactly one trailing active-work
   refresh. That activation performs the ordinary journal-first tracker read
   and accepts G1; it never overlaps the first activation.

The operator sees the Run remain active and later react to G1. Dalph must not
erase D1 or E1 to fabricate an empty frontier, mark the Run terminal, issue a
G2 read before yielding, start a concurrent activation, create a second
scheduler or read authority, change configured capacity, or send D1/E1 an
executor command without a position.

If Dalph dies before returning the descriptive result, process-local ownership
disappears and ordinary journal-first restart reconstructs the same held and
prepared facts. If it dies after returning but before consuming the hint, a
fresh sole owner obtains current durable facts; no durable hint or admission
queue is invented. Retrying either activation reuses exact attempt identities
and must not duplicate an executor command.

### Acceptance-test mapping

- `returns admission-stalled quiescence with the blocked proposals when exact
  attempts hold all ordinary capacity` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`
  proves steps 1 and 2.
- `does not report admission-stalled quiescence while a local owner can finish
  or for work that needs no task position` in the same file proves that only
  the concrete capacity boundary yields this result.
- `reuses a full-capacity position for its matching exact prepared attempt`
  proves that a retained exact correlation remains admissible rather than
  being mislabeled as stalled.
- `does not classify fresh work without an exact planned-attempt protocol as
  admission-stalled` proves this handoff does not become a general fresh-work
  capacity policy.
- `returns RunMustRemainActive without G2 when task-work admission is stalled`
  in `packages/orchestrator/src/coordination/run/run-stabilization.test.ts`
  proves step 3 and the preserved non-empty frontier.
- `runs one queued active refresh after admission-stalled delivery yields`
  in `packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts`
  proves step 4's single trailing activation and maximum concurrent activation
  count one.
- `active-work refresh recovers ordinary authority reads without a private
  refresh protocol` in
  `packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts`
  remains the governing #266 evidence that the trailing activation performs
  G1 through the ordinary journal-first tracker read protocol.

## Unchanged passive attachment does not hide the full-capacity handoff

### Starting situation and trigger

No person triggers this composition. Capacity is three and exact attempts A1,
B1, and C1 are executing and hold all three positions. Restart reconstruction
produces one exact passive `Observe` proposal for each attempt. Exact prepared
attempts D1 and E1 are also present as `ReserveOrReuse` proposals, but neither
has a position and neither has received `Begin`. An already-recorded ordinary
tracker-read intent for independent task F also has one exact
`ObserveResponsibleTaskClaim` proposal. No Git lineage, ref, or worktree fact
changes in this scenario because none of these actions crosses a Git boundary.

The ordinary activation starts the three executor projection reads. Each read
finds the same already-accepted `Executing` report, attaches that exact
attempt's process-local passive observer, and returns
`UnchangedPassiveObservation`. While those reads settle, the task tracker
returns `UnclaimedTask` for F. The ordinary journal-first tracker-read protocol
accepts that exact result as `TaskTrackerFactsObserved` at the next Journal
position and removes F's completed read proposal. Production delivery-relation
assembly preserves the exact A1–E1 proposal identities. F's publication is not
evidence that A1, B1, or C1 needs another projection read.

### Ordered runtime handoff and later passive change

1. Dalph calls the executor projection boundary exactly once for A1, B1, and
   C1. Each call attaches one process-local passive owner and sends no `Begin`,
   `Resume`, or `Suspend` command.
2. Dalph remembers within this activation that each exact `Observe` proposal
   already has its passive owner attached. Unlike an action deferred while it
   waits for changed accepted facts, an unrelated accepted ordinal does not
   erase that marker while the exact proposal remains present. If current task
   grouping facts causally refresh the proposal identity while the projection
   read is still settling, the marker follows the current `Observe` proposal
   for the same exact run and attempt; Dalph removes the settled old owner.
3. Admission excludes the three locally attached `Observe` proposals from the
   remaining frontier. With only exact blocked D1 and E1 left, the ordinary
   runtime returns `TaskWorkAdmissionStalledRuntimeQuiescence`, preserving D1,
   E1, and the held A1/B1/C1 correlations. D1 and E1 receive no executor call.
4. Later the passive owner for one exact attempt, B1, observes `Safe` or a
   terminal executor result. It publishes that exact report at the next
   Journal ordinal. Only B1's held position is released; A1 and C1 remain held.
5. If a new Dalph process starts, the old process-local attachment marker does
   not survive. Restart reconstruction may call each still-required exact
   `Observe` boundary once and attach fresh passive owners.

The operator sees Startup return control instead of repeatedly rereading A1,
B1, and C1. Dalph must not treat an unrelated Journal advance as permission to
reattach the same observer, persist attachment markers, remove D1 or E1, send
either blocked attempt an executor command, release A1 or C1 when B1 changes,
recreate a marker after its proposal disappears while an observation settles,
leave a settled old owner blocking its causally refreshed proposal, or broaden
the full-capacity classifier to non-exact work.

If Dalph dies, all activation-local markers and passive owners disappear. A
fresh activation reconstructs exact obligations from the Journal and may
reattach. If an `Observe` action is genuinely deferred before attachment, its
accepted-ordinal marker remains the existing wait-for-changed-facts rule and
may clear when accepted facts change. The two outcomes are not interchangeable.

### Acceptance-test mapping

- `keeps exact passive attachments across unrelated accepted facts and returns
  blocked D and E as admission-stalled` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`
  proves steps 1–3, validates F's exact tracker-read intent and
  `TaskTrackerFactsObserved` outcome as canonical Journal history, feeds that
  concrete publication through production delivery-relation assembly, checks
  exact one-call counts and preserved A–E identities, and makes no D/E executor
  call.
- `moves a passive-attachment marker across an in-flight route refresh and
  removes it on disappearance` in the same file derives two production-valid
  Fresh `Observe` routes for the same exact attempt, proves the refreshed route
  inherits the attachment without a second boundary call or settled old owner,
  and proves disappearance prunes the marker so a later exact proposal is not
  hidden.
- `waits for changed accepted facts after unchanged reconciliation instead of
  retaining an attachment` in the same file proves that a non-attaching
  unchanged `Reconcile` remains excluded at the same accepted Journal position
  and becomes runnable after accepted facts change.
- `observes live terminal executor change once and releases the exact position`
  and `observes safe suspension only after exact suspend intent and releases
  only that attempt` in
  `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts`
  provide the vertical executor-lifecycle, serialized Journal publication,
  ordinal, and exact position-release evidence for step 4.
- `restart reprojects the exact executing attempt once then reattaches without
  Begin` in `packages/dalph/test/scenarios/production.test.ts` proves step 5
  through the production restart composition. `recovers process death before
  terminal publication by reprojecting and accepting terminal once` in the
  bootstrap file remains the terminal-at-restart control.
- Existing `settles one unchanged passive observation owner without
  re-admission or successor permission` and `admits an independently proposed
  suspension after one unchanged passive observation` remain the local
  one-proposal and independent-successor controls.
