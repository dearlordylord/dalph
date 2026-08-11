# Reconcile blockers before and after Git promotion

Issue: [Reconcile blockers before and after Git promotion](https://github.com/dearlordylord/dalph/issues/138)

Status: accepted on 2026-08-07; behavior-changing implementation may use these
scenarios as its operational gate.

No person directly triggers these scenarios. The task tracker owns prerequisite
relationships and completion. Git owns candidate, ref, and ancestry facts.
Dalph owns integration responsibility, the order of boundary intents and
observations, and the decision to wait before a later operation.

## A new unfinished prerequisite appears before promotion

### Starting situation

Run R contains task A, prerequisite task B, and independent task C. A has an
accepted result and a started integration responsibility. Candidate M has been
constructed for expected target head H and is preserved in its exact isolated
integration resource. M has not been promoted. B was previously complete or
not a prerequisite of A, so prior complete tracker facts allowed integration
to reach this point. C requires none of A's facts or serialized resources.

The live coordinator currently holds the process-local serialized integration
resource for A's exact repository/ref target.

### Trigger and chronological behavior

1. A fresh complete tracker read reports that B is now an unfinished
   prerequisite of A.
2. Dalph records the tracker observation and reconstructs A's new dependency
   constraint.
3. Dalph preserves candidate M, the accepted result, planned attempt, worktree,
   claim, integration responsibility, and all evidence.
4. Dalph releases the process-local serialized integration target resource and
   enters dependency wait for A. It records no derived lock or wait row.
5. The ordinary graph frontier keeps B eligible when its own facts allow it and
   keeps independent C eligible. A's local wait does not block either task.
6. Dalph selects no verification, promotion, tracker completion, cleanup, or
   reintegration for A while B remains unfinished.

If Dalph crashes after step 1, restart reconstructs any durable tracker
observation but recreates process-local integration ownership empty. It does
not infer that A still owns the resource and does not discard M. If the read
intent exists without a result, it completes the accepted tracker-read
protocol before acting.

An operator sees A waiting on B while B and C can progress. Dalph must not
delete or rebuild M, hold the target resource throughout the wait, claim B on
A's behalf, block C, or promote M from stale prerequisite facts.

### Acceptance-test seam

- `preserves the candidate and releases integration when a blocker appears before promotion`
- `keeps the prerequisite and independent task eligible during the local wait`
- `reopens the pre-promotion blocker wait without derived resource ownership`

## The prerequisite clears before promotion

### Starting situation

A waits with preserved candidate M because B was unfinished. Dalph does not
hold the integration target resource. The tracker later completes B. Git may
have advanced the configured target ref while A waited.

### Trigger and chronological behavior

1. A fresh focused tracker read either reports B complete or proves that B is
   no longer a prerequisite of A, and still reports A inside the target with
   otherwise compatible lifecycle and claim facts. Removing the prerequisite
   edge is itself sufficient to clear the dependency wait; B need not complete.
2. Dalph clears only A's dependency constraint. Every independent constraint
   remains in force.
3. Before reusing M or acquiring the target resource, Dalph freshly reads the
   exact target head and required ancestry facts.
4. Compatible Git facts return A to the ordinary candidate reconciliation,
   verification, and serialized integration frontier. Stale or contradictory
   facts enter their accepted Git behavior.
5. Dalph does not mark M verified, promote it, or complete A merely because B
   cleared.

If the configured target advanced compatibly from H to H2 while A waited, M
remains immutable evidence of the earlier candidate `[H, C]`; Dalph does not
rewrite it or claim it was built from H2. The ordinary bounded candidate
reconciliation protocol records integration-session supersession for the stale
H-bound session while preserving M and its isolated resource as historical
evidence. Only after that durable supersession may Dalph start one H2-bound
successor session for the same accepted result and construct a new candidate
identity M2 with ordered parents `[H2, C]`. M2 requires its own verification
before promotion. The two sessions are never unsettled at the same time.

If Dalph crashes after step 1, restart reuses the durable complete tracker
observation only according to its reconfirmation protocol and performs any
still-missing Git reads before progress. If it crashes after recording
integration-session supersession but before starting the successor, restart
does not revive the H-bound session and starts at most one H2-bound successor.

The operator sees A become eligible for current integration work, not jump
directly to completion. When the edge was removed while B remained unfinished,
the earlier complete observation containing `A -> B` and the later complete
observation without that edge preserve enough durable evidence for a future
projection to show an informational warning. This issue does not add or require
that warning, persist separate warning state, or constrain A because of it.
Dalph must not trust the old H, erase a claim or lineage constraint, mutate M,
require the now-unrelated B to complete, or build a second candidate outside
the owning bounded reconciliation protocol.

### Acceptance-test seam

- `freshly proves Git authority after a pre-promotion blocker clears`
- `clears dependency wait when a complete read proves the prerequisite edge was removed`
- `retains the complete observations needed to derive a future removed-prerequisite warning`
- `supersedes the stale-head session before starting one successor from the new head`
- `clears only the dependency constraint and does not promote directly`

## A new unfinished prerequisite appears after promotion

### Starting situation

Candidate M was verified and Git promotion has reached a durable known result:
the configured target ref advanced from exact expected head H to M. Dalph has
released the process-local integration target resource. The tracker task A is
not yet marked complete. A fresh complete tracker observation now reports
unfinished prerequisite B. Independent task C requires none of A's facts.

This includes the unavoidable cross-authority race where Dalph's last complete
tracker read reported no unfinished prerequisite, another tracker client then
added B, and Git accepted the exact compare-and-set promotion before Dalph
could observe B. The tracker edit and Git promotion cannot be made atomic. A
later complete tracker read places the already-promoted task into this same
post-promotion wait; it does not invalidate the successful Git result.

### Trigger and chronological behavior

1. Dalph records the tracker observation proving B unfinished.
2. Dalph preserves the exact promotion proof and enters dependency wait before
   tracker completion.
3. Dalph does not roll Git back, rebuild, reverify, or repromote M.
4. The frontier keeps B and independent C eligible under their own current
   facts while exposing no tracker-completion operation for A.

If Dalph crashes, restart reconstructs the promotion proof and blocker wait.
Because promotion has a known durable result, it does not repeat the Git
mutation. An intent without a known promotion result remains owned by issue
#60's ambiguous-promotion protocol rather than this scenario.

The operator sees promoted work preserved while tracker completion waits on B.
Dalph must not force-update the ref back to H, delete M, reopen executor work,
hold the integration resource, or report A complete.

### Acceptance-test seam

- `preserves promotion proof and waits before tracker completion on a new blocker`
- `never rolls Git back after promotion`
- `keeps prerequisite and independent work eligible after promotion`

## The prerequisite clears after promotion

### Starting situation

A has durable proof that exact candidate M was promoted, but tracker completion
waits on unfinished B. The target ref and tracker may have changed during the
wait. No integration target resource is held.

### Trigger and chronological behavior

1. A fresh focused tracker read proves either that B completed or that B is no
   longer a prerequisite of A, and proves A otherwise eligible for completion.
2. Dalph reads Git's current exact target head and proves that M is still an
   ancestor of it. Equality is not required because compatible work may have
   advanced the target.
3. Dalph records the ancestry observation.
4. The ordinary tracker-completion frontier may continue from the preserved
   promotion proof without candidate reconstruction, verification, or another
   promotion.
5. If M is not an ancestor, or Git is unreadable, Dalph enters the accepted Git
   constraint or wait and does not complete the tracker task.

If a force-push removed M from the target's ancestry while A waited, that
incompatibility is a task-local Git constraint. Force-pushes are ordinarily a
problem requiring explicit reconciliation: Dalph preserves the immutable
promotion proof and all evidence, keeps independent work eligible, and does
not treat the rewrite as permission to roll back, automatically reintegrate M,
or manufacture a replacement promotion.

If Dalph crashes after either read intent, restart completes that exact read
protocol before another request. Recorded promotion proof remains immutable
and is never replaced by an inference from the current ref.

The operator sees A complete only after both current prerequisite and ancestry
authority permit it. Dalph must not reintegrate M, require the target to equal
M, use stale ancestry, or complete A after an unreadable or incompatible Git
result.

### Acceptance-test seam

- `proves promoted candidate ancestry after the blocker clears and completes without reintegration`
- `waits without tracker completion when promoted ancestry is unreadable or incompatible`

## Incomplete or unreadable tracker facts do not manufacture a transition

### Starting situation

A is either approaching promotion or waiting before tracker completion. A
focused tracker read is incomplete, unreadable, or omits the prerequisite family, so
it proves neither that a blocker appeared nor that an existing blocker cleared.

### Trigger and chronological behavior

1. Dalph records the typed focused observation or boundary failure through the
   tracker-read protocol.
2. Dalph preserves A's current candidate, promotion proof, integration
   responsibility, and dependency state.
3. If A held the process-local serialized integration target resource, Dalph
   releases it while waiting for complete authority facts. A retains its queue
   position, so later work for the same target cannot pass it; other targets
   remain independently governed by their own resources.
4. Dalph authorizes no promotion or tracker completion from the incomplete
   result and does not newly constrain B or C without facts about them.

If Dalph crashes, restart does not reinterpret the incomplete result as a
complete graph. A later complete observation may change the constraint.

The operator sees an explicit authority wait. Dalph must not treat omission as
completion, retain process-local target ownership throughout the wait, reorder
the same-target queue, block the whole Run, or discard proven Git facts.

### Acceptance-test seam

- `preserves the current integration state when blocker facts are incomplete`
- `releases target ownership during an incomplete tracker wait without same-target reordering`
- `does not treat omitted prerequisite facts as blocker clearance`

## A prerequisite reopens while tracker completion is in flight

### Starting situation

A has durable proof that M was promoted. A fresh focused tracker read reports
B complete and A otherwise eligible for completion, and a fresh Git read
proves M remains an ancestor of the configured target. Dalph has initiated the
ordinary tracker-completion protocol for A but has not yet recorded its result.

### Trigger and chronological behavior

1. Another tracker client reopens B after Dalph's focused eligibility read.
2. The task tracker nevertheless accepts Dalph's completion request for A.
   The prerequisite read and completion mutation cannot be assumed atomic
   unless the tracker boundary explicitly proves such a precondition.
3. Dalph records the actual successful completion result. It does not undo or
   reinterpret that external fact.
4. A later complete tracker read reports the resulting inconsistency: A is
   complete while B is again unfinished. Dalph preserves A's completed state
   and derives a visible warning from those current facts and the recorded
   completion result.
5. Ordinary graph reconciliation uses the current tracker facts for other
   tasks; Dalph does not manufacture a repair for A or B.

If a later complete observation reports B complete again, the current
inconsistency and its visible warning clear. The supporting tracker
observations and completion result remain in durable workflow history; Dalph
does not persist a separate permanent race-warning state.

If Dalph crashes after the completion request but before recording its result,
restart follows the owning tracker-completion ambiguity protocol before any
retry. This scenario does not authorize a duplicate completion request.

The operator sees that A completed across a prerequisite race and that B is
unfinished. Dalph must not reopen A automatically, claim B on A's behalf,
reverse the Git promotion, or conceal the inconsistency.

### Acceptance-test seam

- `preserves accepted tracker completion when a prerequisite concurrently reopens`
- `warns about completed A with a newly unfinished prerequisite without automatic repair`
- `clears the derived warning when fresh tracker facts remove the inconsistency`

## Forbidden-result invariant mapping

| Scenario rule | Governing delivery invariant |
| --- | --- |
| Preserve accepted work, candidates, promotion proof, and isolated resources across every blocker, unreadable result, force-push constraint, and crash | D10 retention, D16 work-in-progress survival, D31 same-work recovery |
| Constrain only A, keep B and C governed by their own facts, and clear no independent constraint | D9 fresh-authority eligibility, D18 local constraint, D19 independent clearing |
| Treat incomplete tracker coverage and unreadable Git as no permission to promote or complete | D23 incomplete or unreadable facts never prove absence, D24 no inferred completion |
| Never rewrite candidate parents, reuse a candidate against H2, promote an unverified candidate, roll Git back, or force-update a stale target | D26 candidate shape, D27 exact compare-and-set promotion, D28 verification before promotion |
| Record intent before an ambiguity-crossing mutation and reconcile its result before retry | D21 intent before effect, D22 reconcile before retry |
| Persist no queue, wait, or integration-target ownership and recreate process-local ownership empty after restart | D29 authority separation |
| Preserve acceptance-derived same-target order while A waits | D42 single acceptance-derived integration queue |
| Release the serialized target resource whenever A is only waiting on tracker facts | D43 target-resource release while waiting |
| Supersede the stale H-bound session before starting one H2-bound successor | D44 at most one unsettled integration session per accepted result |

## Scenario-to-test mapping required at handoff

The implementation handoff must replace every seam above with a passing test,
authored/recorded cassette coverage, and the owning model plus executable
adapter. It must identify which existing tracker and Git reads prove each
transition and which later issue owns every deliberately unperformed effect.
