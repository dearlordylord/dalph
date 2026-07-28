# Keep one position for one admitted planned task attempt

Issues:
[Define planned-attempt executor work and position release](https://github.com/dearlordylord/dalph/issues/162)
and
[Derive the runnable frontier and bounded admission](https://github.com/dearlordylord/dalph/issues/131)

## The fake executor completes Task A's planned attempt

### Starting situation

Alice is monitoring run R, but she does not directly trigger this automatic
behavior. The running Dalph coordinator has two task-work positions. The fake
tracker reports Tasks A and B eligible.
Dalph has planned `(run R, attempt attempt-A-3)` for Task A and recorded that
it is starting executor work for that exact pair. Task A therefore occupies
one position. Task B may use the other position.

The fake-provider milestone does not model a coding agent, reviewer, handback,
retry, or restoration step inside the executor.

### Trigger and ordered actions

The controlled fake executor returns a terminal successful result for
`(run R, attempt attempt-A-3)`. Dalph records that result for the same pair and
makes Task A's task-work position available.

This result does not say that the fake tracker marks Task A completed. Dalph
must perform the later integration and tracker-completion workflow, then read
the fake tracker again and record its completed lifecycle before any task
blocked by A becomes eligible.

### Visible and forbidden result

Alice can see that executor work for Task A's attempt finished; independently
eligible work may now start. Alice cannot yet see Task A presented as
tracker-completed unless the later tracker read reports it.

Dalph must not allocate a second executor identity, expose an executor-internal
operation, keep the position merely because tracker completion is pending, or
release A's dependants from the executor result.

No crash or retry occurs in this scenario. If the shared Dalph/fake-executor
process dies before the terminal result is journaled, the shared-crash scenario
below applies; no external executor request survives to retry.

### Acceptance-test mapping

- `frees Task A's position when its planned-attempt executor work completes`
  proves A stops using task-work capacity.
- The diamond cassette in #167 proves that executor completion alone does not
  release tracker dependants.

## Alice pauses Task A and the executor safely suspends it

### Starting situation

Alice is the affected user. Task A's `(run R, attempt attempt-A-3)` is admitted
and occupies one task-work position. The controlled fake executor reports its
complete work for that pair as running.

### Trigger and ordered actions

Alice asks Dalph to pause Task A. Dalph applies and records the Pause direction.
Dalph asks the fake executor to bring its complete work for the planned attempt
to a safe resumable stop. Until the fake executor reports the attempt safely
suspended, Task A keeps its position.

The fake executor then reports that no executor-owned activity for
`(run R, attempt attempt-A-3)` remains running and that the same pair can
resume. Dalph records that suspension result and makes the position available.
A later Unpause does not itself consume a position; Task A must be admitted
again before Dalph asks the executor to resume the same pair.

### Visible and forbidden result

Alice sees Task A reach a safely suspended state. Dalph must not infer
suspension from a stopped inner process, create a replacement attempt, or free
the position before the complete-attempt suspension result.

If the shared process dies while suspension is in progress, both Dalph and the
fake executor stop. Restart reconstructs the applied Pause direction and the
same planned-attempt responsibility as occupying one position. Dalph asks the
recreated fake again to safely suspend that exact pair. Only after Dalph
records the new suspension result does it release the position. There is no
independent executor response to retry.

### Acceptance-test mapping

- `keeps Task A's position while suspension is still in progress` proves the
  position remains occupied before the suspension result.
- `frees Task A's position after safe suspension and resumes the same attempt`
  proves release and later reacquisition.

## Dalph and the fake executor crash together

### Starting situation

Alice is monitoring run R, but she does not cause the crash. Dalph has recorded
`(run R, attempt attempt-A-3)` and the intent to start its executor work. Its
process-local controller shows Task A using one position. The controlled fake
executor runs in the same process.

### Trigger and ordered actions

The process dies. Both Dalph and the fake executor stop; no fake executor work
survives. The process-local position disappears.

After restart, Dalph validates and folds the journal. It reconstructs the same
planned-attempt responsibility, recreates the fake executor, and derives Task
A as needing one position before continuing the same
`(run R, attempt attempt-A-3)`. It does not ask
for or reconcile a separately surviving executor invocation.

### Visible and forbidden result

Alice sees the same attempt continue after restart. Dalph must not create a
new attempt, a separate outer-invocation identity, or a story in which the fake
executor survived the coordinator.

Independently surviving production executor work is post-milestone design.

### Acceptance-test mapping

- `reconstructs the same planned attempt after Dalph and the fake executor
  crash together` proves shared-process restart.
- The test asserts that no separate executor lookup or outer identity exists.

## Duplicate unfinished executor responsibilities are invalid

### Starting situation and trigger

No person or outside provider creates this case. A malformed journal contains
two unfinished executor-work responsibilities for Task A, both claiming to be
the work for `(run R, attempt attempt-A-3)`, or it contains unfinished executor
work for `(run R, attempt attempt-A-3)` and
`(run R, attempt attempt-A-4)` where only one is legal.

### Result

Reconstruction returns a typed invalid-managed-history result naming Task A,
both unfinished responsibility records, and the pair or pairs they claim
before frontier derivation.
The executor, tracker, Git, and every other outside boundary must not be
called. The operator sees that exact recovery error. Dalph does not merge the
responsibilities, count them as one valid position, or present them as an
ordinary executor mismatch.

A repeated restart rereads the preserved malformed history and returns the
same typed failure before frontier derivation or any outside call. Recovery
does not rewrite, merge, or discard either responsibility.

### Acceptance-test mapping

- `rejects duplicate unfinished planned-attempt executor work before frontier
  derivation or an executor call` proves the production recovery seam in
  TypeScript and Quint.
