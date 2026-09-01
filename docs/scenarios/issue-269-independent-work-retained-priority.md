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

## An accepted C position closes capacity before the relation lists it

### Governing behavior

The [full-capacity handoff above](#full-capacity-yields-to-one-queued-active-refresh-without-losing-d-or-e)
requires the ordinary runtime to preserve exact blocked D1 and E1 when no
local action can free a position. [D12 Position
discipline](../DELIVERY-INVARIANTS.md#admission-and-capacity) requires admission
to respect every position currently held by unfinished exact work, while [D29
Authority separation](../DELIVERY-INVARIANTS.md#process-and-durability) keeps
derived positions process-local and out of workflow history. At the formal
abstraction, `deliveryCore.qnt`'s `positionDiscipline` and `admissionRule` laws
require positions to follow outstanding work and prevent admission past
capacity. That model does not represent the short in-process interval in which
the runtime's admission controller has bound a newly accepted exact position
but the descriptive relation still lists the earlier held-position prefix.

This scenario refines only quiescence during that interval. It does not make
the admission controller a durable or outside authority, replace the delivery
relation, add a second capacity counter, or let process-local state authorize
an executor command. It requires the ordinary runtime to take one typed
snapshot of the admission state it already owns before deciding whether its
own denied proposals can make progress.

### Starting situation and trigger

No person directly triggers this handoff. One ordinary activation has capacity
three. Its current delivery-relation evaluation lists exact executing attempts
A1 and B1 as holding two positions. Exact prepared attempts C1, D1, and E1 each
have a `Begin` proposal that requires `ReserveOrReuse`; none has previously
received `Begin`.

The same activation reserves the one free position for C1. Immediately before
entering C1's exact planned-attempt protocol, it binds that reservation to
C1's exact `(RunId, AttemptId)`. The exact journal-first and executor chronology
is ordered below. Once the protocol accepts C1's executing response, the local
exact binding remains after C1's action settles. The latest descriptive
relation evaluation available to this runtime still lists only A1 and B1 in
`taskWork.held`. Because the admission controller already has A1, B1, and bound
C1 at capacity three, it denies D1 and E1 with
`TaskWorkPositionUnavailable`.

The activation also obtains the exact executor projections required for A1,
B1, and C1. Each returns the already-accepted `ExecutorWorkExecuting` report,
installs its process-local passive attachment, and settles its delivery-action
owner. The concrete trigger for the decision below is settlement of the final
one of those owners: no live action remains, D1 and E1 are still denied, and no
outside event queued inside this runtime can free a position.

Git, the tracker, claims, refs, and worktrees do not change at this handoff.
No additional executor call applies because D1 and E1 were denied before their
action boundary, while A1, B1, and C1 have received their one exact projection
call and C1 has also received its one `Begin`.

### Ordered runtime handoff and result

1. While holding the runtime's existing selection boundary, Dalph reserves the
   third position and binds it to C1's exact `(RunId, AttemptId)` before it
   enters the planned-attempt protocol.
2. The protocol first records
   `PlannedAttemptExecutorWorkResponsibilityBegan`, then records C1's exact
   `PlannedAttemptExecutorCommandIntended(Begin)` intent. The intent exists
   before Dalph crosses the executor boundary.
3. Dalph calls the executor boundary once for that exact C1 `Begin`. The
   executor returns C1's exact `ExecutorWorkExecuting` response; the response
   by itself is not yet accepted workflow evidence.
4. The protocol records the exact response as
   `PlannedAttemptExecutorCommandResponseObserved` and accepts its distinct
   lifecycle transition as `PlannedAttemptExecutorWorkReported`. The runtime's
   accepted-publication boundary then proves that the relation has published
   through that accepted Journal prefix before it enqueues C1's completion.
5. The runtime applies that completion once and settles C1's delivery-action
   owner only after its latest evaluation has consumed the accepted prefix. If
   the completion wins the queue first, the publication-through barrier keeps
   the exact owner until the matching `EvaluationChanged` is applied. A1, B1,
   and C1 each retain their process-local passive attachment after their exact
   projection returns, so settling the last of those three owners leaves no live
   action. C1's bound admission position remains because
   `ExecutorWorkExecuting` is unfinished; D1 and E1 remain denied.
6. Still within the runtime's existing selection boundary, Dalph reads one
   typed snapshot from its admission controller. That snapshot contains the
   accepted exact A1 and B1 positions plus C1's exact bound runtime position;
   it is the state that just denied D1 and E1.
7. Dalph reconciles the snapshot with the current descriptive evaluation for
   this quiescence decision. The effective task-work basis has capacity three
   and the exact A1, B1, and C1 correlations. The earlier relation value remains
   unchanged and no admission-derived fact is written to the Journal or any
   other store.
8. The ordinary runtime classifies the remaining exact D1 and E1
   `ReserveOrReuse` proposals as
   `TaskWorkAdmissionStalledRuntimeQuiescence`. The result reports the exact
   effective A1/B1/C1 correlations and preserves D1 and E1 as its non-empty
   proposal frontier.
9. Stabilization returns `RunMustRemainActive` with reason
   `RunnableTransition` without issuing G2. The sole reactivation owner may
   then process its already-queued notification or timer as the later
   activation described by the full-capacity scenario.

The operator can observe the activation return while the Run remains active.
Dalph must not claim that one position is free merely because the descriptive
relation has not yet listed C1, invent a live delivery-action owner for C1,
persist or publish the admission snapshot as workflow authority, admit or call
D1/E1, drop D1/E1 to fabricate an empty frontier, or report only A1/B1 as the
positions that caused the stall.

If Dalph dies after binding C1's position but before recording C1's durable
responsibility and `Begin` intent, the process-local position disappears and
restart may admit the same prepared C1 again through the ordinary exact
protocol. If it dies after the intent but before recording and accepting the
executing response, restart reconciles C1 with the executor before another
command; it does not restore the admission snapshot. If Dalph dies after the
response and lifecycle transition are accepted but before C1's owner settles
or before this quiescence result, restart reconstructs C1's unfinished exact
responsibility from Journal history and current executor evidence, then derives
its position again with A1 and B1. If Dalph dies after returning, the later sole
activation performs the same ordinary reconstruction. In every case D1 and E1
remain prepared but unbegun, and retry must not duplicate a journaled C1
`Begin` intent.

The typed admission snapshot is an internal process-local value, but that
TypeScript boundary alone does not prove that no adapter persisted it.
Acceptance therefore requires all three observable boundaries below: the
relation's `taskWork.held` remains at A1/B1 while the result reports A1/B1/C1,
the Journal gains no record while snapshot reconciliation and quiescence return
run, and a new process with a new admission controller reconstructs C1 only
from its durable exact responsibility and accepted executor lifecycle history.
No serialized snapshot or admission-state variant may be supplied to restart.

### Acceptance-test mapping

- Add `binds C before its journal-first Begin and returns admission-stalled
  from the effective admission snapshot` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`.
  The direct test must begin with only A1/B1 in the relation basis, admit and
  bind C1, record its responsibility and exact `Begin` intent before the one
  executor call, record and accept the exact executing response before owner
  settlement, leave the relation basis unchanged, and settle all three passive
  observations. It must assert one C1 `Begin`, one exact A1/B1/C1 projection,
  no D/E call, exact A/B/C correlations in the typed result, and a D/E-only
  frontier. It must use explicit Effect synchronization rather than time or
  scheduler order.
- Add `does not journal or publish the process-local admission snapshot` to the
  same direct runtime suite. Starting after C1's accepted-publication boundary
  returns and before the final owner settles, it must record the exact Journal
  length and relation-publication history, settle the final owner, and assert
  that neither boundary changes while the runtime reads the snapshot and returns
  `TaskWorkAdmissionStalledRuntimeQuiescence`. The unchanged relation must still
  list A1/B1 while the typed result reports A1/B1/C1. Asserting only that an
  admission-snapshot type is absent from a public union is supporting structure,
  not sufficient acceptance evidence.
- Add `restart reconstructs three unfinished task positions without an
  admission snapshot` in
  `packages/orchestrator/src/control/task-work-capacity.test.ts`. It must discard
  the original admission controller, construct a fresh recovery/controller
  layer from the Journal, and assert exact A1/B1/C1 positions derived from
  `PlannedAttemptExecutorWorkResponsibilityBegan` plus the accepted lifecycle
  history that contains no Safe or Terminal release. Its exact accepted event
  list must contain no quiescence or admission-snapshot record.
- `reconciles existing, pending, and integration-backed admission positions`
  in `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts`
  remains supporting evidence that synchronization preserves a locally bound
  exact position rather than replacing it with a stale accepted position.
- `returns admission-stalled quiescence with the blocked proposals when exact
  attempts hold all ordinary capacity` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`
  remains supporting evidence for the typed D/E-only result once all three
  exact positions are already present in the relation basis.
- `emits the exact DS01 through DS13 delivery checkpoint table` in
  `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts`
  is the required vertical acceptance test: at this exact handoff it must
  consume `CoordinatorActivationReturned(RunMustRemainActive,
  RunnableTransition)` before the later G1 read begins.

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
   grouping facts causally refresh the proposal identity either while the
   projection read is still settling or after its publication-through
   completion has installed the marker, the marker follows the current
   `Observe` proposal for the same exact run and attempt. Dalph removes the
   settled old owner, and a still-live independent read keeps the activation
   open long enough to consume that later relation evaluation. A changed-facts
   deferral remains bound to its exact proposal identity and accepted Journal
   position; it does not follow a refreshed route. A passive marker is dropped
   when the refreshed frontier has no available proposal for that same live
   action, including an ownership-conflict frontier.
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
- `keeps three publication-through passive attachments across a
  post-completion route refresh` in the same file stages A1, B1, and C1
  completions until their accepted publication is applied, waits until all
  three passive markers replace their settled owners, then refreshes all three
  proposal identities while an independent read remains live. It proves one
  executor call per `Observe`, no D1/E1 call, and an exact D1/E1-only
  `TaskWorkAdmissionStalledRuntimeQuiescence` result.
- `derives a passive-attachment marker live-action key from its proposal` in
  the same file proves the classifier cannot pair an action result and proposal
  with a separately supplied, mismatched stable key.
- `does not transfer an accepted-facts deferral to a refreshed live-action
  proposal` in the same file proves the changed-facts marker remains bound to
  its old exact proposal ID even when the replacement has the same stable live
  action key and the accepted Journal position is unchanged.
- `drops a passive marker when the refreshed live action is
  ownership-conflicted` in the same file proves a conflict cannot inherit or
  preserve the activation-local passive attachment marker.
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

## Accepted graph progress cannot strand the next task-specification reads

### Governing behavior

[Issue #193's persistent live-request scenario](issue-193-run-reactive-delivery-actions.md#one-persistent-github-claim-proposal-starts-one-live-request)
requires the ordinary accepted publication to remove a settled owner before an
independent successor starts. [Issue #194's G2 handoff](issue-194-stabilize-each-run.md#g2-is-requested-only-after-g1-is-quiescent-and-reveals-b)
requires work from an accepted later graph publication to reach the runtime
even when that publication precedes the runtime phase's subscription. This
scenario preserves both rules and refines only their shared in-process
relation-to-runtime handoff: it adds no action, retry, authority read, or
durable fact.

[D33 No silent drop and D34 Quiescence is not
completion](../DELIVERY-INVARIANTS.md#progress) require accepted work not to be
silently dropped and forbid quiescence while an admitted owner remains. At the
formal abstraction, [`deliveryCore.qnt`'s `everyBegunSettles`
law](../../research/verification-bakeoff/quint/deliveryCore.qnt) constrains the
no-silent-drop outcome; that model deliberately does not represent
in-process graph/planning publication pairing. The executable `runs work
published after G2 before phase two subscribes` scenario in
[`run-stabilization.test.ts`](../../packages/orchestrator/src/coordination/run/run-stabilization.test.ts)
governs the current-first later-publication handoff. The direct consistency
test below owns exact graph/planning pairing within one stable publication.

### Starting situation and trigger

No person triggers this relation handoff. Dalph has established tracker graph
G0 for independent open tasks A through E and has recorded each task's claim.
As capacity permits, the ordinary runtime creates and holds one exact local
owner for each admitted post-claim graph read. Those reads settle in causal
order while the Journal accepts their intents and results. The executor, Git,
and the tracker perform no additional mutation at this boundary: the concrete
trigger is acceptance of a post-claim graph-read result that changes the
Journal position and therefore the delivery planning publication.

### Ordered relation and runtime handoff

1. The reactive delivery relation publishes the accepted Journal facts, the
   established G0 projection, and the action requirements derived from that
   same publication.
2. While holding the existing publication-consistency boundary, the runtime
   adapter reads the current established-graph consequences and the current
   planned-action frontier. The planning read returns its current value even
   when no later planning change occurs; it does not wait for a future
   publication merely because this is a fresh subscription.
3. If another post-claim result is accepted while that ordered adapter is
   working, its publication remains queued behind the first one. After the
   first evaluation is emitted, the adapter emits the later coherent
   evaluation rather than starving the queue.
4. Once all five post-claim reads are accepted, the later evaluation contains
   the five exact `ReadTaskWorkSpecification` proposals. The runtime removes
   the settled graph-read owner and may select A's specification read first.

The operator sees delivery continue from G0 into task-specification reads.
Dalph must not leave a settled post-claim graph owner waiting forever, combine
the graph from one publication with planned actions from another, discard the
later accepted publication, or make action completion perform a second
authoritative relation read to conceal a blocked planning signal.

There is no separate crash or retry rule at this projection boundary. A process
death discards the in-memory subscription, and the normal restart activation
opens a fresh current-first subscription from durable Journal facts.

### Acceptance-test mapping

- `emits every accepted stable publication after repeated current planning
  samples` in
  `packages/orchestrator/src/coordination/delivery/delivery-evaluation-consistency.test.ts`
  advances a production-shaped coherent signal through the previously blocked
  Journal position and one later publication, then proves that graph and
  action planning stay paired and arrive in order without queue starvation.
- Downstream #268 blocking edge: `emits the exact DS01 through DS13 delivery
  checkpoint table` in
  `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts`
  is pending on the #268 composition and is not claimed as passing evidence on
  this repair branch. Once composed, it supplies the vertical five-task
  chronology: all post-claim graph reads settle, A through E reach their
  specification reads, and the story continues through the remaining delivery
  checkpoints.

## An action owner remains live until its accepted successor frontier reaches the runtime

### Governing behavior

[Issue #193's persistent live-request scenario](issue-193-run-reactive-delivery-actions.md#one-persistent-github-claim-proposal-starts-one-live-request)
requires a settled action to leave one exact owner and lets its accepted
successor start. [The accepted graph-progress scenario above](#accepted-graph-progress-cannot-strand-the-next-task-specification-reads)
requires every coherent accepted publication to reach the runtime without a
second relation read. This scenario preserves both rules and refines the exact
ordering between them: the runtime may settle the predecessor only after it
has consumed the accepted publication named by the proof it obtains after the
executor action returns its ordinary result.

[D33 No silent drop and D34 Quiescence is not
completion](../DELIVERY-INVARIANTS.md#progress) prohibit losing successor work
or claiming quiescence while its predecessor still owns a live action. At the
formal abstraction, [`deliveryCore.qnt`'s exact `everyBegunSettles` temporal
law](../../research/verification-bakeoff/quint/deliveryCore.qnt#L622) requires
every begun action eventually to settle. That model deliberately excludes the
activation-local handoff from an executor's ordinary result, through the
runtime's accepted-publication boundary call, to its process-local completion
queue; the runtime tests below govern that finer ordering. This refinement adds
no Journal record, authority read, retry, persisted queue, or scheduling
priority.

### Starting situation and trigger

No person triggers this in-process handoff. Dalph has one exact live owner for
the post-claim graph-read proposal that precedes task A's current
task-work-specification read. The runtime still holds the intent-era evaluation
at Journal position 22; that evaluation does not yet contain A's specification
proposal.

The existing executor action calls the tracker, records its result, and returns
its ordinary result to the runtime while the Journal accepts the relation facts
through position 23. Before enqueueing an action completion, the runtime calls
the existing accepted-fact publication boundary. That boundary waits until
delivery planning publishes one coherent position-23 evaluation containing A's
exact specification proposal, then returns `{ runId, acceptedThrough }`. The
runtime pairs that proof with the ordinary action result and enqueues the
completion. That completion and the evaluation travel through independent
in-process queue offers, so the completion may be taken first even though the
relation has already published position 23.

Git, the executor, claims, and tracker mutations do not apply at this handoff:
the tracker read already returned, and the remaining steps coordinate only the
two process-local notifications that follow its ordinary Journal publication.

### Ordered runtime handoff and result

1. The executor action returns its ordinary result. The runtime then calls the
   accepted-publication boundary, which returns an activation-local proof naming
   the exact Run and Journal position 23 after delivery planning publishes that
   prefix. The runtime pairs the proof with the result before it enqueues the
   completion. That completion already names the exact predecessor proposal;
   the descriptive relation does not copy or validate that identity.
2. If the runtime takes the completion before it takes the position-23
   evaluation, it retains the exact live owner and the child-completion
   acknowledgement. It does not settle the owner, release its reservation,
   admit a successor, report quiescence, or reread the relation.
3. The runtime consumes ordinary queued relation evaluations. An older
   evaluation cannot satisfy the proof. A proof naming another Run or a result
   naming another proposal fails the activation closed rather than settling
   either owner.
4. When the runtime applies the coherent position-23 evaluation, it applies
   the retained completion exactly once: the predecessor owner settles once,
   the child is acknowledged once, and A's exact specification proposal is
   admitted once from that evaluation.
5. A later accepted empty evaluation at position 24 removes A's settled
   specification owner and permits ordinary quiescence. Position 23 alone is
   not silently rewritten into an empty frontier.

The operator sees delivery continue into A's specification read instead of an
early incomplete return. Dalph must not depend on queue offer order, polling,
sleeping, an extra relation read, a copied graph cache, a persisted barrier, or
a second revision authority. It must not acknowledge the predecessor child or
remove its owner before the runtime reaches position 23, and it must not apply
the retained completion twice.

If Dalph dies while completion is waiting, the owner, acknowledgement, and
publication proof disappear with the activation. The Journal already contains
the accepted prefix, so ordinary restart reconstructs work from that history
and opens a fresh current-first relation subscription. No new crash event,
completion record, or replay token is persisted. A relation failure while the
completion waits keeps the existing scoped cleanup behavior and fails the
activation; it does not convert missing publication into permission to settle.

### Acceptance-test mapping

- `keeps an action owner until its accepted successor publication reaches the
  runtime` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`
  deterministically offers completion before the position-23 evaluation,
  proves that the owner and child acknowledgement remain live, then releases
  position 23 and proves the predecessor settles once, A is admitted once, and
  a later empty position 24 reaches quiescence.
- `fails closed when an action completion proof differs from the exact
  activation Run or proposal` in the same file proves that a foreign Run is
  rejected even before reconstruction exposes a runtime Run snapshot, and
  that neither invalid identity can settle the live owner or acknowledge its
  child.
- `settles pending completions in their publication arrival order when one
  evaluation releases both` in the same file proves that one later accepted
  evaluation flushes multiple ready completions in FIFO order rather than
  depending on queue priority.
- `rolls back an owner when its pending completion loses the relation` in the
  same file proves that relation failure interrupts the unacknowledged child,
  removes its process-local owner through the existing scoped cleanup, and
  records no successful action outcome.
- Downstream #268 blocking edge: `emits the exact DS01 through DS13 delivery
  checkpoint table` in
  `packages/dalph/test/cassettes/delivery-story-capstone.execution.test.ts`
  remains pending on composition. It will prove that this local ordering lets
  the five accepted post-claim results expose A through E's specification reads
  in the complete delivery story.
