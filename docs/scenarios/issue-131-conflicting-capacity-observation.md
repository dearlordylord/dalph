# Keep a freshly observed invocation occupied beside another reservation

Issue: [Derive the runnable frontier and bounded admission](https://github.com/dearlordylord/dalph/issues/131)

## Starting situation

No person directly triggers this behavior. The running Dalph coordinator has
configured one task-work capacity position. For task A, its process-local
capacity controller retains a reservation correlated with workflow operation
`reserved-A`. The task-work provider owns current invocation facts; Dalph's
workflow journal contains the responsibility from which the reservation was
reconstructed, but it contains no persisted capacity position.

The task-work provider then returns a fresh observation that a different
workflow operation, `running-A`, currently consumes task-work capacity for the
same task. This can occur while Dalph is reconciling exact operations after
coordinator or runner interruption. No GitHub task, Git ref, worktree, or
executor session is changed by applying this observation.

## Dalph action and visible result

The activation code passes the normalized provider observation to the capacity
controller. In order, the controller:

1. keeps the existing reservation for `reserved-A`;
2. records `running-A` as process-local occupied capacity;
3. reports that admission availability did not increase; and
4. returns `CapacityWait` when the coordinator next tries to admit task B.

If Dalph later releases only the reservation for `reserved-A`, `running-A`
remains occupied and task B still waits. Only a fresh task-work-provider
observation that `running-A` stopped removes that occupied position. The next
derivation may then reserve the position for task B.

The maintainer can observe that no new task work starts while the provider
still reports `running-A` consuming the sole position. Dalph must not discard
the provider observation because another operation has a reservation, silently
cancel either exact operation's position, or persist the derived reservation,
occupancy, or wait in the workflow journal.

## Crash and repeated observations

If Dalph crashes before or after applying the observation, it loses both
process-local position facts. Startup reconstructs the reservation from durable
workflow responsibility and asks the task-work provider for fresh invocation
facts before admitting more task work. Applying the same fresh
capacity-consuming observation again replaces the observation for that exact
running task rather than allocating another position. Repeating the matching
fresh release after `running-A` is already absent does not release
`reserved-A`.

There is no state-changing external request in this scenario, so request
acknowledgement loss and request retry do not apply. The only repeated boundary
action is the task-work-provider read; its normalized result remains
process-local capacity evidence.

## Acceptance-test mapping

- `fails closed for stale reservation mutations and retains conflicting provider evidence`
  proves that the controller retains both exact facts, refuses task B after
  only `reserved-A` is released, and admits task B only after the matching
  fresh release for `running-A`.
- The unchanged frontier-recovery model checks continue to prove
  `boundedCapacity` and fresh-evidence release behavior for M2's bounded
  one-operation-per-task abstraction. M2 does not represent two distinct
  operation identities for one task, so the exact correlation mismatch is
  proved at the production controller seam rather than claimed as a new model
  behavior.
