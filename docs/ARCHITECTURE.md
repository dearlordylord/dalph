# Dalph Tooling Architecture

This document is the map of Dalph's stable architecture. It shows how the
major parts relate and points to the documents that own detailed protocols.
It does not duplicate target-repository rules, operational scenarios, provider
limits, implementation status, or the issue roadmap.

Canonical domain language lives in [CONTEXT.md](CONTEXT.md). Chronological
behavior lives under [scenarios/](scenarios/), and accepted design decisions
live under [adr/](adr/).

## Governing Composition

Before delivery is constructed, one application entry establishes the exact
Run from the Journal. Absent history causes one beginning to be appended using
a lazily evaluated initial policy; existing history is validated and reduced
to the same target, latest policy, and exact responsibilities. The established
state then feeds one bounded Run activation. The caller does not select a
separate restoration startup.

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
or Run termination. That quiescent condition does not prove a terminal result.
The later observation may reveal new work, prove `Completed` or `Blocked`
together with settled obligations and empty live ownership, classify a settled
Operator cancellation, or leave an incomplete Run recoverable after the
current invocation returns. V1 final dispositions are `Completed`, `Blocked`,
and `Cancelled`; `Failed` requires a separately accepted conclusive Run-failure
protocol.

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
| Ticket deliveries become established settlement facts | `deliverySettlements` | ticket-delivery relation | established Integrator, Git qualification, promotion, cleanup, and disposition evidence | `DeliverySettlementRelation` | description | [`relations.ts`](../packages/orchestrator/src/coordination/delivery/relations.ts) |
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
- **Establishment** reads exact Run history, appends the beginning only when
  history is absent, validates complete history, and reconstructs the state
  required by activation.
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
authored cassettes do not branch on an environment mode. A transition that
starts new task work and one that reconciles an earlier uncertain request may
still call different named action protocols, but Run initialization is one
idempotent establishment path. Every successfully established Run provides the
same ordinary delivery, planning, runtime, and stabilization interfaces.

## Authority and Reconciliation

| System | Facts it owns | What Dalph may retain |
| --- | --- | --- |
| Task tracker | task identity, authored instructions, lifecycle, dependencies, grouping, target membership, and claims | journaled observations and current process-local projections |
| Git | commits, lineage, refs, worktrees, and integration state | exact planned locators, journaled intents and observations, and current process-local projections |
| Dalph executor | complete work for one planned attempt and its normalized running, safely suspended, or terminal report | exact planned-attempt correlation and journaled responsibility/report facts |
| Execution substrate | agent session/context and process observations used internally by an executor | only observations exposed through an accepted executor protocol; no copied session state as authority |
| Integrator | one exact resumable integration session, including merge construction, conflict resolution, repository checks, review, and provider-private recovery | exact session correlation, its prepared-candidate or conclusive unsuccessful report, and referenced evidence |
| Evidence store | immutable bytes addressed by their content digest | exact references in workflow-journal evidence-bearing events; never copied derived frontier or lock state |
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

Integration-finality policy owns completion-claim cleanup across tracker
providers. After a fresh focused success, it uses the generic task-claim
release protocol to observe and release the exact original active claim, then
rereads the exact completion marker, rereads the current active record to prove
it is still absent, and deletes the exact marker last. After observing that the
marker is absent, it rereads the current active record again before recording
deletion or settlement; the earlier release history and pre-delete reread
cannot prove current absence after that boundary. Provider adapters translate
those two typed mutations and independent reads; they do not decide their
order, infer success from an acknowledgement, or repair a foreign replacement.

Issue #69 materializes three separate cleanup authority modules: planned-attempt
worktree disposal, planned branch disposal gated by settled worktree removal,
and quarantined Integrator predecessor-candidate disposal. Each module has its
own authorization, fresh observation, mutation intent/result, contradiction,
and settlement events. No generic cleanup stage or reusable delete approval is
shared across them. The existing subject-scoped Quint models cannot faithfully
cover these distinct authority families; focused/property, cassette, and
memory/SQLite prefix evidence is therefore the executable coverage.

## Durability and Reconstruction

