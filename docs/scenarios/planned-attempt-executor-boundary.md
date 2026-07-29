# Planned-attempt executor boundary scenarios

Status: accepted for the production-shaped fake-executor milestone.

These scenarios define only what generic Dalph needs in order to consume a task
graph with a controlled fake executor. They do not specify coding-agent,
reviewer, evidence, handback, retry, restoration, or convergence behavior
inside a later production executor.

## Dalph starts and completes executor work for one planned attempt

### Starting situation

Alice is monitoring run R, but she does not directly trigger this automatic
start. The fake tracker reports Task A eligible and claimed by Dalph. Dalph has
planned `(run R, attempt attempt-A-3)`. Fake Git reports its exact planned
worktree at the recorded Base SHA. No executor work has started.

### Trigger and ordered actions

Dalph admits Task A within the configured capacity and records that it is
starting executor work for run R, attempt `attempt-A-3`. It passes that exact
planned attempt to the controlled fake executor.

The fake executor first reports the attempt running. Dalph records that report
for the same pair. The fake later returns one terminal result for its complete
work on the attempt, and Dalph records that result before selecting later
integration work. Generic Dalph never sees an executor-internal operation or
another executor identity.

### Visible and forbidden result

Alice sees Task A's executor work start and finish. The result may authorize
the later integration workflow, but it does not prove tracker completion.

Dalph must not allocate a separate outer invocation identity, expose a reviewer or
coding-agent step, or treat executor success as a completed tracker task.

No crash occurs on this path. If the shared process dies before the terminal
result is journaled, the shared-restart scenario below applies; no external
executor response survives to retry.

### Acceptance-test mapping

- `drives one planned attempt through the generic executor boundary` proves
  start, running, and terminal projections using `RunId` plus `AttemptId`.
- `replays the planned-attempt model through the executor boundary` proves
  generated Quint actions and states conform to the TypeScript executor
  service.
- A source and emitted-type check proves generic code contains no separate
  outer identity or experimental review-loop stage.

## Dalph asks the fake executor to suspend one planned attempt

### Starting situation

Alice has asked Dalph to pause Task A. Dalph has applied that direction. Task
A's `(run R, attempt attempt-A-3)` is running and occupies one task-work
position.

### Trigger and ordered actions

Dalph asks the controlled fake executor to stop all work for
`(run R, attempt attempt-A-3)` while preserving the ability to resume it. The
position remains
occupied while the fake executor reports suspension still in progress.

When the fake executor reports that exact pair safely suspended, Dalph records
the result and makes the position available. After Alice unpauses A, Dalph
later reacquires a position and resumes the same pair.

### Visible and forbidden result

Alice sees the attempt safely suspended and later resumed. Dalph must not infer
suspension from an internal process event, create another attempt, or release
the position before the complete-attempt result.

If the shared process dies during suspension, both Dalph and the fake executor
stop. Restart reconstructs the applied Pause and the same pair as occupying one
position. Dalph asks the recreated fake again to safely suspend that pair. Only
after Dalph records the new suspension result does it release the position. No
independent executor response survives to retry.

### Acceptance-test mapping

- `releases capacity only after the planned attempt is safely suspended`
  proves the stop-for-resume boundary.
- `resumes the same planned attempt after unpause` proves identity reuse.

## Dalph and the controlled fake executor restart together

### Starting situation

Alice is monitoring run R, but she does not cause the crash. Dalph has durable
history for `(run R, attempt attempt-A-3)`. The fake executor and Dalph run in
the same process. The fake tracker still reports Task A eligible and claimed by
Dalph. Fake Git still reports the planned worktree at its recorded Base SHA.

### Trigger and ordered actions

The process dies, so the fake executor dies with Dalph. On restart, Dalph folds
the journal, reconstructs the same planned-attempt responsibility, creates a
new controlled fake-executor instance, and continues the same
`(run R, attempt attempt-A-3)` when capacity permits.

### Visible and forbidden result

Alice sees the existing attempt continue. Dalph does not search for a
surviving fake executor, invent a separate invocation identity, or pretend that
the journal proves external executor activity remained alive.

Independent coordinator and production-executor lifetimes are post-milestone
work, so provider observation, lost executor responses, and cross-process retry
do not apply here.

### Acceptance-test mapping

- `recreates the fake executor and continues the same attempt after shared
  process death` proves the milestone restart rule.

## A stage-name-free fake drives generic orchestration

### Starting situation and trigger

This is controlled test evidence, so no person, tracker edit, Git change,
outside process, crash, or retry applies. The fake executor knows only the
exact `(RunId, AttemptId)` plus running, suspended, and terminal values. It has
no review-loop vocabulary or outside process.

Dalph runs the real reconstruction, frontier, admission, and activation path
against it.

### Visible and forbidden result

The same generic path drives the milestone cassettes. Source, emitted types,
traces, and cassette entries contain no coding-agent, reviewer, handback,
evidence, restoration, or retry stage.

### Acceptance-test mapping

- `generic activation continues reconstructed work through the controlled
  fake` proves the real reconstruction, frontier, admission, and activation
  path drives the boundary.
- `generic orchestration uses a stage-name-free planned-attempt executor`
  proves generic source contains no displaced executor-internal stages.

## Startup discovers unfinished work owned by another run

### Starting situation and trigger

Dalph is asked to activate run R. The journal also contains valid unfinished
responsibility for run S. The milestone application exposes one run activation,
so it cannot truthfully resume both.

### Visible and forbidden result

Startup fails with both run identities and preserves every record. It must not
activate R while silently ignoring S, and it must not mutate tracker, Git, or
executor state for either run.

### Acceptance-test mapping

- `blocks startup instead of ignoring another run's unfinished responsibility`
  proves the fail-closed single-run milestone boundary.

## Startup discovers only completed work from another run

### Starting situation and trigger

Dalph is asked to activate run R. The journal contains responsibility for run
S, followed by the matching outcome that completed that responsibility. Run S
has no unfinished responsibility.

### Visible and forbidden result

Startup activates run R. Historical responsibility entries for run S remain
preserved, but their presence alone must not block R or cause Dalph to repeat
completed work.

No person, tracker edit, Git change, executor call, crash, or retry applies to
the completed run because startup only reconstructs its journaled disposition.

### Acceptance-test mapping

- `does not block startup for another run's completed responsibility` proves
  startup distinguishes retained history from unfinished work.
