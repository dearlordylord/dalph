# Autonomous planned-attempt executor work

Status: accepted by issue 264. This scenario supersedes the repeated
`Running`-report continuation scenario in issue 193 and the corresponding
executor premise in issue 254. It also supersedes issue 66 and issue 56's
late-Resume amendment: a terminal Stop or Restart cancels an admitted but
unissued Resume before executor contact, while a recorded Resume intent or an
accepted executing report makes that terminal choice unavailable.

## Begin once, then observe the same executing work

### Starting situation and trigger

Alice is monitoring Run R; she does not directly trigger this automatic work.
GitHub reports task A open with Dalph's exact claim. Git proves A1's recorded
Base SHA, branch, and one exact worktree. Dalph has reserved A's task-work
position and recorded executor-work responsibility for `(R, A1)`. No executor
command or report exists.

The coordinator admits A1. Dalph records Begin command intent ordinal 1 before
calling the executor's `begin` boundary once. The executor starts its one
autonomous work unit and returns `ExecutorWorkExecuting`. Dalph records the
exact command response, accepts the first distinct lifecycle report at report
ordinal 1, and keeps A's position occupied.

If a production provider finishes or fails before its turn-start boundary
returns, the adapter still returns `ExecutorWorkExecuting` from public Begin
and retains the exact terminal result in its private attempt record. A read
explicitly identified as reconciliation of the ambiguous Begin continues to
project Executing, including after restart; a passive lifecycle observation
instead exposes the retained Terminal result. This distinction prevents a
fast provider result from bypassing report ordinal 1 without hiding Terminal
from ordinary later observation.

Before that Begin response settles, a passive projection cannot create the
first accepted lifecycle report, even when it is exact and correlated. Dalph
records a typed causality contradiction and retains A's position; it must
settle the once-only Begin response or its exact reconciliation evidence.

An independently admitted observation owner may call only the executor's
passive `observe` boundary for this executing attempt. An exact unchanged
executing projection is finite, process-local delivery-result bookkeeping: it
appends no observation event or
report ordinal 2, records no command intent, changes no observation proposal
identity, grants no successor proposal permission, leaves the accepted journal
position unchanged, consumes no command budget entry, and reads no current graph,
specification, claim, worktree, or target-lineage facts as permission to
continue work. A controlled boundary seam invokes five unchanged reads inside
that one independently admitted owner; all five have the same durable result
as one, do not create another proposal identity, and do not readmit the settled
owner. The executor-owned work continues autonomously.

### Visible and forbidden result

Alice sees one attempt executing and one held capacity position. She does not
see artificial progress stages or failure after three observations. Dalph must
not call `begin` or `resume` while A1 is executing, manufacture another
accepted lifecycle report, or create replacement work because an observation
is absent, unavailable, unreadable, or correlated to another attempt.

The scheduler that creates a later independent observation owner is outside
this amendment and is owned by issue 265. This amendment proves the passive
boundary semantics inside one independently admitted owner; it does not use an
unchanged result as permission to schedule or readmit another owner.

### Acceptance-test mapping

- `observes unchanged executing work more than three times without durable
  events or another command`
- `settles one unchanged passive observation owner without re-admission or
  successor permission`
- `admits an independently proposed suspension after one unchanged passive
  observation`
- `keeps an accepted executing attempt on its passive observation route without
  current-fact reads`
- `beginOnceAndObserveExecutingFiveTimesTest`
- `rejects a Safe response to Begin without accepting lifecycle authority`
- `rejects a first passive lifecycle report without an exact settled Begin`
- `firstPassiveLifecycleReportRequiresBeginSettlementTest`
- `firstPassiveReportWithoutBeginIsDetectedTest`
- `unchangedObservationMutationIsDetectedTest`
- `normalizes an immediate provider failure to Begin Executing and exposes
  Terminal passively`
- `reconciles a lost provider response and keeps lost public Begin
  reconciliation executing`

## A changed terminal observation ends the exact work

### Starting situation and outside event

A1 has accepted `ExecutorWorkExecuting` at report ordinal 1, and its position
is still held. No person triggers the completion. The executor finishes its
autonomous work and its passive state projection changes to
`ExecutorWorkTerminal` with A1's exact result.

Dalph calls `observe`, records the state observation, accepts the changed
lifecycle report at ordinal 2, and releases A's task-work position. Ordinary
result handling then decides what happens to the tracker task and Git result;
the terminal executor report alone does not claim either action occurred.

