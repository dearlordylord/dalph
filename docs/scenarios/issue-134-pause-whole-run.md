# Pause or unpause a whole Run

Issue: [Pause or unpause a whole run](https://github.com/dearlordylord/dalph/issues/134)

Status: accepted in the 2026-08-01 scenario interview.

These scenarios consume the durable applied Pause and Unpause directions from
issue #166. They do not add a command receipt, a person identity, or a
transport request identity. Issue #135 separately owns task and grouping
descendant pause behavior.

Run Pause is a best-effort workflow-selection boundary, not instantaneous
process suspension. Work already selected or sent before Pause may finish or
reach its accepted safe boundary, and Dalph may complete the lightweight
bookkeeping needed to record and understand that outcome. After Dalph observes
Pause, it starts no new task execution, integration, claim, Git mutation, or
other forward-progress responsibility. Generic service maintenance and the
ability to receive Unpause remain allowed; “light work” is not a separately
estimated or scheduled domain category.

While R is paused, Dalph does not devote run-specific activity to refreshing
R's outside authorities and promises no polling cadence or freshness. A read
already selected before Pause may finish, and shared or generic control-plane
activity may incidentally observe an authority. Such an observation neither
violates Pause nor authorizes forward progress; ordinary work still waits for
Unpause and its required fresh-read protocol.

## Alice pauses a Run before Dalph selects more work

### Starting situation

Alice is the Operator. Dalph is coordinating Run R against tracker target T.
The journal contains the beginning of R, its latest complete tracker facts, and
any responsibilities already created for R. No tracker, Git, executor, or
integration request is currently between its intent and observed outcome.
Neither task A nor any other task has an independently applied task Pause.

Git refs, worktrees, task claims, and executor reports remain owned by their
respective systems. The journal records their workflow history but does not
replace those outside facts.

### Trigger and chronological behavior

1. Alice applies Pause to R through the control boundary from issue #166.
2. Dalph records one `ControlDirectionApplied` occurrence for R.
3. Before selecting another tracker mutation, Git mutation, executor start,
   integration start, or other new forward-progress operation, Dalph
   reconstructs R as paused.
4. Dalph retains every existing responsibility and its exact planned attempt,
   worktree, claim, and integration history. It selects no new
   forward-progress operation for R.
5. If Dalph exits and restarts, it reconstructs the confirmed Run Pause before
   selecting new work. It may perform generic service maintenance and receive
   Unpause, but it promises no run-specific polling and starts no new
   forward-progress responsibility for R merely because the process restarted.

There is no ambiguity-crossing request after step 2, so no retry protocol is
needed for the pause reaction itself. Retrying the external Pause application
is governed only by issue #166: a pre-application crash may lose it, while a
recorded application remains explainable from the journal.

Alice can see that R starts no new forward work. Dalph must not manufacture task
Pause occurrences, release preserved claims, discard worktrees, start a
replacement task, or infer that preserved outside facts are still current.

### Acceptance-test seam

- `stops before the next forward operation after Alice pauses the Run`
- `restarts a confirmed paused Run without selecting new forward progress`
- `promises no run-specific polling while paused and ignores incidental observations for progress`
- `keeps task Pause state unchanged when Alice pauses the Run`

## Alice pauses while an already-sent bounded action is unresolved

### Starting situation

Run R has a preserved responsibility for task A. Dalph recorded intent before
calling one accepted tracker, Git, executor, or integration boundary, and the
request may already have crossed that boundary. Its outcome is not yet known.
No later operation for that responsibility has started.

### Trigger and chronological behavior

1. Alice applies Pause to R, and Dalph records the applied direction.
2. Dalph does not pretend the earlier request was cancelled and does not send a
   competing request.
3. Dalph completes the accepted bounded wait or checks the owning system again
   when the outcome is ambiguous, then records the observed result.
4. Dalph performs only the already-selected work and lightweight bookkeeping
   needed to bring that exact responsibility to its accepted safe boundary and
   record the outcome. It selects no later forward-progress operation.
5. Once every in-flight responsibility is at a safe boundary, the Run remains
   passively paused.

If Dalph crashes between steps 2 and 4, restart reconstructs the prior intent,
the applied Run Pause, and any recorded outcome. It checks the owning boundary
before retrying an ambiguous effect and still stops at the same safe boundary.

Alice sees the Run move toward a safe pause rather than stopping an outside
effect mid-call. Dalph must not estimate a new operation as “light” and start
it after Pause, duplicate the request, abandon an uncertain outcome, start
later work, roll back completed Git state automatically, or claim that an
executor is safely suspended before the executor reports that fact.

### Acceptance-test seam

- `reconciles an already-sent bounded action and stops at its safe boundary`
- `recovers an ambiguous in-flight action under Run Pause without duplicating it`

## Alice unpauses a passively paused Run

### Starting situation

Run R has a durable applied Run Pause. Its journal retains at least one
preserved responsibility for task A. No run-specific polling cadence or worker
is required merely because R is paused, although shared or generic activity may
have incidentally observed outside facts. The tracker, Git repository, claims,
worktrees, and executor may have changed while R was passive.

### Trigger and chronological behavior

1. Alice applies Unpause to R, and Dalph records the applied direction.
2. Dalph does not directly start or resume executor work.
3. For each preserved responsibility, Dalph selects the accepted fresh reads
   required by that responsibility: current tracker membership, lifecycle,
   instructions, prerequisites or grouping facts; current claim facts; current
   Git lineage and worktree facts; and current executor facts when that
   boundary applies.
4. Dalph records each observation through its existing intent/observation
   protocol.
5. Only the resulting current frontier may admit ordinary work. Changed,
   completed, blocked, foreign-claimed, unreadable, or removed tasks follow
   their accepted reconciliation or wait behavior instead of resuming stale
   work.

If Dalph crashes after step 1, restart reconstructs Unpause and the preserved
responsibilities. It resumes with the missing fresh reads, reusing recorded
post-Unpause read outcomes where their protocols allow it, and still does not
directly start a worker. Reapplying Unpause is governed by issue #166 rather
than an invented receipt identity.

Alice sees R resume only after current authority permits it. Dalph must not
create or remove task Pause occurrences, trust pre-Pause observations, start a
worker before admission, or interpret preserved responsibility as current
provider authority.

### Acceptance-test seam

- `freshly rereads every preserved authority after Alice unpauses the Run`
- `does not directly start a worker when Alice unpauses the Run`
- `reopens after Unpause and continues the missing fresh reads`

## Alice unpauses while safe suspension is still in flight

### Starting situation

Run R is paused, and Dalph has already asked the executor to bring planned
attempt P for task A to its accepted safe resumable boundary. The executor has
not yet reported the complete-attempt suspension result. P retains its exact
Run ID, Attempt ID, worktree, Base SHA, and responsibility.

### Trigger and chronological behavior

1. Alice applies Unpause to R while the suspension request remains unresolved.
2. Dalph records Unpause but does not cancel the suspension request and does
   not start competing executor work.
3. Dalph waits for or reconciles the exact suspension result and records it.
4. After the safe boundary is confirmed, Dalph performs the same fresh reads
   required by the ordinary Unpause scenario.
5. P can resume only through the ordinary frontier and bounded admission
   protocol.

If Dalph crashes before step 3, restart checks the executor through its
accepted recovery boundary before another suspension request. Alice sees no
duplicate worker and no false resume. Dalph must not treat Unpause as
cancellation, allocate a second task-work position for P, or bypass current
tracker, claim, Git, and executor observations.

### Acceptance-test seam

- `finishes the exact safe suspension before fresh reads after Unpause`
- `recovers Unpause during safe suspension without competing executor work`

## Scenario-to-test mapping required at handoff

The implementation handoff must replace each seam above with a passing test or
model scenario. It must also identify which existing provider protocols prove
each fresh read and ambiguous-effect reconciliation. Aggregate coverage and the
P0–P6 conformance cut-point labels are not substitutes for this mapping.
