# Reconcile missing, foreign, and unreadable task claims

Issue:
[Reconcile missing, foreign, and unreadable claims](https://github.com/dearlordylord/dalph/issues/137)

The tracker owns the current claim record. Dalph's journal proves which exact
owner, token, task, and acquisition operation authorized its attempt, but that
historical record does not prove the claim is still current. These scenarios
cover provider-neutral behavior through the controlled tracker. Issue #113
later qualifies the same behavior against GitHub.

## Owning model and executable adapter

`specs/taskFactReconciliation.qnt` owns the affected-attempt claim constraints,
safe-suspension decision, command-gated replacement identity, foreign-claim
preservation, and independent-task progress. Its deterministic scenarios live
in `specs/taskFactReconciliation_test.qnt`; the production frontier projection
is exercised by
`packages/dalph/test/conformance/task-fact-reconciliation.mbt.test.ts`.
P0–P6 remain conformance-test cut-point labels rather than production stages
or persisted domain terms. The canonical repository no longer contains the
issue's stale `specs/frontierRecovery.qnt`, ADR 0010, or literal P0–P6 lane
files. The focused owning model and executable adapter named above are the
current conformance path; inventing replacement lane names would create a
second, unauthoritative model hierarchy.

At the current production-shaped fake-provider milestone, Dalph materializes
separate task-claim, task-claim-release, task-worktree, coarse
planned-attempt-executor-work, and integration responsibilities. Executor
sessions, inner invocations, and evidence handling are deliberately not
separate generic orchestration responsibilities yet. Claim loss therefore
retains every materialized responsibility and all journal evidence; it cannot
preserve nonexistent executor-internal responsibility types without violating
the accepted milestone boundary.

## Another tracker client replaces A's claim while A is running

### Starting situation

Alice monitors Run R but does not trigger or author the claim change. Task A
and independent Task C are open in the current target closure and need none of
each other's facts or resources. Dalph has recorded claim K1 for A, planned
attempt P1 at authored fingerprint F1, exact worktree W1, and unfinished
executor-work responsibility for P1. The controlled fake executor reports P1
running. A uses one task-work position; capacity remains available for C.

No integration, tracker-completion, cleanup, or disposition request exists for
A. W1 contains work in progress.

### Trigger and ordered boundary calls

Another tracker client removes K1 and records K2 for A with a different owner,
token, or acquisition operation. Dalph does not know who made the change.

Before selecting another forward-progress action for A, Dalph asks the
controlled tracker for A's current exact claim. The tracker reports K2. Dalph
compares every part of K2 with K1 and records the normalized observation.

Dalph asks the executor to safely suspend P1. A keeps its task-work position
until the executor reports that it preserved resumable state and no
executor-owned activity remains running. Dalph then makes the position
available and exposes a task-local foreign-claim isolation. It retains P1, W1,
WIP, executor evidence, and every separate disposition responsibility. It
sends no claim mutation.

C remains selectable whenever capacity is available.

The same chronology applies when a complete claim read reports no current
claim: Dalph records the proven absence, safely suspends P1, and starts no
automatic acquisition. Proven absence and a foreign replacement remain
distinct observations even though both forbid forward progress.

### Crash, retry, visible result, and forbidden result

If Dalph dies after recording the claim observation but before safe
suspension, restart reconstructs P1 and asks the executor for the same P1
outcome before releasing its position. If it dies after safe suspension, the
claim observation and unfinished responsibilities reconstruct A's isolation;
restart does not acquire another claim.

Alice sees A stop with its preserved attempt and sees C continue. Dalph must
not edit or remove K2, infer who created it, silently reacquire an absent
claim, abandon W1, settle unrelated A responsibilities, block C, or treat the
claim change as tracker completion.

### Acceptance-test mapping

- `records a foreign claim from an authored recovery story and safely suspends
  only its attempt` drives the composed controlled-provider loop and verifies
  its recorded-cassette projection.
- `reads current claim facts, safely suspends A, and then exposes its
  missing-claim constraint` proves the chronological missing-claim recovery
  path.
- `keeps A's worktree responsibility constrained while independent C remains
  selectable` proves a separate worktree obligation is retained without an A
  action while C is actually selected.
- `fails closed without current tracker facts and orders authorized integration
  work` proves a foreign claim retains A's integration responsibility without
  queueing or starting it.
- Quint scenarios `foreignClaimStopsOnlyA` and `missingClaimRequiresCommand`
  prove local progress and the absence of automatic acquisition.

## A's claim cannot be read

### Starting situation

Alice monitors A and independent C. Dalph retains K1, P1, W1, and unfinished
executor responsibility for A. The fake executor currently reports P1
running. No later executor, review, integration, completion, cleanup, or claim
mutation has been selected.

### Trigger and ordered boundary calls

The controlled tracker returns an unreadable result when Dalph asks for A's
current claim. Dalph tries to read A's claim up to three times under the same
continuation decision. It performs no state-changing tracker request between
reads.

During those bounded reads, an already-running P1 may continue its current
executor work, but Dalph starts no new executor work, review, integration, or
tracker-completion action for A. If a reread reports K1 exactly, ordinary
selection may continue after every other independent continuation fact is
fresh.

If all three reads are unreadable, Dalph records the exhausted typed
observation and asks the executor to safely suspend P1. It retains A's position
until safe suspension, then exposes a claim-authority wait whose wake condition
is a later successful claim reread. It preserves every A resource and lets C
continue.

### Crash, retry, visible result, and forbidden result

A crash between unreadable reads loses only the process-local retry count.
Restart reconstructs the unfinished continuation read and begins a new bounded
set of reads; it does not infer either claim ownership or claim loss. A crash
after the exhausted observation reconstructs the wait and safe-suspension
responsibility. No timer or retry counter is persisted as authority.

Alice sees A continue briefly while Dalph retries, then stop if the tracker
remains unreadable. Dalph must not turn unreadability into missing or foreign
claim evidence, start a later A stage, mutate a claim, discard W1, or stop C.

### Acceptance-test mapping

- The unreadable variant inside `records a foreign claim from an authored
  recovery story and safely suspends only its attempt` consumes three authored
  provider failures, records exhausted typed evidence, safely suspends P1, and
  projects the evidence into the recorded cassette.
- `stops after three unreadable observations without mutating the tracker`
  proves the provider retry bound.
- `accepts the exact claim after two unreadable observations` proves transient
  unreadability does not create a claim-loss constraint.
- `explains missing, foreign, and unreadable claims without selecting task
  work` proves independent C remains selected.
- Quint scenario `unreadableClaimCannotAuthorizeProgressOrLoss` proves the
  negative transition rules.

## Alice explicitly asks Dalph to reacquire A

### Starting situation

A is safely suspended after a fresh read proved K1 missing. Dalph preserves P1,
W1, WIP, and its other unfinished responsibilities. No current tracker claim
exists for A. The old K1 identity remains in history and cannot authorize a
new request.

### Trigger and ordered boundary calls

Alice sends the accepted explicit reacquisition command for A. The
authenticated command names A and has its own immutable command identity.
Dalph accepts that command for this replacement only when it follows the
durable missing observation for the still-current loss episode. An exact or
unreadable observation before the command cannot authorize a later loss; an
exact restoration, a different foreign claim, or unreadability after the
command ends its authority. A recorded exact claim acquisition also ends any
older loss episode before another focused read occurs. Dalph records the
command, then its claim planner allocates a new acquisition operation and
token K3; neither claim identity equals K1. Dalph records K3's intent before
asking the tracker to acquire it. It reads the current claim before the
request and again after an ambiguous result, using the existing bounded
acquisition protocol.

Redelivery of the same command reuses its recorded result and cannot allocate
another K3. A different command cannot reuse K1 because only the claim planner
allocates claim identities. If the tracker reports a foreign K2, Dalph
preserves K2 and records a terminal foreign-claim rejection for that exact
acquisition intent. Restart reconstructs the rejection and never retries that
command, even if K2 later disappears; a later loss requires a new command.
Only a fresh unclaimed observation may authorize creation of K3. Reacquiring
capacity and deciding whether preserved P1 may continue remain independent
later decisions.

### Crash, retry, visible result, and forbidden result

If Dalph dies after recording the command or acquisition intent, restart reuses
K3 and checks the tracker before another request. If the tracker created K3 but
the response was lost, the reread accepts that exact K3 and records one
outcome.

Alice sees either exact K3 acquired, a visible foreign-claim conflict, or a
bounded unreadable result. Dalph must not reuse K1, overwrite K2, create two
claims, treat the command as capacity admission, or resume P1 merely because
K3 was acquired.

### Acceptance-test mapping

- `records explicit pause, unpause, and claim-reacquisition commands without
  applying workflow effects` proves the authenticated command is durable but
  does not itself admit or resume work.
- `reads current claim facts, safely suspends A, and then exposes its
  missing-claim constraint` proves a command recorded before a real recovery
  activation survives that restart, allocates one stable fresh K3, binds
  intent once, rereads exact K3, and only then exposes ordinary continuation
  to admission.
- The missing-claim and foreign-conflict variants inside `records a foreign
  claim from an authored recovery story and safely suspends only its attempt`
  compose the authenticated operator request with the controlled tracker:
  missing K1 produces fresh K3 and a foreign K2 remains untouched as a typed
  acquisition conflict.
- `rereads tracker authority after an ambiguously applied acquisition` proves
  intent-before-effect reconciliation after a lost response.
- `stops when atomic acquisition reports a competing claim` proves a foreign
  K2 is preserved.
- `records a foreign acquisition rejection as terminal and never reconstructs
  a retry` proves the definite conflict is journaled as the intent's terminal
  outcome and remains non-runnable across restart even if K2 later disappears.
- `requires a prior matching authenticated command for a reacquisition intent`
  proves malformed history cannot manufacture replacement authority, commands
  recorded after exact or unreadable evidence cannot authorize a later loss,
  restoration ends an earlier loss command, a stale K1 identity is rejected,
  and an ordinary acquisition is never classified by parsing its opaque
  operation-ID spelling.
