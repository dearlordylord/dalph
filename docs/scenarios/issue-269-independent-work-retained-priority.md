# Admit independent work while preserving an exact retained attempt

Owning issue: [#269](https://github.com/dearlordylord/dalph/issues/269)

Status: implementation candidate on the issue task branch. This scenario
refines admission after restart; it does not add a durable queue, another
capacity counter, or task-ID authority over an exact planned attempt.

## Governing behavior

[Issue #265's restart attachment](issue-265-passive-executor-observation-through-restart.md#a-later-dalph-process-reattaches-to-the-exact-codex-attempt)
keeps unfinished exact attempts observable without sending another work
command. [Issue #266's active-work refresh](issue-266-active-work-authority-refresh.md#alice-changes-b-while-a1-b1-and-c1-execute-autonomously)
keeps tracker and Git reads separate from executor positions. Issue #269
composes those facts with [D12 Position discipline](../DELIVERY-INVARIANTS.md#admission-and-capacity):
read-only restart obligations consume no task-work position, while an exact
attempt selected for `Continue` retains priority over fresh work at the next
available position.

The tracker continues to own task identity and current instructions. The
Journal and reconstructed planned-attempt protocol identify the exact
`(RunId, AttemptId)` selected for `Continue`. A task ID alone cannot transfer
that retained position to replacement work.

## Read-only restart obligations do not block independent D

### Starting situation and trigger

No person triggers an individual boundary call. A previous Dalph process ended
while exact attempts A1 and C1 remained unfinished. The Journal reconstructs
their exact planned-attempt responsibilities and requires current executor
projection reads. Neither obligation requests `Begin`, `Resume`, or
`Suspend`, so neither requires a task-work position. The executor owns A1's and
C1's current projections. Git and the tracker have no mutation to perform for
these reads.

Independent task D is open, unclaimed, free of unfinished prerequisites, and
has no planned attempt. The latest accepted tracker graph and the ordinary
fresh-work protocol make D's exact current-graph/claim step eligible. One
task-work position is free.

### Ordered boundary calls and result

1. Dalph starts A1's and C1's exact passive executor projection reads. Both may
   remain in flight.
2. While those reads remain in flight, Dalph reserves the free task-work
   position for D's ordinary fresh pipeline and starts D's tracker boundary
   call.
3. Each returned executor projection is published only through the existing
   exact planned-attempt protocol. D continues only through its own recorded
   tracker and Git evidence.

The operator can observe D start while A1 and C1 are still being read. Dalph
must not count either read-only obligation as executing work, wait for those
reads before admitting D, send another executor work command, or use A1's or
C1's evidence for D.

If Dalph dies while a read is unresolved, its process-local owner disappears
and ordinary journal-first recovery reconstructs that exact obligation. If it
dies while D's boundary effect is ambiguous, ordinary intent/reconciliation
rules apply. Neither crash creates or persists an admission queue.

### Acceptance-test mapping

- `admits independent D while recovered A and C perform read-only restart
  obligations` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`
  holds both exact executor reads open and proves D's boundary action starts
  with capacity one.

## Exact B1 selected for Continue precedes D and replacement B2

### Starting situation and trigger

Alice has selected `Continue` for safely suspended exact attempt B1. Current
tracker, claim, planned-worktree, control, and Git evidence authorizes Resume
for B1, but all task-work positions are initially occupied. The Journal keeps
B1's exact `RunId` and `AttemptId`; no task-ID-only reservation exists.

Independent task D is eligible for fresh work. A same-task replacement B2 is
not authorized to inherit B1's position merely because both refer to tracker
task B. The runtime admission boundary nevertheless treats such a malformed
fresh B proposal fail-closed if one reaches it.

An existing attempt has just released one position; another independent
attempt A still occupies the other position in the admission snapshot. No
person performs another boundary call. Publication of that released-capacity
snapshot is the trigger that lets admission proceed.

### Ordered boundary calls and result

1. The responsibility-derived Resume proposal for exact B1 is considered
   before fresh D or any fresh B proposal.
2. Dalph binds the released position to B1's exact attempt correlation and
   sends B1's Resume command through the existing executor protocol.
3. D waits because capacity is full. Replacement B2 also waits: an
   uncorrelated fresh step may reuse only the temporary position created by
   its own fresh pipeline, never B1's exact accepted or runtime-bound position.
4. A later release may admit D through its own evidence. It cannot transfer
   B1's authority to B2.

Alice can observe B1 resume before fresh D. Dalph must not let D pass an
already-selected B1, let B2 use B1's position, collapse B1 and B2 to tracker
task B, or send two executor commands for B1.

If Dalph dies before Resume settles, ordinary exact-command reconciliation
uses B1's `RunId` and `AttemptId`. If it dies after B1's position is bound, the
reconstructed exact attempt retains that position. Restart does not persist or
restore a separate ordering queue; the responsibility-first frontier and exact
position correlation derive the same decision again.

### Acceptance-test mapping

- `gives retained B1 the released position before D and rejects uncorrelated B
  replacement work` in
  `packages/orchestrator/src/coordination/delivery/run-delivery-runtime.test.ts`
  composes real Resume, fresh-D, and malformed fresh-B proposals under one
  released position and proves only B1 starts.
- `does not let uncorrelated replacement work reuse the exact retained attempt
  position` in
  `packages/orchestrator/src/coordination/delivery/delivery-runtime-admission.test.ts`
  proves the admission boundary rejects task-ID-only reuse while preserving
  B1's exact correlation.
- `reconciles existing, pending, and integration-backed admission positions`
  in the same file proves an uncorrelated fresh step may still reuse its own
  temporary pending pipeline position, while exact-bound reuse requires the
  matching correlation.
