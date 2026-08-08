# Dalph Tooling Architecture

This document is the map of Dalph's stable architecture. It shows how the
major parts relate and points to the documents that own detailed protocols.
It does not duplicate target-repository rules, operational scenarios, provider
limits, implementation status, or the issue roadmap.

Canonical domain language lives in [CONTEXT.md](CONTEXT.md). Chronological
behavior lives under [scenarios/](scenarios/), and accepted design decisions
live under [adr/](adr/).

## Governing Composition

Dalph treats the tracker graph as a current signal. Delivery projects that
signal into a frontier, bounded tickets, responsibility-aware ticket delivery,
settlement, and the tracker consequences implied by settlement.

```ts
export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  return yield* reflectDeliverySettlements(settlements)
})
```

Every line above is descriptive. Reading or subscribing to the returned
current signal performs no tracker, Git, executor, or journal action.

Downstream planning code derives action proposals from delivery
consequences and other established facts. Runtime code owns admission,
process-local action ownership, fibers, interruption, and repetition. The
named action protocol records intent when required, calls the tracker, Git, or
executor, observes the result, and records the resulting workflow fact.
Journal publication changes the ordinary input signals, so description and
planning derive their next values without a general invalidation command.

Run stabilization sits above description, planning, and live action ownership.
After no action is executable and no admitted action is still running, it must
obtain a later complete tracker observation before either an incomplete return
or normal termination. That quiescent condition does not prove completion. The
later observation may reveal new work, help prove normal termination together
with settled obligations and empty live ownership, or leave an incomplete Run
recoverable after the current invocation returns.

