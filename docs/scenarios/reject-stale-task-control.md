# Reject stale task Pause and Unpause requests

Issue: [Reject stale task pause and unpause requests visibly](https://github.com/dearlordylord/dalph/issues/156)

Status: accepted by issue #156 and its implementation request.

The task tracker owns whether a task belongs to one Run's configured target
closure. A rejected control request remains an ephemeral operator result; only
an accepted direction becomes a durable `ControlDirectionApplied` occurrence.

## Alice pauses a task that still belongs to the Run

### Starting situation

Alice is the Operator. Run R targets tracker closure T, and task 2 belongs to
the latest complete read of T. No Pause is recorded for task 2. Git, the
executor, claims, capacity, and cleanup have no role in deciding membership.

### Trigger and chronological behavior

1. Alice asks Dalph to Pause task 2 in R.
2. Before applying the direction, Dalph reads T through the logical task
   tracker.
3. The tracker returns a complete graph that contains task 2.
4. Dalph applies and durably records the exact task Pause through the existing
   control-direction protocol.
5. Ordinary task-Pause behavior may then drain already-running covered work.

If Dalph crashes before step 4, the request need not survive and retry performs
another fresh tracker read. If it crashes after step 4, recovery reconstructs
the applied direction. Alice sees an accepted Pause. Dalph must not apply the
direction before the read or use a graph for another Run target.

### Acceptance-test mapping

- `reads the current Run target before applying Alice's task Pause`
- `acceptedCurrentTaskRequiresMembershipReadTest`
- `replays received and applied control directions through production history reconstruction`

## Alice acts from a stale screen after task 2 leaves the Run

### Starting situation

Alice's screen still shows task 2 in Run R. Another actor has completed or
removed task 2 so a complete current read of R's target closure no longer
contains it. No request has yet crossed the control-application boundary. A
task with a similar provider-facing label may belong to another Run; it is not
R's task 2.

### Trigger and chronological behavior

1. Alice asks Dalph to Pause or Unpause exact task 2 in exact Run R.
2. Dalph reads R's configured tracker target before applying anything.
3. The tracker returns a complete graph that does not contain task 2.
4. Dalph returns a typed visible rejection naming R, task 2, the requested
   direction, and that the task is outside the current target closure.
5. Dalph records no applied direction and selects no interruption, claim,
   capacity, Git, executor, integration, or cleanup action.

There is no outside mutation to reconcile or retry: the read itself established
the rejection. If Dalph crashes before Alice receives it, the rejected request
need not be retained; her retry performs another fresh read. Alice sees a stale
task-control error. Dalph must not pause nothing silently, affect another Run,
or begin task-Pause draining.

### Acceptance-test mapping

- `rejects Alice's stale task Pause and Unpause visibly without applying either direction`
- `alreadyOutsideTaskRequestCannotChangePauseStateOrAnotherTaskTest`
- `staleRejectionPauseMutationIsDetectedTest`
- `rejects a stale task after a fresh read without selecting task work`

## The tracker cannot prove whether task 2 still belongs

### Starting situation

Alice asks to Unpause task 2 in R. The last complete graph may have contained
task 2, but the current logical tracker read fails or returns an incomplete
snapshot. No direction for this request has been applied.

### Trigger and chronological behavior

1. Dalph asks the tracker for R's configured target closure.
2. The tracker returns its typed unreadable or incomplete-snapshot failure.
3. Dalph returns that failure to Alice and does not reinterpret missing content
   as proof that task 2 is outside R.
4. Dalph records no direction and starts no downstream work.

A retry performs a new read because neither a rejection nor an application was
durably accepted. Alice sees the tracker-read failure, not a stale-task error or
successful Unpause. Dalph must not use cached membership, invent absence, or
apply the direction.

### Acceptance-test mapping

- `keeps an unreadable task membership distinct from stale rejection and applies nothing`
- `unreadableMembershipCannotApplyOrRejectAsStaleTest`
- `unreadableFailurePauseMutationIsDetectedTest`
- `shows an incomplete control read without recording a direction`

## Run control is not task membership control

Alice may Pause or Unpause Run R without asserting that a particular task
belongs to it. Dalph therefore delegates a run direction to the existing
durable protocol without a task-membership read. The existing runtime lease
still requires R to be active. There is no relevant task-tracker absence,
another task, or task-specific drain decision.

### Acceptance-test mapping

- `applies Alice's Run Pause without a task-membership read`
