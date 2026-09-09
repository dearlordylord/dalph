# Alice reopens C and resumes its retained attempt

Accepted authority: [issue 274](https://github.com/dearlordylord/dalph/issues/274)
and [issue 256, DS-18/19](https://github.com/dearlordylord/dalph/issues/256).

## Governing behavior

The decision to resume C preserves [the accepted same-attempt Resume
protocol](issue-264-autonomous-executor-work.md#resume-only-the-same-safely-suspended-attempt-selected-by-current-facts)
and [tracker lifecycle reconciliation](issue-136-reconcile-changed-task-facts.md#the-tracker-closes-a-without-success-and-later-reopens-it).
The [accepted delivery story](../DELIVERY-STORY.md#the-beats) supplies DS-18/19.
[D1–D4 identity](../DELIVERY-INVARIANTS.md#identity),
[D13 admission](../DELIVERY-INVARIANTS.md#admission-and-capacity),
[D18–D19 preservation](../DELIVERY-INVARIANTS.md#preservation), and
[ambiguity and evidence](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
govern these continuations.
[taskFactReconciliation.qnt](../../specs/taskFactReconciliation.qnt) owns `continueRequiresEveryFreshExactAuthority`,
`continueResumesOnlyImmutableAttemptP`, and `changedFactsPreserveWip`;
[plannedAttemptExecutor.qnt](../../specs/plannedAttemptExecutor.qnt) owns `resumeRequiresAcceptedSafeReport`,
`acceptedSafeReportAuthorizesAtMostOneResume`, `beginOccursAtMostOnce`, and
`boundaryEvidenceUsesExactCommandIdentity`. The approved #274 refinement of
`freshTaskAdmission.qnt` distinguishes a safely suspended continuation awaiting
revalidation from retained work with an independent constraint. Only the former
receives existing-responsibility priority for a process-local position before
its focused reads. `retainedNotReadyDoesNotBlockFreshTest` remains required.
This refinement applies to C's closure before its accepted Safe report and
later complete-graph reopening. B's ordinary Safe checkpoint without that
lifecycle sequence retains the accepted DS-12/13 behavior; Safe plus Open alone
does not enter this new reservation path.

## Starting facts and chronology

Alice maintains the tracker and applies Dalph capacity policy. The tracker,
Git, the exact planned-attempt executors, and Dalph's Journal are the relevant
systems. B1 and D1 are executing and occupy both positions at capacity two.
C1 is safely suspended after tracker closure. Its original claim, immutable
plan, worktree, and unfinished work remain owned by the same authorities.
B suspended first; D took B's vacancy before the capacity contraction. C then
closed and suspended. Alice selected B's original attempt, and A's accepted
result released the position B used to Resume. D did not take C's vacancy.

The maintained controlled slice consumes the actual DS-01–13 Journal and
outside authority instances after a deliberate coordinator process cut. It
does not fabricate a replacement C plan or executor. A's DS-14–17 delivery and
predecessor cleanup remain their separate accepted slices. Composing these
with DS-18/19 in one uninterrupted seven-task cassette belongs to #279.

1. Alice reopens C. Ordinary recovery records a complete tracker-read intent,
   reads G4, and records its observation. C's lifecycle constraint disappears;
   no Operator Unpause is applied. This graph says nothing about current claim
   ownership, authored instructions, worktree registration, or Git lineage.
2. B1 and D1 still hold both positions. C1 waits for capacity before the focused
   continuation reads. C's accepted exact safe report, open lifecycle, and
   absence of independent Pause, specification, claim, or Git constraint make
   it eligible to reserve a position for revalidation, not to Resume.
3. Alice changes capacity to three using the current expected policy revision.
   The public control boundary records revision three. B1/D1 ownership remains.
4. C1 acquires the available position in existing-responsibility order before
   fresh E can enter. While retaining that same process-local position, Dalph
   reads C's current authored specification, exact claim, planned worktree,
   and target lineage through the existing correlated protocols. It validates the exact current
   witnesses, appends continuation authorization, records one Resume intent,
   and calls only C1's executor. Its Executing response is settled through the
   ordinary command/report protocol. Dalph creates no plan, claim, or worktree.

Alice sees C waiting at capacity two and executing after capacity three. The
controlled Git boundary proves preservation of the original registered
worktree and absence of creation/disposal requests; executor-private edit
bytes remain behind the executor's accepted same-attempt suspension contract.

## Crashes and failed evidence

The coordinator can stop after the actual G4 observation, applied capacity
revision, position reservation, any focused read, or immediately before Resume
intent. A fresh ordinary activation uses retained authorities and Journal
history, discarding process-local reservations and rebuilding eligibility.
G4 recovery still waits at capacity two. At capacity three C again reserves
before E and revalidates the exact original attempt. No frontier, reservation,
or capacity occupancy is persisted. Negative or unavailable focused evidence
releases the pre-command reservation and defers C; genuinely constrained
retained work does not block fresh work. After Resume intent, any ambiguous
response must be reconciled at the exact executor before retry.
If that exact pending Resume is reconciled as still Safe, Dalph reconstructs
the retry's revalidation eligibility from the original closed/Safe/reopened
history and exact command projection. It again reserves before E and rereads
current facts before retrying that same command ordinal. An ordinary Safe
checkpoint or a foreign/stale command projection cannot establish this basis.
Before calling the executor again, Dalph records
`PlannedAttemptExecutorResumeRedeliveryIntended`. This consumes that exact Safe
projection and names the original Resume ordinal, the projection ordinal, the
next redelivery ordinal, and the five current observation identities. It is
not another semantic Resume command or continuation authorization. Its accepted
append hands the same reserved position to command-delivery responsibility
before the executor call; a restarted process reconstructs that responsibility
from the Journal. Another crash after this intent requires a newer executor
projection before any further redelivery, never reuse of the consumed proof.
A separate qualified execution lets C's executor
apply Resume and retain its Executing projection, then cuts the coordinator
before the response returns. Recovery reads that same executor correlation and
settles the original command ordinal. It sends neither Begin nor Resume again.

Removing any one of the five actual continuation observations rejects the
authorization. The existing production-route failure matrix separately checks
missing, stale, foreign, pending, and unreadable tracker/Git witnesses with
zero executor contacts. A graph reopen cannot supply these missing facts or
clear an independently applied Pause, changed specification, or claim/Git
constraint. No cleanup or replacement is authorized by any such wait.

The Pause execution first applies Alice's task Pause through the public control
boundary while C is closed, cuts the coordinator, then observes G4 and accepts
capacity three. Another fresh activation still preserves Pause and contacts no
Resume boundary. B/D remain the only owners of task-work positions.

## Scenario-to-test mapping

| Scenario | Maintained evidence |
| --- | --- |
| Ordinary Safe B does not acquire C's lifecycle-revalidation classification | `ordinarySafeBDoesNotEnterLifecycleRevalidationTest`; `ordinarySafeSelectionTurnsLifecycleInvariantRedTest`; recovery eligibility test contrasting ordinary Safe+Open with closed→Safe→open |
| G4 clears lifecycle only; B/D retain capacity; original C resumes after revision three | `issue-274-lifecycle-resume.test.ts`: `reopens C and resumes its original attempt only after accepted capacity three` |
| Capacity two rejects C reads; capacity three reserves one position before E | `capTwoRejectsCReservationTest`, `capTwoRejectsFocusedCReadTest`, `capThreeRejectsFreshEBypassTest`, `cReservesThirdPositionBeforeFreshETest`; controller test `reserves only the third position for Safe revalidation before fresh E and releases a rejected pre-intent lease` |
| Independent constraint or unavailable evidence releases C without blocking fresh E | `pausedClosedOrConflictingCCannotReserveTest`, `failedCReadReleasesReservationAndAllowsETest`, retained `retainedNotReadyDoesNotBlockFreshTest`; controller test `releases safe revalidation capacity when accepted evidence becomes constrained` |
| Same reserved position spans reads, authorization, and exact Resume; stale retry basis is rejected | `reservedCRejectsEarlyResumeTest`, `reservedCRejectsMissingWitnessAuthorizationTest`, `reservedCRejectsDoubleOccupancyTest`; controller tests `keeps one exact safe continuation reservation through reads and Resume intent handoff` and `rejects stale or swapped reconciled Resume identity before reserving` |
| Exact current observations precede authorization and Resume; absent observation rejects | The same test validates all five actual witness identities/order and removes each observation as a negative control |
| G4 crash recovers through a real activation | `recovers the real G4 crash before resuming exactly retained C1` |
| Capacity, reservation, each focused observation, authorization, and pre-call Resume-intent recovery | `recovers the real Capacity/Reservation/Specification/Claim/Worktree/Lineage/Authorization/ResumeIntent crash before resuming exactly retained C1` (one test per named cut) |
| Pending Resume reconciles as still Safe, reacquires before E, then retries only after current facts | `reconciledSafeResumeRejectsFreshEBypassTest`; `reconciledSafeResumeReacquiresOnePositionBeforeReadsTest`; `missingResumeReconciliationTurnsInvariantRedTest`; actual `ResumeIntent` crash cassette |
| G4 cannot clear an independent Pause, even after capacity increases | `preserves Alice's independently applied Pause when G4 reopens C even at capacity three` |
| Executor applies Resume but its response is lost | `issue-274-lifecycle-resume.test.ts`: `reconciles C's lost Resume response after restart without another Begin or Resume` |
| Crash before the initial Resume call; Safe reconciliation permits only same-ordinal redelivery | `issue-274-lifecycle-resume.test.ts`: `recovers the real ResumeIntent crash before resuming exactly retained C1`; pure `resume-redelivery-authorization.test.ts` rejects consumed/swapped/foreign or superseded proofs; controller exact receipt test retains one position across append publication and rejects a settled lease |
| Invalid/superseded authority cannot contact Resume | `delivery-proposal-routes.test.ts`: `never contacts Resume for invalid or superseded continuation authority` |
| Pending/unreadable tracker facts must be reread | `recovery-activation.test.ts`: `recovers each later pending or unreadable tracker read before proposing Resume` |
| Uninterrupted DS-01–22 composition and passive presentation | Deferred to #279; these controlled recovery slices make no such claim |

## Approved refinement implementation plan

1. Model C's revalidation eligibility and position reservation in
   `freshTaskAdmission.qnt` and its capacity proof. Collect positive cap2/cap3,
   exact witness/handoff, constraint, and crash tests plus negative controls
   for fresh E bypass, early Resume, and duplicate occupancy. Run pinned Quint
   typecheck/tests and the changed-model gate before runtime implementation.
2. Derive exact safe-continuation eligibility from accepted Run evidence;
   reserve in the existing admission controller before focused reads and retain
   one position through Resume. Release only before intent on failed evidence;
   use ordinary intent reconciliation afterward. Verify admission and
   continuation tests and the corresponding executable model adapter.
3. Complete the controlled DS-18/19 crash prefixes and cassette assertions in
   the mapping above, preserving actual B1/D1 execution and original C1 facts.
   Run focused tests and `pnpm check:fast`; the orchestrator owns frozen-candidate
   full gates and integration. No native issue dependency changes.

The command-redelivery model delta follows the qualified #341 canonical
intent/delivery model lineage. The integration coordinator sequences that
merge and the changed-model gate; the runtime milestone is not a final formal
qualification or integration handoff.