The governing design and chronology are specified by
[issue 190](https://github.com/dearlordylord/dalph/issues/190). GitHub owns
implementation status; this document records the architecture rather than
mirroring ticket state.

This section states that governing destination. During the #191–#195 migration,
temporary runtime-relation, revision, invalidation, quiescence-probe, and
environment-named seams may still exist in source. They are implementation
gaps, not alternate architecture.

## Protected Compositions

The following Effects are the readable account of delivery at their respective
abstraction levels. Their visible composition is priority-one architecture,
not incidental glue.

| Stable meaning | Current exported symbol | Visible argument | Other established input | Result | Colour | Source |
| --- | --- | --- | --- | --- | --- | --- |
| Current graph becomes coherent delivery consequences | `delivery` | none | current tracker graph, Run policy, exact obligations/current evidence, and established settlement evidence | `CurrentSignal<DeliveryConsequences>` | description | [`delivery.ts`](../packages/orchestrator/src/coordination/delivery/delivery.ts) |
| Current frontier is viewed through current Run policy | `boundedParallelTickets` | current delivery frontier | current Run control policy | current bounded parallel tickets | description | [`relations.ts`](../packages/orchestrator/src/coordination/delivery/relations.ts) |
| Bounded placements and exact obligations become ticket deliveries | `executorResponsibilities` | current bounded parallel tickets | established exact obligations and their current evidence | `TicketDeliveryRelation` | description | [`relations.ts`](../packages/orchestrator/src/coordination/delivery/relations.ts) |
| Ticket deliveries become established settlement facts | `deliverySettlements` | ticket-delivery relation | established integration, verification, promotion, cleanup, and disposition evidence | `DeliverySettlementRelation` | description | [`relations.ts`](../packages/orchestrator/src/coordination/delivery/relations.ts) |
| Settlement facts become coherent tracker-reflection meaning | `reflectDeliverySettlements` | delivery-settlement relation | none | `CurrentSignal<DeliveryConsequences>` with semantic tracker consequences, never executable proposals | description | [`relations.ts`](../packages/orchestrator/src/coordination/delivery/relations.ts) |
| Current delivery consequences and accepted action requirements become one checked proposal frontier | `deliveryActionPlanning` | current delivery consequences | named tracker-graph, ticket-delivery, settlement/integration, and tracker-reflection requirements | `CurrentSignal<DeliveryProposalFrontier>` | planning | [`delivery-action-planning.ts`](../packages/orchestrator/src/coordination/delivery/delivery-action-planning.ts) |

The five delivery compositions and the downstream planning composition are
indexed by stable meaning, current exported symbol, and source file.
`executorResponsibilities` is the current source locator; its returned domain
value is broader `TicketDelivery`, not proof that an executor responsibility
already began. A separately approved vocabulary change updates the index
without changing the stable semantic step.

Any change to the visible steps, order, semantic inputs, result meaning, or
colour of these compositions requires explicit project-owner approval, an
approved scenario or design amendment when behavior changes, and an updated
architecture guard. The current exact source guard is in
[`delivery.test.ts`](../packages/orchestrator/src/coordination/delivery/delivery.test.ts);
extending that guard to all indexed compositions is allowed without changing
their source.

## Function Colours and Composition

A function colour identifies obligations that must not be hidden inside a
higher-level description:

- **Description** derives immutable values or current signals without changing
  an owning system.
- **Planning** derives exact proposed actions, order, conflicts, isolation, and
  resource requirements without performing them or allocating identities.
- **Reconciliation** rereads the system that owns a fact before deciding
  whether an earlier request may be continued or repeated.
- **Action** records intent when required, crosses one external seam, observes
  the result, and records the established workflow fact.
- **Runtime** owns subscriptions, bounded admission, process-local ownership,
  fibers, interruption, wake-up, and repetition.
- **Stabilization** obtains the required later complete tracker observation
  after quiescence, then decides whether the invocation returns or records Run
  termination.

A clean composition remains at one colour and one abstraction level until a
different obligation is unavoidable. It then calls a named lower composition
whose interface describes that change. Authority ambiguity, retry ordering,
resource ownership, and cleanup remain explicit inside the module that owns
them; declarative presentation does not erase those protocols.

Effect services and Layers provide these seams. Controlled, test, and external
adapters are selected when the program is assembled. Shared domain code and
authored cassettes do not branch on an environment mode. Fresh and recovered
initialization remain distinct because they establish different Run facts,
then provide the same ordinary delivery, planning, runtime, and stabilization
interfaces.

## Authority and Reconciliation

| System | Facts it owns | What Dalph may retain |
| --- | --- | --- |
| Task tracker | task identity, authored instructions, lifecycle, dependencies, grouping, target membership, and claims | journaled observations and current process-local projections |
| Git | commits, lineage, refs, worktrees, and integration state | exact planned locators, journaled intents and observations, and current process-local projections |
| Dalph executor | complete work for one planned attempt and its normalized running, safely suspended, or terminal report | exact planned-attempt correlation and journaled responsibility/report facts |
| Execution substrate | agent session/context and process observations used internally by an executor | only observations exposed through an accepted executor protocol; no copied session state as authority |
| Integration-candidate agent | its separately identified candidate-construction session and reports | journaled candidate intent, exact session correlation, and submitted candidate evidence |
| Target repository verification wrapper | one exact request's guarded checks, terminal result, diagnostics, and heavy-lock lifecycle | journaled request intent plus content-addressed artifacts and the sealed manifest after complete rereads |
| Evidence store | immutable bytes addressed by their content digest | exact references in workflow-journal verification events; never copied derived frontier or lock state |
| Dalph Journal | ordered workflow occurrences recorded by Dalph | the workflow history itself |

Dalph does not turn a copied external fact into authority. After an ambiguous
request or process loss, it reads the system that owns the result before it
repeats the request. A tracker mutation result may update the current graph
view when it contains enough normalized coverage, completeness, consistency,
freshness, and replacement evidence to satisfy the same named contract as a
tracker observation. A bare acknowledgement that a mutation was accepted or
applied is not enough.

Derived frontiers, bounded tickets, ticket deliveries, settlements, proposed
actions, stream positions, wakeups, capacity positions, and live action owners
remain process-local. They can be rebuilt from journal history and current
authority observations and are not persisted as substitutes for those facts.

Cleanup for every owned resource is disposition-typed, exact, recoverable, and
fail-closed.

## Durability and Reconstruction

Dalph persists workflow history, not a serialized coordinator. On restart it
validates each Run's complete journal history, reconstructs exact outstanding
responsibilities through pure composed reducers, and obtains current evidence
from each owning seam wherever the accepted protocol provides and requires that
observation. The current same-process executor is recreated
rather than inspected after process loss.

Intent is recorded before an effect whose outcome could become ambiguous.
After a lost response or crash, the ordinary protocol reconciles the recorded
intent with the system that owns the result before retrying. Invalid shared
journal history fails the affected Run closed. A contradiction local to one
task, attempt, or resource prevents action only in the region that needs that
fact when independent regions can still proceed safely.

The detailed journal, publication, reduction, crash, and reconstruction rules
are in [Journal and Reconstruction](architecture/journal-and-reconstruction.md).

## Exclusive Coordinator Lock

At most one live Dalph coordinator may send state-changing requests for one
canonical Git common directory. It holds an operating-system lock on that
directory and verifies ownership before each such request. Losing or
contradicting ownership interrupts the in-flight request and rejects later
ones. Process-local semaphores, journal rows, stale-file timeouts, and leases
are not substitutes for this local-host exclusion rule.

Filesystem qualification and lifecycle details are in
[Coordinator, Control, and Admission](architecture/coordinator-control-and-admission.md).

## Workflow Commands, Actions, Occurrences, and Events

A proposed action is not proof that anything happened. A workflow event is the
immutable domain value for one past-tense occurrence; a journal record is its
durable envelope. An initiated action names its actor. A non-action occurrence,
such as receiving tracker facts or an executor report, does not copy the actor
from an earlier action.

Every event exposed to a generic production consumer has exactly one
runtime-visible action/non-action classification. Adding an actor or event
variant must break exhaustive consumers until they handle it. Presentation
must not infer this classification from an operation name, transition name,
button label, test source, or environment. A dying coordinator cannot record
its own death; recovery accepts every retained journal prefix without a
fabricated crash event.

The canonical vocabulary is in [CONTEXT.md](CONTEXT.md), and concrete projection
rules are in
[workflow-occurrence-projection.md](scenarios/workflow-occurrence-projection.md).

## Historical-Harness Boundary

Dalph is a graph-native orchestrator. It does not invoke, resume, migrate, or
preserve behavioral parity with `scripts/ralph-run.sh`. The historical harness
is research evidence only; a behavior becomes Dalph architecture only through
an accepted decision or scenario.

## Pause, Unpause, and Resumption

Pause prevents later forward progress after an already-sent bounded request
reaches its ordinary protocol boundary. It does not erase claims, attempts,
worktrees, executor obligations, or integration obligations. Unpause causes
the required current facts to be read before progress resumes. Run Pause and
task Pause are separate journaled directions; task Pause follows current
tracker grouping descendants rather than dependency edges.

Detailed behavior lives in [ADR 0008](adr/0008-derive-run-scoped-pause-state.md),
[Run Pause scenarios](scenarios/issue-134-pause-whole-run.md), and
[task Pause scenarios](scenarios/issue-135-pause-task-grouping-descendants.md).

## Frontier Derivation, Scheduling, and Capacity

The delivery frontier is a graph-only description. Bounded parallel tickets
apply current Run policy without starting work or proving that a task owns a
runtime position. Existing exact obligations remain visible even when their
tasks are closed, removed, blocked, or outside the current bound.

Planning describes proposed actions and their resource requirements. Runtime
admits them, allocates fresh identities only after admission, and owns the
positions while the accepted protocol requires them. Capacity contraction is
non-preemptive. Integration uses a separately serialized resource.

Wait, pause, isolation, relinquishment, and settlement are different domain
conditions. An empty proposal frontier proves only that no action can start
now; it does not prove that the Run completed.

Detailed rules live in
[Coordinator, Control, and Admission](architecture/coordinator-control-and-admission.md)
and [ADR 0009](adr/0009-separate-frontier-from-bounded-admission.md).

## Tracker Target Closure

Grouping chooses target membership. Dependency edges extend that membership
only far enough to include every transitive prerequisite needed to evaluate a
selected task. Grouping children of a prerequisite-only task remain outside
the closure unless the target also selects them.

## Task-Tracker Observation Consistency

The tracker adapter returns a complete normalized observation for its declared
read shape or a typed failure. Each observation states its subjects, covered
fact families, completeness, consistency, freshness, and content identity.
Missing coverage never proves that a blocker or task is absent. Incomparable
facts remain an explicit conflict until a later observation resolves them.

Provider-neutral and GitHub-specific rules are in
[Tracker Graph and Claims](architecture/tracker-graph-and-claims.md).

## GitHub Task Claims

The configured tracker owns claims. Dalph records its exact claim intent before
asking GitHub to create the repository label used as the claim record. After an
unknown result or restart it rereads that exact record before repeating or
releasing anything.

The label representation and provider limits are in
[Tracker Graph and Claims](architecture/tracker-graph-and-claims.md); recovery
chronology is in
[issue-137-reconcile-task-claims.md](scenarios/issue-137-reconcile-task-claims.md).

## Durable Task-Attempt Planning

One immutable planned task attempt binds the Run, task revision, Attempt ID,
exact Base SHA, branch, worktree path, and executor locator before Dalph asks
Git or the executor to act. A later attempt requires an explicit outcome that
authorizes it; changing an operation identity cannot replace a plan.

See [ADR 0002](adr/0002-planned-task-attempt-admission.md) and
[Attempt Delivery and Integration](architecture/attempt-delivery-and-integration.md).

## Exact Git Worktree Reconciliation

Normal execution and recovery use the same read-after-request protocol. Dalph
continues only after Git proves that the exact planned path, branch, current
`HEAD`, and declared Base have the required relationship. A contradiction
preserves the observed resources and fails closed; this protocol does not
repair, reset, prune, move, clean, or delete them.

See [Attempt Delivery and Integration](architecture/attempt-delivery-and-integration.md)
and [issue-139-reconcile-git-facts.md](scenarios/issue-139-reconcile-git-facts.md).

## Planned-Attempt Executor Boundary

The executor performs the complete work for one exact planned attempt and
reports `Running`, `SafelySuspended`, or a terminal result using the same
`RunId` and `AttemptId`. Safe suspension and terminal results prove that no
executor-owned activity for that attempt remains running. Coding-agent,
reviewer, retry, handback, and session-restoration stages remain internal to a
future production executor design.

The current controlled executor shares Dalph's process lifetime; it does not
prove adoption of an independently surviving production session. See
[planned-attempt-executor-boundary.md](scenarios/planned-attempt-executor-boundary.md)
and [Attempt Delivery and Integration](architecture/attempt-delivery-and-integration.md).

## Accepted-Result Integration Admission

An accepted executor result does not complete its tracker task. Dalph first
establishes a durable integration obligation. Runtime serializes work for the
same repository/ref target separately from task-work capacity. Integration
uses a candidate resource distinct from the task worktree and must establish
the exact accepted-head protocol before tracker completion or cleanup can be
settled. After Git proves the exact two-parent candidate, Dalph reacquires the
same-target process-local position, obtains current tracker and target-lineage
facts, and invokes only the configured public verification wrapper. The
wrapper owns its heavy lock. Dalph records one deterministic request intent,
stores and rereads immutable evidence, and records a sealed terminal manifest.
A non-passing terminal preserves the candidate and blocks promotion; a sealed
passing manifest is only a premise for the later promotion protocol.

See [Attempt Delivery and Integration](architecture/attempt-delivery-and-integration.md),
[issue-56-queue-accepted-integration.md](scenarios/issue-56-queue-accepted-integration.md),
and
[issue-57-build-two-parent-integration-candidate.md](scenarios/issue-57-build-two-parent-integration-candidate.md).
The verification continuation is specified by
[issue-59-run-target-verification.md](scenarios/issue-59-run-target-verification.md).

## Formal Model and Executable Scenarios

Quint models and executable TypeScript scenarios verify the protocol slices
they name. They do not extend the production domain or prove behavior outside
their stated model boundary. The final relevant change runs `pnpm check:quint`;
ordinary repository verification runs `pnpm check:all`.

Current model boundaries include
[`plannedAttemptExecutor.qnt`](../specs/plannedAttemptExecutor.qnt) and
[`acceptedResultIntegration.qnt`](../specs/acceptedResultIntegration.qnt).

[QUINT-GUIDE.md](QUINT-GUIDE.md) covers how to write a model here: guard and
invariant conventions, the places Quint fails silently, and where these models
depart from the community knowledge base.

## Detailed Architecture Index

| Group | Owns |
| --- | --- |
| [Journal and Reconstruction](architecture/journal-and-reconstruction.md) | journal publication, reduction, recovery, responsibility reconstruction, and failure locality |
| [Coordinator, Control, and Admission](architecture/coordinator-control-and-admission.md) | exclusive coordinator ownership, Run lifecycle, pause, frontier/admission separation, capacity, waits, and stabilization |
| [Tracker Graph and Claims](architecture/tracker-graph-and-claims.md) | tracker closure, observation evidence, GitHub consistency limits, named reads, mutations, and claims |
| [Attempt Delivery and Integration](architecture/attempt-delivery-and-integration.md) | immutable attempts, Git worktree reconciliation, executor boundary, integration serialization, and candidate construction |
| [CONTEXT.md](CONTEXT.md) | canonical domain vocabulary |
| [scenarios/](scenarios/) | chronological behavior and acceptance-test mappings |
| [adr/](adr/) | accepted design decisions and their trade-offs |
| [research/](../research/) | investigation and evidence, not accepted architecture by itself |

The configured tracker owns roadmap and implementation status. This document
and its grouped architecture pages state stable structure and invariants only.
