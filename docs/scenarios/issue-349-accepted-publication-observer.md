# Alice's reopened C receives the next ordinary activation

Accepted authority: [issue 349](https://github.com/dearlordylord/dalph/issues/349).

## Governing behavior

When Alice reopens C while B and D hold both task-work positions, preserve
[C's existing revalidation and Resume chronology](issue-274-reopen-retained-c.md#starting-facts-and-chronology)
and its [crash recovery](issue-274-reopen-retained-c.md#crashes-and-failed-evidence).
[D13 admission](../DELIVERY-INVARIANTS.md#admission-and-capacity),
[D29–D32 process and durability](../DELIVERY-INVARIANTS.md#process-and-durability),
and [D33–D36 progress](../DELIVERY-INVARIANTS.md#progress) govern the result.
The existing [fresh admission scenarios](../../specs/freshTaskAdmission_test.qnt) `capTwoRejectsFocusedCReadTest`
and `cReservesThirdPositionBeforeFreshETest`, and
[executor model](../../specs/plannedAttemptExecutor.qnt) laws `resumeRequiresAcceptedSafeReport` and
`beginOccursAtMostOnce`, continue to constrain C's execution. This repair
restores the process-local publication callback in the delivery program's
Effect context; it changes no owner, coalescing, admission, or model rule.

## Starting facts and chronology

Alice maintains the tracker. The tracker has G3; the Journal contains one Run,
the accepted G3 observation, capacity two, executing B1 and D1, and C1's exact
safe-suspension report after its task closed. Git still owns C1's original
branch, Base SHA, and worktree. C's executor retains the same suspended work.
The application has one Run reactivation owner and an optional read-only
diagnostic publication observer.

1. Alice reopens C. One tracker notification selects active refresh. Dalph
   reads and accepts G4 and the authority facts required for executing B/D.
   The active refresh does not perform focused reads for unpositioned C1.
2. The delivery program constructs reactive relations after bootstrap has
   built its activation Layer. Each published bundle reaches both the ambient
   diagnostic observer and bootstrap's observer. Only an accepted position
   newer than the activation's entry position notifies the scheduling owner.
3. Active refresh returns `RunMustRemainActive`. Its accepted publications
   coalesce into exactly one trailing ordinary activation, without another
   tracker notification, timer, executor report, or authored hint. The current
   activation returns before that ordinary activation enters.
4. Ordinary reconstruction publishes C1 as eligible for continuation
   revalidation at capacity two. B1/D1 still hold the positions, so C's focused
   tracker/Git reads and Resume wait for capacity.
5. Alice's later capacity-three change uses the existing control boundary.
   C1 reserves the third position before fresh E, obtains the required exact
   tracker/Git witnesses, and resumes once through the existing protocol.

Alice sees C waiting after reopening, then continuing its original work after
capacity increases. Neither observer replaces the other. A relation's initial,
duplicate, or older publication must not manufacture more ordinary entries;
callbacks add no Journal event, persisted scheduling state, second owner,
concurrent activation, duplicate Begin/Resume, or early E admission.

## Crash and retry

If the process dies after G4 is accepted but before ordinary entry, only the
callback is lost. A new process reconstructs the same Run and C1 from the
Journal and checks current authorities through ordinary recovery. It does not
append another G4 observation merely to wake itself, persist a pending
activation, or recreate C's resources. Resume-response ambiguity remains owned
by the existing exact executor reconciliation protocol. No Git mutation or
executor request occurs inside publication observation, so this callback adds
no new ambiguous boundary or retry policy.

## Scenario-to-test mapping

| Scenario | Passing test seam |
| --- | --- |
| Runtime-created relations send an accepted Journal publication to scheduling and ambient diagnostics | `journaled-run-bootstrap.test.ts`: `runtime-created relations notify scheduling and ambient publication observers` |
| Several publications during active refresh become one ordinary entry after return, with maximum concurrency one and no extra timer/hint | `journaled-run-bootstrap.test.ts`: `coalesces runtime accepted publications into one nonconcurrent ordinary activation after active refresh returns` |
| Initial, repeated, and older publications do not add scheduling hints | `journaled-run-bootstrap.test.ts`: `does not turn the activation's initial publication into another Run activation`; `signals once only when a relation publication advances beyond the activation entry position` |
| G4 is accepted during active refresh; after that activation returns, its publication queues exactly one nonconcurrent ordinary entry that publishes exact waiting C1 at capacity two without another external notification or duplicate provider/executor mutation | `issue-349-accepted-publication-observer.test.ts`: `accepted publication from active refresh starts one trailing ordinary activation` |
| Ordinary recovery retains one Run-level graph proposal while exact accepted-Safe C1 needs its C-covered continuation read; no reopen, a later re-close, or malformed/foreign G4 plan provenance does not create that authority | `reactive-delivery-relations.test.ts`: `establishes the current graph while a recovered continuation graph read waits for capacity`; `recovery-activation.test.ts`: `replays G1 only when its exact run target subjects predecessors and missing outcome still agree` |
| G4 publishes exact C1 revalidation eligibility at capacity two; capacity three resumes original C1 before fresh work | `issue-274-lifecycle-resume.test.ts`: `reopens C and resumes its original attempt only after accepted capacity three` |
| G4 accepted before process loss survives without duplicate executor commands or resources | `issue-274-lifecycle-resume.test.ts`: `recovers the real G4 crash before resuming exactly retained C1` |
| A lost Resume response is reconciled before another command | `issue-274-lifecycle-resume.test.ts`: `reconciles C's lost Resume response after restart without another Begin or Resume` |

The focused #349 cassette composes the real bootstrap owner with the existing
#268/#274 controlled authorities. It preserves C1's accepted Safe history,
B1/D1 at capacity two, the B/D-covered G4 active read, activation return, and
the callback-driven ordinary C-covered continuation read in one chronology.
The existing #274 cassette continues through capacity three and therefore owns
the later exact Resume and C-before-E evidence. The uninterrupted seven-task
composition belongs to downstream #337 and is not required for this repair.
No accepted outcome or blocking dependency is removed.