If Dalph crashes after recording the terminal state observation but before
appending report ordinal 2, recovery accepts that already observed distinct
report before another boundary call. Replaying either accepted report appends
nothing.

### Visible and forbidden result

Alice sees A1 leave execution with its exact result and sees capacity become
available. Dalph must not send another work-changing command, append a second
executing report first, release capacity from an unavailable projection, or
treat a foreign terminal result as A1's result.

### Acceptance-test mapping

- `records a distinct terminal observation after unchanged executing work`
- `accepts a pending terminal state observation after restart without another
  executor call`
- `passiveTerminalObservationAppendsDistinctReportTest`
- `releases the task position for safe and terminal passive executor results`

## Suspension response settlement is distinct from lifecycle acceptance

### Starting situation and trigger

Alice applies Pause to A while A1 is executing at report ordinal 1. Dalph
records a Suspend command intent before calling `requestSuspension`. The
separate suspension-command bound remains in force because it bounds repeated
mutation attempts, not passive observations.

If the boundary response is still `ExecutorWorkExecuting`, Dalph records the
exact command response and settles that command. It appends no report ordinal
2 and keeps A's position. A later bounded suspension request may return
`ExecutorWorkSafelySuspended`; Dalph then accepts that distinct report at
ordinal 2 and releases the position. A terminal response also releases the
position. No other response does.

If the response is lost after intent, restart calls passive `observe` to
reconcile that exact command before any retry. No-current-report, temporary
unavailability, unreadability, or foreign correlation retains the position and
grants no replacement or retry permission.

If no Suspend intent exists after the accepted Executing report, a passive
`ExecutorWorkSafelySuspended` projection is an unsolicited state change, not
causal suspension proof. Dalph records a typed lifecycle contradiction and
retains A's position.

### Visible and forbidden result

Alice sees Pause wait while work is still executing and complete only after
safe suspension or terminal evidence. Dalph must not use `WorkReported` as the
settlement record for an unchanged command response, fabricate report ordinal
2, or release capacity merely because it asked for suspension.

### Acceptance-test mapping

- `settles an unchanged suspension response without appending another work
  report`
- `unchangedSuspendResponseSettlesWithoutNewReportTest`
- `rejects a passive Safe report without an exact Suspend intent`
- `passiveSafeObservationRequiresSuspendTest`
- `passiveSafeWithoutSuspendIsDetectedTest`
- `never issues a fourth durable suspension command after accepted executing
  work`
- `commandResponseCannotManufactureReportOrdinalTest`

## Resume only the same safely suspended attempt selected by current facts

### Starting situation and trigger

A1 has an accepted `ExecutorWorkSafelySuspended` report and holds no position.
Alice unpauses A. A fresh tracker graph still selects A, its specification and
claim exactly match A1, Git proves the same planned worktree and required
target lineage, and the accepted continuation rule names those exact reads.

Dalph reserves A's position, records a Resume command intent, and calls
`resume` for A1. An executing response becomes the next distinct accepted
report. An executing attempt, an unaccepted safe projection, stale selection
facts, another attempt, or a safe report already consumed by a prior resume
cannot authorize this call.

If Dalph crashes after the Resume intent, it reconciles that exact ambiguous
command by observation before any further command. It never sends Begin again.

### Visible and forbidden result

Alice sees the same A1 resume. Dalph must not allocate A2, use report ordinals
as continuation authority, or relabel a generic repeated Begin as Resume.

### Acceptance-test mapping

- `safeSuspendThenExactResumeTest`
- `resumeWithoutSafeReportIsDetectedTest`
- `resumes the same planned attempt after unpause`
- `rejects a recovered continuation without current witnesses before executor
  contact`
- `recovers each later pending or unreadable tracker read before proposing
  Resume` covers the runtime-valid recovery matrix: graph reads remain pending
  or end in `TaskTrackerFactsReadFailed`, specification reads remain pending,
  and claim reads remain pending or end in
  `FocusedTaskClaimFactsUnreadable`; every cell proposes its exact tracker
  reread and never Resume.
- `never contacts Resume for invalid or superseded continuation authority` is
  the zero-contact authority matrix: it rejects a same-task/same-target graph,
  specification, or claim read attached to a foreign planned-attempt plan,
  rejects a graph whose outcome omits the task or whose read shape does not
  explicitly cover it, rejects tracker witnesses whose target differs from
  the immutable `WorkflowRunBegan.target`, and keeps every rejected route at
  zero executor contacts.
- The same test's positive cases retain an exact current witness when a later
  same-task/same-target read is attached to a foreign plan; that foreign read
  does not invalidate current evidence.