Dalph persists workflow history, not a serialized coordinator. On every Run
entry it establishes the exact Run idempotently: absent history receives one
beginning; existing history is validated in full and reduced to the latest
policy and exact outstanding responsibilities. It then obtains current
evidence from each owning seam wherever the accepted protocol provides and
requires that observation. The planned-attempt executor is injected at the
application boundary. After process loss, Dalph asks it only for the normalized
current report for the exact `(RunId, AttemptId)`; it does not inspect or
reconstruct implementation-private stages, and no report preserves the
outstanding responsibility.

Task-work positions are reconstructed from exact unfinished responsibilities
before the activation admits new work. The position map itself does not
survive. A newly begun and an already existing Run then use the same bounded
activation and finality path.

Intent is recorded before an effect whose outcome could become ambiguous.
After a lost response or crash, the ordinary protocol reconciles the recorded
intent with the system that owns the result before retrying. Invalid shared
journal history fails the affected Run closed. A contradiction local to one
task, attempt, or resource prevents action only in the region that needs that
fact when independent regions can still proceed safely.

The detailed establishment, journal publication, reduction, crash, and
reconstruction rules are in
[Journal and Reconstruction](architecture/journal-and-reconstruction.md).

## Exclusive Coordinator Lock

At most one live Dalph coordinator may send state-changing requests for one
canonical Git common directory. It holds an operating-system lock on that
directory and verifies ownership before each such request. Losing or
contradicting ownership interrupts the in-flight request and rejects later
ones. Process-local semaphores, journal rows, stale-file timeouts, and leases
are not substitutes for this local-host exclusion rule.

Filesystem qualification and lifecycle details are in
[Coordinator, Control, and Admission](architecture/coordinator-control-and-admission.md).
The local ownership interval and its distinction from remote latency are in
[Control-plane latency and responsiveness budgets](architecture/control-plane-latency-and-responsiveness.md).

## Graceful Application Exit

An Operator command or process-supervisor signal enters one transport-neutral
application-lifecycle protocol at the application shell. Accepting Exit
atomically closes process-wide forward-progress admission. V1 contains at most
one activated unfinished Run; discovery of several still fails closed before
activation.

Dalph then spends at most five seconds asking the executor only to suspend the
exact planned attempt, performing the suspension intent and report writes
required by that protocol, acknowledging already-produced journal writes, and
releasing process-local resources. Generic Dalph does not ask the executor to
start or continue work, wait for terminal completion, start fresh
reconciliation or stabilization, or dispose a durable workflow resource. An
exact safe-or-terminal executor report is required before releasing that
attempt's task-work position. How an executor implementation handles its
suspension request remains behind the executor boundary. An interruptible
tracker or ordinary Git workflow call may instead leave a recoverable ambiguity
behind its acknowledged intent. An admitted Integrator call and target
promotion are separately classified atomic integration actions: one admitted
action may finish only inside the original drain, then releases its local owner
without admitting a successor. Its existing protocol intent remains the basis
for ordinary restart reconciliation if the process deadline wins.

Exit request, result, failure, timeout, signal, and process death are
application-lifecycle facts outside every Run workflow journal. Success requires
no live action owner, unsafe executor, unacknowledged produced journal write,
reservation, fiber, or held coordinator lock. A conclusive failure force-terminates after
the remaining useful quick work settles; a drain still unresolved at five
seconds force-terminates nonzero. Restart restores no Exit mode or timer and
uses ordinary Run establishment and owning-boundary reconciliation.

The accepted chronology is in
[issue-169-graceful-application-exit.md](scenarios/issue-169-graceful-application-exit.md),
the exact model/test mapping is in
[issue-203-application-exit-model-mapping.md](scenarios/issue-203-application-exit-model-mapping.md),
the corrected outer-Integrator boundary mapping is in
[issue-224-outer-integrator-application-exit.md](scenarios/issue-224-outer-integrator-application-exit.md),
and the durable-boundary trade-off is recorded in
[ADR 0013](adr/0013-bound-graceful-application-exit.md).
The five-second local drain boundary and its separation from executor and
tracker latency are listed in the
[control-plane budget map](architecture/control-plane-latency-and-responsiveness.md).

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

## Run Task Graph

