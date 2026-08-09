# Run delivery actions from accepted reactive facts

Issue: [#193](https://github.com/dearlordylord/dalph/issues/193)

No person manually starts the process-local scheduling below. A maintainer can
see the resulting GitHub request, integration-agent request, typed failure, or
Run completion, but cannot see Dalph's in-memory proposal owner.

## One persistent GitHub-claim proposal starts one live request

### Starting situation

GitHub's last complete graph read says open task A has no prerequisites and no
claim. Dalph's journal contains that exact graph observation. No worktree or
executor session exists for A. The current Run has one task-work position
available, and Dalph has not allocated the operation identity for adding A's
claim label.

### Trigger and ordered boundary calls

The accepted graph observation publishes A's claim-acquisition proposal. Dalph
reserves A's one task-work position, then allocates the operation identity,
records the exact claim intent, and asks GitHub to add the repository label
used as A's claim record. While GitHub's response is pending, the same current
proposal may be published again. Dalph keeps one process-local owner for that
exact proposal and does not send a second GitHub request.

When GitHub's result is accepted, the interpreter returns. Until the ordinary
graph/journal publication removes A's old proposal, its settled owner remains
as a same-process duplicate guard. A repeated publication of that same
proposal still cannot send another request. Once the proposal disappears,
Dalph removes the settled owner. An independent B proposal may start whenever
B has its own available position.

This scenario does not include a crash; the next scenario owns restart. The
maintainer sees at most one GitHub claim request for A. Dalph must not allocate
before admission, start A twice, occupy two positions for A, or release B's
position. These prohibitions preserve D1, D12, D15, and D41.

### Acceptance-test mapping

- `starts one live action while its proposal remains present`
- `does not allocate an operation or attempt identity before admission`
- `passes a deferred proposal without reordering the later proposals`

## A newer causal route does not repeat the same recovered boundary read

### Starting situation

An unfinished Run retains exact attempt A and has asked the task tracker to
read A's current work specification after accepted graph G1. Dalph owns that
tracker request in this process. Before it returns, accepted graph G2 changes the read's causal
predecessor and therefore its proposal identity, but the original recovered
transition kind, RunId, and AttemptId are unchanged. The same situation can
occur when Dalph asks the task tracker to read the current claim record of a
responsible task that has no planned attempt; in that case the exact subject is
its TaskId.

After integration responsibility for A has started, Dalph can instead be
waiting for Git to read A's target lineage. The journal identifies that exact
responsibility by its queued and started positions; it also retains A's exact
RunId and AttemptId and the integration target's repository and ref. A newer
predecessor operation can change the lineage-read proposal identity without
changing any of those facts.

### Trigger and ordered boundary calls

The ordinary relation publishes the G2-derived proposal while the G1-derived
tracker request is still owned. Dalph keeps one process-local owner for the original
recovered transition kind and exact subject, skips the duplicate proposal, and
continues admitting unrelated work. After the first read settles, its accepted
observation removes that recovered read from the ordinary relation, and the
settled owner is pruned normally.

For the started integration responsibility, Dalph likewise keeps one owner
while the first `read target lineage` Git call is pending. Its identity includes
the planned-attempt-continuation purpose, exact RunId and AttemptId, exact
repository and ref, and exact queued and started journal positions. It excludes
the newly allocated read operation identity and causal predecessor identities.
The changed proposal therefore cannot start a second Git call, while unrelated
work can still proceed.

The recovered transition kind is part of this process-local identity. A
continuation claim read and a later stopped-attempt claim read for the same
RunId and AttemptId ask the task tracker different questions about the current
claim. Once the continuation read settles and the stopped-attempt transition is
published, Dalph admits the stopped-attempt claim read. Release and
claim-reacquisition actions keep their exact proposal identities; they are not
read-coalesced. Executor calls do not apply because these proposals select only
task-tracker or Git reads.

There is no person or crash in this same-process race. The maintainer sees one
task-tracker call for each exact recovered question and ordinary independent
progress; for the integration case, the maintainer likewise sees one Git read.
Dalph must not overlap or replay a read merely because its causal route changed,
coalesce two different recovered transition kinds or integration purposes, or
reorder queued proposals globally.

### Acceptance-test mapping

- `does not repeat one recovered observation after only its causal route changes while it is live`
- `does not repeat one responsible-task claim read after only its causal route changes while live`
- `does not repeat one started-integration lineage read after only its causal route changes while live`
- `runs a stopped-attempt claim read after the distinct continuation-claim read settles`

## A journaled integration-agent report selects the next exact continuation

### Starting situation

Task A already produced accepted commit C. Dalph's journal says integration of
C started against target head H, Git proved H still descends from A's planned
Base SHA, and this process holds A's exact integration target. The first
integration-agent request is live in A's isolated candidate resource. Its
configured continuation and correction counts are finite.

### Outside result and ordered behavior

The integration agent reports `Conflict` for A's exact session and candidate
resource. Dalph appends that report to the workflow journal before the
interpreter returns. The journal publishes its new accepted position. Delivery
planning removes the old continuation proposal and publishes a new exact
continuation naming the accepted report position. Only then may Dalph ask the
same session to continue.

If the agent later submits candidate M, Dalph asks Git for M's object type and
complete ordered direct-parent list. A valid `[H, C]` result is appended and
ends candidate construction. A non-submitting report or invalid Git result may
select another continuation only while its respective configured count remains.
Replaying the old journal publication cannot repeat the old agent boundary.

If Dalph stops after appending the report but before observing the new
proposal, restart reconstructs the report position and selects the same next
continuation. It does not need an in-memory completion acknowledgement. The
maintainer sees bounded continuation of the same candidate session, or the
durable correction/continuation-limit result with its artifacts preserved.
Dalph must not use `ProposalCompleted`, a general invalidation command, or a
returned in-memory result as authority to advance.

### Acceptance-test mapping

- `reacts to an accepted action result through its owning fact signal`
- `round-trips every non-submitting integration-agent report`
- `runs maintained conflict, unreadable-Git, correction, exhaustion, and contradiction stories`
- `reopens an ambiguously constructed candidate before retrying it`

## Each accepted Running report authorizes one next executor request

### Starting situation, restart, and ordered boundary calls

Executor session E belongs to A's exact RunId and AttemptId. Dalph's journal
contains A's executor-responsibility beginning and accepted `Running` report
ordinal 1. The process that accepted ordinal 1 has exited, so its proposal
owner no longer exists. GitHub still reports A open with Dalph's exact claim;
Git still proves A's planned worktree and target lineage.

On restart, Dalph reconstructs ordinal 1 as the exact accepted progress for
the next continuation, reserves or reuses A's one task-work position, and
calls the executor's `startOrContinue` boundary once for E. If E returns
`Running`, Dalph appends it as ordinal 2 before publishing a new
continuation whose identity names ordinal 2. The settled ordinal-1 owner
cannot suppress this distinct continuation. Dalph may then call
`startOrContinue` once more. If E returns `Terminal`, Dalph appends it as
ordinal 3, releases A's task-work position, and publishes no further
continuation.

Dalph accepts at most three consecutive `Running` reports for this exact
attempt since its last accepted `SafelySuspended` report. If it reaches three,
the next continuation fails with the typed
`PlannedAttemptExecutorContinuationLimitReached` result before calling E.
The journal and worktree remain intact, and restart reconstructs the same
exhausted budget instead of beginning another three calls.

A replay of ordinal 1 while its exact proposal owner remains live or settled
does not call E twice. A report for another RunId or AttemptId authorizes
nothing for A. The maintainer sees the recovered session advance through
`Running(1)`, `Running(2)`, and `Terminal(3)` without a duplicate request or a
forever wait. These prohibitions preserve D1, D12, and D41.

### Acceptance-test mapping

- `gives each accepted executor report its own continuation proposal`
- `publishes each accepted executor report before continuing and stops after Terminal`
- `stops an always-Running executor at the durable continuation limit`
- `stops an always-Running controlled workflow at the shared continuation limit`

## Process loss discards a live claim owner and rereads GitHub

### Starting situation and outside event

Dalph recorded its exact intent to add A's claim label and sent the request to
GitHub. GitHub may have added the label, but the response was lost. Dalph has
not appended an accepted outcome. Its process then exits, discarding the live
fiber, task-work reservation, and proposal-owner map while retaining the
journal intent.

### Restart, retry, and visible result

After restart, Dalph reads the workflow journal, finds A's intent without an
outcome, and asks GitHub for A's current claim record before any create retry.
If GitHub returns the exact label, Dalph records that observation and continues
without creating another claim. A foreign label yields the existing typed
ownership conflict; an unreadable GitHub response grants no retry permission.
Independent task B follows its own current graph and admission facts.

The maintainer sees one exact claim, a typed wait/failure, or independent B
progress. No person repairs process-local state. Dalph must not infer that the
lost owner means GitHub did nothing, repeat the create before the reread, or
retain a process-local position across restart. These prohibitions preserve D6,
D7, D8, and D19.

### Acceptance-test mapping

- `rereads tracker authority after an ambiguously applied acquisition`
- `gives newly begun and reconstructed Runs the same one-shot finality path`
- `replays the exact durable claim and worktree intents`

## Empty work hands control to Run-level stabilization for one final graph

### Starting situation and ordered boundary calls

The current proposal publication is empty and no live or settled owner remains.
The last complete GitHub graph observation is not yet sufficient for the
Run's finality decision. The delivery runtime returns its quiescent G1 result
to Run-level stabilization. Stabilization allocates one exact tracker-read
operation, records its intent through the journaled tracker boundary, asks
GitHub for the current graph, and waits for that exact accepted G2
observation. `QuiescenceProbe` is not a delivery-action route or proposal.

If G2 reveals runnable task A, Dalph executes the newly published work before
checking quiescence again. If G2 equals G1 and the Run remains incomplete,
Dalph returns the typed incomplete decision. If G2 proves the target and every
responsibility settled, bootstrap records the single Run termination. A crash
before the observation loses only process-local activation state; the next
ordinary establishment and activation asks again if a final read is still
needed. A crash after the observation was appended uses that journaled
observation normally.

The maintainer sees the final tracker read and Run decision, or the existing
typed tracker-read failure. Dalph must not publish G2 as delivery work,
disguise action-result invalidation behind stabilization, perform a second G2
read in the activation, or treat an empty proposal list alone as Run
completion.

### Acceptance-test mapping

- `requests accepted G2 only after G1 becomes quiescent`
- `runs work published after G2 before phase two subscribes`
- `returns without terminating after equal G2 leaves the Run incomplete`
- `keeps quiescence probes out of action planning and compatibility runtime code`
- Authored public-entry test
  `performs one final tracker read before the current bounded activation returns or terminates`
  labels the exact post-quiescence tracker result in the declarative story and
  proves the public activation returns only after consuming it. The accepted
  entry for an unfinished Run is the same idempotent establishment path
  described in
  [run-establishment-and-activation.md](run-establishment-and-activation.md).
