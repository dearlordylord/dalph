# Replace one purged Codex work unit in the retained planned attempt

Status: accepted implementation scenario for issue #111.

This document preserves the earlier Codex executor decision that a materialized
attempt thread is never replaced. It adds an explicit Operator action for one
owned turn inside that retained thread, after Codex proves the exact preceding
turn was purged and Dalph freshly proves that the planned attempt, thread, and
worktree still have one exclusive owner. Ordinary Begin/Observe/Resume recovery
still never authorizes this replacement.

For the selected Codex executor, one non-ephemeral Codex thread is the private
task-work session retained for the outer planned `(RunId, AttemptId)`. Each
owned Codex turn is one provider work unit inside that session. Replacing a
purged turn never creates a new thread, planned attempt, or generic executor
correlation.

## Alice replaces a confirmed-purged Codex turn

### Starting facts and trigger

Alice is the Operator affected by this action. Run R has one unfinished planned
attempt P for task A. The Dalph Journal retains P's exact executor-work
responsibility and its generic command/report history; it contains no Codex
thread id. P still names task revision F1, active Dalph claim K1, Base SHA B1,
branch L1, and registered worktree W1. Git reports that W1 remains at a commit
descended from B1 and contains changed or untracked work that Alice wants to
keep.

The Codex private store associates P with retained thread S1 and records
preceding owned turn U1 as previously observed. `resumeThread(S1, W1)` returns
a readable, matching S1 history in which U1 is now absent. Because Dalph had
already durably observed U1, that exact disappearance is purge evidence. A
transport failure, malformed response, absent S1, idle thread, interrupted
turn, process death, or missing never-observed turn intent is not this fact.

Alice sends `ReplacePurgedProviderWorkUnit` with stable request identity D1 for
exact R and P. Exact redelivery of D1 resumes or returns the same replacement;
reusing D1 for another subject is a contradiction.

### Boundary order

1. Dalph reads the current Run history and private attempt association. Missing
   P or a different private correlation stops the action.
2. Dalph freshly reads the task tracker and requires exact current revision F1
   and exact active claim K1 for A. It does not use an older journaled tracker
   observation as current authority.
3. Dalph freshly asks Git for W1's registration, branch, current `HEAD`, B1
   ancestry, and complete changed/untracked-file status. A missing, moved,
   foreign, or unreadable worktree stops the action without changing it.
4. Dalph asks Codex for S1, requires the exact thread/cwd correlation, and
   accepts U1 as purged only when that otherwise readable history omits the
   previously observed U1. It then asks the execution substrate for every
   executor-owned writer that could still change W1. Exact absence is required;
   unreadable, contradictory, or live activity stops the action.
5. While holding P's existing executor-command exclusion, Dalph durably records
   replacement intent D1 with P, S1, U1, W1, and the exact purge evidence. This
   private executor record is not a generic Dalph Journal event and does not add
   another outer executor identity.
6. Dalph rereads the retained-ownership facts required after any ambiguous
   boundary and verifies that W1 was not silently reset, cleaned, moved, or
   replaced.
7. Dalph records a fresh owned-turn token for D1. After the second authority
   proof, it records that the exact `turn/start` boundary may now be crossed,
   then calls `turn/start(S1)`
   with A's original F1 task specification, P's
   immutable planned facts, and explicit evidence that U1 was purged and the
   new turn is a replacement work unit in the retained P/S1/W1 session.
8. After returned turn U2 is correlated to that token, Dalph seals U1 and its
   purge evidence as immutable private history, makes U2 the current work unit,
   and returns the ordinary exact `ExecutorWorkExecuting(P)` report. Later
   passive observation, exact safe-state Resume, and suspension use S1/U2
   without presenting U2 as resumed U1.

Alice sees one successful replacement for D1 and P continue in the same W1.
She does not see a new attempt, Base SHA, branch, worktree, claim, or generic
executor correlation. Dalph must not reset, clean, copy, merge, move, or delete
W1; edit K1; mutate U1; describe U2 as resumed U1; or send P's incomplete work
to semantic review or integration.

### Acceptance tests

