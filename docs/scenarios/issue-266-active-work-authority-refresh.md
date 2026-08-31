# Refresh tracker facts during autonomous work and suspend proven changes

Owning issue: [#266](https://github.com/dearlordylord/dalph/issues/266)

Status: accepted candidate integrated on the issue task branch and under final
review. Issue #266
closes the active-work bridge left when autonomous executor work replaced
repeated continuation commands: an accepted `ExecutorWorkExecuting` report
must not keep one live Run activation from checking whether current tracker or
Git facts prove a task-local constraint. Related accepted behavior remains
owned by
[#190](https://github.com/dearlordylord/dalph/issues/190),
[#53](https://github.com/dearlordylord/dalph/issues/53),
[#164](https://github.com/dearlordylord/dalph/issues/164),
[#137](https://github.com/dearlordylord/dalph/issues/137),
[#139](https://github.com/dearlordylord/dalph/issues/139), and
[#218](https://github.com/dearlordylord/dalph/issues/218).

## Governing behavior

The decision to check current facts while an executor already reports
`ExecutorWorkExecuting` is
governed by [A lost tracker notification is recovered by the bounded
timer](issue-218-reactivate-incomplete-runs.md#a-lost-tracker-notification-is-recovered-by-the-bounded-timer):
a tracker notification or configured timer asks Dalph to check current facts
but proves no work itself. This scenario refines that behavior only when the
same Run reconstructs an exact attempt with an accepted
`ExecutorWorkExecuting` report; it does not add a second Run activation,
scheduler, tracker lifecycle, or durable wake record.
[Several hints produce one activation and one optional trailing
check](issue-218-reactivate-incomplete-runs.md#several-hints-produce-one-activation-and-one-optional-trailing-check)
continues to own coalescing, a failed or raced handoff, and the Pause, Exit,
Unpause, and termination rules that this active-work case preserves.

For the resulting read, [#190](https://github.com/dearlordylord/dalph/issues/190)
remains the coordination owner,
[A later recorded tracker observation releases Task
B](issue-53-refresh-complete-task-pipelines.md#a-later-recorded-tracker-observation-releases-task-b)
remains the ordinary complete refresh-and-traversal owner, and
[A fresh read finds unchanged
facts](issue-164-journal-first-tracker-observations.md#a-fresh-read-finds-unchanged-facts)
remains the owner that records the complete normalized observation or compact
unchanged reconfirmation before reconstructed knowledge is used. This scenario
selects one opportunity and the exact executing attempts whose focused reads
are needed. It does not introduce a private graph/Git read protocol,
observation family, refresh ordinal, cache, or replay path.

[G2 is requested only after G1 is quiescent and reveals
B](issue-194-stabilize-each-run.md#g2-is-requested-only-after-g1-is-quiescent-and-reveals-b)
continues to own the one post-quiescence complete graph read. That later read
has a distinct cause and cannot satisfy this active-work opportunity.

The consequences of a successful current read preserve rather than replace
[Alice changes A's instructions while its planned attempt is
running](issue-136-reconcile-changed-task-facts.md#alice-changes-as-instructions-while-its-planned-attempt-is-running),
[Another tracker client replaces A's claim while A is
running](issue-137-reconcile-task-claims.md#another-tracker-client-replaces-as-claim-while-a-is-running),
[Scenario 12B: the integration target is rewritten outside the planned
lineage](issue-139-reconcile-git-facts.md#scenario-12b-the-integration-target-is-rewritten-outside-the-planned-lineage),
[Scenario 14A: Git no longer registers the planned
worktree](issue-139-reconcile-git-facts.md#scenario-14a-git-no-longer-registers-the-planned-worktree),
[D12 Position discipline](../DELIVERY-INVARIANTS.md#admission-and-capacity),
[D16 Work in progress survives every
constraint](../DELIVERY-INVARIANTS.md#preservation),
[D18 A constraint is local to its
subject](../DELIVERY-INVARIANTS.md#locality),
[D23 Incomplete and unreadable never prove
absence](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence),
and [D29 Authority separation](../DELIVERY-INVARIANTS.md#process-and-durability).

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

Issue #266 adds one bounded focused title/body read for each exact executing
attempt after the ordinary complete graph refresh. Issue
[#281](https://github.com/dearlordylord/dalph/issues/281) continues to own the
ordinary focused title/body read before beginning fresh work or safely resuming
one suspended attempt; that is a separate chronology and does not repeatedly
authorize work that is already executing. The #266 active-work read may detect
a constraint, but it cannot authorize a continuation or change the planned
fingerprint. Generic accepted-fact publication and Operator Wake remain
ordinary reactivation hints under #218; they do not grant this narrower
active-work refresh opportunity.

#266 refines #137's exhausted-unreadable suspension only in this live
refresh case. Three unreadable claim reads during an ordinary continuation
still enter #137's existing safe-suspension wait. During a refresh of an
attempt whose accepted report is `ExecutorWorkExecuting`, unreadability proves
neither loss nor permission and does not suspend the healthy executing work. A
later tracker notification or configured timer must start a new bounded read.
This trades immediate stopping for avoiding an inference from uncertainty; the
accepted #266 specification makes that trade-off explicit.

The task-fact model already distinguishes this case with
`ActiveRefreshUnreadableObservedAction` and proves with
`activeRefreshUnreadableAuthorizesNoExecutorAction` that active-refresh
unreadability selects neither continuation nor suspension. Existing executable
test `activeRefreshUnreadableDoesNotSuspendOrContinueTest` preserves that
positive evidence. Existing mutation-catching negative control
`activeRefreshUnreadableCannotRequestOrdinarySuspensionTest` deliberately
conflates the active refresh with ordinary suspension and demonstrates that the
property rejects it. #266 preserves this model evidence; it requires no Quint
change. Existing Git constraint transitions likewise need no change because the
process-local refresh source only makes their current observations reachable.

## Alice changes B while A1, B1, and C1 execute autonomously

### Starting situation

Alice maintains tracker instructions for tasks A, B, and C in one exact
unterminated Run R. Earlier complete graph observation G0 and focused reads
established planned attempts A1, B1, and C1 from F1-era tracker facts. Each
attempt has Dalph's exact tracker claim, one exact registered Git worktree at
its planned Base SHA, an executor-work responsibility, and an accepted
`ExecutorWorkExecuting` report. The three attempts hold three task-work
positions and their executor implementations may still be changing their own
worktrees.

A, B, and C are open in R's last complete target closure, have complete
blocker facts, and have no unfinished prerequisite. Their claims, worktrees,
executor responsibilities, and task-work positions are distinct. A1 and C1
need none of B1's facts and can continue while B is checked or suspended.

The task tracker owns each task's current lifecycle, dependency, membership,
instructions, and claim. Git owns each worktree's registration, current
contents, refs, and lineage. The executor owns each attempt's current
lifecycle report. The Journal owns only Dalph's accepted workflow history. The
activation has no durable cached frontier, active-attempt set, hint, timer, or
wake fact.

The notification or timer selects every exact `(RunId, AttemptId)` whose
accepted lifecycle report is `ExecutorWorkExecuting`; it never chooses an
arbitrary attempt. An attempt whose accepted report is
`ExecutorWorkSafelySuspended` or `ExecutorWorkTerminal` remains on its ordinary
path and is not converted into an active-refresh subject. Each selected
attempt receives its own focused tracker and Git facts. B1's source,
observations, constraint, and suspension decision never become A1's or C1's
facts. The Quint active-refresh model uses one representative exact subject
for this per-attempt law; runtime applies the law independently to every exact
executing attempt.

### Outside event and trigger

Alice edits B's title or body from F1 to F2 while A1, B1, and C1 continue
executing. That tracker edit is not a workflow event and authorizes no Dalph
action. The same read path may instead discover that another tracker client
replaced or removed one exact claim, closed or completed a task, removed it
from the target closure, or added an unfinished blocker. Git may report that
one exact planned worktree is no longer registered or that its planned Base is
no longer an ancestor of the current target. Dalph uses only the returned
authority facts and does not infer who made an alternative change.

The task tracker's notification for R reaches the application-level
reactivation owner. `TrackerNotification` is a refresh opportunity, not proof
of any change. If no tracker notification arrives, the configured bounded
timer is the only other event that supplies the same active-work refresh
opportunity.

For these already-executing attempts, an accepted-fact publication, including
publication of a newly accepted `ExecutorWorkExecuting` report, does not supply
this opportunity. Recording or publishing an `ExecutorWorkExecuting`,
`ExecutorWorkSafelySuspended`, or `ExecutorWorkTerminal` report does not call
the tracker-graph, focused task-instruction, claim,
Git-lineage, or worktree boundaries. Those reports remain executor facts, not
tracker or Git authority. Generic accepted-fact publication and Operator Wake
may still request #218's ordinary activation for other unfinished work; the
ordinary executing-work shortcut prevents them from refreshing A1, B1, or C1.

### Ordered boundary calls and result

1. The reactivation owner offers the notification to R's one serialized
   activation entry. Several tracker notifications or timer ticks that arrive
   before the read starts coalesce into one opportunity. A notification or
   timer tick arriving while the tracker or Git read is in flight requests at
   most one trailing refresh after the current activation returns. It does not
   start a second activation or concurrent coordinator path. At that activation
   boundary, Dalph enumerates every reconstructed attempt whose accepted report
   is `ExecutorWorkExecuting` and gives each exact pair its own active-read
   subject. It does not select one attempt by ordering, task ID, or capacity.
   If the active handoff rejects the opportunity or the activation finishes
   during the handoff, the owner retains that one marker and performs one
   trailing ordinary establishment/activation instead of losing the check.
2. #190 coordinates one read through the ordinary observation stack. #53
   performs the serialized complete refresh and traversal, and #164 records
   its normalized result before reconstructed knowledge is used. Equal graph
   contents may produce #164's compact unchanged reconfirmation, but they do
   not avoid the provider call. The activation then records and performs only
   the ordinary focused tracker and Git reads selected for A1, B1, and C1 by
   that complete observation: current title/body, exact claim, exact planned
   worktree registration, and target lineage. Each focused read links to this
   exact operation and uses its existing journal-first intent, observation,
   failure, and recovery protocol.
3. A1's and C1's current facts still prove their tasks open and in the closure
   with complete prerequisites, their planned fingerprints and exact claims,
   exact worktrees, and valid lineage. Dalph records those observations and
   selects no executor command for either attempt. It does not append another
   Begin or Resume or manufacture a continuation authorization. A1 and C1
   remain the same autonomously executing responsibilities.
4. B's focused task-work-specification read proves F2 rather than B1's planned
   F1. Dalph records that exact observation and enters #136's existing
   task-local changed-instruction route. It records one exact `Suspend(B1)`
   intent and asks the executor to suspend B1. It preserves B's exact claim,
   worktree and work in progress, B1's executor evidence, and every separate
   unfinished disposition. The same ordinary route localizes any independently
   proven lifecycle, membership, blocker, claim, worktree, or lineage
   constraint. A complete observation that B's exact claim is missing or held
   by another owner is a proven claim constraint and enters this `Suspend(B1)`
   route. An incomplete, unavailable, unreadable, malformed, or
   identity-contradictory boundary result proves no constraint and selects no
   executor command.
5. B1 continues to occupy its task-work position until an exact
   `ExecutorWorkSafelySuspended(B1)` or `ExecutorWorkTerminal(B1)` report is
   accepted. `ExecutorWorkExecuting(B1)`, a foreign report, process
   disappearance, an unreadable authority result, or a recorded suspension
   intent does not release the position.
6. A1 and C1 continue independently. B's refresh or constraint never creates a
   Run-wide stop or changes A/C's read source, evidence, lifecycle report, or
   task-work position.

If Alice makes another edit after this refresh completes, that edit waits for
the next independent tracker notification or configured timer. Dalph does not
manufacture an executor report, reuse the completed opportunity, or turn a
later state-changing protocol's own required current read into evidence for
this earlier cycle.

If a tracker graph, focused tracker, or Git read is incomplete, malformed,
throttled, or otherwise unreadable, Dalph records the typed outcome and
admits no new work and authorizes no executor command from it. It does not
immediately retry the active-work refresh or turn unreadability into a
suspension. The next independent tracker notification or configured timer may
offer a later fresh opportunity under the existing bounded policy.

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

If Dalph crashes after an ordinary tracker or Git read intent is recorded but
before the call, restart reuses that exact operation identity through the
read's existing owner. If the tracker returned but the response was lost
before #164 recorded the observation, its existing read-only protocol asks the
tracker again with that identity. If a Git response was lost, that ordinary
Git read owner asks Git again with its exact identity and records the returned
fact. Neither owner infers a result from the trigger or process loss.

If Dalph crashes after recording a proven constraint but before recording the
`Suspend(B1)` intent, restart reconstructs the constraint and selects the same
exact suspension. If it crashes after recording the intent but before the
executor call, restart reuses the intent. If the executor accepted the request
but its response was lost, restart asks the executor boundary for B1's exact
attempt-level report before another command, as required by [D21 Intent before an
ambiguity-crossing effect](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
and [D22 Reconcile before
retry](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence). An exact
`ExecutorWorkExecuting(B1)` report retains the position and unfinished
suspension; an exact `ExecutorWorkSafelySuspended(B1)` or
`ExecutorWorkTerminal(B1)` report releases it. A crash after that accepted
`ExecutorWorkSafelySuspended(B1)` or `ExecutorWorkTerminal(B1)` report
reconstructs the released position and does not send a second suspension solely
because the refresh is replayed.

The refresh opportunity itself is process-local and may be coalesced again;
tracker/Git intent and observation records and executor-command intent remain
the durable evidence. No provider mutation is retried by this scenario.

### Visible and forbidden results

Alice sees her tracker edit remain F2. A maintainer who later inspects R sees
B1 move through its existing exact changed-instruction and safe-suspension
route while A1 and C1 remain `ExecutorWorkExecuting` and continue
independently. If a read is unreadable, the maintainer instead sees the exact
responsibility and position retained until a later independent notification or
timer supplies another successful refresh.

Dalph must not ask the executor to continue A1, B1, or C1 merely because
current facts are healthy; use an accepted executor report, generic
accepted-fact publication, or Operator Wake as permission to read their
tracker or Git facts; start overlapping refreshes or a second activation;
release B1's position before exact `ExecutorWorkSafelySuspended(B1)` or
`ExecutorWorkTerminal(B1)` acceptance; mutate a missing, foreign, or unreadable
claim;
recreate, reset, or delete a worktree; block A1 or C1; turn an incomplete read
into absence; let this read stand in for another protocol's required current
read or #194's finality read; add a task-edit-specific timer, per-executor
poller, freshness SLA, or provider-load tuning subsystem; or persist a derived
refresh/frontier state.

### Acceptance-test mapping

An **existing test** (or **existing tests** when exact peers are grouped) below
names its literal current source title and owns only the assertions stated. An
**existing direct test** additionally executes the accepted chronology named by
this scenario. An **existing composed mapping** names complementary direct tests
that together own the accepted chronology without claiming that one test body
asserts every part. An **existing model test** names an executable Quint
scenario and proves only its model law. A **supporting test** (or **supporting
tests** for grouped peers) names an exact current test that owns a narrower
adjacent fact but not the accepted vertical chronology. **Rejected evidence**
names a current fixture whose premise conflicts with accepted authority
ownership and cannot satisfy the mapping even if it passes. Every previously
required vertical seam now has a direct or composed mapping below; issue
closure still waits for final review and the declared verification gates.
Exact existing titles that contain `Running` retain their source spelling for
traceability; scenario-owned prose uses `ExecutorWorkExecuting`,
`ExecutorWorkSafelySuspended`, and `ExecutorWorkTerminal`.

- **Existing test:** `tracker notification refreshes a Running attempt and
  suspends it after an exact foreign claim while independent work continues`
  exercises both complete authoritative missing-claim and foreign-exact-claim
  cases, selects the existing suspension disposition for the affected attempt,
  and leaves the independent attempt eligible in
  `packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts`.
  It does not substitute for the direct B/F2 or three-attempt production
  chronologies below.
- **Existing test:** `configured timer refreshes a Running attempt and suspends
  it after its exact worktree is lost` selects the existing lost-worktree
  suspension transition from a timer opportunity and preserves independent
  eligibility in
  `packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts`.
  **Existing direct test:** `lost or pre-subscription tracker notification is
  recovered by the ordinary timer and executes an active authority read` in
  `packages/dalph/src/application/production-reactivation.test.ts` drives the
  Timer source through the production-shaped owner and executes graph,
  instruction, claim, worktree, and lineage reads with no executor call.
- **Existing direct test:** `unchanged active-work refresh calls each ordinary
  provider once records reconfirmation and does not loop` in
  `packages/dalph/src/application/production-reactivation.test.ts` exercises
  the production graph, focused instruction, claim, worktree, and lineage
  selection, records the equal-graph reconfirmation after the provider call,
  and asserts one active opportunity and zero executor calls.
- **Existing test:** `shares one active graph read across Running attempts
  before their own focused reads` asserts one complete graph read precedes both
  exact attempts' focused instruction reads. **Existing test:** `refreshes two
  Running attempts through independent authority chains and suspends only the
  constrained subject` asserts task-local evidence and disposition for its two
  subjects. Both are in
  `packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts`.
- **Existing direct test:** `accepted B F2 refresh suspends only B1 while A1
  and C1 continue executing` starts all three exact attempts with accepted
  `ExecutorWorkExecuting` reports, records each exact focused instruction read,
  completes A1/C1's claim and Git chains, and proves only B1 receives Suspend.
  Its Safe and Terminal table proves the suspension intent precedes the exact
  settlement while A1/C1 receive no executor action. Once B's exact F2 read
  already proves the constraint, Dalph deliberately does not spend additional
  claim or Git reads on B; this preserves the minimal-provider-call rule while
  A1 and C1 still complete their healthy authority checks. The test is in
  `packages/dalph/src/application/production-reactivation.test.ts` and its
  Safe/Terminal table proves three positions remain held through the Suspend
  intent and B's position is absent only after the exact settlement.
  `restart holds the task-work position until an exact Safe or Terminal
  observation is accepted` and `restart releases the task-work position after
  an unchanged accepted Safe or Terminal passive replay` in
  `packages/orchestrator/src/control/task-work-capacity.test.ts` separately own
  the generic restart/capacity rule; they do not replace the A/B/C chronology.
- **Existing test:** `accepted executor report publication never refreshes
  tracker or Git authority` covers accepted publication of
  `ExecutorWorkExecuting`, `ExecutorWorkSafelySuspended`, and
  `ExecutorWorkTerminal` and asserts zero authority reads in
  `packages/dalph/src/application/production-reactivation.test.ts`.
- **Existing direct test:** `accepted publication notification and timer
  coalesce behind one active refresh and one trailing ordinary activation` in
  `packages/dalph/src/application/production-reactivation.test.ts` injects all
  three hints while the production-shaped refresh is active and asserts one
  serialized active entry followed by one ordinary entry. **Supporting test:**
  `turns hints arriving during an active refresh into one trailing ordinary
  activation` in
  `packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts`
  owns the lower-level one-trailing-marker rule.
- **Existing direct test:** `a later tracker edit waits for the next independent
  notification or timer` in
  `packages/dalph/src/application/production-reactivation.test.ts` records the
  post-first-refresh cut with no executor call, then supplies a second tracker
  notification and observes the changed instructions and suspension.
- **Existing direct tests:** `production refresh recovers a constraint observed
  before a crashed suspension intent`, `production refresh reuses a persisted
  suspension intent after a provider-entry crash`, and `production refresh
  reconciles an accepted suspension when its response append is lost` in
  `packages/dalph/src/application/production-reactivation.test.ts` execute the
  three suspension crash cuts. They prove one durable Suspend intent, reconcile
  current executor evidence before any resend, and accept the exact Safe report
  after response loss. The older projection test `recovers the exact active-work
  suspension after process loss without releasing its position early` remains
  supporting projection evidence, not the crash vertical.
- **Existing direct test:** `active-work refresh recovers ordinary authority
  reads without a private refresh protocol` in
  `packages/orchestrator/src/coordination/run/active-work-authority-refresh.acceptance.test.ts`
  tables graph, focused instruction, claim, worktree, and target-lineage reads
  at intent-before-call and response-before-observation cuts. It proves the
  existing ordinary owners reuse the same operation identity, reread only when
  no observation exists, and append only ordinary intent/outcome events.
- **Existing direct parameterized test:** `complete authoritative constraints
  including a missing or foreign exact claim suspend only their affected
  attempt: $name` in
  `packages/dalph/src/application/production-reactivation.test.ts` covers
  changed instructions, completed lifecycle, target-membership loss, a new
  unfinished blocker, missing claim, foreign claim, lost worktree, and
  incompatible lineage. Every case observes B's complete authority fact before
  one B-only Suspend/Safe chronology and asserts no A/C executor command.
- **Existing direct test:** `incomplete unavailable unreadable malformed or
  identity-contradictory active-work reads authorize no executor action` in
  `packages/dalph/src/application/production-reactivation.test.ts` executes the
  production boundary distinctions that remain representable after
  normalization: tracker failures become one typed `TrackerReadError`, bounded
  claim unreadability remains focused claim evidence, and a Git failure leaves
  its ordinary lineage intent unsettled. For each case it proves no executor
  call, one live activation at a time, retained executing responsibility, no
  immediate self-retry, and a second read only after another independent
  notification. It does not claim that the normalized graph boundary can emit
  an incomplete snapshot or preserve provider-specific malformed/throttled
  subtypes.
- **Supporting test:** `a later timer retries an unreadable active-work refresh
  as a fresh authority check` in
  `packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts`
  covers only owner scheduling of a later opportunity; the production
  uncertainty matrix above owns the boundary calls and no-action assertions.
- **Existing tests:** `AcceptedFactPublication for a Running report uses
  ordinary entry without A authority reads` and `Operator Wake remains an
  ordinary entry without active authority reads` prove those generic #218 hints
  use the ordinary executing-work shortcut in
  `packages/dalph/src/application/production-reactivation.test.ts`. The broader
  accepted-report test above owns all three lifecycle report variants.
- **Existing direct test:** `retains one trailing ordinary activation when the
  active handoff rejects` proves a rejected active handoff retains one marker,
  starts no concurrent activation, and performs exactly one trailing ordinary
  establishment/activation in
  `packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts`.
- **Existing direct test:** `accepted Pause suppresses active refresh until
  Unpause completes its ordinary current read` in
  `packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts`
  accepts Pause, offers notification/timer hints and advances controlled time,
  proves no active read while paused or during Unpause's blocked ordinary read,
  then observes a later notification only after that read completes.
  `stops the Run-specific timer on accepted Pause and starts one fresh timer on
  Unpause` and `replays durable Pause between observer attachment and the
  mandatory current read` remain narrower support for timer lifecycle and the
  attach/read race.
- **Existing direct test:** `lets an admitted active refresh record its read
  outcome before Exit rejects a later refresh` in
  `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts`
  blocks after the ordinary graph intent, requests Exit, proves a later Timer
  refresh never enters, then lets the admitted provider response become one
  durable observation before Exit completes. `keeps one owner per exact Run
  composition and lets Exit stop after the active boundary` remains narrower
  owner/drain evidence.
- **Existing composed mapping:** `starts each restarted owner with fresh timer,
  hint, and coalescing state` in
  `packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts`
  abandons a first owner with timer progress and queued hints, starts a second
  owner for the same Run, and proves it performs only its ordinary startup read
  until a new notification arrives. The ordinary-read and suspension crash
  tests above separately prove that ordinary operation and executor intent
  history survives; this owner test does not inspect journal records.
- **Existing direct test:** `active-work refresh and post-quiescence finality
  perform cause-ordered separate complete graph reads` in
  `packages/orchestrator/src/coordination/run/run-stabilization.test.ts` executes
  both provider calls through the ordinary journaled graph owner. It proves
  distinct identities, `ExecutingWorkAuthorityCheck` before
  `PostQuiescenceReconfirmation`, the G1 causal predecessor on G2, and separate
  ordered intent/outcome pairs. `retains the active boundary while a pending G2
  intent awaits replay` remains supporting projection evidence.
- **Supporting tests:** `stops its timer when activation returns
  RunMayTerminate` and `treats terminated history as closure and never
  schedules a fresh activation` cover the terminal decision and already
  terminated restart. `production composition wires current-first tracker
  notifications and fresh checks` covers production owner installation. None
  replaces the direct Pause, Exit, restart-state, or finality-separation tests.
- **Existing model test:** Quint scenario
  `activeRefreshUnreadableDoesNotSuspendOrContinueTest` proves
  active-refresh unreadability selects no executor action while the ordinary
  unreadable scenario still requests safe suspension. Existing
  mutation-catching negative control
  `activeRefreshUnreadableCannotRequestOrdinarySuspensionTest` erases the source
  distinction and demonstrates that the property rejects the mutation. The
  model's one representative subject does not replace runtime coverage
  selection and locality tests.

Aggregate gate totals do not replace any direct scenario test. In particular, a
supporting projection or owner test is not promoted to vertical evidence for a
boundary call, crash cut, or accepted issue chronology that it does not
execute.
