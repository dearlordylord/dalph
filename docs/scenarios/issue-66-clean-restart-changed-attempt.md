# Clean-restart an exact changed attempt

Issue:
[Clean-restart an exact changed attempt](https://github.com/dearlordylord/dalph/issues/66)

Status: proposed on 2026-08-08. The first two maintainer decisions were
accepted on 2026-08-09. The remaining choices and the full scenario still
await maintainer acceptance, so this file does not authorize behavior-changing
implementation.

Issue #136 already exposes `RestartTaskImplementation` only after a current
tracker read proves that task instructions changed and the executor reports the
exact old attempt safely suspended. Issue #65 defines exact request redelivery,
first-journaled choice arbitration, writer-stoppage proof, and the integration
cutoff for the other two choices. Issue #137 defines what happens when the
tracker claim is missing, foreign, or unreadable. This proposal preserves those
chronologies rather than reviving the deleted frontier-recovery specification,
ADR, model, or executor-internal stages still linked from issue #66.
`docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md`, the former recovery ADR 0010, and
`specs/frontierRecovery.qnt` were deleted together in commit `360258012`; they
are historical evidence rather than current authorization.

## Settled maintainer decision: Restart requires exact safe suspension

The maintainer accepted this decision on 2026-08-09: Alice may choose Restart
only after issue #136 has obtained an exact `SafelySuspended` planned-attempt
executor-work report for P1. Alice cannot choose Restart while P1 is `Running`.
Issue #66 owns no new interruption, writer-termination, or partial-evidence-
sealing protocol.

Issue #66's current “interruption intent is durable” acceptance text must now
become “the Restart direction and one proposed planned-attempt replacement
event are durable.” That event makes exact P1 no longer unsettled while it
records immutable planned task attempt P2; its journal record is the durable
envelope. No retained journal prefix contains a superseded P1 without P2. The
accepted generic executor boundary has no coding-agent session, inner process
tree, or partial-evidence manifest. The controlled fake therefore has no
separate evidence-sealing boundary to call. The issue owner must amend the
criterion before this proposal can become accepted; merging this proposed file
alone does not satisfy it. A future requirement to seal executor-internal
partial evidence needs a separate accepted coarse executor contract. Generic
Dalph must not inspect or reconstruct executor-internal stages. The selected
executor owns process observations, and the controlled fake shares Dalph's
process lifetime.

## Settled maintainer decision: preserve every P1 resource

The maintainer accepted this decision on 2026-08-09: after Dalph records
planned task attempt P2, it preserves every P1 resource. This includes P1's
worktree, branch, commits, and uncommitted work. Dalph's append-only journal
evidence also remains. If a future accepted executor contract exposes session
history or a separate evidence artifact, issue #66 preserves that resource.
Issue #66 performs no cleanup or disposal. Issue #67 owns every later resource
disposition, but workflow-journal history is never a cleanup target.

P2 starts in a different worktree at its exact Base SHA and receives no content
from P1. Restart sends no cleanup request, so a crash creates no uncertain
cleanup result to reconcile. No issue #66 path may delete, reset, move, repair,
or reuse a P1 resource. Dalph keeps its P1 journal evidence. Any session history
or separate evidence artifact stays with the selected executor. The controlled
fake and the current generic executor boundary expose neither resource, so
there is no such fact to inspect and no fake cleanup boundary to call.

## Next maintainer decision: record P1 replacement and P2 together

Should one workflow-journal event make P1 no longer unsettled and record
planned task attempt P2?

I recommend one event. It gives a crash two exact results: P1 is unsettled and
P2 is absent, or P1 is superseded and exact P2 exists.

Otherwise, issue #66 must use two events and define the intermediate state,
crash recovery, and actor-visible result. Recording P1 supersession first
leaves no successor. Recording P2 first conflicts with D3 because P1 and P2
are both unsettled.

## Alice restarts P1 from F2 without carrying W1 into P2

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

1. Alice submits `RestartTaskImplementation` for exact R, A, P1, F1, and F2
   under one exact proposed Restart request identifier D1.
2. Dalph checks that P1 is still before integration, that the journal contains
   the unbroken exact safe-suspension report, and that no Continue, Restart, or
   Stop choice already won for the F1/F2 pair. It records Alice's applied
   Restart direction before selecting any replacement work.
3. Dalph records and performs a current complete target-closure read, a focused
   authored-instructions read for A, and an exact claim read. The tracker must
   report A open, in the closure, free of unfinished prerequisites, still at
   F2, and still carrying exact K1. These reads change no tracker state.
4. Dalph records and performs Git reads for W1 and the configured target ref.
   Git must still identify W1 as P1's worktree and returns H2 as the exact
   target head for the new planning decision. “Latest head” means H2 at this
   identified read; it does not mean an unrecorded head chosen later.
5. Because no later executor command broke the exact safe-suspension proof,
   Dalph sends no second executor request. Using D1, the fresh exact K1 and F2
   eligibility observation, and the exact H2 Git observation, Dalph allocates
   P2 once and constructs one proposed planned-attempt replacement event. It
   appends a journal record containing that event and waits for acknowledgment.
   The event makes P1 no longer unsettled, ends only P1's planned-attempt
   executor-work responsibility, and records immutable planned task attempt P2.
   P1's immutable F1, B1, branch, W1, and executor locator do not change. P2
   binds F2, Base H2, a new attempt identity, a different branch, a different
   worktree W2, and its selected executor locator. The event does not dispose
   W1 or release K1.
6. The existing worktree protocol records intent, checks Git, and creates or
   discovers only exact W2. It never copies, merges, resets, or mounts W1 into
   W2. Ordinary bounded admission may later give P2 one task-work position and
   ask the executor to start P2. C remains selectable throughout.

W1, its old WIP, and P1's journal evidence remain available for inspection.
This is not “carrying old WIP”: P2's worktree begins at exact H2 and receives no
content from W1. Current invariant D16 forbids restart from deleting W1 or its
WIP, and D17 requires a separate exact disposition before any later cleanup.
The maintainer rejected the deleted historical specification's default
worktree deletion as issue #66 behavior. Any session history or evidence
artifact exposed by a future accepted executor contract also remains at its
executor locator; generic Dalph does not inspect or copy it. The current
controlled fake has no such resource.

Issue #66 disposes no Git or tracker resource in this chronology. The exact P1
replacement event settles its planned-attempt executor-work responsibility,
while its already released task-work position is process-local and needs no
cleanup. Issue #67 must authorize any later worktree, branch, session history,
or executor-owned evidence-artifact cleanup by exact identity. Append-only
workflow-journal evidence has no cleanup path.

### Crash and retry

If Dalph crashes after step 2, restart returns D1's recorded result and
continues the missing read-only checks. Exact redelivery of D1 records no
second direction. Reusing D1 for another Run, task, attempt, fingerprint pair,
or choice is a typed contradiction. If Continue, Restart, and Stop requests
race, the first valid choice acknowledged by the journal wins; later requests
are stale regardless of arrival order.

If Dalph crashes while appending the replacement event's journal record,
restart folds the retained journal before acting. When the record is absent,
P1 remains unsettled and no P2 exists. The earlier in-memory P2 identity
authorizes nothing and no W2 request has crossed Git. A later activation repeats
the current tracker and Git reads, allocates a fresh proposed successor
identity, and attempts a new replacement-event append. When the record is
present, its event reconstructs both P1's outcome and exact P2, and no new
successor identity is allocated. Recovery continues exact planned task attempt
P2 and reconciles W2 through Git before another create request. It does not
allocate P3 merely because no executor report for P2 is present.

### Visible and forbidden result

Alice sees D1 applied, P1 durably superseded, K1 retained, and P2 planned from
F2 and H2. She sees P1's branch, worktree, commits, uncommitted work, and
journal evidence preserved. The controlled fake has no session-history UI. A
future accepted executor contract must define how Alice sees its preserved
session history. P2 may visibly wait for capacity; applying Restart is not
task-work admission. C continues whenever its own facts and capacity allow.

Dalph must not run P1 and P2 concurrently; retain a journal prefix in which P1
is superseded but P2 is absent; change P1's immutable facts; release, reacquire,
or replace K1 merely because Alice chose Restart; reuse W1, its branch, or its
WIP for P2; delete or reset W1; discard any P1 commit, uncommitted work, or
journal evidence; ask an executor to discard session history or an evidence
artifact; treat H2 as current without its Git read; cross the integration
boundary; complete A in the tracker; or block C behind A's local replacement
work.

### Invariant trace required before acceptance

Current invariants already forbid changing P1's immutable facts (D2), retaining
two unsettled attempts for A (D3), deleting W1 or its WIP during restart (D16),
stopping C because A is constrained (D18), treating executor or claim results
as tracker completion (D24), and restoring a capability after integration
starts (D46).

The current invariant list does not yet state three other forbidden results in
this chronology. Before accepting this scenario, the delivery specification
must state that only the exact applied Restart direction plus unbroken safe-
suspension evidence may authorize the one planned-attempt replacement event
that simultaneously makes P1 no longer unsettled and records P2; Restart
retains K1 and sends no claim mutation; and W2 receives no content from W1
while W1 remains preserved for a separately authorized disposition. The
specification must also say that
a terminal `Accepted` report arriving after Restart won and before integration
starts remains preserved evidence and starts no integration responsibility.
D49 must cover exact Restart redelivery and first-journaled arbitration with
Continue and Stop. Until those invariant amendments are accepted, this
proposal remains incomplete and cannot authorize implementation.

### Proposed acceptance-test and cassette seams

- `Alice restarts F1 and F2 only after P1 is safely suspended and records
  planned task attempt P2 from exact F2 and H2`
- `keeps P1's worktree branch commits uncommitted work and journal evidence
  while P2 starts from a clean W2`
- `sends no executor cleanup request and treats fake session history and
  evidence artifacts as not applicable`
- `retains exact K1 throughout clean restart without another tracker mutation`
- `coalesces exact Restart redelivery and lets the first of Continue Restart
  and Stop win`
- `records one P1 replacement event and planned task attempt P2 in one journal
  append`
- `reuses one recorded planned task attempt P2 after restart instead of
  allocating P3`
- authored and recorded cassette `changedAttemptRestartsCleanly`
- authored and recorded cassette `changedAttemptRestartAfterSupersessionCrash`

## Current tracker or Git facts do not authorize P2

### Starting situation and outside changes

Alice has applied D1, but no planned-attempt replacement event or planned task
attempt P2 exists. One of these outside events then occurs:

- Alice edits A again, and the focused tracker read returns F3 instead of D1's
  F2;
- another tracker client removes K1 or replaces it with K2;
- the tracker cannot return a readable exact claim or complete blocker facts;
  or
- Git cannot return a readable target head for the configured ref; or
- Git reports W1 absent, registered to another branch or path, detached,
  duplicated, malformed, or otherwise not P1's exact ready worktree.

Before the listed outside event, W1 and its WIP have the first scenario's exact
facts. P1 remains safely suspended in every branch. The tracker and target-head
branches leave W1 and WIP preserved. In the non-ready-W1 branch, Dalph preserves
P1's plan, K1, journal evidence, the branch and worktree facts Git still
reports, and every still-readable resource. It does not infer whether bytes
that Git can no longer report were preserved or disposed. C remains
independent.

### Ordered boundary calls, crash, and retry

Dalph records each read intent and the exact F3, missing, foreign, unreadable,
or Git failure result it actually receives. An F3 observation makes D1 stale
for planning and exposes a new exact F1/F3 choice; Dalph does not silently plan
P2 from F3. For an unreadable claim, Dalph tries to read A's claim up to three
times during this activation and sends no tracker mutation between reads. An
exact K1 result permits the remaining checks; three unreadable results record
the exhausted observation and enter issue #137's local claim wait. A missing or
foreign claim enters the matching issue #137 behavior and sends no claim
mutation. An unreadable complete tracker read or Git target read remains a
typed wait and proves no fingerprint, blocker absence, claim ownership, or Base
SHA. Any non-ready W1 result enters issue #139's exact task-local Git behavior:
Dalph records the concrete Git result, preserves every observed resource, and
records no planned-attempt replacement event or planned task attempt P2.

Because these are read-only boundary calls, there is no uncertain external
mutation to reconcile. If Dalph crashes between unreadable claim reads, the
process-local read count is lost; restart begins a new set of at most three
reads without inferring either K1 ownership or loss. If Dalph crashes after
recording another read intent without its result, restart repeats that exact
read. After a recorded result, restart reconstructs the same wait or new choice
and obtains a later identified read only when ordinary activation calls for
one.

### Visible and forbidden result

Alice sees why no P2 exists: A changed again, K1 is not exact, the tracker is
unreadable, Git has not supplied a Base, or Git reported the exact W1
contradiction. C remains selectable. Dalph must not replace P1, allocate P2,
use D1's F1/F2 choice for F3, mutate K2, reacquire an absent claim merely
because D1 was applied, infer readable Git state, repair or recreate W1, delete
any resource Git still reports, infer that missing WIP is disposable, or turn
A's local wait into a Run-wide stop.

### Proposed acceptance-test and cassette seams

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

## Dalph cannot reconstruct an unbroken safe-suspension proof for P1

### Starting situation and executor result

D1 is durable, but a later start-or-continue command for P1 means the earlier
#136 safe-suspension proof is no longer unbroken. Dalph records the exact
suspension command intent and asks the executor to suspend exact R/P1 through
the existing planned-attempt executor protocol. Its direct result or later
projection may report P1 `Running`, `SafelySuspended`, or `Terminal` with
`Completed`, `Failed`, or `Accepted`; report a different Run or attempt; or be
unreadable.

### Ordered behavior, crash, and retry

Dalph records the exact readable executor result. It retains P1's
planned-attempt executor-work responsibility, K1, W1, WIP, and every journal
fact. The journal does not say P1 was superseded, and no planned task attempt P2
exists while P1 is `Running`, the correlation contradicts R/P1, or the executor
is unreadable. C continues. A later activation may ask the executor for exact
R/P1 evidence under the existing bounded suspension protocol.

An exact `SafelySuspended` report restores the proof used by the first
scenario. Exact terminal `Completed` and `Failed` reports also prove that no P1
writer remains, but Dalph records and preserves their distinct results; neither
proves A completed in the tracker or supplies an accepted Git result. A late
terminal `Accepted` report preserves its exact commit as P1 evidence. Under
this proposal, because D1 won before that report and integration has not
started, Dalph does not pair the commit with a target or create an integration
responsibility for it. That behavior deliberately changes issue #56's accepted
rule that every recovered accepted terminal receives its missing integration
responsibility exactly once. This proposal therefore cannot be accepted in
isolation: issue #56's scenario and conformance seams must be amended at the
same time. After each exact no-writer result, Dalph repeats the current tracker
and Git reads and may append the one replacement planning record. It never
rewrites one terminal variant as another.

After a crash, restart reconstructs the unresolved suspension command and
checks the executor before another state-changing request. In the controlled
fake composition, the fake dies with Dalph and is recreated for the same R/P1
protocol; Dalph does not claim an old response survived. Process loss, timeout,
missing session data, and a report for another attempt prove no writer stopped.

### Visible and forbidden result

When the executor reports `Running`, Alice sees “Restart is waiting because P1
is still running.” A report for another Run or attempt produces a typed
correlation contradiction naming expected R/P1 and the reported pair. An
unreadable executor produces a typed “Restart is waiting for an exact P1
report” result. Alice sees `Completed`, `Failed`, or `Accepted` preserved under
its own name before replacement continues. Dalph must not release K1, discard
W1, record planned task attempt P2, or present D1 as completed while a running,
contradictory, or unreadable result remains. It must not call A completed from
`Completed` or `Failed`, and it must not integrate the late `Accepted` commit.

### Proposed acceptance-test and cassette seams

- `preserves P1 and records no planned task attempt P2 while an exact writer
  may remain`
- `checks the executor after restart before repeating P1 suspension`
- `does not treat process loss or an unrelated terminal report as safe
  suspension evidence`
- `preserves Completed and Failed separately without completing A in the
  tracker`
- `preserves a late Accepted commit without creating integration after Restart
  won`
- `does not append issue 56's integration responsibility when exact Restart
  won before a late Accepted terminal`
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
cutoff. It records no applied Restart direction and sends no executor, tracker,
Git, evidence, cleanup, or disposition request. Since no outside request is
sent, there is no uncertain boundary result to reconcile after a crash. Exact
redelivery of a D1 accepted before the cutoff still returns D1's recorded
result; it does not become a new post-cutoff request.

Alice sees Restart rejected. Dalph must not cancel integration, roll Git back,
release the claim, dispose either worktree, or create a successor attempt.

### Proposed acceptance-test and cassette seams

- `rejects Restart after the exact integration cutoff without crossing a
  boundary`
- authored and recorded cassette `changedAttemptRestartPastIntegrationRejected`

## Proposed model and implementation handoff mapping

Acceptance of this file would require extending
`specs/taskFactReconciliation.qnt`, its collected tests, and its executable
production adapter. The model seam must add Restart as the third exact F1/F2
choice, represent one replacement planning record separately from preserved W1
and K1, and allow that record only after exact unbroken safe suspension and
fresh F2/K1/H2 facts. Its properties must state that the first journaled
Continue, Restart, or Stop wins; no state contains superseded P1 without P2; P1
and P2 never both remain unsettled; P2 carries no W1 content; F3 needs a new
choice; unreadable facts authorize no successor; the three terminal result
variants remain distinct; a late Accepted commit starts no integration after
Restart won; and integration start removes the Restart capability.
The executable conformance path must compose that model with the existing
`specs/plannedAttemptExecutor.qnt` suspension protocol. It must reject a
Restart request while P1 is `Running`. If a later command breaks the retained
safe-suspension proof after Restart was applied, the composition may use only
the existing planned-attempt executor-work suspension protocol. It must not add
an evidence-bearing executor result or inspect executor-internal work.

The late-`Accepted` branch is also a proposed amendment to
`docs/scenarios/issue-56-queue-accepted-integration.md`. Acceptance must change
that scenario, `specs/acceptedResultIntegration.qnt`,
`packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts`, and
the production protocol under
`packages/orchestrator/src/workflow/protocols/integration-admission/` together.
Their composition must prove `does not append issue 56's integration
responsibility when exact Restart won before a late Accepted terminal`, while
unchanged accepted terminals still receive one responsibility exactly once.
The authored and recorded `changedAttemptRestartLateAccepted` cassette is the
controlled-fake boundary record for that branch.

Acceptance must also add canonical `docs/CONTEXT.md` definitions for the exact
Restart request identity and for the replacement planning event that makes P1
no longer unsettled while recording its one successor. This proposal
deliberately describes those happenings in chronological language rather than
declaring unaccepted domain types.

ADR 0002 must be amended with a replacement-specific planning action rather
than weakening ordinary `RecordTaskAttemptPlan`. Its exact causal evidence is
the earlier applied D1 result, the later claimed-task eligibility observation
for F2 and K1, and the recorded H2 Git observation. The replacement action
appends the one P1/P2 record; changing an operation identity alone remains no
permission to replace an attempt.

The implementation handoff must map every proposed seam above to a passing
test, the maintained authored and recorded cassettes, and the owning model
scenario. It must state the concrete non-applicability of executor-internal
partial evidence for the controlled fake. Aggregate gate totals cannot replace
that mapping.
