# Restart after Git promotes the target without returning

Issue: [Prove crash-after-effect recovery](https://github.com/dearlordylord/dalph/issues/88)

Status: accepted by the owner on 2026-08-24 for the reliable-code and
working-MVP frontier.

This scenario selects one exact ambiguity cut from the hermetic journey: Git
has applied the target-ref compare-and-set, but Dalph has not received the
result or recorded `TargetPromotionObservedSuccess`. It qualifies the existing
promotion-reconciliation behavior without adding another retry policy or
changing a Quint model.

## A maintainer restarts after the first promotion response is lost

### Starting situation

The harness owns one temporary source repository, bare target repository,
SQLite journal, filesystem evidence store, coordinator lock location, and the
task worktrees used by the #87 hermetic journey. The bare target `master` and
the source repository begin at H0. Task A is open and unclaimed. No executor
process, Integrator session, candidate, promotion attempt, completion claim, or
successful completion exists.

The maintainer starts the public `runWorkflow` boundary. Dalph reads the
tracker, claims A, plans its exact attempt against H0, creates its exact
worktree, runs the child process, stores the accepted-result evidence, and
records the accepted executor report and integration responsibility in SQLite.

### Trigger, crash, and chronological recovery

1. Dalph invokes one opaque outer Integrator session for A. The Integrator
   returns candidate M-A with direct parents `[H0, A-accepted]`. Dalph asks real
   Git to prove those parents and records the promotion intent and attempt.
2. The real Git adapter applies exactly one compare-and-set from H0 to M-A in
   the bare repository. The test boundary deliberately withholds the successful
   return. At this point Git owns the fact that `master` is M-A, while SQLite
   has no `TargetPromotionObservedSuccess` for A.
3. The harness kills the complete first coordinator/application scope. This is
   the crash. It does not let that scope append an outcome, complete A in the
   tracker, release A's exact claim, or start another Integrator or promotion
   attempt.
4. The maintainer starts a fresh production layer against the same SQLite
   journal, repositories, evidence store, Run id, planned attempt, worktree,
   Integrator session, candidate resource, and tracker claim. Dalph reconstructs
   the unmatched promotion attempt and reads Git before authorizing another
   compare-and-set.
5. Git reports that `master` already equals M-A. Dalph records
   `TargetPromotionObservedSuccess` with basis `AfterAttempt(1)`. It does not
   call the Integrator again, create another candidate, or issue a second Git
   compare-and-set. The original attempt and semantic budgets therefore remain
   consumed exactly once.
6. Dalph replaces the exact active claim with the completion claim, completes
   A only after the promotion observation is durable, rereads focused and
   complete tracker facts, deletes only the exact completion claim, and
   terminates the Run. The accepted evidence remains readable and the original
   successful worktree and branch remain because #89 owns terminal disposition
   cleanup.
7. The harness closes the restarted scope, proves the coordinator lock and
   child process are gone, and removes only its owned temporary root.

No GitHub provider is contacted: the tracker is a deterministic boundary, so
the crash qualification does not spend live-provider calls. No person acts
between the crash and restart beyond starting the same command again.

### Visible result and forbidden result

The maintainer sees one completed task and one completed Run whose final target
is M-A. SQLite shows one Integrator session/candidate, one promotion intent,
one promotion attempt, and one promotion success observed after that attempt.
The promotion boundary observation count proves that Git moved the target only
once.

Dalph must not assume the missing response means Git did nothing, issue a
second compare-and-set, rerun the Integrator, allocate a new attempt, worktree,
session, candidate resource, evidence object, or claim identity, complete the
tracker before observing promotion success, double-consume a retry or semantic
budget, delete immutable evidence, or remove resources without an accepted
disposition.

### Acceptance-test mapping

- `restarts after Git promotes A without returning and does not repeat A
  integration or promotion` uses real local Git, SQLite, filesystem evidence,
  OS coordinator locking, and a child process through public `runWorkflow`. It
  holds the first compare-and-set response, kills the first application scope,
  reopens every durable authority through a fresh production layer, and proves
  the exact one-call lineage and `AfterAttempt(1)` recovery chronology.
- Existing target-promotion conformance and `acceptedResultIntegration` model
  tests remain the protocol-level evidence for reconcile-before-retry and
  budget accounting. This scenario proves their production-shaped composition;
  it does not change their laws.
