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

This ordinary path applies when no exact pre-integration Restart choice is
already carried by the terminal attempt. The late-`Accepted` exception after
an applied Restart is the separate chronology below: it preserves the result
without creating an integration responsibility.

### Trigger and ordered boundary calls

Dalph receives A's typed terminal accepted result first. It records the
executor report, then records exact integration responsibility for A. The
journal envelope position of that responsibility is A's integration order;
Dalph writes no queue row, queue ordinal, timestamp, or completed-ID set.

If the coordinator dies after the accepted terminal report commits but before
the responsibility append, restart folds that exact executor responsibility
and terminal result. The coordinator-selected target policy supplies the
integration target again, and the shared selector appends the missing
responsibility exactly once before any integration start. If the original
append actually committed before an ambiguous failure, the stable attempt key
rediscovers the same responsibility instead of creating another.

Dalph receives B's typed terminal accepted result second and records B's exact
integration responsibility at the next committed journal position. Releasing
each task-work position does not acquire or release the serialized integration
resource.

The coordinator process and same-process fake executor die before either
integration begins. The tracker, Git repository, claims, and journal survive.
On restart, Dalph folds the journal and derives A then B from the two committed
positions. The prior process's tracker observation can reconstruct history but
cannot authorize a new integration action. Dalph reads the tracker again and
records a new complete observation after recovery began. Those current facts
report both tasks open, claimed by Dalph, inside the target, and without
unfinished blockers. Until that observation commits, the selector exposes a
typed tracker-facts wait and neither starts queued work nor reacquires a target.

The production composition receives the exact repository locator and ref as a
typed integration target at its configuration boundary. It does not infer a
branch name from the Git common directory.

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
- `reconciles durable accepted terminals in order and idempotently after
  restart` runs authoritative recovery, retries an already committed
  reconciliation, proves only the next missing responsibility is exposed, and
  proves that a focused task-work-specification read cannot substitute for the
  post-restart complete graph observation required before a start is selectable.
- `starts integration once and consumes only its pre-integration cancellation
  capability` proves the cutoff, idempotent recovery, and resource
  separation.
- `serializes one exact target while allowing another target and releases only
  its owner` proves the process-local controller is distinct from task-work
  capacity and journal state.
- `continues an accepted result after process death and crosses its integration
  cutoff once` records the terminal accepted result, coordinator death,
  recovered selection, integration-start occurrence, and tracker blocker
  through the production-shaped controlled fake providers.
- Quint tests `journalOrderSurvivesRestart` and
  `restartRequiresFreshTrackerFactsBeforeStart`, plus invariants
  `queuePositionsAreUnique`, `atMostOneTargetHolder`, and
  `startedPrecedesRemainingQueue` check the corresponding state-machine
  ordering and serialization properties.

## A late accepted result after Restart remains evidence without integration

### Starting situation

Alice is the Operator for Run R. Task A has immutable planned attempt P1,
current task revision F2, exact claim K1, and preserved worktree W1. Issue #136
proved that A changed while P1 was unfinished, and Alice's exact Restart
choice correlated with request D1 is already durably applied. P1 was initially safely suspended,
but a later start-or-continue command made that earlier proof no longer
unbroken. No `PlannedAttemptReplaced` event, P2, integration responsibility,
or integration start exists. The tracker, Git, executor, and Journal are the
authorities for their respective facts.

### Trigger and ordered boundary calls

The executor reports an exact terminal `Accepted` result for R/P1, naming
commit C1, after the Restart choice was recorded and before replacement.
Dalph records that report and preserves C1 and its evidence. The report ends
P1's planned-attempt executor-work responsibility and proves that no P1 writer
remains. It may therefore replace the earlier safe-suspension report as the
current executor quiescence fact. It does not complete A in the tracker,
create an integration responsibility, cross the integration cutoff, or by
itself authorize P2.

Dalph performs fresh complete task facts and exact Git reads. If they still
prove A at F2 with exact K1, W1 is the exact ready worktree with its required
lineage, and the configured target head is H2, the choice correlated with D1 remains
valid. Dalph appends one atomic `PlannedAttemptReplaced` event that makes P1
superseded and records P2. P2 then enters ordinary bounded task-work admission;
Alice sends no second Restart command. The accepted C1 remains preserved P1
evidence and is not paired with the integration target.

If any fresh read is missing, unreadable, contradictory, or reports changed
task facts, Dalph records the exact wait or contradiction and appends no P2.
It still creates no integration responsibility for C1. A later activation uses
the same Run-establishment entry and ordinary bounded activation; it does not
ask Alice to reapply D1 merely because the terminal result arrived late.

### Crash, retry, visible result, and forbidden result

If Dalph dies after the terminal report is durable, restart reconstructs C1,
the ended P1 writer responsibility, and D1 before another outside request. It
performs the fresh task and Git reads again. If the replacement append was
ambiguous, absence leaves P1 unsettled with no P2 and presence reconstructs
the one P1/P2 event; neither branch creates another integration responsibility
or allocates P3. If the report itself was not durable, existing executor
reconciliation decides whether an exact R/P1 terminal result can be recorded;
process loss alone proves neither acceptance nor quiescence.

Alice sees C1 and its evidence preserved, no P1 integration responsibility,
and either P2 admitted through ordinary capacity or the exact fresh-facts wait.
Dalph must not queue or integrate C1, discard W1 or K1, infer tracker
completion, require a second Restart command, or treat a terminal `Accepted`
report as permission to replace P1 without D1 and the fresh task/Git facts.

### Acceptance-test and model mapping

- `preserves a late Accepted result as P1 evidence without creating issue 56's
  integration responsibility` proves the terminal report, exact commit, and
  absent integration obligation remain distinct.
- `uses late Accepted as current quiescence after fresh checks and honors the
  applied Restart without a second command` proves the quiescence replacement,
  fresh task/Git reads, atomic P1/P2 replacement, and ordinary P2 admission.
- `reconciles late Accepted replacement across process loss without P3 or
  duplicate integration responsibility` proves both replacement-append crash
  prefixes and same-entry restart.
- The `acceptedResultIntegration` model and its production adapter retain the
  ordinary terminal-to-responsibility path for A/B above while rejecting the
  late-Restart exception; issue #66's `taskFactReconciliation` seam owns D1,
  the replacement event, and the fresh-facts guard.

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
  target remains independently selectable. The process-local controller test
  named above proves release then reacquisition is exact to the owning
  responsibility.
- The authored cassette test above proves the exact
  `IntegrationDependencyWait` names blocker C and the tracker-observation wake
  condition while the accepted result and recorded start remain present, and
  derives the selector's exact `ReleaseStartedIntegrationTarget` transition
  from that chronology.
- Quint test `blockerReleasesTargetWithoutDiscardingResult` plus invariant
  `dependencyWaitPreservesQueueOrder` checks process-local target release
  without same-target reordering.
- Existing task-admission tests continue to prove integration transitions do
  not consume task-work positions.
