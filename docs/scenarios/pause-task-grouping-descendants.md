# Pause one task and its grouping descendants

Issue: [Pause a task and its grouping descendants](https://github.com/dearlordylord/dalph/issues/135)

Status: accepted by issue #135 and its `ready-for-agent` implementation request.

These scenarios consume the durable applied Pause and Unpause directions from
issue #166 and the opaque planned-attempt executor boundary from issue #158.
The tracker owns grouping and dependency edges. Dalph records one direction for
the selected task and derives its current grouping coverage from complete
tracker facts; it does not copy directions onto descendants.

## Alice pauses a parent while related tasks retain ordinary graph behavior

### Starting situation

Alice is the Operator. Dalph is coordinating Run R. The latest complete tracker
read contains parent A, child D, grandchild E, prerequisite P, dependant B,
sibling S, and independent task C. D is grouped under A and E under D. P is a
prerequisite of A, while B depends on A. No task has an independently applied
Pause. No request for A, D, or E is already in flight.

The tracker owns all grouping and prerequisite facts. Git owns refs and
worktrees, the executor owns current attempt reports, and Dalph's journal owns
only recorded workflow history.

### Trigger and chronological behavior

1. Alice applies Pause to `(R, A)` through the control boundary from issue
   #166. Dalph records one `ControlDirectionApplied` occurrence for A.
2. Before selecting more work, Dalph reads the latest complete tracker grouping
   facts and derives that A, D, and E are covered.
3. Dalph starts no new claim, worktree, executor, evidence, integration,
   completion, or cleanup operation for A, D, or E.
4. P, B, S, and C retain ordinary graph behavior. P may continue or start when
   otherwise eligible; B still waits on its prerequisite A; S and C may
   progress independently.
5. Later complete tracker reads may change the current grouping coverage.
   Dalph derives the next selection from those current facts without creating
   Pause occurrences for descendants.

A crash after step 1 reconstructs A's applied direction and derives coverage
from the latest valid complete grouping facts. A crash before application may
lose the external command under issue #166. There is no separate pause effect
to retry.

Alice sees A and its grouping subtree stop while unrelated work keeps moving.
Dalph must not follow prerequisite or dependant edges, pause siblings, create
descendant commands, use an incomplete grouping read as authority, release a
claim, or clean up preserved work.

### Acceptance-test mapping

- `derives only the selected task and its transitive grouping descendants`
- `suspends a running grouping descendant and reopens it after current facts move it outside the parent`
- `pauses A and its grouping descendants while prerequisite dependant sibling and independent tasks retain ordinary behavior`
- `records one parent Pause without manufacturing descendant directions`

## Alice pauses while covered executor work or another bounded request is in flight

### Starting situation

Run R has planned attempts for A and grouping child D. Each holds one task-work
position and has reported `ExecutorWorkExecuting`. Independent C is eligible. Dalph may also
have already sent one bounded tracker, Git, or integration request for covered
work. Exact claims, worktrees, sessions, work in progress, and responsibilities
are retained. The current coarse-executor milestone has no separate
evidence-sealing or tracker-completion operation: executor work is one opaque
responsibility ending in its correlated report, so there is no such additional
boundary for task Pause to interrupt or finish.

### Trigger and chronological behavior

1. Alice applies Pause to `(R, A)`, and Dalph records the exact applied
   direction.
2. Dalph does not pretend an already-sent bounded request was cancelled. It
   waits under that request's accepted policy, checks the owning system after
   an ambiguous result, and records the outcome without duplicating the
   request.
3. Dalph asks the opaque executor to suspend the complete planned attempts for
   A and D. It preserves each exact Run ID, Attempt ID, claim, worktree,
   session, and work in progress.
4. A task-work position remains held until the executor freshly reports
   `ExecutorWorkSafelySuspended` or a terminal result for that exact attempt. Dalph then
   releases only that attempt's position.
5. Integration already holding the serialized target resource reaches its
   known Git result and releases that resource. It starts no later cleanup or
   tracker completion request after reaching the boundary. The opaque executor
   report in step 3 is the milestone's only evidence boundary.
6. Independent C may use released capacity and continue through ordinary
   admission.

If Dalph crashes after a suspension request may have crossed the executor
boundary, restart reconstructs the owed suspension, checks the exact attempt,
and does not infer safe suspension from process death. Retrying a bounded
outside effect follows that effect's existing reconcile-before-retry protocol.
If a running independent task becomes A's child during the active Pause, the
complete graph read that first covers it starts a new suspension obligation;
an earlier safe suspension while it was independent does not settle that new
obligation, even when A is unpaused before the new report arrives.

Alice sees covered work reach safe resumable boundaries and independent work
continue. Dalph must not release capacity before a correlated report, discard
work in progress, delete a claim or worktree, duplicate an outside request, or
start later completion or cleanup.

### Acceptance-test mapping

- `suspends a running grouping descendant and reopens it after current facts move it outside the parent`
- `finishes an already-held integration boundary after task Pause without later cleanup`
- `lets independent work use capacity only after the covered attempt confirms suspension`
- `reopens an owed task suspension without duplicating executor work`

## Alice unpauses a grouping subtree while another task remains paused

### Starting situation

Run R records A paused and its planned attempt safely suspended. Grouping child
D is covered by A's direction. Independent task C has its own applied task
Pause. The tracker, exact claims, Git lineage, worktrees, and executor reports
may have changed while A and D were stopped.

### Trigger and chronological behavior

1. Alice applies Unpause to `(R, A)`. Dalph records one applied direction for A
   and does not create directions for D or C.
2. Dalph does not directly resume executor work or allocate a second position.
3. For each preserved responsibility formerly covered by A, Dalph obtains the
   current complete tracker graph and the accepted current specification,
   exact claim, worktree, target-lineage, and executor facts required by that
   responsibility.
4. Dalph records those observations through their existing protocols. Only the
   resulting responsibility-first frontier may admit A or D.
5. C remains paused by its independent direction. Changed, completed, blocked,
   foreign-claimed, unreadable, removed, or newly regrouped tasks follow their
   current reconciliation, wait, or pause result instead of resuming stale
   work.

If Unpause is applied while an earlier suspension request remains unresolved,
Dalph finishes or reconciles that exact request before performing the fresh
reads. If Dalph crashes after Unpause, restart reconstructs the direction and
continues missing reads; it does not directly start a worker.

Alice sees A's current grouping subtree resume only after outside authority
permits it, while C remains paused. Dalph must not trust pre-Unpause facts,
cancel an in-flight suspension, manufacture descendant Unpause directions,
clear C's Pause, or bypass bounded admission.

### Acceptance-test mapping

- `freshly rereads preserved task authorities before resuming a task grouping subtree`
- `finishes an in-flight task suspension before fresh reads after Unpause`
- `unpauses A without clearing an independent Pause on C`
- `reopens after task Unpause and continues missing fresh reads before executor work`

## Scenario-to-test mapping required at handoff

The implementation handoff must replace every seam above with a passing public
test or explicitly identify an inapplicable seam and its concrete reason.
Aggregate test totals and historical P0–P6 labels are not substitutes.
