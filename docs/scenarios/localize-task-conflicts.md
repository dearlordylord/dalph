# Localize one task's conflict while an independent task continues

Issue:
[Localize task and dependant conflicts](https://github.com/dearlordylord/dalph/issues/55)

## A leaves the target while independent B continues

### Starting situation

Alice is monitoring Run R but does not trigger this automatic behavior. The
controlled task tracker initially reports A open and B open with A as B's
prerequisite. Dalph has recorded one planned attempt for A, has recorded that
the complete executor-work responsibility for A began, and the controlled fake
executor has reported A running. Run R has task-work capacity two, so A uses
one position and one position remains available.

The journal contains no terminal executor report for A. Git still reports A's
exact planned worktree at its planned Base SHA. The tracker still contains
Dalph's exact claim for A. No integration resource is held. B has no Dalph
responsibility yet.

### Trigger and ordered boundary calls

The coordinator process and its same-process fake executor die. The task
tracker, Git repository, tracker claim, and Dalph journal survive. On restart,
Dalph folds the journal and reconstructs A's unfinished planned-attempt
responsibility and its occupied task-work position.

Dalph asks the controlled tracker for a complete current target graph. The
tracker now reports that A is absent from the target and B is open with no
unfinished prerequisites. Dalph records that complete tracker observation.
The selector explains A with an exact planned-attempt target-membership
constraint. It does not ask the recreated fake executor to continue A.

B needs none of A's removed membership fact, claim, worktree, or executor
state, and the second task-work position is available. The same activation
loop acquires B's claim, reads B's current work specification, plans and proves
B's exact worktree, and gives B's planned attempt to the recreated controlled
fake executor. The fake reports B running and then terminal completion. Dalph
records those reports.

No uncertain external request is retried in this scenario. A second crash does
not occur, so reconcile-before-retry and exact-operation retry behavior do not
apply to this #55 conformance slice; later boundary-specific tickets own those
chronologies.

### Visible and forbidden result

Alice sees B complete while A remains unfinished and constrained by current
target membership. Dalph keeps Run R active because A's responsibility is not
settled.

Dalph must not:

- ask the recreated fake executor to continue A;
- turn A's missing membership into executor completion, claim release,
  worktree disposal, or whole-run failure;
- withhold B merely because A is constrained;
- persist the derived membership constraint, runnable frontier, admission
  choice, task-work position map, queue, or wakeup as authority; or
- claim that the tracker edit was made by Alice.

### Acceptance-test mapping

- `continues independent B while recovered A has a target-membership
  constraint` drives the shared-process restart through the composed
  production loop and proves B completes without another A executor report.
- `a responsible task leaving complete membership becomes a task-local
  constraint` proves the exact workflow-operation explanation.
- `an executor responsibility leaving complete membership becomes an
  executor-local constraint` proves the exact planned-attempt explanation.
- `continues independent work for each local constraint at capacities one and
  two` proves pause, dependency, foreign-claim, and unreadable-boundary
  explanations do not remove independent C from admission.
- `keeps grouping independent while traversing and deriving diamond
  eligibility` proves grouping edges, prerequisite edges, and lifecycle facts
  retain separate tracker meanings.

The historical M2 model named by #55 is no longer present in the accepted
fake-executor milestone model portfolio. This slice changes no modeled
transition: it adds production-composition evidence for the existing frontier
rule, so `pnpm check:quint` continues to govern the current planned-attempt
executor model without inventing a replacement M2 action.

## Boundary ownership retained for later reconciliation tickets

This issue localizes constraints and proves independent progress. It does not
invent the later boundary-specific resolution protocols:

- #136 owns changed instructions, lifecycle, and target-membership choices;
- #137 owns bounded claim rereads, foreign-claim protection, and reacquisition;
- #138 owns blockers before and after Git promotion;
- #139 owns Git lineage, worktree loss, and promotion races; and
- #141 owns integration, tracker completion, settlement, and finality.

Grouping and prerequisites remain separate tracker fact families; task claims
remain tracker authority; lifecycle and target membership remain distinct
tracker facts; Git lineage remains Git authority; and executor availability
remains executor authority. Clearing or constraining one does not synthesize a
fact for another.