One Run root task starts each complete Run task graph read. Grouping edges are
followed downward from the root and its grouping descendants. Dependency edges
add every transitive supporting prerequisite needed to evaluate or complete
included work. Grouping children of a supporting prerequisite remain outside
the graph unless an explicit prerequisite edge also reaches them.

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

When an activation ends after responsibility is durable but before the next
executor report, the next activation reconstructs that exact responsibility
through the ordinary Run entry. It rereads current tracker facts and the exact
planned worktree through their journaled protocols, then records one generic
continuation authorization naming those observations before executor contact.
The authorization is an internal non-projected fact: it does not become a
recovery occurrence, replacement attempt, or new executor identity. A typed
cassette lifecycle control may dispose the activation at that same boundary,
but it is not part of this production event vocabulary.

## Accepted-Result Integration Admission

An accepted executor result does not complete its tracker task. Dalph first
establishes a durable integration obligation. Runtime serializes work for the
same repository/ref target separately from task-work capacity. Integration
uses a session and candidate resource distinct from the task worktree. Dalph
gives the exact integration-ready result and target facts to one injected
Integrator. The Integrator owns merge construction, conflict resolution,
repository checks, review, and provider-private retry or recovery. Dalph does
not model or invoke those internal stages separately.

When the Integrator reports one prepared candidate M, Dalph asks Git to prove
that M has exact ordered parents `[H, C]`. Only that Git-qualified report may
reach target promotion. A conclusive unsuccessful report or an invalid
reported candidate enters the #68 quarantine and operator-direction protocol.

See [Attempt Delivery and Integration](architecture/attempt-delivery-and-integration.md),
[issue-56-queue-accepted-integration.md](scenarios/issue-56-queue-accepted-integration.md),
and [issue #222](https://github.com/dearlordylord/dalph/issues/222). The
historical issue-57 and issue-59 scenarios predate this boundary correction and
are not current acceptance authority.

## Formal Model and Executable Scenarios

Quint models and executable TypeScript scenarios verify the protocol slices
they name. They do not extend the production domain or prove behavior outside
their stated model boundary. The final relevant change runs `pnpm check:quint`;
ordinary repository verification runs `pnpm check:all`.

Current model boundaries include
[`plannedAttemptExecutor.qnt`](../specs/plannedAttemptExecutor.qnt) and
[`acceptedResultIntegration.qnt`](../specs/acceptedResultIntegration.qnt), and
the process-local lifecycle decisions in
[`applicationExit.qnt`](../specs/applicationExit.qnt).

[QUINT-GUIDE.md](QUINT-GUIDE.md) covers how to write a model here: guard and
invariant conventions, the places Quint fails silently, and where these models
depart from the community knowledge base.

## Detailed Architecture Index

| Group | Owns |
| --- | --- |
| [Journal and Reconstruction](architecture/journal-and-reconstruction.md) | Run establishment, journal publication, reduction, later-activation reconstruction, responsibility reconstruction, and failure locality |
| [Coordinator, Control, and Admission](architecture/coordinator-control-and-admission.md) | exclusive coordinator ownership, Run establishment and activation, pause, frontier/admission separation, capacity, waits, and stabilization |
| [Tracker Graph and Claims](architecture/tracker-graph-and-claims.md) | tracker closure, observation evidence, GitHub consistency limits, named reads, mutations, and claims |
| [Attempt Delivery and Integration](architecture/attempt-delivery-and-integration.md) | immutable attempts, Git worktree reconciliation, executor boundary, integration serialization, outer Integrator, Git qualification, and exact-head promotion |
| [Control-plane latency and responsiveness](architecture/control-plane-latency-and-responsiveness.md) | tracker freshness, local derivation, admission, executor observation, local ownership contradiction, application drain, and recovery timing policy |
| [CONTEXT.md](CONTEXT.md) | canonical domain vocabulary |
| [scenarios/](scenarios/) | chronological behavior and acceptance-test mappings |
| [adr/](adr/) | accepted design decisions and their trade-offs |
| [research/](../research/) | investigation and evidence, not accepted architecture by itself |

The configured tracker owns roadmap and implementation status. This document
and its grouped architecture pages state stable structure and invariants only.
