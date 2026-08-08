# Observe a requested Pause reach its safe boundaries

Issue: [Observe drain to quiescence](https://github.com/dearlordylord/dalph/issues/63)

Status: proposed chronological scenarios for issue #63. A maintainer has not
yet accepted this file. Runtime implementation remains blocked until the issue
or another accepted specification accepts these choices.

Issue #63 currently gives abstract projection criteria but no chronology. Its
linked graph-frontier specification and ADR were removed when the coarse
planned-attempt executor boundary replaced that model. These scenarios restate
the still-current request against the shipped Pause behavior in issues #134
and #135, the applied-direction boundary from issue #166, and the stale-task
rejection from issue #156.

The proposed observation is transport-independent. After one exact Run or task
Pause has been applied, Alice may subscribe to an immediate view and later
updates caused by relevant delivery facts. The view lists every exact
outstanding responsibility covered by the Pause. Each covered responsibility
is either already at its accepted safe boundary or names the exact operation,
planned attempt, or newly covered grouping descendant that still prevents
confirmation. “Waiting” and “confirmed” are results of this view, never journal
events or outside-system authority.

The observer combines the current descriptive delivery projection with current
process-local ownership of already-admitted actions through one named
observation composition. It does not call the task tracker, Git, executor,
journal store, or cleanup adapters; those systems are called only by the
existing Pause and reconciliation protocols. It emits an initial view and
changes driven by new accepted facts, then completes after it reports either
that the Pause is confirmed or that a later Unpause means the Pause is no
longer applied. It schedules no timer, polling read, heartbeat, or estimated
completion time. A client may impose its own wait timeout by ending only its
subscription.

These output choices need maintainer acceptance before they become a public
contract:

- the view includes all covered outstanding responsibilities, not only the
  ones still preventing confirmation;
- confirmation means that every currently covered responsibility is at the
  safe boundary already established by its accepted protocol;
- a later Unpause ends the observation without reporting a confirmed Pause;
  and
- asking to observe a subject with no currently applied Pause returns a typed
  absence instead of creating a wait.

## Alice watches a task and its grouping child reach safe boundaries

### Starting situation

Alice is the Operator. Dalph is coordinating Run R against tracker target T.
The latest accepted complete tracker observation G1 says that D is a grouping
child of A. P is A's prerequisite, B depends on A, and C is independent. The
journal records one applied task Pause for exact subject `(R, A)` and no later
Unpause.

Before that Pause was applied, Dalph began exact planned-attempt executor work
PA for A. It also recorded the next target-promotion attempt intent for D's
integration candidate and asked Git to compare-and-set that exact candidate MD
against its expected target head. The executor's latest report for PA is
`Running`; the suspension selected after Pause has not yet returned. Git may
have applied MD, but Dalph has no recorded known result yet. C has its own
running planned attempt PC. No cleanup or relinquishment disposition exists
for A, D, or C.

The current grouping facts cover A and D. They do not cover prerequisite P,
dependant B, or independent C. PA and D's integration remain exact outstanding
responsibilities. PC remains independent work even though it is active at the
same time.

### Trigger and chronological behavior

1. After the task Pause application succeeds, Alice subscribes to observation
   of exact subject `(R, A)`.
2. Dalph assembles one coherent observation from the current descriptive
   delivery projection and current process-local ownership of already-admitted
   actions. The inputs contain the latest applied Pause or Unpause direction,
   G1, exact outstanding responsibilities, recorded executor reports and
   boundary outcomes, and the actions currently running. This read performs no
   outside request and appends no journal record.
3. Dalph derives A and D as the covered tasks. The first view lists PA and D's
   integration responsibility together with exact promotion request MD. It
   does not list PC, P, B, or C as covered by A's Pause.
4. The view explains that PA prevents confirmation until the executor reports
   `SafelySuspended` or a terminal result for PA's exact `(RunId, AttemptId)`.
   It separately explains that grouping descendant D prevents confirmation
   until Dalph reads Git, establishes MD's exact result, and reaches the
   integration protocol's safe resource-release boundary. The view does not
   replace either explanation with a generic “draining” phase.
5. The ordinary Pause protocols continue independently of Alice's observer.
   When Git returns or reconciliation establishes MD's result, Dalph records
   that existing workflow outcome. When the executor reports PA safely
   suspended, Dalph records that exact correlated report.
6. Each accepted fact updates the ordinary delivery relation. Alice receives a
   new derived view showing which covered responsibility reached its boundary
   and which exact responsibility still prevents confirmation.
7. After PA and D's integration responsibility reach their safe boundaries,
   the view still identifies the covered outstanding responsibilities but
   marks neither as preventing confirmation. It reports the task Pause
   confirmed and completes the observation. Claims, worktrees, planned
   attempts, accepted evidence, and other preserved resources remain owned
   under their existing protocols.

If the coordinator process dies while Alice is observing, the subscription
ends without a synthetic crash occurrence. Restart reconstructs the applied
Pause, G1, responsibilities, and recorded outcomes from valid journal history.
The ordinary protocols check the executor or Git before repeating an ambiguous
request. Alice may reconnect and receives a newly derived current view; no
observer cursor or pause phase is recovered.

Alice sees exactly why the task Pause is or is not yet confirmed. Dalph must
not copy A's Pause onto D, include dependency-related or independent work in
the covered set, infer safe suspension from process death, persist the view,
release or clean a preserved resource, duplicate MD, or invent an ETA or
heartbeat.

Forbidden-result mapping: D17 forbids cleanup without an exact disposition,
D20 fixes task Pause scope, D22 requires rereading Git or the executor before a
retry, D29 keeps the view process-local, D30 forbids a synthetic crash event,
and D34 forbids inferring quiescence from process loss or an unpublished
boundary result.

### Proposed acceptance-test mapping

- `shows Alice every covered task responsibility and the exact safe-boundary blocker`
- `updates Alice's task Pause view only after the corresponding workflow outcome is accepted`
- `confirms Alice's task Pause without persisting a pause phase or cleaning preserved work`
- Authored and recorded cassette: `Alice sees task A and grouping child D reach their exact Pause boundaries`

## A later grouping fact makes another running task part of the Pause

### Starting situation

Run R still has the applied Pause for `(R, A)`. Complete tracker observation G1
says D is independent of A. Planned attempt PD for D previously reported
`SafelySuspended`, later resumed while independent, and now reports `Running`.
Another covered responsibility for A still prevents confirmation, so Alice's
observation subscription remains open.

The task tracker currently contains a later edit making D a grouping child of
A, but Dalph has not yet accepted a complete observation containing that edit.
An incomplete page or a failed read cannot establish the new grouping edge.

### Trigger and chronological behavior

1. An ordinary or shared activity that is independent of Alice's observer asks
   the task tracker for a complete target-closure graph. The observer itself
   does not schedule this read.
2. The tracker returns complete observation G2 with D grouped under A. Dalph
   records G2 through the existing tracker-observation protocol.
3. The current delivery relation changes. Alice's next view adds exact planned
   attempt PD as a covered responsibility and identifies descendant D as
   preventing confirmation.
4. PD's safe-suspension report from before G2 cannot settle the new obligation:
   it described an earlier time when D was independent. Dalph asks the executor
   to suspend the same exact attempt under issue #135's existing protocol.
5. Only a `SafelySuspended` or terminal report correlated to PD after the G2
   coverage boundary lets the view mark PD safe. Once A's other covered
   responsibility is also safe, Alice receives the confirmed view and the
   subscription completes.

If the coordinator crashes after G2 but before the new report, restart
reconstructs both the grouping observation and the owed suspension. It checks
the exact attempt and never treats the older safe report as evidence for the
new coverage interval. Alice reconnects to the derived current result.

Alice sees D appear for the concrete reason that current complete grouping
facts now place it under A. Dalph must not let an incomplete graph change
coverage, manufacture a Pause direction for D, reuse stale suspension evidence,
or make the observation subscription poll the tracker.

Forbidden-result mapping: D20 forbids a manufactured descendant direction and
dependency-edge coverage, D23 rejects incomplete facts as proof, D29 keeps the
covered set derived, D31 preserves the exact attempt through recovery, and D36
forbids repeated reads or continuous polling from unchanged facts.

### Proposed acceptance-test mapping

- `adds a newly grouped running descendant to Alice's open task Pause view`
- `does not let a safe report from before grouping coverage confirm the later Pause obligation`
- Authored and recorded cassette: `Alice sees current grouping facts add D to task A's Pause`

## Alice's client disconnects while a Run Pause is still reaching a boundary

### Starting situation

Run R has one applied Run Pause and no later Unpause. Before the Pause, Dalph
recorded exact planned-worktree reconciliation operation OW for task A and
asked Git to create or identify its exact planned worktree. The request remains
unresolved. Every task in R with an outstanding responsibility is covered by
the Run Pause. The journal contains OW's intent but no known result, and no
cleanup disposition exists.

Alice's client applies its own finite wait timeout to a subscription. The
timeout is client state: it is not a Run policy, a workflow event, a journal
field, or an instruction to the coordinator.

### Trigger and chronological behavior

1. Alice subscribes to observation of R's applied Pause.
2. Dalph immediately returns a view listing every covered outstanding
   responsibility and explaining that OW still prevents confirmation while
   Git's worktree result is unknown.
3. No relevant delivery fact changes before Alice's client timeout expires.
   Dalph sends no timer-driven heartbeat and no ETA. Silence does not claim
   that OW stopped or that the Pause is confirmed.
4. The client ends its subscription. Dalph releases only the process-local
   observer resources. It does not apply Unpause, cancel OW, cancel executor
   work, release capacity early, change a claim, alter Git, append an observer
   event, or authorize cleanup.
5. The ordinary workflow continues waiting for Git or rereading the exact
   worktree registration after ambiguity. It records OW's known result and
   stops the covered responsibility at the safe boundary required by the
   already-applied Pause.
6. Alice reconnects later. A new subscription derives the result from the
   still-applied Run Pause and the now-recorded outcome. If every covered
   responsibility is safe, Alice immediately sees confirmation and the
   subscription completes.

A network disconnect has the same effect as the client timeout: only the
observer disappears. If the coordinator itself crashes, D30 applies instead;
restart reconstructs workflow facts without pretending that either kind of
loss was a workflow occurrence. Retrying observation is always a new
process-local subscription and never repeats OW.

Alice sees that her timeout ended waiting, not the workflow. Dalph must not
equate observation cancellation with Unpause, cancellation, cleanup, or
quiescence; persist subscription state; emit an invented ETA; or require a
Run-specific polling heartbeat after confirmation.

Forbidden-result mapping: D17 forbids cleanup without disposition, D22 forbids
repeating OW because the observer disappeared, D29 keeps subscription and view
state process-local, D30 distinguishes coordinator death from an event, D34
forbids timeout-derived quiescence, and D36 forbids continuous polling.

### Proposed acceptance-test mapping

- `cancelling Alice's Pause observation does not cancel delivery or authorize cleanup`
- `reconnecting derives the current Run Pause view without persisted observer state`
- `a confirmed Run Pause emits no heartbeat ETA or Run-specific poll`
- Authored and recorded cassette: `Alice disconnects while Run R reaches its existing safe boundary`

## Alice unpauses while observation is waiting

### Starting situation

Alice is observing an applied task Pause for `(R, A)`. Exact planned attempt PA
is covered and its suspension request remains unresolved, so the current view
does not report confirmation. The observer itself owns no workflow
responsibility and has sent no executor request.

### Trigger and chronological behavior

1. Alice applies Unpause to `(R, A)` through the existing control boundary.
2. Dalph records the applied Unpause. It does not cancel PA's in-flight
   suspension or directly resume executor work.
3. The current delivery relation exposes that the latest direction for exact
   subject `(R, A)` is no longer Pause.
4. Alice's observer reports that the requested Pause is no longer applied. It
   does not report a confirmed Pause, and it completes the subscription.
5. The ordinary issue-135 protocol finishes or reconciles PA's exact suspension
   and performs the required current reads before ordinary admission can resume
   the preserved attempt.

If the coordinator crashes after step 2, restart reconstructs Unpause and the
unresolved suspension. A later observation request for `(R, A)` returns the
typed absence of a currently applied Pause. It neither recreates the earlier
observer nor claims that the old Pause reached confirmation.

Alice sees the difference between withdrawing a Pause and safely confirming
one. Dalph must not turn Unpause into cancellation, call an unresolved
suspension confirmed, persist an observer terminal state, or start competing
executor work.

Forbidden-result mapping: D20 distinguishes Unpause from cancellation, D29
keeps the observation result process-local, D31 preserves the same attempt,
and D34 forbids an unpublished suspension result from proving quiescence.

### Proposed acceptance-test mapping

- `ends Alice's task Pause observation without claiming confirmation after Unpause`
- `keeps the exact in-flight suspension independent of the observer ending`
- Authored and recorded cassette: `Alice unpauses task A before its Pause observation confirms`

## A rejected stale task request creates no Pause view

### Starting situation

Alice's screen shows task A in Run R, but a current complete tracker read proves
that A is outside R's target closure. No task Pause for `(R, A)` is applied.
Issue #156 owns the fresh membership read and visible stale-subject rejection.

### Trigger and chronological behavior

1. Alice asks to Pause `(R, A)` from the stale screen.
2. Dalph performs issue #156's current target-closure read, rejects the exact
   request, and records no applied Pause direction.
3. The client shows that rejection and does not start a Pause observation.
4. If a client nevertheless asks to observe `(R, A)`, Dalph reads the current
   delivery projection, finds no applied Pause, and returns the typed absence.
   It does not produce a waiting or confirmed view and appends no record.

There is no observer state or Pause effect to recover after a crash. Alice may
retry the control request, which performs issue #156's new fresh read. Retrying
an observation cannot turn the rejected request into workflow state.

Alice sees the stale-task rejection rather than fictitious Pause progress.
Dalph must not persist a pausing or paused phase, interrupt an executor, release
capacity, change a claim, alter Git, clean a resource, or affect a similarly
named task in another Run.

Forbidden-result mapping: D17 forbids unapproved cleanup, D20 limits Pause to
an applied exact subject, D23 requires complete readable membership evidence,
and D29 forbids persisting the derived or absent view.

### Proposed acceptance-test mapping

- `does not create a Pause view after Alice's stale task request is rejected`
- `returns typed absence instead of waiting when no Pause is applied`
- Existing authored and recorded cassette: `Alice's stale task Pause is rejected visibly after a fresh read`, extended to assert that no observation is produced

## Scenario-to-test mapping required after acceptance

The implementation handoff must map every proposed test above to a passing
public test and every actor-visible chronology to an authored and recorded
cassette. The public test seam is the transport-independent observation
subscription composed with the ordinary current delivery relation; tests may
cancel that subscription but must not mock internal reducers or inspect a
private helper.

These scenarios add a derived observation only. They deliberately do not
change the applied-direction, task grouping, executor suspension, Git
reconciliation, or capacity decisions owned by existing models. No Quint
model change is required unless acceptance changes one of those decisions. A
focused projection property test may supplement, but cannot replace, the named
public tests and cassettes.

## Gate outcome for this documentation change

Adding this proposed file and its scenario-index entry changes no Dalph runtime
behavior. It exposes no command, service, type, workflow decision, outside
request, durable fact, retry, recovery rule, cleanup action, or visible runtime
result. Runtime tests, cassettes, and models therefore remain unchanged in this
documentation-only gate commit. They become required only after a maintainer
accepts the chronology and implementation begins.
