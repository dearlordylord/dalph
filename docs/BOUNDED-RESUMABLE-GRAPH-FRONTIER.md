# Bounded Resumable and Pausable Graph-Frontier Specification

Status: accepted

Scope correction from issue #162: the provider-neutral graph, responsibility,
pause, and capacity rules remain accepted. Descriptions of the current
review-loop implementation, coding-agent work units, reviewer/handback retry
policy, task-work-provider sessions, independently surviving executor
processes, and their recovery models are historical implementation material,
not requirements for the production-shaped fake-provider milestone. Issues
#127 and #168 own their post-milestone redesign and reconciliation.

This is the canonical behavior and acceptance specification for bounded
task-graph traversal across ordinary execution, user-requested pause, restart
after coordinator death, external authority changes, and resume. Canonical
terms remain in [CONTEXT.md](CONTEXT.md), stable component and boundary rules
remain in [ARCHITECTURE.md](ARCHITECTURE.md), and hard-to-reverse choices remain
in [ADRs](adr/).

## Problem Statement

A Dalph user needs work to continue from every legal durable workflow prefix
without duplicate external changes, lost work, stale-authority decisions, or
one constrained task stopping an independent graph branch. The task tracker,
Git, task-work provider, executor, and Dalph workflow journal each own different
facts. Coordinator process loss, a pause command, or a change in one external
application must not blur those authority boundaries or turn reconstructed
state into a second authority.

The current implementation predates parts of this specification. This document
defines the accepted target behavior; it does not claim that every named
workflow operation or adapter already exists.

## Solution

The Dalph orchestrator records intent before every request that may change an
external application, records normalized observations afterward, and preserves
the same `OperationId` while an uncertain result is checked and legally
retried. It reconstructs graph knowledge, workflow history, pause state, and
per-subject responsibility from the journal; then it derives a process-local
runnable frontier and bounded admission set.

One activation uses the ordinary selector after every recorded result. It
continues every immediately legal independent transition until each outstanding
responsibility has either a legal transition or a named wait, pause, isolation,
relinquishment, settlement, subject-specific final outcome, or typed issue.
Appending one journal event is not a return boundary.

External changes become independent continuation constraints. The orchestrator
asks the application that owns each fact for fresh evidence, stops only the
affected work at its accepted safe boundary, preserves exact responsibilities
and recoverable resources, and lets unrelated graph branches continue.

## Actors and Authority Boundaries

| Actor or application | Facts it owns |
| --- | --- |
| Dalph user | Authenticated Pause, Unpause, stop, restart, override, and repair commands. |
| Dalph orchestrator | Run and operation identities, planned attempts, outer workflow selection, durable intents, normalized observations and outcomes, responsibility and disposition history. |
| Dalph executor | Its complete work for one exact planned task attempt and any implementation details hidden behind that boundary. |
| Task tracker | Task identity and authored work specification, lifecycle, prerequisites, grouping, target membership, and claims. |
| Git | Refs, commits, ancestry, registered worktrees, candidates, and atomic target-ref promotion facts. |
| Task-work provider | Provider-native sessions, work units, or worker processes used inside a later production executor. |
| Dalph workflow journal | Only the workflow history that the orchestrator records; never current tracker, Git, executor, or provider state. |

Providers do not append their internal histories to the Dalph workflow journal.
The orchestrator records only normalized facts returned through their named
boundaries. Invalid causal ordering in Dalph's journal is invalid managed
history. Unreadable or contradictory provider state is a reconciliation
constraint on the exact subject and does not by itself invalidate the journal.

## User Stories

1. As a Dalph user, I want coordinator restart to continue every legal
   operation from durable history and fresh external facts, so that process
   loss does not lose or duplicate work.
2. As a Dalph user, I want to pause a whole run without turning the request
   into many task pauses, so that later run unpause preserves independently
   paused tasks.
3. As a Dalph user, I want to pause one task and its grouping descendants while
   its prerequisites and independent branches continue, so that pause does not
   invent dependency semantics.
4. As a Dalph user, I want pause to preserve claims, worktrees, sessions, and
   unfinished work after in-flight actions reach safe boundaries, so that an
   ordinary pause is not abandonment.
5. As a Dalph user, I want Unpause to reread the task tracker, Git, and task
   runner facts needed by preserved work, so that stale work does not restart
   after the world changed.
6. As a Dalph user, I want an edited task to stop at a safe boundary and offer
   explicit continue, restart, or stop choices, so that Dalph never pretends an
   executor incorporated new instructions.
7. As a Dalph user, I want externally completed tasks to release dependants
   without duplicate integration or tracker completion, so that Dalph accepts
   the task tracker's current fact.