- `reconciles a lost turn/start response and seals one U2`
- `returns the same sealed D1 result on exact redelivery without starting U3`
- `persists an immutable purged-unit replacement ledger and reopens it exactly`
- `rejects replacement request identity reuse and one-field correlation/history mutations`
- maintained cassette `purgedWorkUnitReplacement` runs this chronology through
  `runs maintained Codex executor stories through the concrete production
  executor` with controlled tracker, Git, Codex, store, and
  execution-substrate boundaries.

## Unreadable, absent, foreign, or concurrently writable state fails closed

### Starting facts and trigger

Alice sends the same kind of replacement request, but one required fresh read
does not prove the happy-path facts. The alternatives are distinct:

- Codex is temporarily unreachable or U1's response is malformed, so purge is
  unreadable rather than confirmed;
- S1 is readable and still contains U1, so the work unit is conclusively not
  purged;
- the private store or Codex has no retained S1 task-work session;
- its thread, Run, Attempt, cwd, task revision, or claim conflicts
  with D1;
- tracker or Git evidence is missing, foreign, changed, or unreadable; or
- the execution substrate reports a live, unreadable, or contradictory writer
  that could still change W1.

### Chronology and result

Dalph performs only the reads needed to classify that exact branch. It records
no replacement intent, calls no `turn/start`, retains P's
generic responsibility and task-work position, and leaves every Git and
provider artifact untouched. A later explicit invocation starts with fresh
reads again; it does not turn elapsed time or process death into purge or writer
absence.

Alice sees the exact typed outcome: `ProviderTemporarilyUnreadable`,
`PurgeUnconfirmed`, `TaskWorkSessionAbsent`, `CorrelationConflict`, or
`ExclusiveRetainedOwnershipUnproved`. Dalph must not collapse these into
`ConfirmedPurged`, fabricate a replacement, release P, or select #66 clean
restart automatically.

### Acceptance tests

- `covers the replacement cut before durable intent`
- `rejects a foreign U2 correlation without making it current`
- `rejects durable purge evidence for another private thread before resuming it`
- `runs maintained Codex executor stories through the concrete production executor`
- maintained cassettes `purgedWorkUnitUnreadable`,
  `purgedWorkUnitStillPresent`, `purgedWorkUnitSessionAbsent`,
  `purgedWorkUnitCorrelationConflict`, `purgedWorkUnitWriterConflict`, and
  `purgedWorkUnitRequestConflict` expose every actor-visible wait or
  contradiction and the forbidden zero-replacement-call result.

## Process loss reconciles replacement intent before another provider call

### Starting facts and crash cuts

There is no person acting at the crash instant. Alice previously submitted D1,
and Dalph may stop at any of these private executor cuts:

1. after fresh purge/ownership proof but before replacement intent is durable;
2. after replacement intent is durable but before the fresh authority reread;
3. after U2's owned-turn intent is durable but before `turn/start(S1)`;
4. after the turn-boundary-crossing fact is durable and `turn/start(S1)` may
   have crossed, but before returned U2 is durable;
5. after U2 is durable but before it becomes P's current private record; and
6. after U2 becomes current but before U1 history is sealed.

### Recovery order and result

At cut 1 no replacement operation exists; a later explicit D1 invocation
starts fresh. At every later cut, Dalph reads D1's exact private record and
freshly rereads tracker, Git, purge, and writer authority before continuing.
Once `turn/start` may have crossed, recovery reads S1 for D1's exact owned-turn
token before sending any turn. A missing never-observed token is ambiguous and
does not permit another turn; only an exact matching U2 settles that boundary.
Once U2 is observed, recovery seals the same U1-to-U2 history exactly once.

The later invocation returns the one D1 result or an exact fail-closed outcome.
It must not start two task turns, resume U1, erase changed files, or create a
second replacement after U2 was observed.

### Acceptance tests

- `reopens the node private store at every replacement crash cut without starting U3`
- `reopens after U2 crossed turn/start and reconciles it without starting U3`
- `reconciles a crossing marker without blindly retrying turn/start`
- `recovers after U2 history is durable but before the current private record`
- `recovers after U2 observation before the private history seal`

