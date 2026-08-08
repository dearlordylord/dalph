# Authored-cassette abstraction levels

These scenarios refine the authored assertion vocabulary accepted in issues
#165 and #170. They do not change Dalph's production tracker, Git, executor,
journal, retry, cleanup, or recovery behavior.

## A maintainer describes the task work without protocol evidence

A Dalph maintainer runs the checked-in singleton cassette. Task A is open and
unclaimed, its planned worktree is absent, the same-process fake executor has
no prior report, and the in-memory journal is empty. No task B exists in the
tracker facts.

The maintainer asks Dalph to coordinate the cassette's tracker target. Dalph
reads the tracker graph, rereads A around the claim request, obtains A's work
specification, records one immutable planned attempt, prepares its worktree,
assumes responsibility for asking the executor to perform that planned work,
and receives Running followed by Terminal Completed for the same attempt.

The authored task-work results say, in order, that the planned work for A
completed. A separate assertion says that Dalph undertook no planned work for
B. Neither names the attempt. The assertion that no work was undertaken for B
is checked after the story finishes by looking for any journaled executor-work
responsibility for a planned attempt belonging to B.

The story may omit attempt planning, claim acquisition, worktree readiness,
executor-work responsibility, and Running from its assertion vocabulary. Dalph
still performs and journals those occurrences. Omission does not let the
cassette runner skip or search ahead through an explicitly authored tracker
response, executor response, or Dalph-selected operation: every authored
interaction must still match the current story item.

Claim and Git responses remain implicit controlled-boundary behavior. There is
no real GitHub, Git process, executor process, SQLite, network loss, crash, or
retry. Rerunning creates fresh controlled boundaries and an empty in-memory
journal.

The maintainer sees a readable task-work result without claim, worktree, or
attempt vocabulary. “Planned work for A completed” must not claim that the
tracker closed A or that Git integrated A's changes. Dalph must not satisfy
“no planned work undertaken for B” merely because B lacked a terminal report
after Dalph had already assumed responsibility for B's executor work.

Acceptance tests:

- `runs the maintained singleton through production activation and describes
  only its task-work result`
- `rejects no-work-undertaken when Dalph assumed executor-work responsibility
  for that task`
- `keeps explicit story interactions chronological when lower-level evidence
  is omitted`

## A maintainer asks for lower-level evidence

A Dalph maintainer runs the same singleton story but elects to assert its
lower-level evidence. The starting tracker, claim, worktree, executor, and
journal facts and all production boundary calls are the same as in the first
scenario.

The task-work assertions still say that A's planned work completed and that no
planned work was undertaken for B. The optional orchestration lens additionally
names, in exact order, that Dalph assumed executor-work responsibility for A's
planned attempt and received Running then Terminal Completed for that attempt.
The optional protocol lens names, in exact order, that A's claim was acquired,
the attempt was planned, and its worktree became ready.

Each present lens is the complete ordered projection of its own evidence. An
omitted lens consumes no authored assertion item and makes no claim about that
level. A present lens with missing, reordered, or additional evidence fails.
Attempt identity appears only in the orchestration and protocol lenses. If a
story declares more than one task-work result for the same task, it must include
the orchestration lens so the attempts remain distinguishable.

No additional outside request, crash, or retry occurs because selecting an
assertion lens changes only how the completed in-memory journal is checked.
The maintainer sees the task-work result followed by any elected supporting
evidence. Dalph must not manufacture omitted evidence, derive protocol evidence
from final fake state, or allow evidence from one lens to compensate for a
mismatch in another.

Acceptance tests:

- `matches optional orchestration and protocol evidence in exact order`
- `rejects missing, reordered, or additional evidence within either present
  authored assertion lens`
- `requires orchestration evidence when task-work results cannot distinguish
  attempts`

## Scenario-to-test mapping

| Scenario | Concrete outcome | Acceptance test |
| --- | --- | --- |
| A maintainer describes the task work without protocol evidence | The specialist assertion omits attempt identity and lower-level evidence while explicit interactions remain chronological | `runs the maintained singleton through production activation and describes only its task-work result`; `keeps explicit story interactions chronological when lower-level evidence is omitted` |
| A maintainer describes the task work without protocol evidence | Any executor-work responsibility for B contradicts the declared absence even without a B report | `rejects no-work-undertaken when Dalph assumed executor-work responsibility for that task` |
| A maintainer asks for lower-level evidence | Present orchestration and protocol lenses match their complete projections independently | `matches optional orchestration and protocol evidence in exact order` |
| A maintainer asks for lower-level evidence | Missing, reordered, or additional evidence in either present lens fails | `rejects missing, reordered, or additional evidence within either present authored assertion lens` |
| A maintainer asks for lower-level evidence | Repeated task-level results require exact-attempt orchestration evidence | `requires orchestration evidence when task-work results cannot distinguish attempts` |
