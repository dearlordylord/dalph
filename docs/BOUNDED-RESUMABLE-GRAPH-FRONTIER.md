# Bounded Resumable and Pausable Graph-Frontier Specification

Status: accepted

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
| Dalph user | Authenticated pause, resume, stop, restart, override, and repair commands. |
| Dalph orchestrator | Run and operation identities, planned attempts, outer workflow selection, durable intents, normalized observations and outcomes, responsibility and disposition history. |
| Dalph executor | Its implementation algorithm, coding-agent sessions and invocations, review/restoration strategy, and internal implementation or review artifacts. |
| Task tracker | Task identity and authored work specification, lifecycle, prerequisites, grouping, target membership, and claims. |
| Git | Refs, commits, ancestry, registered worktrees, candidates, and atomic target-ref promotion facts. |
| Task-work provider | Provider-native sessions, work units or worker processes, availability, and outer invocation results exposed through the executor boundary. |
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
   into many task pauses, so that later run resume preserves independently
   paused tasks.
3. As a Dalph user, I want to pause one task and its grouping descendants while
   its prerequisites and independent branches continue, so that pause does not
   invent dependency semantics.
4. As a Dalph user, I want pause to preserve claims, worktrees, sessions, and
   unfinished work after in-flight actions reach safe boundaries, so that an
   ordinary pause is not abandonment.
5. As a Dalph user, I want resume to reread every authority needed by preserved
   work, so that stale work does not restart after the world changed.
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

One process-local capacity controller represents reserved and occupied task
admission positions. A worker occupies capacity only while a fresh provider
observation says its exact invocation consumes capacity. Paused worktrees and
sessions do not consume capacity by themselves.

### Recovery activation

Ordinary execution and restart invoke the same pure selector. Before a request
intent exists, restart recomputes the choice and may allocate a new identity.
After intent exists, every request, result check, retry, and outcome retains
that exact identity and immutable payload. The orchestrator checks the request's
destination before retrying after an outcome that may be ambiguous.

Workflow code declares the graph subjects, fact families, completeness, and
freshness required by a decision. The graph boundary decides whether existing
knowledge satisfies that request or the task tracker must be read. A successful
read contributes a graph-knowledge observation even when the normalized values
did not change.

A scheduled technical retry is a named wait with a durable wake time. An
unresolved provider invocation is immediately reconcilable and is not a
scheduled wait. Dalph owns outer operation identity, timing, correlation, and
the obligation to obtain an outer outcome; the executor owns restoration of its
internal algorithm.

### Pause and resume

The journal records distinct run-pause, run-resume, task-pause, and task-resume
commands under branded control-command identities. Reducers derive pause
phases; they do not persist `Pausing` or `Paused` status records.

A task pause covers only the selected `(RunId, TaskId)` and its current
transitive grouping descendants. It follows grouping parent-to-child edges and
never copies pause state to descendants or follows prerequisite edges. An
unfinished prerequisite blocks its dependants under ordinary tracker semantics;
it is not paused by that fact.

After a pause request, the orchestrator starts no new forward-progress action
for the covered work. An already-started bounded request completes or follows
its normal uncertain-result check. A long-running invocation is interrupted and
freshly observed. Evidence sealing already in progress finishes atomically.
Integration already holding its serialized Git resource reaches a known Git
result and releases that resource, but does not begin the separate tracker
completion request. Already-requested tracker completion is reconciled.

Confirmed pause is passive. It schedules no polling. Resume changes the desired
pause direction but does not start a worker. It triggers the fresh tracker, Git,
executor, provider, evidence, review, and integration reads required by the
preserved responsibilities. Resume requested while pausing cannot cancel an
already-sent interruption or other safe-boundary action.

### Active-task continuation and external changes

Before every new long-running invocation and before pre-promotion integration
continues, the orchestrator obtains sufficiently fresh continuation facts. An
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
| Provider proves correlated native session unavailable | Preserve its historical identity. After proving no predecessor worker can write, require an explicit command to create a successor session or choose clean restart or stop. |
| Provider session is unreadable | Perform bounded rereads; unreadability does not prove absence and cannot authorize replacement. |

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
| M2 — Graph-frontier recovery composition | Can the orchestrator traverse a bounded graph across all accepted boundaries while crash, pause, capacity, and external constraints compose without duplicate effects or branch-global blockage? | [`frontierRecovery.qnt`](../specs/frontierRecovery.qnt), [`frontierRecovery_test.qnt`](../specs/frontierRecovery_test.qnt), [`frontierRecovery_counterexamples.qnt`](../specs/frontierRecovery_counterexamples.qnt) | Tasks A–D; A prerequisite of B; D grouping child of A; independent C; checked capacity two with a required capacity-one profile; request/read bound two; bounded revisions and one crash/pause cycle. Maintained with the orchestrator control plane. |

M2 keeps frontier, pause, and reconciliation together because they share one
authority projection, workflow adapter, conformance-test reopening seam,
checking strategy, lifecycle, and maintainer. M1 remains separate because its detailed
provider correlation and three-lookup protocol would make the broad model less
tractable and obscure the focused question.

| Model | Canonical safety properties | Required checking profiles |
| --- | --- | --- |
| M1 | Request requires intent; identity, payload, and causal predecessors remain stable; only fresh authoritative absence permits a repeat; unreadability and conflict never permit creation; establishment requires one matching report; lookup bound and terminal outcome remain stable. | Deterministic decision-edge scenarios; seeded construction traces; separate exhaustive matching, absence, unreadability, conflict, and crash/restart profiles; deliberately weakened missing-intent, changed-identity/payload, unreadable-repeat, and no-matching-report profiles. |
| M2 | Capacity remains bounded; every effect has a matching earlier intent; one operation identity applies at most one authority effect; requests retain intent identity; stale observations never authorize requests; every responsibility is actionable or exactly explained; a local constraint does not stop independent C; finality remains subject-specific; frontier, pause, claim, promotion, and successor-session negative rules remain explicit. | Deterministic accepted scenarios; seeded witness traces; exhaustive all-boundary, crash, run/task pause, capacity-one, graph-conflict, reconciliation, and selected two-constraint profiles; deliberately weakened negative profiles; sampled Quint-connect conformance. |

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
| Pause and resume | Public control-command boundary; derived phases and safe-boundary actions are observed, never assigned by the driver. |
| Invocation completion or interruption | Controlled provider advancement followed by a fresh execution observation. |
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
| Task/grouping pause, interruption, capacity release, and same-session resume | M2 | E, S, P, R |
| Pause during bounded requests and all accepted safe boundaries | M2 | E, S, P, R |
| Resume while a pause action remains in flight | M2 | E, S, P, R |
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
2. A paused responsible task releases worker capacity after confirmed
   interruption; B uses it; resumed A waits without a journal event and receives
   responsibility-first admission when capacity returns.
3. Pausing grouping parent A covers descendant D but does not pause A's
   prerequisite, dependant B, sibling, or independent C.
4. Restarting a confirmed paused run performs no polling or forward progress
   until a resume or separately accepted observation policy triggers reads.
5. A crash after any boundary intent checks that boundary before repeating the
   same request with the same identity.
6. A task edit during active work stops the invocation; continuing records an
   explicit override, restarting supersedes the old attempt, and stopping
   abandons it without generic cleanup.
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
