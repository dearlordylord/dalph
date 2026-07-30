# Issue 53: refresh and traverse complete task pipelines

## A later recorded tracker observation releases Task B

No person directly triggers the coordinator's repeated reads. A maintainer is
watching one Dalph run. The controlled task tracker initially reports open Task
A and open Task B, with B depending on A. Neither task has a claim, planned
attempt, worktree, executor report, or workflow responsibility. Dalph's journal
contains only the run beginning when it starts the first logical graph read.

Dalph records the read intent, asks the tracker for the complete target graph,
records the normalized observation, reconstructs it from the journal, and
selects A. The controlled fake executor eventually reports A's planned attempt
Terminal Completed. That report makes A's task-work position available but does
not claim tracker completion and does not release B.

When no current transition remains, Dalph records another complete graph-read
intent and asks the tracker again. The controlled tracker returns a changed
graph that reports A completed and B still open. This controlled return is the
evidence that a later completion protocol such as issue #61 must obtain; issue
#53 does not invent or persist a tracker-completion acknowledgement. Dalph
records the changed observation, reconstructs the graph, and only then selects
B in the same Run. B completes through the ordinary claim, focused
specification, planned-attempt, worktree, and coarse-executor workflow.

If Dalph crashes after the tracker returns the changed graph but before the
observation append, restart cannot select B and repeats the unresolved read. If
it crashes after the append, restart reconstructs A completed and B eligible
from the journal. No raw provider return or executor result authorizes B.

The maintainer sees planned work complete for A and then B in one Run. Dalph
must not create workflow responsibility from graph membership, select B before
the changed observation is durable, allocate another Run, persist a frontier,
or treat A's executor result as tracker completion.

Acceptance tests:

- `continues the same run with B only after a recorded refresh reports A completed`
  runs the authored cassette through the production activation loop.
- `a crash before append authorizes no work; restart after append reconstructs
  facts and only a later observed completion releases B` retains the #164
  journal/recovery proof used by this traversal.

## An unchanged quiescent refresh ends without inventing work

The controlled tracker reports open A and open B with B depending on A. A's
planned executor work reaches Terminal Completed, but the next complete tracker
read returns the same graph: A remains open and B remains blocked. Dalph records
the later read as an unchanged reconfirmation of the earlier complete payload.
After reconstructing the same eligible set and finding no unscheduled task or
unfinished responsibility, the Run terminates.

There is no provider retry or crash in this scenario. If the read fails, the
typed read failure remains visible and the Run does not terminate normally. Git
does not change after A's worktree is prepared, and no person acts.

The maintainer sees A's planned work complete and no planned work for B. Dalph
must not busy-loop on unchanged facts, ask the executor to repeat A's terminal
attempt, infer A completed, or create B's claim.

Acceptance test:

- `stops after one unchanged quiescent refresh and records a compact
  reconfirmation` proves bounded convergence and the recorded projection.

## Changed membership is local and invalid reads authorize nothing

The controlled tracker initially reports two independent open tasks A and C.
Capacity one admits A first. Before unstarted C can acquire a claim, its
ordinary current-graph read reports that C left the target, so its process-local
stage ends without creating responsibility. When no transition remains, the
quiescent complete read reports A completed and adds open task D. Dalph records
and reconstructs that observation, then may select D. The graph observations
themselves create no claim, attempt, worktree, executor responsibility,
capacity position, or persisted frontier.

If a task with an existing exact workflow responsibility leaves the complete
target membership, Dalph keeps that responsibility and exposes a constraint for
that task. It does not turn the graph edit into successful cleanup, release, or
whole-run failure. Issues #136 and #65–#67 own the later continue, restart, stop,
and disposition choices.

If the tracker instead returns an incomplete or contradictory logical graph,
the task-tracker adapter returns a typed failure before a usable normalized
observation exists. A crash or retry cannot select D from that rejected return.
Other external boundaries are not called because the new task never becomes
eligible.

The maintainer can see the exact constrained task or typed graph-read failure.
Dalph must not keep an unstarted removed task runnable, isolate unrelated
responsibilities, or consume a raw provider result.

Acceptance tests:

- `later complete reads add newly selected D and keep removed unstarted C from
  responsibility`;
- `a responsible task leaving complete membership becomes a task-local
  constraint`;
- `an executor responsibility leaving complete membership becomes an
  executor-local constraint`;
- `an invalid quiescent refresh authorizes no new work`;
- `serializes selection while capacity-N runners overlap` retains the existing
  capacity-two proof while the cassette proves refreshed facts precede new
  selection.
