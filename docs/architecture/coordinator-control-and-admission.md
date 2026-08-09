# Coordinator, Control, and Admission

This page groups the process-level rules that sit around descriptive delivery:
exclusive coordinator ownership, Run lifecycle, Pause and Unpause, bounded
admission, resource ownership, waits, and Run stabilization.

## Exclusive coordinator ownership

At most one live Dalph coordinator may send state-changing tracker or Git
requests for a canonical Git common directory. Production proves this by
holding an operating-system lock on the directory itself. Closing the Effect
Layer scope or ending the process releases the lock. A competing coordinator
fails before it sends a state-changing request.

Every requested path is canonicalized before either the deterministic adapter
or production adapter evaluates it. Before each live state-changing request,
the coordinator checks that the locked descriptor and canonical path still
identify the same directory. A contradiction interrupts an in-flight request
and prevents later requests.

The native acquisition request is non-blocking and is not retried. While the
lock is held, the background ownership check starts its next descriptor/path
comparison one second after the previous comparison completes. State-changing
requests additionally check synchronously before crossing their seam. This is
a local-filesystem contract; network filesystems and distinct bind-mount
aliases require separate qualification.

A durable row, stale-file timeout, TTL lease, in-process semaphore, or task
claim is not a substitute. Dry-run is read-only and does not acquire the
production lock.

## Run establishment and activation

One production entry accepts an exact `AllocatedWorkflowRunId`, tracker
target, and lazy source of initial control policy. The cryptographic allocator
may mint the identity in a separate Run-creation step; allocation itself does
not begin a Run. The entry first scans Journal startup facts while coordinator
ownership is held. More than one unfinished Run fails closed naming every
identity and constructs no activation.

For absent exact history, Run establishment evaluates and schema-decodes the
initial policy and atomically records that identity, target, and policy before
the first tracker read. For existing history, it does not evaluate or accept a
replacement initial policy. It validates every row, requires the exact Run and
target, and reconstructs the latest durable policy and exact unfinished
responsibilities. Invalid or mismatched history fails before any tracker, Git,
or executor action.

This application behavior is idempotent across a lost beginning-append
response: the later call reads and reconstructs the accepted beginning. The
lower Journal boundary still rejects a direct second `WorkflowRunBegan`, so a
duplicate append remains visible as a lifecycle defect rather than silently
merging payloads.

Successful establishment feeds one bounded Run activation. New and existing
history receive the same delivery, planning, runtime, stabilization, and
finality interfaces; no caller selects a restoration mode. Before new
admission, activation recreates task-work positions from exact unfinished
responsibilities under the reconstructed policy. It never restores a
process-local owner, semaphore, fiber, or position map as authority. Controlled
and external implementations are selected by Layers at program initialization,
not by a mode tag in shared domain code.

A normally completed Run records one final termination fact. It is the last
record for that Run, and the Journal rejects every later append. A crash leaves
an unterminated Run recoverable. A quiescent but incomplete invocation may
return without recording termination, leaving the same Run available to a
later establishment and activation. A terminated history validates as closed
and never constructs another activation; a new Run for the target requires a
separately allocated identity.

See
[run-establishment-and-activation.md](../scenarios/run-establishment-and-activation.md)
and
[ADR 0011](../adr/0011-establish-runs-idempotently-before-activation.md).

## Pause and Unpause

The control surface receives Pause and Unpause as ephemeral requests. Receiving
or queueing a request is not itself a workflow occurrence. When Dalph applies
the direction, it records one initiated action for the exact Run or task.

Pause does not cancel a bounded state-changing request already sent. That
request reaches its normal outcome or uncertainty boundary. Dalph records the
known result and starts no later forward-progress action for the paused
subject. The request's ordinary reconcile-before-retry rules continue to
apply.

Ordinary Pause preserves claims, planned attempts, worktrees, unfinished
executor work, accepted results, and integration obligations. It does not
authorize cleanup, abandonment, release, rollback, or handoff. When running
executor work must stop, Dalph asks the executor to bring the complete planned
attempt to a safe resumable stop. Only the executor's safe-suspension report
makes its task-work position available.

Run Pause is one Run-level direction, not a batch of task directions. Task
Pause applies to the selected task and the current transitive descendants of
tracker grouping edges. It does not follow prerequisite edges. Current graph
knowledge derives coverage; Dalph does not persist the resolved descendant
set.

