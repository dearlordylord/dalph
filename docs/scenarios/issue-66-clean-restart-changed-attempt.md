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
the unbroken exact safe-suspension report,
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
only after issue #136 has obtained an exact `ExecutorWorkSafelySuspended` planned-attempt
executor-work report for P1. Alice cannot choose Restart while P1 is
`ExecutorWorkExecuting`.
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
`begin` boundary for exact `(RunId, AttemptId)`. Alice sends no second
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

## Issue #264 amendment: a terminal choice cancels an unissued Resume

Issue #264 supersedes the former late-Resume amendment in this file. Restart is
available only while the latest accepted lifecycle report is
`ExecutorWorkSafelySuspended` and no executor command is unsettled. If a Resume
delivery owner was admitted but has not contacted the executor, applying Stop
or Restart cancels that owner before it can record a Resume intent or cross the
boundary. A Resume that already recorded an intent makes the terminal choice
unavailable; a settled executing response replaces the accepted Safe report
and also makes the choice unavailable.

Consequently, current Restart authorization retains the accepted Safe report
through the fresh task and Git reads. A passive Safe-to-Executing projection,
an unaccepted terminal projection, a raw command response, or a merely admitted
Resume owner cannot replace that accepted report or authorize P2. The former
`StartOrContinue` vocabulary remains historical documentation and proof
terminology only. The current journal schema does not decode the ambiguous
command; a retained provisional journal needs an explicit offline migration
before use and cannot supply live replacement permission.

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
`ExecutorWorkSafelySuspended`; no later Resume command exists. P1 holds no
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
   before Dalph calls the executor's existing `begin` boundary for
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
direction, current executor quiescence evidence from the unbroken latest
accepted `ExecutorWorkSafelySuspended` report with no unsettled command, the
recorded current exact W1 `Planned worktree ready`
observation containing H1 and the B1-ancestry proof, and the recorded F2, K1,
and H2 facts may authorize the one `PlannedAttemptReplaced` event that
simultaneously makes P1 no longer unsettled and records P2. A distinct terminal
report does not authorize that event. Terminal `Accepted` follows ordinary
integration admission; `Completed` and `Failed` remain their exact terminal
outcomes. Restart retains K1 and sends no claim mutation,
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

## Superseded historical late-Resume chronology

Pre-#264 journals may contain a Restart followed by the former
`StartOrContinue`/suspension chronology. That vocabulary remains historical
documentation and proof terminology only. The current journal schema does not
decode it, because an ambiguous conversion to Begin or Resume could grant
false authority; a retained provisional journal requires an explicit offline
migration outside issue #264. Current recovery is governed by issue #264: a
durable Resume intent makes Restart unavailable, and a distinct accepted
Terminal after an applied Restart is absorbing and follows ordinary
integration admission. There is no maintained authored cassette for the
superseded path.

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
W1 and K1, and allow that event only after exact unbroken `ExecutorWorkSafelySuspended`
evidence, a recorded current exact W1 `Planned worktree ready` observation containing H1
and B1 ancestry, and recorded F2/K1/H2 facts. Its properties must state that
the first valid Continue, Restart, or Stop choice committed in the Journal
wins; no state contains superseded P1 without P2; P1 and P2 never both remain
unsettled; P2 carries no W1 content; F3 needs a new choice; unreadable facts
authorize no successor; a non-ready W1 authorizes no successor; and integration
start removes the Restart capability. It must also prove that Stop and Restart
cancel an admitted-but-unissued Resume before executor contact, retain the
accepted Safe report, and make a newly admitted or newly issued Resume invalid.
The executable conformance path must reject a Restart request while P1 is
`ExecutorWorkExecuting`; it must not synthesize a Safe-to-Executing transition,
issue a replacement-specific Suspend, or inspect executor-internal work.

Issue #264 also supersedes the former late-`Accepted` amendment to
`docs/scenarios/issue-56-queue-accepted-integration.md`. A current accepted
terminal result follows ordinary integration admission unless a separately
accepted current rule says otherwise; an artifact produced by a future
explicit offline migration is not itself live integration or replacement
authority. No legacy command enters the current journal schema directly.

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