8. As a Dalph user, I want missing claims, rewritten Git lineage, lost
   worktrees, and unavailable sessions to affect only their exact subjects, so
   that independent work continues.
9. As a maintainer, I want every ambiguity-crossing boundary to use one
   intent/check/outcome contract, so that retries retain identity and are
   exhaustively testable.
10. As a maintainer, I want model actions replayed through the production
    workflow algebra and both journal stores, so that a model proof cannot hide
    an implementation or physical-reopening mismatch.

## Implementation Decisions

### Reconstructed state and transition selection

The process reconstructs one validated managed-run state by composing pure
reducers for graph knowledge, workflow history, per-subject responsibility,
and pause state. It does not persist the composed state, runnable frontier,
admission set, capacity reservation, queue, timer, or UI projection as
authority.

The runnable frontier contains exact per-responsibility transitions allowed
before task-work capacity is applied. It also explains every responsibility
without a legal transition. Deterministic admission gives already-owned
responsibilities priority over fresh tasks, then uses the accepted canonical
task order. Fresh-task selection creates responsibility only when the
orchestrator records that task's first exact operation intent.

One process-local capacity controller stores at most one task-admission
position per task. Dalph decides whether a workflow transition needs zero or
one position; the executor does not request, acquire, declare, or release it.
For example, continuing task A through the executor needs one position, while a
tracker-only observation needs none. The controller never infers capacity from
an executor's internal stage or operation name.

After Dalph admits a planned task attempt, its task keeps one position until
the executor returns a terminal result for that complete attempt or proves the
complete attempt safely suspended after Dalph asked it to stop for later
resume. An internal delay, retry, stopped process, or executor operation cannot
release the position because generic Dalph neither sees nor interprets those
facts. A completed executor attempt releases task-work capacity but does not
prove that the task tracker marks the task completed.

Valid journal history contains at most one unfinished planned-attempt executor
responsibility for each task. If reconstruction finds two, Dalph rejects that
managed history before deriving the frontier. It does not normalize two
responsibilities into one position.

### Planned-attempt executor boundary

Dalph gives the executor one exact planned task attempt and later receives a
coarse report for the executor's complete work on that attempt: running, safely
suspended, or terminal with a normalized result. Readiness to start or resume
is derived by Dalph before it calls the executor; it is not an executor-reported
state. The generic correlation is the planned attempt's `RunId` and
`AttemptId`; no separate outer-invocation identity exists. Executor-internal
operations and identities never enter generic responsibility, frontier,
admission, or capacity state.

The production-shaped fake-provider milestone installs one controlled fake
executor behind this boundary. Its cassettes can start, complete, fail, suspend,
and resume a planned attempt without inventing coding-agent, reviewer,
handback, restoration, or retry stories. Dalph and this fake executor share one
process lifetime. If Dalph crashes, the fake executor crashes too; no fake
executor activity survives for Dalph to discover. Restart reconstructs the
same planned attempt from journaled workflow history and recreates the fake
executor. Independently surviving executor processes and the detailed
review-loop implementation are post-milestone work.

