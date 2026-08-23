# Replace an exact changed attempt from clean resources

Issue:
[Clean-restart an exact changed attempt](https://github.com/dearlordylord/dalph/issues/66)

Status: accepted on 2026-08-11 after the five maintainer decisions recorded on
2026-08-09 through 2026-08-11. Runtime implementation remains unimplemented;
this file is the accepted operational-scenario gate for issue #66.

Issue #136 exposes the accepted Operator command
`RestartTaskImplementation`. “Restart” in that command means replacing
immutable planned task attempt P1 with exact successor P2; it does not mean
restarting the Run, choosing a restoration entry, or asking an executor to
restart a process. Renaming that accepted command requires a separate
maintainer decision. Issue #136 exposes it only after a current tracker read
proves that task instructions changed and the executor reports the exact old
attempt safely suspended. Issue #65 defines exact request redelivery,
first-journaled choice arbitration, writer-stoppage proof, and the integration
cutoff for the other two choices. Issue #137 defines what happens when the
tracker claim is missing, foreign, or unreadable. This scenario preserves those
chronologies rather than reviving the deleted frontier-recovery specification,
ADR, model, or executor-internal stages still linked from issue #66.
`docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md`, the former recovery ADR 0010, and
`specs/frontierRecovery.qnt` were deleted together in commit `360258012`; they
are historical evidence rather than current authorization.

## Accepted vocabulary

This scenario uses `PlannedAttemptReplaced` for the workflow event
that atomically makes one exact pre-integration planned task attempt no longer
unsettled and records its one exact successor. Its exact premises are the
recorded applied Restart choice, current executor quiescence evidence from
the unbroken exact safe-suspension report or the accepted late-terminal rule
below,
the recorded current exact `Planned worktree ready` observation containing
W1's current HEAD and proof that B1 is its ancestor, and the required current
tracker and target-head facts. It preserves P1's immutable plan and resources.
The Journal record is the event's durable envelope; neither the event nor its
envelope proves that P2's worktree exists or that executor work started.

The canonical attempt-choice request identity covers Continue, Restart, and
Stop for one exact
earlier/current task-revision fingerprint pair. D1 is that request identity; it
is not the applied direction or a workflow occurrence. The first valid choice
committed in the Journal wins for the pair. Exact request redelivery returns
the recorded choice result, while reuse for another Run, task, attempt,
fingerprint pair, or choice is contradictory. The canonical definitions are
recorded in [`CONTEXT.md`](../CONTEXT.md).

## Settled maintainer decision: Restart requires exact safe suspension

The maintainer accepted this decision on 2026-08-09: Alice may choose Restart
only after issue #136 has obtained an exact `SafelySuspended` planned-attempt
executor-work report for P1. Alice cannot choose Restart while P1 is `Running`.
Issue #66 owns no new interruption, writer-termination, or partial-evidence-
sealing protocol.

Issue #66's current “interruption intent is durable” acceptance text becomes
“the Restart choice and one `PlannedAttemptReplaced` event are durable.”
That event makes exact P1 no longer unsettled while it records
immutable planned task attempt P2; its journal record is the durable envelope.
No retained journal prefix contains a superseded P1 without P2. The
accepted generic executor boundary has no coding-agent session, inner process
tree, or partial-evidence manifest. The controlled fake therefore has no
separate evidence-sealing boundary to call. A future requirement to seal
executor-internal partial evidence needs a separate accepted coarse executor
contract. Generic Dalph must not inspect or reconstruct executor-internal
stages. The selected executor owns process observations, and the controlled
fake shares Dalph's process lifetime.

## Settled maintainer decision: preserve every P1 resource

The maintainer accepted this decision on 2026-08-09: after Dalph records
planned task attempt P2, it preserves every P1 resource. This includes P1's
worktree, branch, commits, and uncommitted work. Dalph's append-only journal
evidence also remains. If a future accepted executor contract exposes session
history or a separate evidence artifact, issue #66 preserves that resource.
Issue #66 performs no cleanup or disposal. Issue #67 owns every later resource
disposition, but workflow-journal history is never a cleanup target.

P2 starts in a different worktree at its exact Base SHA and receives no content
from P1. Replacement sends no cleanup request, so a crash creates no uncertain
cleanup result to reconcile. No issue #66 path may delete, reset, move, repair,
or reuse a P1 resource. Dalph keeps its P1 journal evidence. Any session history
or separate evidence artifact stays with the selected executor. The controlled
fake and the current generic executor boundary expose neither resource, so
there is no such fact to inspect and no fake cleanup boundary to call.

## Settled maintainer decision: record P1 replacement and P2 together

The maintainer accepted this decision on 2026-08-09: one workflow-journal event
atomically makes P1 no longer unsettled and records exact planned task attempt
P2. There is no two-event intermediate durable state.

A crash has two exact journal results. If the event is absent, P1 remains
unsettled and P2 is absent. If the event is present, P1 is superseded and exact
P2 exists. A later invocation enters the same idempotent Run-establishment
entry, folds that event, and gives the reconstructed Run to the same bounded
activation before it performs another action.

## Settled maintainer decision: P2 uses ordinary bounded admission

The maintainer accepted this decision on 2026-08-09: after Git proves P2's
planned worktree is ready, P2 follows ordinary bounded admission. Admission
gives P2 one task-work position before Dalph calls the existing executor
`startOrContinue` boundary for exact `(RunId, AttemptId)`. Alice sends no second
command.

This is the same activation surface after every process loss. A later process
invocation enters the one idempotent Run-establishment path accepted in
[ADR 0011](../adr/0011-establish-runs-idempotently-before-activation.md) and
the [Run-establishment chronology](run-establishment-and-activation.md),
reconstructs P2 and its exact unfinished responsibilities from Journal history,
and gives them to the ordinary bounded activation. No caller selects fresh
initialization, restoration, or a replacement-specific start procedure. The
activation uses the existing exact-attempt reconciliation rules before it
repeats an ambiguous executor request.

This choice does not bypass capacity, pause, or another ordinary admission
constraint. P2 may wait visibly until a task-work position is available, but
the wait creates no new Operator command or alternate startup entry.

## Accepted maintainer decision: a late Accepted report for P1

After the Restart choice correlated with D1 is committed in the Journal but
before the atomic `PlannedAttemptReplaced` event is appended, a later
start-or-continue command
may break the unbroken safe-suspension proof and an exact terminal `Accepted`
report for P1 may arrive. The accepted safe-suspension rule means that the
terminal report does not by itself authorize P2, and it never creates issue
#56's integration responsibility. Dalph preserves P1's accepted commit and
evidence. The terminal report ends P1's planned-attempt executor-work
responsibility and may replace the earlier safe-suspension report as the
current quiescence fact: it proves that no P1 writer remains, while preserving
the distinct accepted result.

Dalph then performs fresh task-tracker and Git reads. If they still prove the
exact F2 task facts, K1 claim, current P1 worktree readiness, and H2 target
head, the already committed Restart choice remains honored. Dalph appends
the atomic `PlannedAttemptReplaced` event for P1 and P2 and gives P2 ordinary
bounded admission; Alice does not choose Restart again. If those fresh reads
do not authorize replacement, no P2 is recorded and the exact reason remains
visible. In either outcome, P1's accepted result stays preserved evidence and
no P1 integration responsibility is created.

## Alice replaces P1 from F2 without carrying W1 into P2

### Starting situation

Alice is the Operator. The tracker contains open Task A and independent Task C.
A is inside Run R's complete target closure, its prerequisites are complete,
and its current authored title and body have fingerprint F2. The tracker still
contains Dalph's exact claim K1 for A. C needs none of A's facts or resources.

The journal records immutable planned attempt P1 for A at fingerprint F1, Base
SHA B1, branch `attempt-P1`, worktree W1, and one executor locator. It also
records the later complete tracker observation and focused specification read
that proved F2 differs from F1. The exact executor report for R and P1 says
`SafelySuspended`; no later start-or-continue command exists. P1 holds no
task-work position.

Git reports W1 registered to `attempt-P1`, with its commits and uncommitted WIP
still present. Git also reports the configured target ref at H2. No accepted
result, integration responsibility, integration start, planned task attempt P2,
P2 branch, or P2 worktree exists.

### Trigger and ordered boundary calls

1. Alice invokes Dalph's one production entry for exact R and its target. Dalph
   acquires exclusive coordinator ownership, discovers exact R from the Hot
   Journal partition, and reads, decodes, and
   reduces R's complete history. The reduction reconstructs R's latest control
   policy, exact P1 responsibility, and safe-suspension evidence. Dalph hands
   that established Run to one bounded activation. When R was first created,
   the same production entry appended its beginning, reduced the accepted
   history, and performed the same handoff. After process loss, it performs the
   scan and reconstruction described here. Alice selects no fresh or
   restoration mode, and every successfully established Run reaches the same
   activation surface.
2. Alice submits `RestartTaskImplementation` for exact R, A, P1, F1, and F2
   under one exact Restart request identifier D1.
3. Dalph checks that P1 is still before integration, that the Journal contains
   the unbroken exact safe-suspension report, and that no valid Continue,
   Restart, or Stop choice is already committed for the F1/F2 pair. It records
   Alice's applied Restart choice before selecting any replacement work.
4. Dalph records and performs a current complete target-closure read, a focused
   authored-instructions read for A, and an exact claim read. The tracker must
   report A open, in the closure, free of unfinished prerequisites, still at
   F2, and still carrying exact K1. These reads change no tracker state.
5. Dalph records and performs Git reads for W1 and the configured target ref.
   Git must still identify W1 as P1's exact registered worktree, report W1's
   current HEAD H1, and prove B1 is an ancestor of H1. That is the canonical
   exact `Planned worktree ready` observation for current W1. Git also returns
   H2 as the exact target head for the new planning decision. “Latest head”
   means H2 at this identified read; it does not mean an unrecorded head chosen
   later.
6. Because no later executor command broke the exact safe-suspension proof,
   Dalph sends no second executor request. Using the recorded applied Restart
   choice correlated with D1, the recorded current exact `Planned worktree ready`
   observation containing H1 and the B1-ancestry proof, the fresh exact K1 and F2
   eligibility observation, and the exact H2 Git observation, Dalph allocates
   P2 once and constructs one `PlannedAttemptReplaced` event. It
   appends a journal record containing that event and waits for acknowledgment.
   The event makes P1 no longer unsettled, ends only P1's planned-attempt
   executor-work responsibility, and records immutable planned task attempt P2.
   P1's immutable F1, B1, branch, W1, and executor locator do not change. P2
   binds F2, Base H2, a new attempt identity, a different branch, a different
   worktree W2, and its selected executor locator. The event does not dispose
   W1 or release K1.
7. The existing worktree protocol records intent, checks Git, and creates or
   discovers only exact W2. It never copies, merges, resets, or mounts W1 into
   W2. P2 then enters ordinary bounded admission. When capacity and the other
   ordinary constraints permit it, admission gives P2 one task-work position
   before Dalph calls the executor's existing `startOrContinue` boundary for
   exact R/P2. C remains selectable throughout.

W1, its old WIP, and P1's journal evidence remain available for inspection.
This is not “carrying old WIP”: P2's worktree begins at exact H2 and receives no
content from W1. Current invariant D16 forbids replacement from deleting W1 or
its WIP, and D17 requires a separate exact disposition before any later cleanup.
The maintainer rejected the deleted historical specification's default
worktree deletion as issue #66 behavior. Any session history or evidence
artifact exposed by a future accepted executor contract also remains at its
executor locator; generic Dalph does not inspect or copy it. The current
controlled fake has no such resource.

Issue #66 disposes no Git or tracker resource in this chronology. The exact P1
`PlannedAttemptReplaced` event settles its planned-attempt executor-work
responsibility, while its already released task-work position is process-local
and needs no cleanup. Issue #67 must authorize any later worktree, branch,
session history, or executor-owned evidence-artifact cleanup by exact identity.
Append-only workflow-journal evidence has no cleanup path.

### Crash and retry

If Dalph crashes after step 3, the next invocation enters the same
Run-establishment path, reconstructs the recorded result correlated with D1,
and continues the missing read-only checks through ordinary activation. Exact
redelivery of D1 records no second direction. Reusing D1 for another Run, task,
attempt, fingerprint pair, or choice is a typed contradiction. If Continue,
Restart, and Stop requests race, the first valid choice committed in the
Journal wins; later requests are stale regardless of arrival order or a lost
response.

If Dalph crashes while appending the `PlannedAttemptReplaced` event's Journal
record, the next invocation establishes the Run from the retained journal
before acting. When the record is absent, P1 remains unsettled and no P2
exists. The earlier in-memory P2 identity authorizes nothing and no W2 request
has crossed Git. The bounded activation repeats the current tracker and Git
   reads, allocates a fresh successor identity, and attempts a new
`PlannedAttemptReplaced` append. When the record is present, its event
reconstructs both P1's outcome and exact P2, and no new successor identity is
allocated. Ordinary activation continues exact planned task attempt P2 and
reconciles W2 through Git before another create request. It does not allocate
P3 merely because no executor report for P2 is present.

### Visible and forbidden result

Alice sees the Restart choice correlated with D1 applied, P1 durably superseded,
K1 retained, and P2 planned from F2 and H2. She sees P1's branch, worktree,
commits, uncommitted work, and Journal evidence preserved. The controlled fake
has no session-history UI. A future accepted executor contract must define how
Alice sees its preserved session history. P2 may visibly wait for capacity;
applying Restart is not task-work admission. C continues whenever its own facts
and capacity allow.

Dalph must not run P1 and P2 concurrently; retain a journal prefix in which P1
is superseded but P2 is absent; change P1's immutable facts; release, reacquire,
or replace K1 merely because Alice chose Restart; reuse W1, its branch, or its
WIP for P2; delete or reset W1; discard any P1 commit, uncommitted work, or
journal evidence; ask an executor to discard session history or an evidence
artifact; start P2 without a task-work position; treat H2 as current without
its Git read; cross the integration boundary; complete A in the tracker; or
block C behind A's local replacement work.

### Invariant trace

Current invariants already forbid changing P1's immutable facts (D2), retaining
two unsettled attempts for A (D3), deleting W1 or its WIP during replacement
(D16), stopping C because A is constrained (D18), treating executor or claim
results as tracker completion (D24), and restoring a capability after
integration starts (D46).

The delivery specification states that only the exact applied Restart
direction, current executor quiescence evidence (the unbroken
`SafelySuspended` report or a durably published late terminal `Accepted` report
as described below), the recorded current exact W1 `Planned worktree ready`
observation containing H1 and the B1-ancestry proof, and the recorded F2, K1,
and H2 facts may authorize the one `PlannedAttemptReplaced` event that
simultaneously makes P1 no longer unsettled and records P2. `Completed` and
`Failed` do not authorize that event, and terminal `Accepted` authorizes it
only after the fresh task and Git checks; no terminal report creates P1
integration responsibility. Restart retains K1 and sends no claim mutation,
and W2 receives no content from W1 while W1 remains preserved for a separately
authorized disposition. D49 covers exact Restart redelivery and
first-journaled arbitration with Continue and Stop.

### Acceptance-test and cassette mapping

- `Alice replaces F1 with F2 only after P1 is safely suspended and records
  planned task attempt P2 from exact F2 and H2`
- `keeps P1's worktree branch commits uncommitted work and journal evidence
  while P2 starts from a clean W2`
- `sends no executor cleanup request and treats fake session history and
  evidence artifacts as not applicable`
- `retains exact K1 throughout clean replacement without another tracker
  mutation`
- `coalesces exact Restart redelivery and lets the first of Continue Restart
  and Stop win`
- `records one PlannedAttemptReplaced event and planned task attempt P2 in one
  Journal append`
- `requires W1 current HEAD and B1 ancestry in the recorded Planned worktree
  ready observation before PlannedAttemptReplaced`
- `reuses one recorded planned task attempt P2 after process loss instead of
  allocating P3`
- `admits planned task attempt P2 through ordinary bounded admission without a
  second Operator command`
- `uses the same Run-establishment entry and bounded activation before
  processing the request correlated by D1 and after process loss`
- authored and recorded cassette `changedAttemptRestartsCleanly`
- authored and recorded cassette `changedAttemptRestartAfterSupersessionCrash`

## Current tracker or Git facts do not authorize P2

### Starting situation and outside changes

Dalph has recorded the applied Restart choice correlated with D1, but no
`PlannedAttemptReplaced` event or planned task attempt P2 exists. One of these
outside events then occurs:

- Alice edits A again, and the focused tracker read returns F3 instead of the
  F2 carried by D1;
- another tracker client removes K1 or replaces it with K2;
- the tracker cannot return a readable exact claim or complete blocker facts;
  or
- Git cannot return a readable target head for the configured ref; or
- Git reports W1 absent, registered to another branch or path, detached,
  duplicated, malformed, unable to prove B1 is an ancestor of its current HEAD,
  or otherwise not P1's exact ready worktree.

Before the listed outside event, W1 and its WIP have the first scenario's exact
facts. P1 remains safely suspended in every branch. The tracker and target-head
branches leave W1 and WIP preserved. In the non-ready-W1 branch, Dalph preserves
P1's plan, K1, journal evidence, the branch and worktree facts Git still
reports, and every still-readable resource. It does not infer whether bytes
that Git can no longer report were preserved or disposed. C remains
independent.

### Ordered boundary calls, crash, and retry

Dalph records each read intent and the exact F3, missing, foreign, unreadable,
or Git failure result it actually receives. An F3 observation makes the F1/F2
Restart choice carried by D1 stale for planning and exposes a new exact F1/F3
choice; Dalph does not silently plan P2 from F3. For an unreadable claim, Dalph
tries to read A's claim up to three
times during this activation and sends no tracker mutation between reads. An
exact K1 result permits the remaining checks; three unreadable results record
the exhausted observation and enter issue #137's local claim wait. A missing or
foreign claim enters the matching issue #137 behavior and sends no claim
mutation. An unreadable complete tracker read or Git target read remains a
typed wait and proves no fingerprint, blocker absence, claim ownership, or Base
SHA. Any non-ready W1 result enters issue #139's exact task-local Git behavior:
Dalph records the concrete Git result, preserves every observed resource, and
records no `PlannedAttemptReplaced` event or planned task attempt P2.

Because these are read-only boundary calls, there is no uncertain external
mutation to reconcile. If Dalph crashes between unreadable claim reads, the
process-local read count is lost; the next invocation establishes the Run and
ordinary activation begins a new set of at most three reads without inferring
either K1 ownership or loss. If Dalph crashes after recording another read
intent without its result, ordinary activation repeats that exact read. After
a recorded result, Run establishment reconstructs the same wait or new choice
and obtains a later identified read only when ordinary activation calls for
one.

### Visible and forbidden result

Alice sees why no P2 exists: A changed again, K1 is not exact, the tracker is
unreadable, Git has not supplied a Base, or Git reported the exact W1
contradiction. C remains selectable. Dalph must not replace P1, allocate P2,
use the F1/F2 choice carried by D1 for F3, mutate K2, reacquire an absent claim
merely because the Restart choice correlated with D1 was applied, infer readable
Git state, repair or recreate W1, delete any resource Git still reports, infer
that missing WIP is disposable, or turn A's local wait into a Run-wide stop.

### Acceptance-test and cassette mapping

- `requires a new Restart choice when F3 arrives before planned task attempt P2
  is recorded`
- `keeps P1 suspended and sends no mutation when K1 is absent foreign or
  unreadable`
- `stops replacement planning after three unreadable K1 reads in one
  activation`
- `plans no successor while the target head is unreadable`
- `delegates a non-ready W1 observation to issue 139 without replacing P1`
- `lets independent C continue while A waits for replacement facts`
- authored and recorded cassette `changedAttemptRestartFactsChanged`
- authored and recorded cassette `changedAttemptRestartClaimUnavailable`
- authored and recorded cassette `changedAttemptRestartWorktreeNotReady`

## A late terminal report does not discard an already applied Restart

### Starting situation and executor result

Dalph has durably recorded the applied Restart choice correlated with D1, but a
later start-or-continue command for P1 means the earlier #136 safe-suspension
proof is no longer unbroken. Dalph records the exact suspension command intent
and asks the executor to suspend exact R/P1 through the existing
planned-attempt executor protocol. Its direct result or later projection may
report P1 `Running`, `SafelySuspended`, or `Terminal` with `Completed`,
`Failed`, or `Accepted`; report a different Run or attempt; or be unreadable.

### Ordered behavior, crash, and retry

Dalph records the exact readable executor result. While P1 is `Running`, the
correlation contradicts R/P1, or the executor is unreadable, Dalph retains P1's
planned-attempt executor-work responsibility, K1, W1, WIP, and every Journal
fact. The Journal does not say P1 was superseded, and no planned task attempt P2
exists. C continues. A later activation may ask the executor for exact R/P1
evidence under the existing bounded suspension protocol.

An exact `SafelySuspended` report supplies the safe-suspension evidence used by
the first scenario. Exact terminal `Completed` and `Failed` reports end only
P1's planned-attempt executor-work responsibility and remain preserved under
their distinct results, but they do not authorize replacement. They do not
prove A completed in the tracker, supply an accepted Git result, or create P2.

An exact late terminal `Accepted` report is different in one bounded respect:
it preserves its exact commit and evidence, creates no issue #56 integration
responsibility, and ends P1's planned-attempt executor-work responsibility.
Once that report is durably published, it may replace the earlier
safe-suspension report as the current executor quiescence fact because it proves
that no P1 writer remains. It does not by itself authorize P2 or prove Run
completion. Dalph performs fresh task-tracker and Git reads. If those reads
still prove F2, K1, the exact current P1 worktree readiness, and H2, D1 remains
honored and Dalph appends the atomic `PlannedAttemptReplaced` event for P1 and
P2. P2 then follows ordinary bounded admission; Alice does not choose Restart
again. If any fresh fact is missing, unreadable, or changed, no P2 is recorded
and the exact wait or contradiction remains visible without creating an
integration responsibility.

After a crash, the next invocation establishes the Run through the same entry,
reconstructs the unresolved suspension command or the durable terminal report,
and checks the executor before another state-changing request. A durable late
`Accepted` report remains evidence across restart, and fresh task/Git checks
still decide whether the already applied D1 can produce P2. In the controlled
fake composition, the fake dies with Dalph and is recreated for the same R/P1
protocol; Dalph does not claim an old response survived. Process loss, timeout,
missing session data, and a report for another attempt prove no writer stopped.

### Visible and forbidden result

When the executor reports `Running`, Alice sees “Restart is waiting because P1
is still running.” A report for another Run or attempt produces a typed
correlation contradiction naming expected R/P1 and the reported pair. An
unreadable executor produces a typed “Restart is waiting for an exact P1
report” result. Alice sees `Completed` and `Failed` preserved under their own
names with no replacement. For late `Accepted`, she sees the exact commit and
evidence preserved, no integration responsibility, and—when fresh F2/K1/Git
facts still authorize it—the same applied Restart produce P2 without another
command. Dalph must not release K1, discard W1, integrate the late commit,
record P2 from a running, contradictory, or unreadable report, or ask Alice to
reapply D1 merely because the accepted report arrived late. It must not call A
completed from `Completed` or `Failed`.

### Acceptance-test and cassette mapping

- `preserves P1 and records no planned task attempt P2 while an exact writer
  may remain`
- `checks the executor after process loss before repeating P1 suspension`
- `does not treat process loss or an unrelated terminal report as safe
  suspension evidence`
- `preserves Completed and Failed separately without completing A in the
  tracker`
- `ends only P1 executor-work responsibility after each exact terminal report`
- `does not authorize PlannedAttemptReplaced from Completed or Failed`
- `uses a late Accepted report as current quiescence evidence after fresh
  checks and honors the already applied Restart without a second command`
- `preserves a late Accepted commit without creating integration after the
  Restart choice correlated with D1 was committed`
- `does not append issue 56's integration responsibility when the Restart
  choice correlated with D1 was committed before a late Accepted terminal`
- authored and recorded cassette `changedAttemptRestartRemainsUnproved`
- authored and recorded cassette `changedAttemptRestartLateAccepted`

## Alice requests Restart after integration has begun

### Starting situation and trigger

The journal already records the exact integration start for P1's accepted
result. Candidate construction, verification, promotion, or tracker completion
may still be pending. Alice submits a new `RestartTaskImplementation` request
for P1.

### Ordered behavior, crash, retry, and visible result

The control boundary rejects Alice's request as past the pre-integration
cutoff. It records no applied Restart choice and sends no executor, tracker,
Git, evidence, cleanup, or disposition request. Since no outside request is
sent, there is no uncertain boundary result to reconcile after a crash. Exact
redelivery of D1 whose Restart choice was committed before the cutoff still
returns the recorded result correlated with D1; it does not become a new
post-cutoff request.

Alice sees Restart rejected. Dalph must not cancel integration, roll Git back,
release the claim, dispose either worktree, or create a successor attempt.

### Acceptance-test and cassette mapping

- `rejects Restart after the exact integration cutoff without crossing a
  boundary`
- authored and recorded cassette
  `changedAttemptRestartPastIntegrationRejected`

## Model and implementation handoff mapping

Implementation of this accepted scenario requires extending
`specs/taskFactReconciliation.qnt`, its collected tests, and its executable
production adapter. The model seam must add Restart as the third exact F1/F2
choice, represent one `PlannedAttemptReplaced` event separately from preserved
W1 and K1, and allow that event only after exact unbroken `SafelySuspended`
evidence or a durably published late `Accepted` report serving as current
quiescence evidence, a recorded current exact W1 `Planned worktree ready`
observation containing H1
and B1 ancestry, and recorded F2/K1/H2 facts. Its properties must state that
the first valid Continue, Restart, or Stop choice committed in the Journal
wins; no state contains superseded P1 without P2; P1 and P2 never both remain
unsettled; P2 carries no W1 content; F3 needs a new choice; unreadable facts
authorize no successor; the three terminal result variants remain distinct; a
non-ready W1 authorizes no successor; a late Accepted commit starts no
integration after the Restart choice correlated with D1 was committed; no
terminal variant alone authorizes `PlannedAttemptReplaced` (late `Accepted`
may supply current quiescence only when D1 and fresh facts also authorize the
event); and integration start removes the Restart capability.
The executable conformance path must compose that model with the existing
`specs/plannedAttemptExecutor.qnt` suspension protocol. It must reject a
Restart request while P1 is `Running`. If a later command breaks the retained
safe-suspension proof after Restart was applied, the composition may use only
the existing planned-attempt executor-work suspension protocol. It must not add
an evidence-bearing executor result or inspect executor-internal work.

The late-`Accepted` branch is also an amendment to
`docs/scenarios/issue-56-queue-accepted-integration.md`. Its implementation
must change that scenario, `specs/acceptedResultIntegration.qnt`,
`packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts`, and
the production protocol under
`packages/orchestrator/src/workflow/protocols/integration-admission/` together.
Their composition must prove `does not append issue 56's integration
responsibility when the Restart choice correlated with D1 was committed before a
late Accepted terminal`, while unchanged accepted terminals still receive one
responsibility exactly once.
The authored and recorded `changedAttemptRestartLateAccepted` cassette is
the controlled-fake boundary record for that branch.

The accepted vocabulary section above is also recorded in `docs/CONTEXT.md`;
the three-choice request identity expansion and `PlannedAttemptReplaced` must
remain the same terms in implementation and tests.

ADR 0002 must be amended with a replacement-specific planning action rather
than weakening ordinary `RecordTaskAttemptPlan`. Its exact causal evidence is
the recorded applied Restart choice correlated with D1, the later claimed-task
eligibility observation for F2 and K1, the recorded current exact W1
`Planned worktree ready` observation containing current HEAD H1 and proof that
B1 is its ancestor, and the recorded H2 Git observation. The replacement
action appends the one P1/P2 record; changing an operation identity alone
remains no permission to replace an attempt.

The implementation handoff must map every seam above to a passing
test, the maintained authored and recorded cassettes, and the owning model
scenario. It must state the concrete non-applicability of executor-internal
partial evidence for the controlled fake. Aggregate gate totals cannot replace
that mapping.