Unpause removes only the corresponding direction. It does not directly restart
executor work. Dalph obtains the current authority evidence required and
supported by each obligation's accepted protocol, then lets ordinary
description and planning derive what may happen next. The current same-process
executor protocol does not inspect or adopt an independently surviving session.

A confirmed pause is passive. It schedules no Run-specific polling or timer by
itself.

See [ADR 0008](../adr/0008-derive-run-scoped-pause-state.md),
[Run Pause scenarios](../scenarios/issue-134-pause-whole-run.md), and
[task Pause scenarios](../scenarios/issue-135-pause-task-grouping-descendants.md).

## Frontier and bounded tickets

The delivery frontier is a pure graph-only projection. It describes every task
in the established graph as eligible or excluded with exact graph evidence.
It performs no read and starts no work.

Bounded parallel tickets apply current Run control policy to that frontier.
They retain both selected tickets and the negative placement of every relevant
ticket: eligible outside the bound, graph-excluded, or absent from the complete
graph. Existing exact obligations therefore do not disappear merely because a
task leaves the positive selection.

Policy and graph changes update these projections through their current
signals. Neither projection persists a queue, scheduling cursor, capacity
reservation, or wakeup.

## Planning, admission, and positions

Planning derives a deterministic proposal frontier from current descriptive
facts. It performs no external request, owns no fiber, and allocates no fresh
operation or attempt identity. Duplicate ownership of one exact proposal is a
typed conflict rather than a deduplication rule.

Runtime chooses proposals that fit current resource availability. It gives
existing obligations their accepted priority and uses stable task identity to
order otherwise equivalent fresh work. Tracker enumeration order, map
iteration, and ambient randomness are not scheduling inputs.

One task holds at most one task-work position. Dalph decides whether a proposed
action needs zero or one position; the executor does not acquire or release it.
The position becomes associated with an exact planned attempt before executor
work begins and remains occupied until a terminal executor report or safe
suspension permits release.

Capacity contraction is non-preemptive. Existing holders continue even when
usage temporarily exceeds the new ceiling; later admission waits. Expansion
preserves holders and permits later proposals to be admitted. Positions are
recreated from unfinished exact obligations after the next Run establishment,
not restored from a persisted semaphore.

Integration-resource ownership is separate from task-work capacity and is
serialized by repository/ref target according to the integration protocol.

See [ADR 0009](../adr/0009-separate-frontier-from-bounded-admission.md),
[issue-54-resize-task-admission.md](../scenarios/issue-54-resize-task-admission.md),
and [issue-131-conflicting-capacity-observation.md](../scenarios/issue-131-conflicting-capacity-observation.md).

## Wait, pause, isolation, relinquishment, and settlement

These conditions are not interchangeable:

- A **wait** names the condition preventing a proposed action and the
  observation that could change it.
- A **pause** is an applied Operator direction that forbids later forward
  progress for its subject.
- **Isolation** retains obligations but forbids action in the affected region
  until repair or current evidence makes action safe.
- **Relinquishment** durably ends one exact obligation after current evidence
  or an authorized handoff proves Dalph may no longer act.
- **Settlement** establishes the accepted disposition of an obligation and its
  resources.

One unavailable branch blocks another only when the second branch concretely
needs its prerequisite, a shared resource it holds, a Run-wide direction, or a
shared valid history/capability.

## Run stabilization

Run stabilization observes both the current proposal frontier and live runtime
ownership. Quiescence requires no executable proposal and no admitted action
still running. It requires one later accepted complete tracker observation G2
after the observation G1 from which quiescence was derived. Equal graph content
still gives G2 its own later logical-read identity. Quiescence is not proof of
completion and is not persisted.

The later accepted observation re-enters the same tracker graph signal:

- if it reveals work, ordinary delivery and planning expose that work;
- if all target tasks completed successfully and every Dalph obligation and
  resource settled, stabilization may authorize one Run termination;
- if the Run remains incomplete with no executable action, the invocation may
  return successfully without termination, leaving the Run recoverable.

An incomplete, contradictory, failed, unjournaled, or unreconstructed read
authorizes neither work nor termination. Continuous polling or waiting after an
incomplete return is a separate policy.

See [issue 194](https://github.com/dearlordylord/dalph/issues/194).