- `ignores same-target foreign-plan tracker facts and schedules an exact
  replacement` exercises recovery selectors for foreign graph, specification,
  and claim reads: no foreign outcome can seed Resume, and recovery schedules
  an independently correlated replacement read.
- `does not seed a continuation graph read from a foreign immutable Run target`
  proves recovery filters the immutable `WorkflowRunBegan.target` before
  choosing a focused graph read or any Resume path.
- `drives a public operator claim-reacquisition request through a later
  activation` proves the later activation reads the fresh claim after claim
  acquisition before it reads Git worktree and target lineage; `records a
  foreign reacquisition rejection and never retries it after the next
  activation` is its no-contact counterpart.
- `does not pair a target-A graph read with an earlier foreign-target snapshot`
  proves the journal publishes the immutable target-A graph together with its
  target-A operation metadata even when target B was recorded first.
- `keeps live and replayed target-A focused reads on target A across a Journal interleaving` proves a later target-B specification outcome cannot replace
  the target-A body or title in either the live append path or replay path.
- `scopes a terminal choice to the immutable Run target` proves a foreign target-B fingerprint is rejected while the target-A Restart fingerprint is accepted; `keeps a target-A Stop choice exposed after a later foreign-target specification` proves the same boundary for Stop.
- `keeps target-A restart advancement valid after a later foreign-target specification` proves both public restart rechecks and reconstructed
  replacement validation retain the target-A choice and do not invalidate it
  from target-B facts.
- `keeps a published target-A Stop valid through advancement, reduction, and recovery`
  exercises the public Journal append, Stop advancement, reducer, and
  restart/recovery projection with a later target-B specification.
- `keeps the immutable run target graph in the public delivery frame` proves
  the frame and fresh-workflow selector retain target A's snapshot and exact
  graph-read predecessor after a newer target-B graph.
- `keeps foreign tracker facts out of the target-bound public delivery
  relation` proves the public Journal-to-frame-to-reactive relation exposes no
  target-B pause coverage, graph, read, claim, or Resume-bound proposal.
- `keeps target-A termination evidence current when a later graph belongs to
  target B` reduces a valid mixed-target history and drives it through
  `decideWorkflowRunTermination`; `rejects finality evidence superseded by a
  later complete graph observation` is the same-target control proving a later
  target-A graph still supersedes stale terminal evidence.
