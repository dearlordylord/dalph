# Issue 194: stabilize each Run above delivery

These scenarios govern the Run-level composition above descriptive delivery,
delivery-action planning, and the live action runtime. Dalph is the only actor:
no person is waiting at a boundary during one activation. Git, task claims,
worktrees, and the executor are stated explicitly where they do not participate.
The activation receives one idempotently established Run; whether establishment
just appended its beginning or reconstructed existing history does not change
the stabilization or finality path.

## G2 is requested only after G1 is quiescent and reveals B

The journal contains accepted complete tracker observation G1 for tasks A and
B. G1 says A is open and B is open with A as its only prerequisite. Dalph owns
A's exact planned attempt and has called the executor's `begin`
boundary. Git has no attempt, branch, worktree, or integration fact for B, and
the executor has no attempt for B.

The executor returns `Terminal(Completed)` for A. Dalph appends that exact
report, waits until delivery planning has published the accepted journal
position, and only then lets the action boundary return and releases its live
owner. The executor result does not change the tracker: G1 still says A is open,
and Dalph has accepted no later tracker fact. With no executable proposal and no
admitted owner, G1 is quiescent.

Run stabilization allocates one operation identity, appends the tracker-read
intent, calls the tracker once for the complete target closure, and appends the
correlated observation. That accepted observation is G2. G2 says A completed
successfully, so B is now eligible. Descriptive delivery and action planning
publish B; the ordinary live runtime admits B. Stabilization never receives a
task-selection callback and never selects B itself.

Forbidden results are a read while A still has a live owner, more than one G2
read in this activation, admitting B from the unaccepted tracker response, or
stabilization directly invoking B's executor work.

If the process dies before the terminal report is appended, recovery reconciles
the executor before retrying it. If it dies after that append, recovery uses the
same attempt and does not ask the executor for the same terminal result again.
If it dies after G2 is appended but before B starts, restart reconstructs G2 and
ordinary delivery may select B; it neither repeats G2's operation nor invents B
from the earlier executor result.

Acceptance tests:

- `resumes actions when G2 introduces eligible B`
- `publishes each accepted executor report before continuing and stops after Terminal`
- `runs work published after G2 before phase two subscribes`
- `retains accepted integration ownership through G2 and releases it once after phase two`

Invariant mapping: D9 forbids releasing B from the executor result, D34
requires the empty frontier and no live owner before G2, and D36 bounds the
activation to one reconfirmation.

## Equal G2 leaves the Run incomplete and recoverable

The journal contains accepted G1 for open task B whose prerequisite A ended
without success. A is excluded by `TerminalWithoutSuccess`; B is excluded by
`PrerequisitesIncomplete(A)`. There is no runnable proposal, admitted action, claim, worktree, Git
lineage operation, integration resource, or executor session. Delivery retains
the concrete `PrerequisitesIncomplete(A)` explanation for B.

After observing quiescence, Run stabilization performs one ordinary complete
tracker read. The tracker returns the same task contents. The journal accepts
G2 with a different read operation identity and a later journal position while
retaining the same graph content identity. Delivery still has no executable
action and still exposes `PrerequisitesIncomplete(A)`.

The core Run Effect returns `RunMustRemainActive` successfully. The Run entry
does not append `WorkflowRunTerminated`; it closes process-local runtime
resources. A later invocation enters the same Run-establishment path, reads the
same unfinished Journal, and is accepted without a caller-selected recovery
mode. That invocation may perform its own one-shot reconfirmation.

If the process crashes after the G2 outcome append but before the first Effect
returns, the later Run entry reconstructs accepted G2 from the Journal. It does
not retry the completed read operation and does not treat an unjournaled
tracker response as G2. The next activation still receives its own one-shot
stabilization read after reaching quiescence; this is not continuous polling by
the prior activation.

Forbidden results are waiting forever after equal G2, appending Run
termination, losing the non-progress explanation, requiring or accepting a
caller-selected recovery start, or treating a failed, incomplete, or
uncorrelated read as G2.

Acceptance tests:

- `returns without terminating after equal G2 leaves the Run incomplete`
- Authored public-entry test
  `re-enters the same Run and activates it after quiescent incomplete return`
  proves the same Run identity receives a second bounded activation and a
  separately labeled final tracker result without another Run beginning.
- `a crash before append authorizes no work; restart after append reconstructs facts and only a later observed completion releases B`

Invariant mapping: D34 distinguishes quiescence from completion, D35 forbids
termination of the unsettled target, and D36 forbids an unchanged-read loop.

## G2 proves complete and settled termination

The journal contains accepted G1 reporting task A completed successfully and
no Dalph responsibility: A was completed by its tracker authority before Dalph
assumed task work. There is therefore no task-work position or
integration-target ownership to settle, and no claim, worktree cleanup, Git
operation, integration action, or executor call remains. The proposal frontier
is empty and the runtime has no admitted owner, but G1 alone cannot terminate
the activation because stabilization has not yet reconfirmed it.

Run stabilization performs one ordinary complete tracker read. Accepted G2 has
a later read identity and journal position and reconfirms A completed
successfully. Delivery confirms both the completed target and the empty set of
unsettled responsibilities. With no executable proposal or live owner,
stabilization returns the existing `RunMayTerminate` proof. The Run entry
appends exactly one `WorkflowRunTerminated` event.

If the process dies after G2 is appended but before termination is appended,
the same Run entry reconstructs G2, reaches quiescence, performs that
activation's one later reconfirmation, and may append the one termination
record. If the termination append succeeded before the response was lost, Run
establishment observes the terminated history and constructs no activation or
second record.

Forbidden results are termination from G1, termination while any responsibility
or resource remains unsettled, a second G2 read in the activation, or a second
termination record.

Acceptance test:

- `terminates once only after G2 proves the target complete and responsibilities settled`

Invariant mapping: D35 supplies the termination safety condition and D36
forbids a second reconfirmation in the activation.

## Source and ownership boundary

`QuiescenceProbe` is not a delivery-action route. Delivery action planning and
the live runtime neither request nor recognize the post-quiescence read.
Process-local revisions and general invalidation do not prove G2. The Run-level
composition correlates the exact allocated read operation with the accepted
graph observation and its journal position.

This is a source-ownership scenario, so no person, external response, crash, or
retry applies: the acceptance test inspects the production source boundary and
performs no runtime call.

Acceptance test:

- `keeps quiescence probes out of action planning and former scheduler runtime code`

Invariant mapping: D29 keeps the Run-level decision out of persisted derived
state, and D34 keeps it distinct from ordinary delivery actions.

## A paused Run does not request G2

Alice has already paused the Run and the accepted journal reconstruction says
`RunPaused`. Issue #134 forbids Run-specific polling while paused, and this
one-shot read would be a new Run-specific tracker request rather than an
incidental shared observation. After already-admitted work and its bookkeeping
finish, the runtime therefore returns the current `RunMustRemainActive` proof
without calling the tracker for G2. Unpause must obtain its own fresh reads
before forward progress.

If the process dies while the Run is paused, restart reconstructs `RunPaused`,
and the same Run entry starts no new forward boundary call and still performs
no G2. A later accepted Unpause direction is the event that permits fresh reads
again.

Forbidden results are a tracker read caused by paused quiescence, termination
of the paused Run, or admitting new forward work.

Acceptance tests:

- `does not request G2 while the Run is paused`
- `stops before the next forward operation after Alice pauses the Run`
- `restarts a confirmed paused Run without selecting new forward progress`

Invariant mapping: D20 owns the paused scope and D34 forbids treating passive
paused return as completion.
