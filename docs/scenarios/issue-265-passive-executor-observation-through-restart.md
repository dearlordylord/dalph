# Observe one autonomous executor attempt through a same-host restart

Status: accepted required behavior for open issue #265. The implementation
candidate is under review; integration remains pending.

## Governing behavior

This scenario preserves [issue #264's Begin-once and passive-observation
semantics](issue-264-autonomous-executor-work.md#begin-once-then-observe-the-same-executing-work)
and composes them with [issue #219's retained Codex-thread
recovery](issue-219-codex-app-server-executor.md#a-later-dalph-process-resumes-the-same-attempt-thread).
It adds the live owner that waits for a genuinely changed executor report and
reattaches that owner after a same-host Dalph restart. It does not change
tracker or Git refresh, safe-suspension authorization, report acceptance, or
position-release rules.

The milestone promise is deliberately bounded. The later Dalph process runs on
the same host with the same Journal, Codex attempt store, Codex state location,
and planned worktree still readable. The earlier Dalph process and its
application-owned app-server child may both be gone. Whole-host loss, loss of
those durable stores, and adoption of an unrelated executor substrate do not
apply because none can prove the exact existing `(RunId, AttemptId)` and Codex
thread association. A later milestone may add a different durable execution
substrate without changing the generic Begin/Observe/Suspend/Resume contract.

## Alice sees one executing attempt finish without another work command

### Starting situation

Alice is monitoring Run R through maintained evidence; #260 owns the later
public CLI or status surface. Dalph has recorded one Begin intent and accepted
`ExecutorWorkExecuting` at report ordinal 1 for exact attempt A1. A1 holds one
task-work position. The Codex implementation has durably associated A1 with
one non-ephemeral thread and one active turn in A1's exact planned worktree.

No tracker or Git fact changes in this scenario. No person triggers the later
executor transition; the coding turn continues autonomously.

### Dalph action and outside event

1. Dalph admits one process-local passive observation owner for A1. That owner
   can read or await A1's exact executor projection. It cannot Begin, Resume,
   request suspension, read the tracker or Git, clean resources, or append to
   the Journal.
2. The owner reads `ExecutorWorkExecuting(A1)`. Because that is the already
   accepted report, Dalph appends no report and schedules or awaits a later
   passive observation without a tight loop.
3. Codex finishes the same turn with exact terminal result C.
4. The owner publishes `ExecutorWorkTerminal(A1, C)` to the existing report
   acceptance boundary. That boundary accepts the changed report once at
   ordinal 2 and records it through the ordinary Journal protocol.
5. Existing terminal settlement releases only A1's task-work position and
   retains C for integration admission.

### Crash and retry

If Dalph dies before step 4 publishes the changed projection, restart follows
the same-host scenario below. If Dalph dies after publication but before the
ordinary report record is conclusive, recovery reconciles that exact report
acceptance; it does not ask Codex to Begin or manufacture another terminal
ordinal. Repeated observation of the same terminal projection is idempotent.

### Visible and forbidden result

Alice's maintained evidence can show one Begin, one executing report, and one
terminal report for A1. This ticket requires the facts to be truthfully
derivable; it does not add a public UI or CLI.

Dalph must not send another Begin or Resume, append duplicate executing or
terminal reports, release another attempt's position, busy-poll Codex, or turn
the executor report into permission to reread the tracker.

### Acceptance-test mapping

The live transition, equal-projection wait, and both publication crash cuts map
to the exact maintained tests in the [canonical scenario-to-test
mapping](#canonical-scenario-to-test-mapping).

## A later Dalph process reattaches to the exact Codex attempt

### Starting situation

The earlier Dalph process and its application-owned app-server child have
ended on the same host. Run R's Journal still records unfinished A1 and its
accepted executing report. The private Codex attempt store still associates
A1 with exact thread T. The same Codex state location and planned worktree are
readable. Process-local observer state is gone; no observer cursor or wakeup is
restored.

The ordinary Run entry has reconstructed A1's responsibility and command
history. No person initiates recovery.

### Dalph action and outside event

1. The new Dalph process launches and initializes its application-owned Codex
   app-server against the same selected Codex state location.
2. It reads A1's exact attempt-thread association and asks Codex once for T's
   current projection in A1's exact worktree. This is a passive executor read,
   not Begin or Resume.
3. If T is executing, Dalph preserves A1's position and attaches one new
   process-local observation owner. If T is terminal, Dalph publishes that
   changed report once. If an exact prior suspension request has settled and T
   is safely suspended, Dalph publishes the Safe report once.
4. An executing projection later changes to Safe or Terminal and follows the
   ordinary report-acceptance path described above.

An absent, temporarily unavailable, unreadable, or foreign projection leaves
A1 and its position retained. It creates no replacement attempt, thread, work
command, cleanup permission, or tracker refresh.

### Crash and retry

If the new process dies before the projection returns, another same-host
process repeats the read of T through the same association. If it dies after a
changed projection returns but before acceptance is conclusive, recovery
reconciles the exact pending report. Losing the process-local owner never
authorizes another Begin.

Whole-host loss or disappearance of the Journal, Codex attempt store, Codex
state location, or planned worktree has no recovery promise in this milestone.
The remaining readable authorities produce a typed wait; Dalph must not infer
that A1 stopped or recreate it from task text, cwd, recency, or thread metadata.

### Visible and forbidden result

Alice sees the same A1 remain executing, become safely suspended, become
terminal, or wait on explicitly unreadable executor evidence. She does not see
a replacement A2 merely because Dalph restarted.

Dalph must not restore an observer cursor, reuse a process identity as attempt
identity, start a replacement app-server against a contradictory live lease,
guess a Codex thread association, repeat Begin, or treat app-server death as a
safe-suspension or terminal proof.

### Acceptance-test mapping

The generic workflow-owner restart, durable Codex association, retained Safe,
typed failure, and capability-boundary outcomes map to the exact maintained
tests in the [canonical scenario-to-test
mapping](#canonical-scenario-to-test-mapping).

## Same-attempt safe suspension remains separate

When an exact suspension intent already exists, the passive owner may observe
`ExecutorWorkSafelySuspended(A1)` and publish it once. Without that intent, a
Safe projection is contradictory evidence and cannot release the position.
Resume remains a later work-changing command selected through current tracker,
claim, worktree, control, capacity, and Git facts. #265 neither requests
suspension nor authorizes Resume.

The causal Safe acceptance and the rejection without matching intent map to
separate exact maintained tests in the [canonical scenario-to-test
mapping](#canonical-scenario-to-test-mapping).

## Scheduling and failure clarifications

The observer subscribes to executor lifecycle changes before reading the
current projection. An executor notification is only a wake hint: Dalph
rereads the exact attempt and filters an equal projection in process memory.
For Codex, both a completed turn and the later completion of owned background
activity are wake sources because a background terminal may outlive its turn.
Codex `item/completed` truthfully wakes the observer when a unified-exec root
finishes. An exact descendant carrying both the application incarnation and
Codex thread identity can outlive that root without another provider
notification. Only while the exact turn is terminal and the fresh exact
owned-activity census is the sole reason its normalized report remains
Executing, one process-local owner schedules a paced census recheck. The timer
is only a wake: every recheck rereads the durable exact attempt-thread
association, fresh thread, and fresh activity census. It stops on a changed
projection, typed failure, attachment interruption, or loss of that qualifying
held-terminal state.

The fresh thread and owned-activity census remain authoritative. No timer,
notification payload, or restored observer cursor proves a lifecycle change.
Broad all-attempt polling and a tight census loop remain forbidden.

An unchanged Executing projection appends nothing and leaves one owner blocked.
Repeated equal wakes coalesce through that same owner. A notification that
arrives after subscription but before the current read completes cannot be
lost; the current-first attachment either reads the newer projection or keeps
the buffered wake for the next read.

`NoReport`, `TemporarilyUnavailable`, `Unreadable`, and
`CorrelationContradiction` are four distinct unresolved observations. The
serialized planned-attempt protocol records the exact evidence, retains the
responsibility and task-work position, proposes no successor, and schedules no
passive reread. A later process that reconstructs the same unresolved evidence
does not attach another observer. A new retry rule would require separately
accepted behavior; #265 does not infer it from restart or elapsed time.

This prohibition does not suppress command reconciliation. If history contains
an unsettled Begin, Resume, or Suspend command, ordinary recovery reconciles
that exact command once before considering passive attachment. If history
contains a pending exact lifecycle observation, ordinary recovery accepts that
observation before another executor read.

## Canonical scenario-to-test mapping

Every test name below is the exact name in the cited test file. This is the
only acceptance mapping for this scenario; the chronology sections above link
here instead of maintaining parallel narrative names.

| Chronology | Direct acceptance test | Test file |
|---|---|---|
| Live Executing becomes Terminal and releases exactly A1 | `observes live terminal executor change once and releases the exact position` | `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts` |
| Exact Suspend causally precedes Safe; A1 is released while an independent position remains held | `observes safe suspension only after exact suspend intent and releases only that attempt` | `packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts` |
| A pending Safe projection after process death retains its causal Suspend history and releases once | `accepts a pending Safe observation after process death with causal Suspend history and one release` | `packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts` |
| Safe without an exact Suspend intent is rejected | `rejects a passive Safe report without an exact Suspend intent` | `packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.test.ts` |
| Equal Executing waits without another read or Journal append | `awaits after unchanged executing projection without another read or journal append` | `packages/orchestrator/src/coordination/run/passive-planned-attempt-observer.test.ts` |
| A unified-exec item-completed wake rereads equal Executing; its exact descendant later exits without another provider event and the targeted cadence observes Terminal | `observes descendant exit at targeted cadence after an equal item-completed wake` | `packages/dalph/src/application/codex-planned-attempt-executor.test.ts` |
| Closing a held-terminal attachment cancels its targeted cadence | `closing a held-terminal attachment stops targeted owned-activity census checks` | `packages/dalph/src/application/codex-planned-attempt-executor.test.ts` |
| A targeted recheck returns a typed projection failure and no later cadence read occurs | `a typed held-terminal projection failure stops targeted census checks without retry` | `packages/dalph/src/application/codex-planned-attempt-executor.test.ts` |
| Processes share one app-server incarnation but only A carries A's exact Codex thread identity; a foreign or missing thread id cannot keep A Executing | `attributes escaped activity to the exact Codex thread and rejects foreign or missing thread ids` | `packages/dalph/src/application/codex-app-server-public.test.ts` |
| A suspension census signals A's exact descendants and never B's | `suspension census for one Codex thread never signals another thread` | `packages/dalph/src/application/codex-app-server-public.test.ts` |
| A notification arrives after subscription and before the consumer awaits | `current-first attachment cannot miss a terminal change between projection and await` | `packages/dalph/src/application/codex-planned-attempt-executor.test.ts` |
| The generic workflow owner is rebuilt from the shared Journal and retains one executing attempt without another Begin | `restart reprojects the exact executing attempt once then reattaches without Begin` | `packages/dalph/test/scenarios/production.test.ts` |
| A rebuilt Codex adapter uses the durable exact attempt-thread association, reads Executing, and later observes Terminal without another turn | `rebuilds Codex lifecycle attachment from durable association across scoped restart` | `packages/dalph/src/application/codex-planned-attempt-executor.test.ts` |
| Process 1 retains causally proved Safe; the rebuilt Codex adapter reads that exact Safe projection without another suspension or turn command | `rebuilds a causally proved Safe Codex projection from durable association across scoped restart` | `packages/dalph/src/application/codex-planned-attempt-executor.test.ts` |
| Restart sees retained Terminal before publication | `recovers process death before terminal publication by reprojecting and accepting terminal once` | `packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.test.ts` |
| Restart sees a pending Terminal observation | `accepts a pending terminal observation after process death without rereading or duplicating the report` | `packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.test.ts` |
| Absent, unavailable, unreadable, and foreign projections retain responsibility and position | `retains responsibility and position for absent unavailable unreadable or foreign projection` | `packages/dalph/test/scenarios/production.test.ts` |
| Each unresolved passive projection remains inert in a later process | `does not schedule another passive executor read after an unresolved $name projection` | `packages/orchestrator/src/coordination/run/recovery-activation.test.ts` |
| An unsettled command with a prior non-exact observation still reconciles once | `reconciles one unsettled command when its prior activation recorded a non-exact projection` | `packages/orchestrator/src/coordination/run/recovery-activation.test.ts` |
| The passive owner has only lifecycle projection and publication capabilities | `passive lifecycle owner has only current projection await and publication capabilities` | `packages/orchestrator/src/coordination/run/passive-planned-attempt-observer.test.ts` |