- `does not release a cancelled claim from a foreign-target observation`
  proves cancellation no-release settlement requires the claim-read intent to
  target the immutable Run target; a valid target-B read cannot settle or
  release target A's claim. `covers termination responsibility settlement and
  graph comparability controls, including target-isolated cancellation
  no-release` drives valid target-A claim evidence followed by foreign
  target-B evidence through reduction and `terminationPreconditionIssues`,
  while a later same-target observation still invalidates the older no-release
  event.
- `does not settle a stopped claim from a foreign-target observation` proves
  the same immutable-target requirement at the Stop settlement boundary.
  Its public control read remains claim-disposition-pending, and direct
  termination preconditions still report an unsettled responsibility.
- `settles Stop from the exact target observation after a later foreign
  observation` proves the target-A no-release observation remains selectable
  after target-B facts, then persists the Stop disposition through reduction
  and recovery without executor contact; `rejects a stale no-release
  observation after a newer exact claim read` remains the same-target
  invalidation control.
- `rejects a no-release after a later same-target unreadable claim observation`
  proves an unreadable target-A outcome is the latest freshness candidate: the
  published Journal appends no no-release event, recovery exposes no settled
  disposition or release, responsibility remains unfinished, and termination
  stays blocked; the forged reducer control proves replay rejects fallback to
  the earlier readable outcome.
- `fails closed for a valid no-begin prefix with a paired pending Git read`
  preserves the accepted historical no-begin prefix shape, including its
  keyed pending Git intent, while the production recovery projection emits
  zero tracker, Git, executor, integration, or cleanup transitions;
  `refuses cleanup selection from a no-begin journal` proves the cleanup loop
  has the same boundary.
- `scopes recovery responsibility to the immutable Run target` reduces a
  valid Run-target-A history containing exact A graph/specification/claim
  facts followed by foreign-target-B graph/specification/claim facts (the B
  graph marks the task completed), and proves no B-derived lifecycle,
  membership, external-success settlement, claim release, or cleanup action.
- `cancels continuation authorization when a terminal choice wins before its
  append` pauses at the first journal read, commits the terminal choice through
  the protocol controller, and proves zero Resume-intent appends and zero
  executor contacts at the append boundary.

## A terminal choice cancels an admitted but unissued Resume

### Starting situation and trigger

A1's latest accepted lifecycle report is
`ExecutorWorkSafelySuspended`, no executor command is unsettled, and the exact
current graph, specification, claim, worktree, and lineage still name A1. A
process-local delivery owner has reserved capacity for Resume, but has not
recorded a Resume intent or contacted the executor. Before that boundary call,
Alice applies Stop or Restart for the current fingerprint pair.

Dalph records Alice's terminal choice and cancels that admitted owner, reusing
or releasing its reservation according to the chosen terminal workflow. It
does not append a Resume intent, call `resume`, or accept an executing report.
The latest accepted Safe report remains the sole lifecycle authority for the
terminal workflow. If a Resume intent was already durable, or a causal Resume
already produced an accepted executing report, the terminal choice is instead
unavailable.

If a distinct terminal report is later accepted without Resume, Terminal is
absorbing. It replaces Safe as the current lifecycle fact, prevents the earlier
choice from authorizing replacement or abandonment, and an Accepted outcome
follows ordinary integration admission after evidence qualification.
Historical `StartOrContinue` remains documentation and proof terminology only.
The current journal and provisional recorded-cassette schemas do not decode
that ambiguous command: a retained artifact requires an explicit offline
migration outside issue #264 so it cannot accidentally grant Begin or Resume
authority.

### Visible and forbidden result

Alice sees one terminal choice and no later Resume for A1. Dalph must not allow
a newer fingerprint to turn that choice into Continue authorization, contact
the executor from the canceled owner, use a raw response or projection as
lifecycle authority, suppress a current Accepted outcome from integration, or
create a replacement from terminal evidence.

### Acceptance-test mapping

- `stopCancelsAdmittedUnissuedResumeBeforeExecutorContactTest`
- `restartCancelsAdmittedUnissuedResumeBeforeExecutorContactTest`
- `terminalChoiceCannotAdmitAnotherResumeTest`
- `terminalChoiceCannotIssueResumeAtExecutorBoundaryTest`
- `settledUnchangedSafeResumeConsumesTerminalChoiceAuthorityTest`
- `settledUnchangedSafeResumeConsumesRestartAuthorityTest`
- `terminalAfterStopIsAbsorbingAndIntegratesNormallyTest`
- `terminalAfterRestartIsAbsorbingAndIntegratesNormallyTest`
- `terminalAfterStopCannotAbandonImplementationTest`
- `terminalAfterRestartCannotBeginReplacementTest`
- `accepts a passive Terminal report after accepted Safe without Resume`
- `passiveTerminalAfterSafeRemainsAllowedTest`
- `treats a settled Resume intent as consuming Safe authority even when the
  response is unchanged`
- `treats an accepted terminal report after Stop as absorbing without
  abandonment or executor contact`
- `reports accepted Terminal as the current result of exact Stop redelivery`
- `rejects Continue after Restart even when a newer fingerprint exposes
  another terminal choice`
- `queues only a durable accepted result after evidence checks`
- authored cassettes `changedAttemptRestartCancelsHeldResume`,
  `changedAttemptRestartCancelsHeldResumeBeforeChangedFacts`, and
  `changedAttemptStopCancelsHeldResume`

## A lost Begin response is reconciled without replacement

### Starting situation and outside event

Dalph has recorded Begin intent ordinal 1 and called `begin` for A1. The
executor accepted the call, but the response was lost before Dalph recorded
it. Dalph may crash at that point.

After restart, Dalph observes the exact executor projection before any command.
An exact executing projection settles Begin ordinal 1 and is accepted as the
first distinct lifecycle report. Dalph never calls Begin ordinal 2. An absent,
temporarily unavailable, unreadable, or foreign projection leaves the command
ambiguous and retains A's position; it is not permission to replace A1.

### Visible and forbidden result

Alice sees one physical attempt or an explicit wait for authoritative evidence.
Dalph must not infer that the lost response means no work started, manufacture
a second Begin, resume without safe evidence, or discard the worktree.

### Acceptance-test mapping

- `reconciles a lost begin response and never repeats the once-only begin`
- `rejects a reconciled Safe projection for a lost Begin without accepting
  lifecycle authority`
- `lostBeginResponseReconcilesWithoutSecondBeginTest`
- `reconciles a lost Begin terminal after restart before exposing it passively`
- Codex adapter tests for recovered, absent, unavailable, unreadable, and
  foreign pre-turn projections