These are executor-private crash cuts. They do not add P0-P6 actions to
`plannedAttemptExecutor.qnt`: the model still observes one unchanged outer P
and only its ordinary `ExecutorWorkExecuting`, `ExecutorWorkSafelySuspended`,
or terminal report. The
existing outer conformance suite remains the negative control that no internal
identity enters Dalph's Journal, capacity, responsibility, or correlation.

## Replacement preserves incomplete work outside semantic review

U1 was purged before producing an accepted terminal result. W1 may contain
commits, modified files, and untracked files. U2 receives W1 as its cwd and the
explicit purge evidence in its first task turn so it can inspect and continue
that work. Dalph does not construct an accepted result, Integrator session,
review request, promotion, tracker completion, or cleanup operation from the
replacement action. Only a later ordinary terminal `Accepted` report may enter
the existing integration protocol.

Acceptance tests:

- `runs maintained Codex executor stories through the concrete production executor`
  asserts committed, modified, and untracked evidence before the replacement
  turn and zero semantic-review, integration, and cleanup boundary calls.

## Alice chooses clean restart instead

This issue does not alter the accepted #66 path. When Alice chooses
`RestartTaskImplementation`, Dalph first proves P1 safely suspended, preserves
P1's claim, worktree, branch, commits, uncommitted work, journal evidence, and
provider history, records P1's exact disposition, and atomically plans distinct
P2 with a fresh W2 at the current target head. P2 never receives W1's changes.

No provider-work-unit replacement call occurs in that chronology, and this
issue never silently converts a failed D1 replacement into Restart. The #66
tests `records one atomic P1 to P2 replacement before ordinary clean successor
work`, `reconstructs P2 after replacement and never allocates P3`, and the
maintained `changedAttemptRestartsCleanlyAuthoredCassette` remain the acceptance
evidence.

## Scenario-to-test mapping required at handoff

| Operational chronology | Required named evidence |
| --- | --- |
| Confirmed purge and retained W1 | `reconciles a lost turn/start response and seals one U2`; `returns the same sealed D1 result on exact redelivery without starting U3`; authored `purgedWorkUnitReplacement`; recorded projection in `runs maintained Codex executor stories through the concrete production executor` |
| Unreadable, still-present, absent, conflict, writer, and request-reuse branches | `covers the replacement cut before durable intent`; `rejects a foreign U2 correlation without making it current`; `rejects durable purge evidence for another private thread before resuming it`; the exact result table in `runs maintained Codex executor stories through the concrete production executor`; authored `purgedWorkUnitUnreadable`, `purgedWorkUnitStillPresent`, `purgedWorkUnitSessionAbsent`, `purgedWorkUnitCorrelationConflict`, `purgedWorkUnitWriterConflict`, and `purgedWorkUnitRequestConflict` |
| Six process-loss cuts | `reopens the node private store at every replacement crash cut without starting U3`; `reopens after U2 crossed turn/start and reconciles it without starting U3`; `reconciles a crossing marker without blindly retrying turn/start` |
| Immutable U1 history and U2 identity | `persists an immutable purged-unit replacement ledger and reopens it exactly`; `roundtrips arbitrary persisted replacement ledgers through Schema and the private encoding`; `preserves exact correlation and history when a replacement phase is appended`; `rejects replacement request identity reuse and one-field correlation/history mutations` |
| No generic identity/model leak | `keeps the Codex replacement seam callable from the package root`; recorded privacy assertions in `runs maintained Codex executor stories through the concrete production executor`; unchanged outer planned-attempt conformance suite |
| Worktree and incomplete-work preservation | committed/modified/untracked fresh-authority evidence and zero semantic-review/integration/cleanup assertions in `runs maintained Codex executor stories through the concrete production executor` |
| Clean restart alternative | `records one atomic P1 to P2 replacement before ordinary clean successor work`; `reconstructs P2 after replacement and never allocates P3`; maintained `changedAttemptRestartsCleanlyAuthoredCassette`; the clean-restart composition has no `CodexProviderWorkUnitReplacement` dependency or call |
