# Refresh authority facts while an attempt is already running

Owning issue: [#281](https://github.com/dearlordylord/dalph/issues/281)

Status: accepted implementation correction awaiting integration. On 2026-08-28
the active #281 delivery audit found this production acceptance gap. An
executor's `Running` report could keep one Run activation
from checking whether its tracker claim, authored instructions, or planned
worktree had changed. Related accepted behavior remains owned by
[#137](https://github.com/dearlordylord/dalph/issues/137),
[#139](https://github.com/dearlordylord/dalph/issues/139), and
[#218](https://github.com/dearlordylord/dalph/issues/218).

## Governing behavior

The decision to check authority facts while an executor is already running is
governed by [A lost tracker notification is recovered by the bounded
timer](issue-218-reactivate-incomplete-runs.md#a-lost-tracker-notification-is-recovered-by-the-bounded-timer):
a tracker notification or configured timer asks Dalph to check current facts
but proves no work itself. This scenario refines that behavior only when the
same Run reconstructs a Running attempt; it does not add a second Run
activation, scheduler, tracker lifecycle, or durable wake record.
[Several hints produce one activation and one optional trailing
check](issue-218-reactivate-incomplete-runs.md#several-hints-produce-one-activation-and-one-optional-trailing-check)
continues to own coalescing, a failed or raced handoff, and the Pause, Exit,
Unpause, and termination rules that this active-work case preserves.

The consequences of a successful current read preserve rather than replace
[Alice changes A's instructions while its planned attempt is
running](issue-136-reconcile-changed-task-facts.md#alice-changes-as-instructions-while-its-planned-attempt-is-running),
[Another tracker client replaces A's claim while A is
running](issue-137-reconcile-task-claims.md#another-tracker-client-replaces-as-claim-while-a-is-running),
[Scenario 12B: the integration target is rewritten outside the planned
lineage](issue-139-reconcile-git-facts.md#scenario-12b-the-integration-target-is-rewritten-outside-the-planned-lineage),
[Scenario 14A: Git no longer registers the planned
worktree](issue-139-reconcile-git-facts.md#scenario-14a-git-no-longer-registers-the-planned-worktree),
[D12 Position discipline](../DELIVERY-INVARIANTS.md#d12-position-discipline),
[D16 Work in progress survives every
constraint](../DELIVERY-INVARIANTS.md#d16-work-in-progress-survives-every-constraint),
[D18 A constraint is local to its
subject](../DELIVERY-INVARIANTS.md#d18-a-constraint-is-local-to-its-subject),
[D23 Incomplete and unreadable never prove
absence](../DELIVERY-INVARIANTS.md#d23-incomplete-and-unreadable-never-prove-absence),
and [D29 Authority separation](../DELIVERY-INVARIANTS.md#d29-authority-separation).

The exact constraint laws remain Quint properties `foreignClaimIsNeverChanged`
and `unreadableClaimCannotAuthorizeReplacement` in
[`taskFactReconciliation.qnt`](../../specs/taskFactReconciliation.qnt), with
executable scenarios `foreignClaimStopsOnlyATest` and
`unreadableClaimCannotAuthorizeProgressOrLossTest` in
[`taskFactReconciliation_test.qnt`](../../specs/taskFactReconciliation_test.qnt).
Git's exact laws remain `incompatibleRewriteConstrainsOnlyAffectedAttempt`,
`gitConstraintPreservesIndependentEligibility`, and
`lostWorktreeNeverAuthorizesRepair` in
[`gitReconciliation.qnt`](../../specs/gitReconciliation.qnt), with executable
scenarios `incompatibleRewriteSuspendsOnlyAffectedAttemptTest` and
`lostWorktreePreservesEvidenceAndNeverRepairsTest` in
[`gitReconciliation_test.qnt`](../../specs/gitReconciliation_test.qnt).

Issue #281 ordinarily limits its focused title/body read to beginning fresh
work or resuming a safely suspended attempt. #218 specifically refines that
limit for a tracker-notification or timer refresh while work is Running: the
read may detect a constraint, but it cannot authorize a continuation or change
the planned fingerprint. Generic accepted-fact publication and Operator Wake
remain ordinary reactivation hints under #218; they do not grant this narrower
active-work refresh opportunity.

#218 also supersedes #137's exhausted-unreadable suspension only in this live
refresh case. Three unreadable claim reads during an ordinary continuation
still enter #137's existing safe-suspension wait. During a refresh of an
already-Running attempt, unreadability proves neither loss nor permission and
does not suspend the healthy executing work. A later tracker notification or
configured timer must start a new bounded read. This trades immediate stopping
for avoiding an inference from uncertainty; the accepted #218 amendment makes
that trade-off explicit.

The task-fact model must add the typed active-refresh source to its existing
unreadable-claim transition. It must preserve ordinary #137 suspension while
proving that active-refresh unreadability selects neither continuation nor
suspension. A negative control must deliberately erase that distinction and
produce a counterexample. Existing Git constraint transitions need no change;
the process-local refresh source only makes their current observations
reachable. Runtime implementation remains gated on that model evidence.

## A tracker notification refreshes one running attempt and preserves unrelated work

### Starting situation

No person directly triggers or observes this behavior. Dalph has one exact
unterminated Run R. Task A has planned attempt P at authored-instruction
fingerprint F1, Dalph's exact tracker claim K, and Git's exact registered
worktree W at planned Base SHA H. The Journal contains P's executor-work
responsibility and an exact `Running(P)` report. A is open, belongs to R's last
complete target closure, has complete blocker facts, and all of its
prerequisites are satisfied. P occupies one task-work position, and its
executor implementation may still be changing W.

Independent tasks B and C are in the same current target closure and need none
of A's claim, worktree, executor responsibility, or task-work position.
Capacity and their own current facts may allow B or C to continue while A is
checked.

The task tracker owns A's current lifecycle, dependency, membership,
instructions, and claim. Git owns W's registration, current contents, refs, and
lineage. The executor owns P's current attempt-level report. The Journal owns
only the accepted history above. The activation has no durable cached frontier
or wake fact.

### Outside event and trigger

Another tracker client replaces K, removes K, edits A's title or body from F1
to F2, closes or completes A, removes A from the target closure, or adds an
unfinished blocker. Alternatively, Git reports that W is no longer the exact
registered planned worktree or that H is no longer an ancestor of the current
target. Dalph does not infer who made either change.

The task tracker's notification for R reaches the application-level
reactivation owner. `TrackerNotification` is a refresh opportunity, not proof
of any change. If no tracker notification arrives, the configured bounded
timer is the only other event that supplies the same active-work refresh
opportunity.

For this already-Running A, an accepted-fact publication, including publication
of its newly accepted `Running(P)` report, does not supply this opportunity.
Recording or publishing a `Running`, `SafelySuspended`, or `Terminal` executor
report does not call the tracker-graph, focused task-instruction, claim,
Git-lineage, or worktree boundaries. Those reports remain executor facts, not
tracker or Git authority. Generic accepted-fact publication and Operator Wake
may still request #218's ordinary activation for other unfinished work; the
ordinary Running shortcut prevents them from refreshing A.

### Ordered boundary calls and result

1. The reactivation owner offers the notification to R's one serialized
   activation entry. Several tracker notifications or timer ticks that arrive
   before the read starts coalesce into one opportunity. A notification or
   timer tick arriving while the tracker or Git read is in flight requests at
   most one trailing refresh after the current activation returns. It does not
   start a second activation or concurrent coordinator path.
   If the active handoff rejects the opportunity or the activation finishes
   during the handoff, the owner retains that one marker and performs one
   trailing ordinary establishment/activation instead of losing the check.
2. The activation records and performs its existing complete tracker-graph
   read. It then records and performs only the focused tracker and Git reads
   selected for A by that complete observation: current title/body, exact
   claim, exact planned-worktree registration, and target lineage. Every read
   uses the existing journal-first intent and observation protocols.
3. If the current facts still prove A open and in the closure with complete
   prerequisites, F1, exact K, exact W, and valid lineage, Dalph records those
   observations and selects no executor command for P. It does not append or
   execute `StartOrContinue(P)` and does not manufacture a generic
   `ContinueAfterCurrentFacts` authorization. P simply remains the
   already-running responsibility it was before the refresh.
4. If the current read chain instead proves a constraint, Dalph keeps each
   boundary's evidence distinct: the complete tracker graph may prove A closed,
   completed, outside the target closure, or newly blocked; the focused
   title/body read may prove F2; the focused claim read may prove K missing or
   foreign; and Git may prove incompatible target lineage or a lost or
   mismatched W. Dalph records that exact observation and enters the
   existing task-local reconciliation route. When that route requires stopping
   executor activity, Dalph records one exact `Suspend(P)` intent and calls the
   executor's suspension boundary for P. It preserves K or the observed
   replacement claim, W and its work in progress, P's executor evidence, and
   every separate unfinished disposition. A successful tracker lifecycle may
   later release dependants or remove only Dalph's exact claim through its
   separately accepted protocols; this refresh does not perform those effects.
5. A continues to occupy its task-work position until an exact
   `SafelySuspended(P)` or `Terminal(P)` report is accepted. `Running(P)`, a
   foreign report, process disappearance, an unreadable authority result, or a
   recorded suspension intent does not release the position.
6. B and C continue through their own ordinary current-fact and capacity
   decisions. A's refresh or constraint never creates a Run-wide stop.

If a tracker graph, focused tracker, or Git read is incomplete, malformed,
throttled, or otherwise unreadable, Dalph records the typed outcome and
authorizes no executor command from it. The focused claim protocol may make its
existing three reads inside this one opportunity; exhaustion still does not
turn unreadability into a live-refresh suspension. The next tracker
notification or configured timer may offer a later fresh opportunity under the
existing bounded policy.

An accepted Pause stops timer and hint-driven Run-specific refresh after the
already-admitted activation boundary. Accepted Unpause performs ordinary
current reads before another refresh. If the application Exit cutoff closes,
the owner admits no new refresh; an already-admitted read reaches its existing
recoverable boundary. If R terminates, the owner discards every retained
refresh marker and never enters R again.

### Crash and retry

If Dalph crashes before accepting the refresh opportunity, the process-local
coalescing marker disappears. The next tracker notification or configured
timer supplies a new opportunity; no wake row is reconstructed.

If Dalph crashes after recording a tracker or Git read intent but before the
call, restart reuses that exact operation identity. If the provider returned
but the response was lost before observation, the existing read-only protocol
asks the same authority again with that identity and records the returned
fact; it does not infer a result from the trigger or process loss.

If Dalph crashes after recording a proven constraint but before recording the
`Suspend(P)` intent, restart reconstructs the constraint and selects the same
exact suspension. If it crashes after recording the intent but before the
executor call, restart reuses the intent. If the executor accepted the request
but its response was lost, restart asks the executor boundary for P's exact
attempt-level report before another command, as required by [D21 Intent before an
ambiguity-crossing effect](../DELIVERY-INVARIANTS.md#d21-intent-before-an-ambiguity-crossing-effect)
and [D22 Reconcile before
retry](../DELIVERY-INVARIANTS.md#d22-reconcile-before-retry). An exact
`Running(P)` report retains the position and unfinished suspension; an exact
`SafelySuspended(P)` or `Terminal(P)` report releases it. A crash after that
accepted safe or terminal report reconstructs the released position and does
not send a second suspension solely because the refresh is replayed.

The refresh opportunity itself is process-local and may be coalesced again;
tracker/Git intent and observation records and executor-command intent remain
the durable evidence. No provider mutation is retried by this scenario.

### Visible and forbidden results

There is no directly affected person in this chronology. A maintainer who
later inspects R sees A remain Running after healthy current reads, or sees A
move through its existing exact safe-suspension/constraint route while B and C
continue independently.

Dalph must not ask the executor to continue P merely because current facts are
healthy; use an accepted executor report, generic accepted-fact publication,
or Operator Wake as permission to read A's tracker or Git facts; start
overlapping refreshes or a second activation; release A's position before exact
safe or terminal acceptance; mutate a missing, foreign, or unreadable claim;
recreate, reset, or delete W; block B or C; turn an incomplete read into
absence; or persist a derived refresh/frontier state.

### Acceptance-test mapping

- `tracker notification refreshes a Running attempt and suspends it after an
  exact foreign claim while independent work continues` proves one coalesced
  notification enters the existing tracker/claim/worktree read chain, records
  the foreign claim, selects one exact `Suspend(P)`, retains A's position until
  exact safe acceptance, and leaves B/C eligible.
- `configured timer refreshes a Running attempt and suspends it after its exact
  worktree is lost` proves the timer is the notification-loss fallback and
  routes a proven Git constraint through the same suspension path.
- `healthy active-work refresh records current authority without continuing
  the Running executor` proves the successful read chain emits neither
  `StartOrContinue(P)` nor `ContinueAfterCurrentFacts`.
- `accepted executor report publication never refreshes tracker or Git
  authority` proves `Running`, `SafelySuspended`, and `Terminal` publication
  makes zero tracker-graph, focused instruction, claim, lineage, and worktree
  reads for the already-Running attempt.
- `coalesces concurrent active-work refresh opportunities into one authority
  read` proves notification/timer coalescing, one serialized activation owner,
  and at most one trailing refresh for opportunities arriving during a read.
- `recovers the exact active-work suspension after process loss without
  releasing its position early` cuts the process before `Suspend(P)` intent,
  after intent/before call, and after a lost call response; it directly asserts
  one intent, one initial call, an executor reread before any resend, zero
  duplicate `Suspend(P)`, and position release only after exact safe-or-terminal
  acceptance.
- `active-work refresh localizes every complete task and Git constraint while
  independent work continues` parameterizes changed instructions, lifecycle
  closure/success, membership loss, a newly unfinished blocker, incompatible
  lineage, and worktree mismatch; each exact observation selects only A's
  existing suspension route and leaves B/C independent.
- `unreadable active-work refresh neither continues nor suspends the Running
  attempt` proves exhausted focused-claim unreadability and incomplete graph or
  Git facts make zero executor calls, while a later notification/timer starts a
  new bounded read.
- `ordinary accepted-fact and Operator hints retain the Running shortcut`
  proves #218 still accepts those generic hints but neither performs A's
  tracker/Git refresh nor creates continuation authorization.
- `retains one trailing activation when an active refresh handoff cannot be
  accepted` proves a rejected handoff and an activation-finished race lose no
  refresh, start no concurrent activation, and produce at most one trailing
  establishment/activation.
- `Pause Exit and termination suppress later active-work refresh` proves Pause
  stops Run-specific refresh until accepted Unpause and current reads, Exit
  admits no later refresh, and termination discards the retained marker.
- Quint scenario `activeRefreshUnreadableDoesNotSuspendOrContinueTest` proves
  active-refresh unreadability selects no executor action while the existing
  ordinary-unreadable scenario still requests safe suspension. Its negative
  scenario deliberately treats the active refresh as an ordinary continuation
  and must fail the new source-sensitive property.

These named seams are required vertical production tests. Existing focused
protocol and model tests remain supporting evidence; aggregate gate totals do
not replace this scenario mapping.
