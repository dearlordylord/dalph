# Queue accepted results and cross the integration cutoff

Issue:
[Queue an accepted result and establish the integration cutoff](https://github.com/dearlordylord/dalph/issues/56)

## Two accepted results retain journal order across coordinator restart

### Starting situation

Alice monitors Run R but does not trigger either result. The tracker reports
independent Tasks A and B open, inside the same target, exactly claimed by
Dalph, and without unfinished blockers. Dalph planned one attempt for each task
against the same exact integration target. Both planned worktrees exist at
their recorded Base SHAs.

The controlled fake executor has completed its whole bounded workflow for A and
B. Each terminal completion names the exact immutable Git commit accepted for
that planned attempt. No integration responsibility or integration-start fact
exists yet. Neither task-work capacity nor the serialized integration resource
is occupied.

### Trigger and ordered boundary calls

Dalph receives A's typed terminal accepted result first. It records the
executor report, then records exact integration responsibility for A. The
journal envelope position of that responsibility is A's integration order;
Dalph writes no queue row, queue ordinal, timestamp, or completed-ID set.

Dalph receives B's typed terminal accepted result second and records B's exact
integration responsibility at the next committed journal position. Releasing
each task-work position does not acquire or release the serialized integration
resource.

The coordinator process and same-process fake executor die before either
integration begins. The tracker, Git repository, claims, and journal survive.
On restart, Dalph folds the journal and derives A then B from the two committed
positions. Current tracker facts still report both tasks open, claimed by
Dalph, inside the target, and without unfinished blockers.

The shared selector chooses A. Dalph acquires the exact integration-target
resource and records that A's integration started. That initiated action is the
non-cancellable cutoff: the derived pre-integration cancellation capability no
longer exists for A. B remains ordered behind A without holding task-work
capacity or the integration-target resource.

If the process dies before the integration-start append, restart derives the
same pre-integration capability and may select A again. If it dies after the
append, restart reconstructs A as already past the cutoff and must not append a
second start or expose pre-integration cancellation again. The runtime target
resource is reacquired only after current facts authorize continuation.

### Visible and forbidden result

Alice sees A enter integration before B even if task identifiers, report
timestamps, or input enumeration would sort B first. She sees no duplicate
integration start after restart.

Dalph must not:

- persist a second durable integration queue or queue ordinal;
- derive order from task identity, completion time, or in-memory insertion;
- count queued or started integration against task-work capacity;
- treat acquiring task-work capacity as acquiring serialized integration;
- expose pre-integration cancellation for A after integration starts; or
- treat an accepted result as tracker completion or Git promotion.

No repository verification or promotion occurs because #59 and #60 own those
boundaries. No two-parent candidate is created because #57 owns candidate
construction.

### Acceptance-test mapping

- `orders accepted results by committed responsibility position after restart`
  proves the journal-derived FIFO, absence of a durable queue ordinal, and
  selection of only the earliest result for one target.
- `starts integration once and consumes only its pre-integration cancellation
  capability` proves the cutoff, idempotent recovery, and resource
  separation.
- `recovers an accepted result in journal order and crosses its integration
  cutoff once` records the terminal accepted result, coordinator death,
  recovered selection, integration-start occurrence, and tracker blocker
  through the production-shaped controlled fake providers.
- Quint test `journalOrderSurvivesRestart` and invariants
  `queuePositionsAreUnique`, `atMostOneTargetHolder`, and
  `startedPrecedesRemainingQueue` check the corresponding state-machine
  ordering and serialization properties.

## A new tracker blocker waits the started responsibility without losing it

### Starting situation

Alice again only monitors Run R. Task A has one typed accepted result and one
recorded integration-start occurrence for the exact target. Dalph has
reacquired the target's serialized integration resource, but no Git promotion
intent or result exists. The exact accepted result and integration
responsibility remain in the journal. No two-parent candidate exists yet
because that later construction belongs to #57.

### Trigger and ordered boundary calls

Before the next integration action, Dalph asks the tracker for complete current
blocker facts for A. The tracker now reports unfinished blocker C. Dalph records
the complete tracker observation.

The shared selector derives an exact dependency wait for A naming C and the
tracker-observation wake condition. Dalph leaves the accepted result and
started integration responsibility unchanged and releases the process-local
serialized integration resource. It does not release A's task claim, dispose
its planned worktree, change task-work capacity, or invent completion.

When a later complete tracker observation reports C completed, Dalph may
reacquire the same target resource and continue the same started responsibility
past the cutoff. It must not recreate a pre-integration cancellation
capability.

A crash before or after the blocker observation changes no external request,
because tracker reads are non-mutating. Restart rereads current tracker facts
before another integration action. No ambiguous mutation or retry applies in
this scenario.

### Visible and forbidden result

Alice sees A waiting for C while unrelated task execution continues and another
integration target remains independently usable. She does not see A lose its
accepted result or start over.

Dalph must not:

- persist the dependency wait, resource ownership, or derived queue frontier;
- hold the serialized target resource while only waiting on tracker facts;
- move B ahead of A on the same target merely because A is waiting;
- expose pre-integration cancellation after the recorded cutoff; or
- create, delete, or rewrite a Git candidate while #57 is not in scope.

### Acceptance-test mapping

- `preserves same-target order while a blocker wait leaves another target
  usable` proves that later same-target work cannot leapfrog while another
  target remains independently selectable.
- The authored cassette test above proves the exact `IntegrationDependencyWait`
  names blocker C and the tracker-observation wake condition while the accepted
  result and recorded start remain present.
- Quint test `blockerReleasesTargetWithoutDiscardingResult` plus invariant
  `dependencyWaitPreservesQueueOrder` checks process-local target release
  without same-target reordering.
- Existing task-admission tests continue to prove integration transitions do
  not consume task-work positions.
