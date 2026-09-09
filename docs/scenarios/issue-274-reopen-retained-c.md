# Alice reopens C and resumes its retained attempt

Accepted authority: [issue 274](https://github.com/dearlordylord/dalph/issues/274)
and [issue 256, DS-18/19](https://github.com/dearlordylord/dalph/issues/256).

## Governing behavior

The decision to resume C preserves [the accepted same-attempt Resume
protocol](issue-264-autonomous-executor-work.md#resume-only-the-same-safely-suspended-attempt-selected-by-current-facts)
and [tracker lifecycle reconciliation](issue-136-reconcile-changed-task-facts.md#the-tracker-closes-a-without-success-and-later-reopens-it).
`taskFactReconciliation.qnt` owns `continueRequiresEveryFreshExactAuthority`,
`continueResumesOnlyImmutableAttemptP`, and `changedFactsPreserveWip`;
`plannedAttemptExecutor.qnt` owns `resumeRequiresAcceptedSafeReport`,
`acceptedSafeReportAuthorizesAtMostOneResume`, `beginOccursAtMostOnce`, and
`boundaryEvidenceUsesExactCommandIdentity`. No model behavior changes here.

## Starting facts and chronology

Alice maintains the tracker and applies Dalph capacity policy. The tracker,
Git, the exact planned-attempt executors, and Dalph's Journal are the relevant
systems. B1 and D1 are executing and occupy both positions at capacity two.
C1 is safely suspended after tracker closure. Its original claim, immutable
plan, worktree, and unfinished work remain owned by the same authorities.

The maintained controlled slice consumes the actual DS-01–13 Journal and
outside authority instances after a deliberate coordinator process cut. It
does not fabricate a replacement C plan or executor. A's DS-14–17 delivery and
predecessor cleanup remain their separate accepted slices. Composing these
with DS-18/19 in one uninterrupted seven-task cassette belongs to #279.

1. Alice reopens C. Ordinary recovery records a complete tracker-read intent,
   reads G4, and records its observation. C's lifecycle constraint disappears;
   no Operator Unpause is applied. This graph says nothing about current claim
   ownership, authored instructions, worktree registration, or Git lineage.
2. Dalph reads C's current authored specification, exact claim, planned
   worktree, and target lineage through the existing correlated protocols.
   B1 and D1 still hold both positions. C1's proposed Resume waits for capacity.
3. Alice changes capacity to three using the current expected policy revision.
   The public control boundary records revision three. B1/D1 ownership remains.
4. C1 acquires the available position. Dalph validates the exact current
   witnesses, appends continuation authorization, records one Resume intent,
   and calls only C1's executor. Its Executing response is settled through the
   ordinary command/report protocol. Dalph creates no plan, claim, or worktree.

Alice sees C waiting at capacity two and executing after capacity three. The
controlled Git boundary proves preservation of the original registered
worktree and absence of creation/disposal requests; executor-private edit
bytes remain behind the executor's accepted same-attempt suspension contract.

## Crashes and failed evidence

The slice validates actual Journal prefixes after G4 observations, the applied
capacity revision, and executor intents. A separate execution lets C's executor
apply Resume and retain its Executing projection, then cuts the coordinator
before the response returns. Recovery reads that same executor correlation and
settles the original command ordinal. It sends neither Begin nor Resume again.

Removing any one of the five actual continuation observations rejects the
authorization. The existing production-route failure matrix separately checks
missing, stale, foreign, pending, and unreadable tracker/Git witnesses with
zero executor contacts. A graph reopen cannot supply these missing facts or
clear an independently applied Pause, changed specification, or claim/Git
constraint. No cleanup or replacement is authorized by any such wait.

## Scenario-to-test mapping

| Scenario | Maintained evidence |
| --- | --- |
| G4 clears lifecycle only; B/D retain capacity; original C resumes after revision three | `issue-274-lifecycle-resume.test.ts`: `reopens C and resumes its original attempt only after accepted capacity three` |
| Exact current observations precede authorization and Resume; absent observation rejects | The same test validates all five actual witness identities/order and removes each observation as a negative control |
| G4, capacity, and Resume-intent crash prefixes remain reconstructable | The same test reduces each actual checkpoint prefix with the production Journal reducer |
| Executor applies Resume but its response is lost | `issue-274-lifecycle-resume.test.ts`: `reconciles C's lost Resume response after restart without another Begin or Resume` |
| Invalid/superseded authority cannot contact Resume | `delivery-proposal-routes.test.ts`: `never contacts Resume for invalid or superseded continuation authority` |
| Pending/unreadable tracker facts must be reread | `recovery-activation.test.ts`: `recovers each later pending or unreadable tracker read before proposing Resume` |
| Uninterrupted DS-01–22 composition and passive presentation | Deferred to #279; these controlled recovery slices make no such claim |
