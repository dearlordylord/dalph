# Observe autonomous executor work through restart

Status: accepted by issue 265; implementation and integration pending.

## Governing behavior

When Dalph has already accepted that one exact attempt is executing, the
decision to accept a later executor projection preserves the chronology in
[Begin once, then observe the same executing work](issue-264-autonomous-executor-work.md#begin-once-then-observe-the-same-executing-work),
[A changed terminal observation ends the exact work](issue-264-autonomous-executor-work.md#a-changed-terminal-observation-ends-the-exact-work), and
[Suspension response settlement is distinct from lifecycle acceptance](issue-264-autonomous-executor-work.md#suspension-response-settlement-is-distinct-from-lifecycle-acceptance).
It preserves
[D3 One unsettled attempt per task](../DELIVERY-INVARIANTS.md#identity),
[D12 Position discipline](../DELIVERY-INVARIANTS.md#admission-and-capacity),
[D22 Reconcile before retry](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence),
[D23 Incomplete and unreadable never prove absence](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence),
[D29 Authority separation](../DELIVERY-INVARIANTS.md#process-and-durability),
[D30 Crash is absence, not an event](../DELIVERY-INVARIANTS.md#process-and-durability),
[D31 Recovery continues the same work](../DELIVERY-INVARIANTS.md#process-and-durability), and
[D36 No busy loop on unchanged facts](../DELIVERY-INVARIANTS.md#progress).

The governing formal source is
[`plannedAttemptExecutor.qnt`](../../specs/plannedAttemptExecutor.qnt). Its
`unchangedExactObservationDoesNotAppendReport`,
`unchangedExactObservationIsProcessLocal`,
`observationsDoNotConsumeCommandBudget`,
`passiveReportAcceptanceHasCausalCommand`,
`unsafeOrUnavailableNeverReleasesPosition`,
`safeSuspensionReleasesPosition`, and `terminalReleasesPosition` laws constrain
each accepted projection below. Issue 265 does not change that lifecycle
algebra. It adds only the process-local owner that obtains one current
projection, awaits a later change without repeatedly commanding or reading the
executor, and recreates that owner from durable history after process loss.
It adds no report-driven tracker-read rule and no new Quint state transition.
[#218's generic accepted-fact hint](issue-218-reactivate-incomplete-runs.md#several-hints-produce-one-activation-and-one-optional-trailing-check)
remains a process-local request for an ordinary activation. It neither makes a
tracker read part of report acceptance nor forbids the independently admitted
ordinary activation from selecting tracker reads under its own rules.

## Live executing work becomes terminal

### Starting situation and trigger

Alice is monitoring Run R, but she does not trigger completion. GitHub still
reports task A open with Dalph's exact claim. Git still owns A1's immutable
Base SHA, branch, and one exact worktree. The Dalph Journal contains R's
beginning, A1's plan, executor-work responsibility, Begin intent and settled
response, and accepted `ExecutorWorkExecuting` report ordinal 1 for exact
`(R, A1)`. A's task-work position is occupied. No Begin, Resume, or Suspend
command is unsettled.

The running executor owns one autonomous work unit for `(R, A1)`. The concrete
trigger is the accepted executing report becoming visible to the process-local
report-observation owner.

### Ordered boundary calls and outside result

1. The observation owner asks only the executor's read-only current-projection
   boundary for `(R, A1)`. It supplies no command ordinal because this is not a
   Begin, Resume, or Suspend request.
2. The executor returns the exact already-accepted
   `ExecutorWorkExecuting(R, A1)`. Dalph appends nothing, retains report ordinal
   1 and A's position, and asks the same read-only boundary to await a value
   different from that exact projection. The await is current-first: if the
   value changed between the first read and attachment, it returns the new
   current value instead of waiting for another notification.
3. Outside Dalph, the autonomous executor completes with exact result C and
   retains `ExecutorWorkTerminal(R, A1, C)` as its current projection. The
   blocked await returns that changed projection. No elapsed duration and no
   tracker notification can manufacture this result.
4. The observation owner publishes the exact changed projection to one
   process-local serialized handoff. The owner has no Journal writer or
   task-work-position mutation capability.
5. The ordinary planned-attempt protocol owner checks the projection's exact
   correlation against the durable responsibility, appends one exact state
   observation, accepts `ExecutorWorkTerminal(R, A1, C)` once at report ordinal
   2, and releases only A1's task-work position once. Ordinary accepted-result
   handling may then consider C; the terminal report itself neither edits
   GitHub nor proves a Git integration fact.
6. The observation owner for A1 ends. Publishing the accepted Journal facts
   may offer [#218's existing generic accepted-fact reactivation
   hint](issue-218-reactivate-incomplete-runs.md#several-hints-produce-one-activation-and-one-optional-trailing-check).
   If #218 admits an ordinary activation from that hint, the ordinary activation
   alone decides which current tracker reads its own facts require. The executor
   report grants no report-specific tracker-read authority, creates no tracker-
   read requirement, and satisfies no tracker freshness rule.

### Crash and retry

If Dalph dies after the executor becomes terminal but before the observation
owner publishes the changed projection, the candidate existed only in process
memory. Restart follows the restart scenario below: it reconstructs A1 and its
position, reads the executor's current exact projection once, and accepts the
retained terminal result without another Begin.

If Dalph dies after appending the exact terminal state observation but before
appending report ordinal 2, restart accepts that pending observed report before
another executor boundary call. It releases A1's position once. Replaying the
same pending or accepted report appends no duplicate. These are the two real
retry cuts; Dalph does not journal a synthetic crash occurrence.

### Visible and forbidden result

Alice sees one A1 move from executing to terminal with result C and sees one
task-work position become available. She may see an explicit wait while the
executor remains unchanged. She does not see a provider stage, artificial
progress report, or report-specific tracker refresh requirement.

Dalph must not send Begin or Resume again, accept ordinal 2 twice, release a
second or foreign position, infer tracker completion, restore a process-local
observer cursor, or busy-poll the executor while nothing changes.

### Acceptance-test mapping

- `observes live terminal executor change once and releases the exact position`
  must assert one Begin call, one initial current projection, one blocked
  change attachment, one terminal observation and ordinal-2 report in order,
  one exact position release, and zero direct Resume, Suspend, tracker, Git, or
  cleanup calls during passive observation and serialized report acceptance.
- `recovers process death before terminal publication by reprojecting and
  accepting terminal once` must cut the first process after the executor
  changes but before process-local publication, reuse the Journal and executor
  state in a new scope, and assert one restart projection, zero repeated Begin
  calls, ordinal 2 once, and one release.
- `accepts a pending terminal observation after process death without
  rereading or duplicating the report` must cut after the state-observation
  append and before report acceptance, then assert zero restart executor reads,
  one ordinal-2 report, and one release.
- `accepted executor report publication grants no report-specific tracker read
  and leaves generic reactivation ordinary` must prove that passive observation
  and report acceptance call no tracker boundary, then offer the publication as
  the same generic #218 hint used by other accepted facts. A resulting ordinary
  activation may perform or omit tracker reads according to its own current
  facts; the test must assert that no report-specific refresh source,
  correlation, or required read was created, not that the whole composition
  made zero tracker calls.
- Existing Quint test `passiveTerminalObservationAppendsDistinctReportTest`
  remains the lifecycle-algebra check; it does not prove scheduling or process
  reattachment.

## An exact suspension request is followed by a later safe projection

### Starting situation and trigger

Alice applies Pause to task A while A1 has the same durable executing history
and occupied position described above. The report-observation owner is already
waiting for a value different from `ExecutorWorkExecuting(R, A1)`. The observer
does not receive Alice's command and has no suspension capability.

### Ordered boundary calls and outside result

1. A separate ordinary action owner records the exact Suspend intent before
   asking the executor to suspend `(R, A1)`.
2. The executor returns `ExecutorWorkExecuting(R, A1)`. Dalph records and
   settles that command response, retains accepted report ordinal 1, and keeps
   A's position. An unchanged command response is not a second lifecycle
   report.
3. Outside Dalph, the executor later finishes stopping all activity it owns for
   A1, preserves what the same attempt needs to resume, and changes its current
   projection to `ExecutorWorkSafelySuspended(R, A1)`.
4. The existing blocked read-only await returns Safe and publishes only that
   process-local projection. The serialized planned-attempt protocol owner
   finds the exact earlier Suspend intent, appends one state observation,
   accepts Safe once at report ordinal 2, and releases only A1's position once.
5. The observation owner ends. A later Resume remains a separate command and
   requires the accepted current tracker, claim, Git, control, and capacity
   facts owned by the issue-264 continuation rule.

### Crash and retry

A crash before the Safe projection is published loses only the local observer.
Restart reprojects A1 and either retains Executing and reattaches or accepts the
retained exact Safe projection. A crash after the Safe observation append but
before ordinal 2 uses the pending-observation recovery path and performs no
second executor read. The recorded Suspend intent and settled response are
reused; neither cut authorizes another suspension attempt.

### Visible and forbidden result

Alice sees Pause wait while A1 remains executing, then sees the exact same A1
safely suspended and its position become available. Dalph must not let the
passive owner request suspension, accept unsolicited Safe without the causal
Suspend intent, fabricate another command response, release another attempt's
position, or Resume from the observer.

### Acceptance-test mapping

- `observes safe suspension only after exact suspend intent and releases only
  that attempt` must assert the exact chronology Suspend intent, one Suspend
  call, unchanged response settlement, later Safe publication, ordinal 2, and
  one release for `(R, A1)` while a controlled `(R, B1)` position remains held.
- `reattaches after process death during suspension without repeating the
  suspend command` must cut before Safe publication and assert one restart
  projection, zero new Suspend calls, causal Safe acceptance, and one exact
  release.
- `accepts a pending Safe observation after process death with causal Suspend
  history and one release` must cut after the exact Safe state-observation
  append and before report ordinal 2. Restart must reuse the exact earlier
  Suspend intent and settled command response, perform zero executor reads,
  accept Safe at ordinal 2 exactly once, and release only A1's position once.
- Existing Quint tests `unchangedSuspendResponseSettlesWithoutNewReportTest`
  and `passiveSafeObservationRequiresSuspendTest` remain the command-settlement
  and lifecycle-causality checks.

## An unchanged projection waits without a loop

### Starting situation and trigger

No person triggers this scenario. R and A1 have the same exact accepted
executing history, executor projection, and occupied position as the terminal
scenario. No command is unsettled. The process-local observation owner starts
because accepted history says A1 is executing.

### Ordered boundary calls and outside result

Dalph performs one current projection and receives the unchanged exact
Executing report. It appends no state observation or work report. It then
enters the executor's change-aware await with the exact last projection. The
await suspends the fiber and applies backpressure; advancing a clock, reaching
an arbitrary observation count, or receiving no outside event performs no
second read. A provider wake for unrelated work may cause the executor adapter
to compare current A1 state, but an equal result remains process-local and the
owner returns to a blocked await only after that concrete wake. There is no
zero-delay retry or schedule whose success repeats `observe`.

When the observation scope closes, interruption detaches the await. It appends
nothing and neither releases A's position nor changes executor work.

### Crash and retry

Process death is equivalent to scope interruption for this owner. No observer
cursor, timer position, last-wake count, or derived executing set survives.
Restart reconstructs from the Journal and performs the one current projection
described below. There is no request to retry because no mutating request was
made.

### Visible and forbidden result

Alice may continue to see A1 executing and its position held, with no false
progress. Dalph must not append an unchanged report, create a new proposal or
command ordinal, fail after three observations, spin on a successful read,
read GitHub or Git for executor progress, or keep a detached fiber alive after
its scope closes.

### Acceptance-test mapping

- `awaits after unchanged executing projection without another read or journal
  append` must use deterministic synchronization and the controlled clock to
  prove that one initial read is followed by a suspended await, arbitrary clock
  advancement performs no further read, the Journal position and report
  ordinal stay fixed, and scope closure interrupts the one owner.
- `coalesces unrelated executor wakes without durable or command progress`
  must inject several event-source wakes while A1 stays Executing and assert
  zero state-observation appends, zero accepted reports, zero command calls,
  and at most one active await owner for A1.
- Existing Quint tests `beginOnceAndObserveExecutingFiveTimesTest` and the
  `unchangedExactObservationDoesNotAppendReport` law remain negative controls
  against durable or command progress; they do not supply the blocking wait.

## Restart reprojects once and reattaches

### Starting situation and trigger

Alice is monitoring R but does not cause the crash. The Journal durably retains
A1's exact plan, responsibility, settled Begin history, and accepted Executing
report ordinal 1. The executor independently retains the exact running work.
The old Dalph process and its observer, fiber, task-work position map, and
delivery owners are gone. No executor command is unsettled.
No pending or unresolved executor-state observation or correlation-
contradiction evidence exists. This normal restart chronology therefore does
not cover restart after one of the typed failures described below.

The concrete trigger is the new Dalph process establishing R from that existing
history.

### Ordered boundary calls and outside result

1. Dalph validates and reduces the complete Journal prefix. It reconstructs
   A1's exact responsibility and command history and recreates A's required
   task-work position from that history before admitting new work.
2. It does not restore the old observer. A new read-only owner asks for the
   current projection of exact `(R, A1)` once before it attaches.
3. If the projection is the unchanged exact Executing report, Dalph appends
   nothing and calls the current-first change await with that projection. The
   await immediately returns a newer value if the executor changed during the
   read/attach interval; otherwise it blocks.
4. A later Terminal or causally requested Safe projection follows the live
   acceptance paths above. No tracker or Git read grants permission for the
   executor's already-autonomous work to continue.

If history instead contains an unsettled Begin, Resume, or Suspend command,
issue 264's command reconciliation occurs before this passive attachment. If
history contains an exact state observation awaiting lifecycle acceptance,
Dalph accepts that pending observation before any executor read. Those cases
are not silently forced through the ordinary passive path. If history contains
unresolved non-exact observation or correlation-contradiction evidence, this
scenario authorizes neither another current projection nor reattachment; the
failure chronology below applies instead.

### Crash and retry

Another crash before the new attachment completes discards only the second
process's local owner. The next process repeats one current projection for the
same durable responsibility. No number of process losses creates another
Begin identity or proves that A1 stopped.

### Visible and forbidden result

Alice sees the same A1 executing or its retained later exact result. She may
see an explicit typed wait if the executor cannot supply a usable projection.
Dalph must not restore a cursor, repeat Begin because local ownership vanished,
allocate A2, create a second worktree, attach to a foreign correlation, release
the position from process death, or perform a tracker refresh as part of
executor reattachment.

### Acceptance-test mapping

- `restart reprojects the exact executing attempt once then reattaches without
  Begin` must use one shared Journal and independently surviving controlled
  executor across two scopes and assert reconstruction precedes the one current
  projection, the change attachment follows it, the exact position is held,
  and Begin, Resume, tracker, Git, cleanup, and Journal append counts remain
  zero in the restarted scope.
- `current-first attachment cannot miss a terminal change between projection
  and await` must gate the boundary between those calls, change the retained
  executor projection there, and assert the await returns Terminal without a
  second outside notification.
- The existing `requiredPlannedAttemptPositionsOf` recovery tests remain the
  position-reconstruction evidence; they do not prove observer reattachment.

## Absent, unavailable, unreadable, and foreign projections fail closed

### Starting situation and trigger

No person triggers these four cases. In each case R's Journal contains the
same exact A1 responsibility, settled Begin history, accepted Executing report
ordinal 1, and no pending command or observation. Dalph has reconstructed and
holds A1's position. One new current read reaches the executor boundary.

Outside Dalph, the executor returns exactly one of these typed projections:

- `NoReport(R, A1)`: no current normalized report exists for that exact
  correlation; this is absence of a projection, not proof that work is absent;
- `TemporarilyUnavailable(R, A1)`: the executor cannot currently answer;
- `Unreadable(R, A1)`: bytes or private state cannot be normalized safely; or
- `CorrelationContradiction(expected (R, A1), observed foreign report)`: the
  returned report belongs to another Run or Attempt.

### Ordered boundary calls and outside result

The passive read-only owner only publishes the exact typed candidate to the
serialized protocol handoff. It cannot record a Journal fact, accept a report,
or release a position. The existing serialized planned-attempt protocol owner
alone checks the exact correlation, records the corresponding typed state
observation or correlation contradiction, and reports it. That non-exact
evidence remains unresolved and non-authoritative: the current lifecycle model
has no action that accepts or clears it. The protocol appends no lifecycle
report, leaves ordinal 1 current, retains the exact responsibility and
position, and creates no successor permission. The failed attachment ends, no
reread is scheduled, and a foreign projection is never adopted.

### Crash and retry

A crash after the passive owner publishes the candidate but before the
serialized protocol records it loses that process-local candidate; no durable
failure fact is inferred from the loss. A crash after the typed observation or
contradiction is recorded preserves that exact unresolved, non-authoritative
evidence and still reconstructs A1 and its position. None of the four outcomes
is an ambiguous mutation, so reconcile-before-retry does not invent command
reconciliation or authorize another Begin.

The accepted lifecycle model supplies no action that clears the evidence or
authorizes a retry. This scenario therefore promises no later passive read
merely because one of these four failures occurred, including after restart. A
new attachment or reread requires a separately accepted scheduling and retry
rule; until then the unresolved evidence, responsibility, and position remain.

### Visible and forbidden result

Alice sees A1 retained with a distinct absent, unavailable, unreadable, or
foreign-correlation wait/error. She does not see the categories collapsed into
"not running." Dalph must not release A's position, mark A1 terminal or safely
suspended, create A2, send Begin, Resume, or Suspend, remove a claim or
worktree, adopt the foreign result, retry in a tight loop, or infer that one
failed projection describes GitHub or Git. It must not treat process restart or
the unresolved evidence itself as authority for another passive read.

### Acceptance-test mapping

- `retains responsibility and position for absent unavailable unreadable or
  foreign projection` must be a four-case table asserting the exact typed
  failure, one current read, accepted ordinal 1, the same required position,
  the serialized protocol recording unresolved non-authoritative observation
  or contradiction evidence, the attachment ending without accepting or
  clearing that evidence, zero successor proposals, and zero Begin, Resume,
  Suspend, tracker, Git, cleanup, release, or internally scheduled reread
  calls. A restart prefix containing that evidence must retain it without
  reprojecting or reattaching. The test makes no claim that a future process or
  opportunity may read again.
- Existing Quint test `unsafeObservationsRetainPositionTest` and the
  `everyBoundaryValueCarriesExactCorrelation` law remain the model checks; the
  four-case runtime table must keep absence, unavailability, unreadability, and
  foreign correlation distinct.

## The observation owner has only passive capabilities

### Starting situation and trigger

This is a contract and Layer-composition check, so no person, tracker edit, Git
change, executor completion, crash, or retry applies. A controlled composition
constructs the process-local observation owner for exact `(R, A1)`.

### Ordered capabilities and result

The owner receives only:

- the read-only executor current-projection and change-await boundary;
- exact `(RunId, AttemptId)` subjects derived from validated Run history; and
- a process-local publication handoff that cannot append the Journal or release
  a position.

It does not receive executor Begin, Resume, or Suspend methods, task-tracker or
Git readers or mutations, a Journal writer, task-work-position mutation,
cleanup, integration, or application-lifecycle termination capabilities. The
existing serialized planned-attempt protocol owner that consumes a published
candidate alone records typed observations or contradictions, accepts distinct
reports, and releases the exact position when the accepted Safe or Terminal
rule requires it. Neither owner receives a generic capability bag.

### Visible and forbidden result

There is no direct person-visible result. The test proves that attaching an
observer cannot itself change executor work or another authority system.
Dalph must not make safety depend only on a convention that a mutation-capable
service happens not to be called.

### Acceptance-test mapping

- `passive lifecycle owner has only current projection await and publication
  capabilities` must construct the owner without executor command, tracker,
  Git, Journal-writer, position-release, cleanup, integration, or application
  lifecycle Layers and exercise both current and changed projections.
- `passive observation publication enters one serialized protocol owner` must
  race duplicate equal Terminal publications and assert that the passive owner
  only publishes candidates while one exact serialized protocol owner records
  one state observation, accepts one next report ordinal, and releases one
  position.
- A compile-time contract assertion must fail if Begin, Resume, Suspend, or a
  Journal append method is added to the passive owner interface.

## Scenario-to-test seams

| Scenario | Concrete outcome | Required acceptance seam |
|---|---|---|
| Live Executing to Terminal | One Begin, one changed terminal acceptance at the next ordinal, one exact release | `observes live terminal executor change once and releases the exact position` |
| Exact suspension then Safe | Safe is causal to the exact Suspend intent and releases only A1 | `observes safe suspension only after exact suspend intent and releases only that attempt` |
| Unchanged Executing | One current read enters a blocking await; time alone causes no read or Journal progress | `awaits after unchanged executing projection without another read or journal append` |
| Restart while Executing | With no pending or unresolved observation evidence, reconstruct position, project once, attach current-first, and repeat no Begin | `restart reprojects the exact executing attempt once then reattaches without Begin` |
| Death before changed publication | Restart reprojects retained Terminal or Safe and accepts it once | `recovers process death before terminal publication by reprojecting and accepting terminal once` |
| Death after Terminal observation | Pending Terminal is accepted without another executor read or duplicate report | `accepts a pending terminal observation after process death without rereading or duplicating the report` |
| Death after Safe observation | Pending Safe is accepted from causal Suspend history at ordinal 2 exactly once and releases A1 once | `accepts a pending Safe observation after process death with causal Suspend history and one release` |
| Typed projection failure | The serialized protocol records four distinct unresolved non-authoritative outcomes, retains A1 and its position, authorizes no successor, and schedules no reread | `retains responsibility and position for absent unavailable unreadable or foreign projection` |
| Tracker-refresh separation | Report acceptance makes no direct tracker read; a generic #218 hint leaves any later reads to ordinary activation | `accepted executor report publication grants no report-specific tracker read and leaves generic reactivation ordinary` |
| Capability restriction | Passive owner cannot call commands, tracker, Git, Journal writer, release, or cleanup | `passive lifecycle owner has only current projection await and publication capabilities` |
