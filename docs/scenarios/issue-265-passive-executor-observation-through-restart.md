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

- `observes a live executing attempt become terminal without another begin`
  must assert one Begin call, one terminal acceptance at the next ordinal, and
  one exact position release.
- `several unchanged passive projections append nothing and do not busy loop`
  must use a controlled clock or controlled executor signal.
- `process loss before and after terminal publication accepts one terminal
  report` must exercise both crash cuts.

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

- `reattaches after same-host Dalph and app-server restart without another
  begin` must use the durable attempt-thread association and assert one current
  projection plus one newly attached process-local owner.
- `restart accepts a persisted terminal projection once` and `restart accepts
  a proved safe projection once` must assert exact correlation and the next
  report ordinal.
- `restart preserves responsibility for absent unavailable unreadable and
  foreign projections` must be parameterized and assert no successor or
  position release.
- `the passive observation owner has no mutation or authority-read
  capabilities` must prove the Layer or contract cannot access Begin, Resume,
  suspension, tracker, Git, cleanup, or Journal append boundaries.

## Same-attempt safe suspension remains separate

When an exact suspension intent already exists, the passive owner may observe
`ExecutorWorkSafelySuspended(A1)` and publish it once. Without that intent, a
Safe projection is contradictory evidence and cannot release the position.
Resume remains a later work-changing command selected through current tracker,
claim, worktree, control, capacity, and Git facts. #265 neither requests
suspension nor authorizes Resume.

The acceptance mapping is `observes safe only after the exact suspension
intent and releases only that attempt`; it must also reject a Safe projection
without the matching intent.

## Scheduling and failure clarifications

The observer subscribes to executor lifecycle changes before reading the
current projection. An executor notification is only a wake hint: Dalph
rereads the exact attempt and filters an equal projection in process memory.
For Codex, both a completed turn and the later completion of owned background
activity are wake sources because a background terminal may outlive its turn.
The fresh thread and owned-activity census remain authoritative. No timer,
poll, notification payload, or restored observer cursor proves a lifecycle
change.

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

## Concrete acceptance seams

| Chronology | Direct acceptance test |
|---|---|
| Live Executing becomes Terminal | `observes live terminal executor change once and releases the exact position` |
| Exact Suspend is followed by Safe | `observes safe suspension only after exact suspend intent and releases only that attempt` |
| Equal Executing waits without durable progress | `awaits after unchanged executing projection without another read or journal append` |
| A background activity exits after an equal turn-completed wake | `observes activity exit after an equal turn-completed wake without another turn hint` |
| Current changes between subscription and await | `current-first attachment cannot miss a terminal change between projection and await` |
| Same-host restart rebuilds the owner | `restart reprojects the exact executing attempt once then reattaches without Begin` |
| Restart sees a retained Terminal before publication | `recovers process death before terminal publication by reprojecting and accepting terminal once` |
| Restart sees a pending Terminal observation | `accepts a pending terminal observation after process death without rereading or duplicating the report` |
| Four non-exact projections fail closed | `retains responsibility and position for absent unavailable unreadable or foreign projection` |
| Observer capability remains read-only | `passive lifecycle owner has only current projection await and publication capabilities` |
