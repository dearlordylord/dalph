# Reconcile changed task instructions, lifecycle, and membership

Issue:
[Reconcile changed task instructions, lifecycle, and membership](https://github.com/dearlordylord/dalph/issues/136)

The public test seams accepted by the issue are the composed controlled-provider
cassette, the ordinary runnable-frontier and recovery activation, the exact
choice projection consumed later by issues #65 and #66, and the owning Quint
conformance adapter. P0–P6 remain test cut-point labels and are not runtime
phases.

## Alice changes A's instructions while its planned attempt is running

### Starting situation

Alice maintains tracker Task A. Dalph has recorded A's exact claim, authored
instruction fingerprint F1, planned attempt P1, worktree W1 at Base SHA B1, and
executor-work responsibility for P1. The controlled fake executor reports P1
running. W1 contains work in progress. A is still inside the Run's complete
target closure, its lifecycle is open, its exact Dalph claim is readable, and
its prerequisites are complete. No integration responsibility exists.

The task-work position for A is occupied. Independent Task C is open and needs
none of A's facts or resources.

### Trigger and ordered boundary calls

Alice edits A's title or body in the tracker. The tracker now derives authored
fingerprint F2, distinct from P1's F1.

Before Dalph next asks the executor to continue P1, it records and performs a
complete tracker-graph read and a focused authored-instructions read for A. The
read proves A is open, inside the target closure, exactly claimed by Dalph, and
has complete blocker facts; the focused read proves F2.

Dalph asks the executor to safely suspend P1. It retains A's task-work position
until the executor reports that P1 has preserved its resumable state and has no
executor-owned activity still running. Dalph then makes the position available,
preserves W1 and every recorded P1 fact, and exposes three explicit
subject-local choices:

1. `ContinueExistingAttempt`.
2. `RestartTaskImplementation`.
3. `StopTaskImplementation`.

Issue #136 owns this exact choice projection, including F1 and F2. Issue #65
owns applying continue or stop, and issue #66 owns applying restart. Those
later commands retain the effects and forbidden effects described below; #136
does not pre-implement their actor or disposition protocols.

Independent C remains selectable throughout whenever capacity is available.

### Crash, retry, visible result, and forbidden result

If Dalph dies before the safe-suspension report, restart reconstructs the
unfinished P1 responsibility and asks the executor for the same P1 outcome
before releasing its position. If Dalph dies after safe suspension but before a
choice is applied, restart shows the same three choices and performs no forward
work for A.

If the response to an applied choice is lost, retry first reconstructs the
choice from the journal. It must not append a second override, create another
P2, or ask twice to release the same claim. An ambiguous tracker claim removal
is checked by rereading A's claim before another removal request.

Alice sees A waiting for her choice, then sees exactly the selected continuation
of P1, replacement P2, or stopped implementation. Dalph must not silently adopt
F2 into P1, resume before safe suspension and current facts, discard W1,
release a foreign or replaced claim, block C, or infer tracker completion.

### Acceptance-test mapping

- `safely suspends changed A while independent B continues for membership,
  specification, lifecycle, and external success`
  proves the complete/focused reads, position release only after safe
  suspension, preserved WIP, and independent C progress.
- `explains each task-authority constraint without changing the planned
  attempt` proves the three choices carry F1 and F2 without claiming F2 was
  incorporated. Applying those choices remains mapped to issues #65 and #66.

## The tracker closes A without success and later reopens it

### Starting situation

Alice monitors A while Dalph owns its exact claim, planned attempt P1, worktree
W1, preserved WIP, and unfinished executor responsibility. A has no integration
or tracker-completion responsibility. Independent C remains eligible.

### Trigger and ordered boundary calls

The tracker reports A as terminal without success. This may result from Alice
closing the task, but Dalph does not attribute the edit to her because the
tracker observation carries no authenticated actor.

Dalph records the complete observation, asks the executor to safely suspend P1,
and preserves the claim, attempt, worktree, WIP, and executor evidence. After
safe suspension it releases A's task-work position and derives a reversible
lifecycle wait. It makes no tracker or Git mutation.

A later complete tracker observation reports A open again, still inside the
same target closure, still bearing Dalph's exact claim, with fingerprint F1 and
no unfinished blocker. Dalph clears only the lifecycle wait. It rereads every
other required continuation fact independently, reacquires capacity, and may
resume the same P1. C remains selectable before and after the reopen.

### Crash, retry, visible result, and forbidden result

A crash before safe suspension retains A's position and recovers the same P1
executor responsibility. A crash after the terminal lifecycle observation
reconstructs the lifecycle wait; restart does not poll or resume A from an old
durable duplicate wait because waits are derived, not persisted.

Alice sees A stop while closed and the same P1 become resumable after a fresh
open observation. Dalph must not abandon or supersede P1, release the claim,
delete W1, treat terminal-without-success as successful completion, clear a
specification, membership, claim, blocker, Git, or pause constraint, or stop C.

No ambiguous mutating retry applies because lifecycle observations are reads and
this scenario performs no tracker or Git mutation.

### Acceptance-test mapping

- `a task leaving complete membership safely suspends its executor work before
  the local constraint` proves the executor reaches safe suspension before the
  lifecycle constraint releases its position, and a fresh reopen requests a
  focused instruction read for the same P1 before continuation.
- `safely suspends changed A while independent B continues for membership,
  specification, lifecycle, and external success` proves the actor-visible
  lifecycle chronology and independent progress.
- Quint scenario `lifecycleCloseReopenPreservesAttempt` proves that closing and
  reopening clears only the lifecycle constraint and never changes P1.

## The tracker reports A already completed while Dalph retains WIP

### Starting situation

Alice monitors A and dependant B. Dalph owns A's exact claim K1, planned attempt
P1, worktree W1 with WIP, and unfinished executor responsibility. B lists A as
an unfinished prerequisite. A has not entered integration, no Git candidate or
promotion exists, and Dalph has not requested tracker completion. Independent C
is eligible.

### Trigger and ordered boundary calls

Another tracker client marks A completed successfully. Dalph does not know who
made that change. Its next complete target-closure read records that A is
successful and obtains fresh graph facts in which B's prerequisite is
satisfied. Dalph also reads A's exact claim and proves K1 still belongs to
Dalph.

Dalph asks the executor to safely suspend P1 and preserves W1, WIP, the planned
attempt, and executor evidence. It records no accepted integration result,
creates no candidate, changes no Git ref, and never asks the tracker to complete
A again.

After recording intent to remove K1, Dalph asks the tracker to remove only that
exact claim. It rereads the claim to establish the outcome. Fresh graph facts,
not the claim removal, make B eligible. B and independent C may proceed through
ordinary bounded admission.

### Crash, retry, visible result, and forbidden result

If Dalph dies after observing tracker success but before safe suspension,
restart recovers P1 and obtains its same exact executor outcome before releasing
the position. If it dies after claim-removal intent and the tracker applied the
removal but before Dalph recorded the result, restart rereads A's claim. Absence
of K1 establishes the intended removal; a foreign or replacement claim is
preserved and reported as a typed conflict. Unreadable claim facts do not
authorize another removal.

Alice sees A remain completed, B become eligible from the fresh successful
lifecycle, and A's WIP remain available for inspection. Dalph must not integrate
or complete A again, delete or reset W1, remove a foreign claim, infer that
claim removal completed A, duplicate the removal after a lost response, or
block B or C behind A's preserved local evidence.

### Acceptance-test mapping

- `safely suspends changed A while independent B continues for membership,
  specification, lifecycle, and external success` proves no duplicate
  integration/completion, exact claim removal, fresh dependency release, and
  independent progress.
- `accepts authoritative absence after an ambiguous release response`
  proves the authoritative reread and exact absence after an ambiguous result.
- `preserves a foreign replacement without sending a release` and `stops
  without a release when the current claim is unreadable` prove exact-claim
  isolation and fail-closed reads.
- `records exact claim-release intent and outcome once before replay returns`
  proves intent-before-effect and journal replay without a second provider
  call.
- Quint scenario `externalSuccessIsFinalWithoutDuplicateDelivery` proves A
  cannot re-enter integration or tracker completion and that B is released only
  by fresh successful lifecycle facts.

## A complete read proves A left the target closure

### Starting situation

Dalph retains A's exact claim, planned attempt P1, worktree W1, WIP, and
executor responsibility. A was a member of the Run's last complete target
closure. Independent C remains in the closure and eligible.

### Trigger and ordered boundary calls

A complete target-closure read no longer contains A. Dalph records the complete
observation, asks the executor to safely suspend P1, preserves every A resource,
and derives a target-membership constraint. It performs no automatic claim,
tracker, Git, or worktree mutation. C continues.

An incomplete or unreadable read cannot prove that A left. Dalph records the
typed read failure, retains the last known membership only as historical
knowledge, authorizes no removal action, and retries according to the tracker
read policy. If a later complete read contains A again, only the membership
constraint clears; every other continuation fact must independently authorize
resumption.

### Crash, retry, visible result, and forbidden result

After a crash, the latest complete observation reconstructs the membership
constraint. The derived constraint itself is never persisted. Retrying an
incomplete read does not create a removal fact or release A's claim.

Alice sees A constrained with its WIP preserved while C continues. Dalph must
not infer removal from pagination, timeout, partial coverage, or absence in an
incomplete response; automatically repair, abandon, or clean A; or turn A's
local membership constraint into a Run-wide stop.

### Acceptance-test mapping

- `safely suspends changed A while independent B continues for membership,
  specification, lifecycle, and external success` proves
  complete-coverage authority, preservation, and subject-local progress.
- `an incomplete quiescent refresh authorizes no new work` and Quint scenario
  `incompleteReadCannotProveMembershipLoss` prove incomplete reads cannot
  authorize removal or continuation.