The accepted chronological scenarios and test seams are recorded in
[planned-attempt executor boundary scenarios](scenarios/review-loop-executor-source-boundary.md).
[Issue #158](https://github.com/dearlordylord/dalph/issues/158) owns the coarse
boundary and controlled fake. Issue #127 owns later configurable executor
policy; a separate post-milestone ticket owns adapting the current experimental
review-loop implementation.

### Recovery activation

Ordinary execution and restart invoke the same pure selector. Before a request
intent exists, restart recomputes the choice and may allocate a new identity.
After intent exists, every request, result check, retry, and outcome retains
that exact identity and immutable payload. The orchestrator checks the request's
destination before retrying after an outcome that may be ambiguous.

Identical durable history, fresh external observations, and current configured
capacity produce the same exact next operation or explanation. When fresh facts
or configured capacity differ after restart, Dalph does not reproduce a lost
in-memory frontier or manufacture the previous global execution sequence. It
derives deterministically from the current inputs, preserves every outstanding
workflow responsibility, does not preempt freshly observed work merely because
the configured limit decreased, and keeps each reachable responsibility
selectable or exactly explained until its obligation completes or is durably
relinquished.

When the process-local capacity controller's snapshot changes so future
admission may be possible—including after a complete planned attempt becomes
terminal, becomes safely suspended, or a pre-start reservation is
cancelled—the Dalph coordinator
reads the current reconstructed managed-run state and controller snapshot and
derives the runnable frontier and admission set again. It asks a
workflow-selected external boundary for fresh facts only when current durable
knowledge does not satisfy the decision; this controller change alone does not
cause complete restart reconstruction. No dormant `awaitAdmission` fiber owns
the next position. The frontier's responsibility-first order remains the only
scheduling order, and the controller retains no second ready-work queue or
task/operation-identity choice.

The selector gives each pre-intent result an exact process-local selected
transition identity over the run, transition kind, exact subject, and immutable
decision inputs carried by that transition. The activation coordinator creates
ownership for that identity while starting one scoped owned-operation runner.
Trigger callers cannot submit a transition or obtain the owned capability, so
a second transition owner cannot be represented through the public API. When
the runner records operation intent, the ownership entry binds to the durable
`OperationId`; every later request, result check, retry, reconciliation action,
and outcome for that workflow operation retains it. A pre-start task admission
reservation may use that operation while Dalph crosses the start boundary.
Once complete executor work starts, capacity is correlated only by the planned
attempt's `(RunId, AttemptId)`, not by the `OperationId`.
The live ownership entry retains its immutable selected-transition value only
as a process-local exclusion correlation until ownership ends, so a pass that
read pre-intent reconstructed state while intent was being recorded still
cannot readmit the owner. No post-intent boundary action uses that correlation
as its identity.

The activation coordinator exposes trigger signaling, not transition submission.
Startup, restart, resume, a recorded workflow result, and a controller change
that may permit admission signal one scoped coordinator. Signals carry no task,
transition, priority, or order key and may coalesce. One pass reads current
reconstructed managed-run state, the activation-ownership snapshot, and the
controller snapshot, then derives the frontier. The coordinator excludes every
exact transition already represented by live activation ownership, emits
`ActivationInProgress` for that subject, and preserves the selector's order for
the remainder. It passes only that filtered frontier to the controller, which
computes bounded admission and reserves its exact first transition. The
coordinator claims it and starts one scoped owned-operation runner. After that
handoff is established, the coordinator rereads current state and may admit
another transition without waiting for the earlier runner's final result. Each
runner executes exactly one operation through the injected workflow
interpreter, records its exact result, releases activation ownership, and
signals the coordinator. Capacity exhaustion returns a `CapacityWait`; it does
not park a transition-owning waiter.

The private handoff registers the reserved task-admission position, activation
ownership, and scoped runner under one interruption mask. Before an
unsuccessful handoff returns or dies, it makes that exact newly reserved
position available and removes partial ownership. A second registration is a
classified `DuplicateActivationOwnershipDefect`, not an expected Effect error;
the coordinator supervisor isolates its exact subject and continues unrelated
work without starting a runner or external effect.

After an acknowledged handoff, a live-runtime runner exit before intent removes
ownership and makes the exact reserved position available. An exit after intent
without a recorded result removes only the dead runner's ownership and retains
the position for the unfinished planned attempt. Only a later terminal
complete-attempt result or safe suspension makes it available. Abrupt process
death relies on startup reconstruction.

Selection, reservation, and activation ownership are process-local. Restart
discards every pre-intent instance and derives again. A recorded intent retains
its `OperationId` and immutable payload. The controller reconstructs positions
from current configuration and unfinished planned-attempt responsibilities.
If reconstructed usage equals or exceeds a lower restart limit, Dalph preempts
none and creates no new reservation until usage falls below the limit. Live
resizing remains a separate control policy.

Workflow code declares the graph subjects, fact families, completeness, and
freshness required by a decision. The graph boundary decides whether existing
knowledge satisfies that request or the task tracker must be read. A successful
read contributes a graph-knowledge observation even when the normalized values
did not change.

The fake-provider milestone defines no executor-internal retry schedule,
provider invocation, or restoration policy. Those current experimental
implementation details do not affect generic frontier or capacity behavior.

### Pause, unpause, and resumption

The control boundary accepts four explicit directions: Pause or Unpause one
run, and Pause or Unpause one task in one run. Receiving a command is not a
workflow occurrence. Issue #166 records the applied direction as a past-tense
operator action; a command lost before application may disappear. Reducers
derive pause phases rather than persisting `Pausing` or `Paused` status.

A task pause covers only the selected `(RunId, TaskId)` and its current
transitive grouping descendants. It follows grouping parent-to-child edges and
never copies pause state to descendants or follows prerequisite edges. An
unfinished prerequisite blocks its dependants under ordinary tracker semantics;
it is not paused by that fact.

After a pause request, the orchestrator starts no new forward-progress action
for the covered work. An already-started bounded request completes or follows
its normal uncertain-result check. If the complete executor work for a planned
attempt is running, Dalph asks the controlled fake executor to preserve and
safely suspend that exact `(RunId, AttemptId)`. The task keeps its task-work
position until the fake reports that no work for the attempt remains running
and the attempt can later resume. Integration already holding its serialized
Git resource reaches a known Git result and releases that resource, but does
not begin the separate tracker completion request. Already-requested tracker
completion is reconciled.

Confirmed pause is passive. It schedules no polling. Unpause changes the
requested pause direction but does not itself consume a task-work position.
Dalph freshly reads the tracker and Git facts required by the preserved
responsibility, reacquires a position, and then asks the fake executor to
resume the same `(RunId, AttemptId)`. Unpause requested while safe suspension
is still in progress waits for that result; it does not start competing
executor work.

### Active-task continuation and external changes

Before starting or resuming complete executor work for a planned attempt, and
before pre-promotion integration continues, the orchestrator obtains
sufficiently fresh continuation facts. An
active-task continuation read covers normalized authored instructions and
fingerprint, lifecycle, exact claim, target-closure membership, and complete
blockers. It does not poll coding-agent progress and it does not repeat initial
attempt eligibility or replan an immutable attempt.

Task pause, task-specification change, lifecycle, claim ownership, target
membership, dependencies, Git lineage, and resource availability are
independent constraints. Clearing one never clears another.

| Fresh observation | Required behavior |
| --- | --- |
| Authored task fingerprint changed before promotion | Stop the active invocation and activate a task-specification change hold. Offer explicit continue-existing-attempt, restart-task-implementation, or stop-task-implementation commands. |
| Tracker reports successful completion | Stop pre-promotion work, preserve WIP, perform no duplicate integration or completion, remove only Dalph's exact claim after proving it is still owned, and recompute the graph. |
| Tracker reports another terminal lifecycle | Activate a reversible task-lifecycle hold; preserve claim, attempt, session, worktree, WIP, and evidence. Reopening may resume the same attempt. |
| Complete read proves task left target closure | Activate a reversible target-membership constraint and stop pre-promotion work. An incomplete read cannot prove removal. |
| Exact claim is missing, replaced, or foreign | Stop the invocation, never edit the foreign claim, and require an explicit command plus new claim identity for reacquisition. |
| Claim is temporarily unreadable | Perform bounded rereads; start no new executor, review, integration, or completion action. Exhaustion interrupts active work and activates a claim-authority hold. |
| New unfinished blocker appears before promotion | Preserve the candidate, release serialized integration, and enter automatic dependency wait without blocking its prerequisite or unrelated work. |
| New unfinished blocker appears after promotion | Preserve promotion proof, never roll Git back, and defer tracker completion until the blocker clears and target ancestry is re-proved. |
| Target advances and planned Base remains an ancestor | Continue; integration uses the latest compatible target head. |
| Target rewrite makes planned Base non-ancestral | Activate a Git-lineage constraint, preserve resources, and require restored compatible ancestry, clean restart, or stop. |
| Result commit is missing or not descended from planned Base | Reject it as the attempt result, preserve the worktree, and offer clean restart or stop. |
| Exact planned worktree is missing or mismatched | Record terminal attempt-worktree-lost, preserve readable evidence, retain the claim, and require clean restart or stop. Never repair or infer a replacement. |
Continuing an attempt after an authored task change records a durable override
that names both fingerprints and does not claim the executor incorporated the
new instructions. Restart supersedes the old attempt, retains the task claim,
and creates a new attempt from current instructions and target head. Stop
abandons the attempt and releases only the exact owned claim. Resource
disposition remains separately authorized.

The orchestrator does not attribute a change to a user unless an authenticated
user command is the observed fact. Dirty and untracked worktree files and normal
commits are ordinary WIP, not evidence of an actor or a hold condition.

### Integration, completion, responsibility, and finality

Integration builds and verifies an isolated candidate against the current
target head. Final promotion atomically fast-forwards the configured target ref
from one exact expected old head to the verified candidate. A stale expected
head triggers candidate reconciliation and retry; it never overwrites the
intervening target update.

After Git promotion reaches a known result and releases the serialized resource,
the tracker protocol replaces the active claim with an exact completion claim,
requests tracker success, freshly confirms successful lifecycle and resulting
graph facts, then deletes only that exact completion claim. The successful
tracker observation may release dependants. A later claim-deletion failure
cannot reopen the task.

There is no generic cleanup stage. Each cleanup, preservation, disposal, or
handoff operation has its own responsibility and causal prerequisites. Final
executor outcome, planned-attempt resolution, tracker task completion, task
responsibility settlement, and run termination are distinct. A task settles
only after the selected resolution protocol is final and every remaining
responsibility is completed or durably relinquished.

## Formal Model Portfolio

[ADR 0010](adr/0010-govern-recovery-with-two-quint-models.md) accepts exactly
two canonical models.

| Model | Question and authority focus | Canonical artifacts | Bounds and maintainer |
| --- | --- | --- | --- |
| M1 — Task-work-session establishment recovery | Can one exact session-establishment operation create or rediscover its provider session after an uncertain request without changing identity or accepting incomplete evidence? It refines provider correlation, authoritative absence, unreadability, conflicts, and bounded lookup. | [`taskWorkSessionRecovery.qnt`](../specs/taskWorkSessionRecovery.qnt), [`taskWorkSessionRecovery_test.qnt`](../specs/taskWorkSessionRecovery_test.qnt) | One task, attempt, and operation; lookup bound three; simulation depth 40. Maintained with the orchestrator session-recovery protocol. |
| M2 — Graph-frontier recovery composition | Can the orchestrator traverse a bounded graph across all accepted boundaries while crash, pause, capacity, and external constraints compose without duplicate effects or branch-global blockage? | [`frontierRecovery.qnt`](../specs/frontierRecovery.qnt), focused proof projection [`frontierRecovery_capacity_correlation.qnt`](../specs/frontierRecovery_capacity_correlation.qnt), [`frontierRecovery_test.qnt`](../specs/frontierRecovery_test.qnt), [`frontierRecovery_counterexamples.qnt`](../specs/frontierRecovery_counterexamples.qnt) | Tasks A–D; A prerequisite of B; D grouping child of A; independent C; configured capacity profiles one and two; request/read bound two; bounded revisions and one crash/pause cycle. Maintained with the orchestrator control plane. |

M2 keeps frontier, pause, and reconciliation together because they share one
authority projection, workflow adapter, conformance-test reopening seam,
checking strategy, lifecycle, and maintainer. M1 remains separate because its detailed
provider correlation and three-lookup protocol would make the broad model less
tractable and obscure the focused question.

The activation extension to M2 must make a runtime-observed runner exit after
intent retain its exact task-admission position for the unfinished
`(RunId, AttemptId)` until its complete executor work is terminal or safely
suspended. A weakened action that frees the position immediately must produce
a counterexample, and Quint-connect must execute that positive sequence
against the production projection. This makes early capacity release after a
runtime-observed post-intent runner exit an automatically detectable model and
MBT failure.

| Model | Canonical safety properties | Required checking profiles |
| --- | --- | --- |
| M1 | Request requires intent; identity, payload, and causal predecessors remain stable; only fresh authoritative absence permits a repeat; unreadability and conflict never permit creation; establishment requires one matching report; lookup bound and terminal outcome remain stable. | Deterministic decision-edge scenarios; seeded construction traces; separate exhaustive matching, absence, unreadability, conflict, and crash/restart profiles; deliberately weakened missing-intent, changed-identity/payload, unreadable-repeat, and no-matching-report profiles. |
| M2 | Capacity remains bounded; every effect has a matching earlier intent; one operation identity applies at most one authority effect; requests retain intent identity; stale observations never authorize requests; every responsibility is actionable or exactly explained; a local constraint does not stop independent C; finality remains subject-specific; frontier, pause, claim, promotion, and successor-session negative rules remain explicit. | Deterministic accepted scenarios; seeded witness traces; exhaustive all-boundary, crash, run/task pause, capacity-one, graph-conflict, reconciliation, selected two-constraint, and focused capacity-correlation profiles; deliberately weakened negative profiles; sampled Quint-connect conformance. One capacity-one profile starts with independently eligible A and C, exports both frontier transitions, admits and reserves only A, and exports C's task identity plus `CapacityWait` wake condition. A second capacity-one profile gives C an existing responsibility and proves it precedes fresh A. The focused capacity-correlation projection checks capacities one and two with one finite crash ordinal while the broad model and conformance adapter retain the complete operational state. A weakened action that omits only the capacity check and reserves both tasks must violate `boundedCapacity`. |

### `AmbiguityBoundaryV1`

M1 and M2 overlap at session establishment through one versioned
specification-level projection:

```text
subject
operation identity
immutable request fingerprint
causal predecessors
intent committed
request attempts and returned acknowledgements or failures
fresh check requests and normalized observations
authority effect identities
outcome or exact nonterminal disposition
authority revision and freshness evidence
```

For every instance, the orchestrator records intent first; every attempt and
fresh check retains the identity and fingerprint; a new activation invalidates
pre-crash authority knowledge for request authorization; only a fresh
boundary-specific observation proves applied, not applied, conflict,
unreadability, or terminal result; proven non-application permits only the same
bounded request; and each outcome settles only its exact subject.

M1 refines `SessionBoundary`; M2 composes that projection with claim, worktree,
invocation, promotion, completion-claim creation, tracker completion, and
completion-claim deletion. Both adapters must project the same generated
session trace to equal `AmbiguityBoundaryV1` values. Changing the projection
version requires an explicit migration of both models and adapters.

### Executable model seam

Each model exports a closed action schema. One test-only TypeScript
Quint-connect driver maps each action to a deterministic test control that
invokes the production workflow algebra or a production reducer. The driver,
its identity projection, and its controls are test support: they are not
production package APIs and are not emitted in the production package. The
driver cannot implement a second scheduler, assign an expected state directly,
edit private module state, or infer effects from trace strings.

After every action, the driver compares the model's ambiguity-boundary and
frontier projection, reconstructed graph knowledge, responsibility, pause
state, derived frontier and admission state, controlled external-authority
state, and ordered semantic workflow trace. A centralized Effect Schema mapping
round-trips bounded model identities to branded Dalph identities. Unknown
actions, missing mappings, duplicate branded identities, and lossy projections
fail before crossing a boundary.

The M2 action families map to these callable production seams:

| Model action family | Production-facing seam |
| --- | --- |
| Commit fresh or responsible intent | Pure frontier/admission selection followed by append of the exact selected workflow-operation intent. |
| Request applies or changes nothing | Controlled tracker, Git, or executor boundary selected by the current workflow operation. |
| Observe authority | Normalized boundary result with declared coverage and freshness, followed by its accepted journal event. |
| Authorize retry or record outcome | Boundary-specific recovery decision plus the shared journaled interpreter. |
| Crash and restart | Close process-local scopes, reconstruct through production startup recovery, then run the ordinary selector. |
| Pause, Unpause, and resumption | Public control-command boundary; derived phases and safe-boundary actions are observed, never assigned by the driver. |
| Planned-attempt executor completion or safe suspension | Controlled fake-executor advancement followed by the attempt-level result for the same `(RunId, AttemptId)`. |
| External change | Change only the owning controlled authority, run the named continuation read, and compare the resulting constraint or disposition. |
| Repair or clear isolation | Change the owning authority, perform a fresh accepted read, and let the ordinary selector decide. |

The M1 closed action map is:

| Model action | Production-facing seam |
| --- | --- |
| Select identity | Construct one session-establishment workflow operation with fixed plan/worktree predecessors. |
| Commit intent | Invoke the journaled session-establishment interpreter and stop after acknowledgement of the exact intent. |
| Request creates session or changes nothing | Release the controlled task-runner request; the controlled provider applies or does not apply that exact request. |
| Lookup matching, absent, unreadable, or conflicting | Supply the corresponding normalized task-runner result or typed failure. |
| Record lookup | Append the lookup request and report or failure, then invoke the production recovery decision. |
| Record outcome | Append the exact task-work-session-established outcome. |
| Crash | Interrupt the complete coordinator scope without mutating journal or provider projections. |
| Restart | Create a fresh application scope over the selected store and invoke startup recovery for the exact run. |

Missing production reducers or callable production seams are implementation
blockers. Tests must not bypass those missing seams to make a model appear
connected.

## Testing Decisions

Formal exhaustive checking, sampled model-to-code conformance, and physical
production reopening are distinct evidence claims.

### Conformance-test recovery cut points

> **P0–P6 are test vocabulary only.** They name conformance-test cut points
> where a test truncates retained journal history and restarts the application.
> They are not production workflow stages, priorities, states, events, or
> terminology for runtime behavior.

For every modeled boundary, the conformance harness truncates legal chains
after every durable journal event:

| Test cut point | Durable endpoint | Restart assertion |
| --- | --- | --- |
| P0 | Previous outcome; next choice existed only in memory | Recompute from fresh facts; do not preserve a lost uncommitted identity. |
| P1 | Exact operation intent | Reconstruct identity and responsibility; fresh-check before a possibly duplicate request. |
| P2 | Request-attempt event, when the protocol has one | Observe the boundary before repeating; missing acknowledgement proves nothing. |
| P3 | Request acknowledgement or typed request failure | Treat as history, not current authority; perform the required fresh result check. |
| P4 | Fresh-check intent | Repeat or finish only the read; do not send a state-changing request. |
| P5 | Fresh observation, report, lookup failure, or constraint | Apply the production decision from that evidence. |
| P6 | Boundary outcome or exact nonterminal disposition | Select only causally later work; replay remains idempotent. |

Every applicable conformance-test cut point runs through a fresh in-memory
application scope over retained journal records and through a closed/reopened
SQLite Layer over the same database file. Neither lane may retain pre-reduced
test state. Both compare the same semantic trace and authority projection;
SQLite additionally proves migration, decode/upcast, canonical order,
idempotent append, corruption handling, and exclusive writer behavior.

For the fake-provider milestone, the harness restarts Dalph and the controlled
fake executor together. Selected lanes reconstruct the same planned-attempt
responsibility without pretending that fake executor activity survived.
Independent coordinator and executor lifetimes, provider observations after
mixed survival, and the corresponding capacity reconstruction belong to
post-milestone production-executor work.

### Coverage lanes

`E` is a named exhaustive finite profile, `S` sampled Quint-connect
conformance, `P` every applicable P0–P6 conformance-test cut point through both
stores, and `R` a selected readable scenario with reviewed user-perspective
evaluation.

| Accepted behavior | Owner | Required lanes |
| --- | --- | --- |
| Authority, knowledge, history, responsibility, pause, frontier, and capacity remain distinct | M2 | E, S, P |
| Usage-shaped graph reads, proven absence, mixed-time results, and local conflicts | M2 | E, S, P, R |
| Deterministic capacity-one/two admission and responsibility-first resume | M2 | E, S, P, R |
| Intent before effect, stable retry identity, no duplicate effect, no stale authority | M1 + M2 | E, S, P |
| Eight boundaries and subject-specific finality | M2 | E, S, P |
| Crash before intent and after every durable event | M1 + M2 | E, S, P |
| Whole-run pause, passive restart, and fresh-read resume | M2 | E, S, P, R |
| Task/grouping pause, complete-attempt safe suspension, position release, and resume of the same `(RunId, AttemptId)` | M2 | E, S, P, R |
| Pause during bounded requests and all accepted safe boundaries | M2 | E, S, P, R |
| Unpause while a pause action remains in flight | M2 | E, S, P, R |
| Task edit with pause or successor-session choice | M2 | E, S, P, R |
| Lifecycle close/reopen with preserved WIP | M2 | E, S, P, R |
| External tracker success without duplicate effects | M2 | E, S, P, R |
| Claim loss, foreign claim, unreadability, and explicit reacquisition | M2 | E, S, P, R |
| Target removal/return and blockers before/after promotion | M2 | E, S, P, R |
| Compatible advance, proven rewrite, and atomic promotion race | M2 | E, S, P, R |
| Lost worktree and operator restart/stop choices | M2 | E, S, P, R |
| Missing/unreadable/replaced session and stale predecessor result | M1 deep boundary + M2 lifecycle | E, S, P, R |
| Local constraint never stops independent task C | M2 | E, S, P, R |
| Run completion requires tracker success and settled responsibilities | M2 | E, S, P, R |

No row is covered by prose alone. Each required lane needs an artifact and
passing evidence, or an explicit boundary-owned omission.

### Trace selection and user-perspective evaluation

TLC explores complete named finite profiles. Quint-connect replays a
deterministic sample. Candidate ITF traces record model commit, profile, bounds,
seed, backend, and tool versions. Selection retains shortest counterexamples,
every unique disposition, and sole witnesses; then deterministic greedy set
cover fills remaining semantic bins, with a bounded seeded reservoir per
profile. Ties use shorter durable trace, canonical action sequence, then trace
hash. A sample fails if a required bin is empty or uninterrupted success
dominates while fault bins remain uncovered.

Paired machine and readable assets live under:

```text
specs/model-scenarios/<model>/<scenario-id>.json
specs/model-scenarios/<model>/<scenario-id>.md
specs/model-scenarios/selection-manifest.json
specs/model-scenarios/evaluations/<scenario-id>/<evaluation-id>.json
```

Readable scenarios name the actor, action, and authority boundary; initial
facts; command or external change; visible behavior and preservation; next
action or wait; facts Dalph does not know; and the common-sense question. A
human validates provenance and wording before evaluation.

At least three fresh simulated evaluators use ordinary-operator,
lost-or-duplicated-work, and recovery-maintainer perspectives. They receive no
invariant name or expected verdict. Any unacceptable verdict, disagreement,
low-confidence majority, or belief that work was silently lost, duplicated,
resumed, or released requires human review. Evaluations cannot change the
expected behavior. A reviewed finding must identify scenario distortion,
adapter divergence, insufficient model abstraction, surprising canonical
policy, misleading presentation, or an assumption outside Dalph's role.

### Atomic change obligations

A behavior change updates its canonical specification, owning model, executable
adapter, selected traces and readable scenarios, and both reopening seams
together. A new workflow operation or durable event updates the closed action
map and conformance-test cut-point inventory. A changed authority result, retry
bound, capacity rule, or disposition updates its model property and negative
profile. A journal migration reruns affected SQLite conformance-test cut points
from the oldest supported event version.

The broader arbitrary generator for complete legal attempt histories remains
deferred until both adapters and the required conformance-test cut-point matrix
pass and a recorded gap proves a reducer/history shape those lanes cannot
reach.

## Acceptance Scenarios

1. With eligible A and B and capacity one, the orchestrator observes both,
   records only A's claim intent, and reconstructs responsibility only for A
   after a crash.
2. A paused responsible task keeps its position until the fake executor reports
   its complete planned attempt safely suspended; B then uses the position;
   resumed A waits without a journal event and receives responsibility-first
   admission when capacity returns.
3. Pausing grouping parent A covers descendant D but does not pause A's
   prerequisite, dependant B, sibling, or independent C.
4. Restarting a confirmed paused run performs no polling or forward progress
   until a resume or separately accepted observation policy triggers reads.
5. A crash after any boundary intent checks that boundary before repeating the
   same request with the same identity.
6. A task edit during active executor work asks the executor to safely suspend
   the planned attempt; continuing records an explicit override, restarting
   supersedes the old attempt, and stopping abandons it without generic cleanup.
7. A task closes without success and later reopens; Dalph preserves and may
   resume the same attempt when every independent constraint clears.
8. A task completes in the tracker while Dalph has WIP; Dalph preserves WIP,
   does not integrate or complete again, removes only its proven exact claim,
   and releases dependants from fresh graph facts.
9. A claim becomes foreign; Dalph stops the affected task, never edits the
   foreign record, and C continues.
10. A blocker appears before promotion; Dalph releases integration and waits.
    The prerequisite and independent work remain eligible.
11. A blocker appears after promotion; Dalph never rolls Git back, waits before
    tracker completion, then proves ancestry and completes without reintegration.
12. The target advances compatibly and work continues; an incompatible rewrite
    activates only the attempt's Git-lineage constraint.
13. The target changes between verification and promotion; the exact
    compare-and-set fails without overwrite, then candidate reconciliation runs.
14. The planned worktree disappears; Dalph records attempt-worktree-lost,
    preserves available evidence, retains the claim, and never runs automatic
    repair.
15. A provider read proves the native session unavailable; only an explicit
    command can create a successor, and a stale predecessor result cannot
    complete successor work.
16. For every local hold, isolation, or unreadable fact on A, independent task
    C continues whenever it needs none of A's facts or shared resources.
17. An empty frontier does not terminate a run while a task is paused, waiting,
    isolated, or retains unsettled responsibility.
18. Both model adapters replay every applicable P0–P6 conformance-test cut
    point through fresh in-memory and SQLite scopes and compare the same
    semantic projection.

## Out of Scope

- Implementing the reducers, test adapters, callable production seams, scenario
  converter, evaluator runner, or implementation ticket graph.
- Compatibility with or migration from the historical Ralph harness.
- Persisting a derived frontier, capacity state, reconciliation rollup, or UI
  projection as authority.
- Inferring who changed Git or provider state without an authenticated command.
- Repairing, resetting, moving, cleaning, or deleting an altered worktree.
- Configurable executor-owned review and restoration pipelines, which remain
  tracked by
  [Research configurable per-task resolution pipelines](https://github.com/dearlordylord/dalph/issues/127).

## Further Notes

The accepted decisions are owned by:

- [Model authority, observation, knowledge, and responsibility](https://github.com/dearlordylord/dalph/issues/115)
- [Specify whole-run, task, and dependency pause semantics](https://github.com/dearlordylord/dalph/issues/117)
- [Specify bounded frontier derivation, scheduling, and capacity](https://github.com/dearlordylord/dalph/issues/118)
- [Specify recovery activation and explicit durable stages](https://github.com/dearlordylord/dalph/issues/119)
- [Specify reconciliation when the world changes](https://github.com/dearlordylord/dalph/issues/120)
- [Verify duplicate intents and retry identity](https://github.com/dearlordylord/dalph/issues/121)
- [Build and check the Quint model](https://github.com/dearlordylord/dalph/issues/122)
- [Define model-based and crash/pause cut-point test coverage](https://github.com/dearlordylord/dalph/issues/123)
