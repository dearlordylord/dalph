# Flat delivery Effect: production gap audit

Status: current source-backed correction to the production-integration plan.
This document changes no Dalph runtime behavior and creates no implementation
ticket.

Audited sources:

- prototype commit `dc69e6cbf`, especially
  `prototypes/attempt-control-reducer/src/delivery.ts` and `DESIGN-NOTES.md`;
- production `master` at `e28b0da1e`, whose delivery cutover is commit
  `3997fff9c`;
- [specification #174](https://github.com/dearlordylord/dalph/issues/174),
  [decision #177](./issue-177-responsibility-composition-decision.md), and
  paused [ticket #178](https://github.com/dearlordylord/dalph/issues/178).

Evidence labels below are deliberate:

- **Source fact**: production or prototype source directly establishes it.
- **Accepted rule**: checked-in architecture, ADR, or accepted scenario states
  it.
- **Inference**: proposed architecture derived from those facts; it is not
  implemented behavior.

## The fixed acceptance artifact

Production is meant to converge on this literal, flat Effect—not merely on a
single activation loop with similar behavior:

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

The exact domain names and lower data shapes may still improve, but planning
must display proposed changes against these seven visible relationships. A
runtime refactor that cannot show how it makes one of these lines real is not
progress toward this architecture.

**Source fact.** The prototype already contains this exact outer composition
and four named lower compositions: `boundedParallelTickets`,
`executorResponsibilities`, `deliverySettlements`, and
`reflectDeliverySettlements` (prototype `delivery.ts`, lines 651–765).

## Why the previous plan failed

**Source fact.** #174 explicitly put both a `CurrentSignal` contract and the
complete outer delivery-settlement loop out of scope. It asked for one
immutable frame per activation turn and one shared fresh/recovered activation
coordinator instead. Commit `3997fff9c` implemented that scope: fresh and
recovered transitions now share `runDeliveryActivation`, while
`readDeliveryActivationTurn`, `runTurn`, queues, refs, finality, and graph
refresh remain assembled in one large runtime-coloured function
([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L64)).

**Inference.** The implementation did not accidentally miss its specification;
the specification replaced the intended acceptance artifact with a narrower
one. #177 then correctly audited that narrower implementation and #178
correctly targeted its hidden provenance lookup, but neither could recover the
flat delivery Effect because neither was asked to produce it.

The earlier recommendation in
[Delivery-story production integration](./delivery-story-production-integration.md)
to postpone the outer story until every settlement protocol exists is therefore
superseded. Missing lower behavior must be represented honestly behind the
story boundary; it must not erase the governing composition.

## Line-by-line production gap

| Required line | Current production source fact | Actual gap |
|---|---|---|
| `yield* TrackerGraphRelation` | `CurrentDeliveryRelation` is constructed locally inside `runDeliveryActivation`; journaled mode folds accepted history into a private `Ref`, and synthetic mode stores a graph and facts in another private `Ref` ([current-delivery-relation.ts](../packages/orchestrator/src/coordination/run/current-delivery-relation.ts#L58)). | There is no production service representing the current graph relation at the outer story boundary. Construction, startup mode, refresh, and consumption are entangled with the run loop. |
| `trackerGraph.signal` | Production exposes a one-shot `read` Effect. Explicit completion handling calls `refreshAcceptedHistory`; quiescence performs another tracker read and then refreshes the relation ([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L176), [run.ts](../packages/orchestrator/src/coordination/run/run.ts#L238)). | There is no current-value signal whose first value is freshly reconstructed and whose later values cover every accepted update without a subscription gap. The current code is reactive only because an imperative loop knows when to reread it. |
| `mapCurrentSignal(graph, frontierOf)` | Production derives fresh decisions from a `CurrentDeliveryFrame`, independently asks recovery for a responsibility-aware frontier, then merges the two and gives fresh work per-task precedence ([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L137)). | There is no single graph-to-frontier projection visible at this level. Production's richer responsibility and pause rules must be preserved behind lower composition; they cannot be silently reduced to lifecycle and prerequisites. |
| `boundedParallelTickets(frontier)` | The activation coordinator repeatedly filters live owners and asks `TaskAdmissionController` to reserve the first allowed transition. Existing responsibility is ordered before fresh work, and zero/one task positions remain process-local ([coordinator.ts](../packages/orchestrator/src/coordination/activation/coordinator.ts#L398), [ADR 0009](../docs/adr/0009-separate-frontier-from-bounded-admission.md)). | Admission exists, but only as runtime plumbing over `RunnableFrontierTransition`; there is no story-shaped bounded-ticket relation. Its production meaning must distinguish desired bounded fresh tickets from already-existing obligations and from actual runtime ownership. |
| `executorResponsibilities(tickets)` | Journal reducers reconstruct responsibility per exact operation/resource subject, and planned-attempt executor-work responsibility begins only at the executor protocol boundary ([ADR 0005](../docs/adr/0005-track-workflow-responsibility-per-subject.md), [executor protocol](../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.ts#L30)). Production has no one relation saying that every selected ticket remains an executor-delivery responsibility from pre-attempt preparation through integration, cleanup, and tracker reflection. | This is the largest semantic gap. The story-level relation is broader than `PlannedAttemptExecutorWorkResponsibility`: it includes the selected ticket before an Attempt exists, every still-outstanding exact lower responsibility, and post-executor delivery obligations until the graph reflects settlement. It must compose desired tickets, existing lifecycle evidence, graph negative space, responsibility-first ordering, admission positions, and typed actions without pretending that a projection appended a durable journal fact. |
| `deliverySettlements(responsibilities)` | Production queues accepted executor results, serializes integration by target, crosses an integration-start cutoff, and constructs an integration candidate ([integration frontier](../packages/orchestrator/src/coordination/frontier/integration-frontier.ts#L61), [integration runtime](../packages/orchestrator/src/coordination/run/integration-transition-runtime.ts#L19)). Verification, promotion, final cleanup/disposition, and established end-to-end settlement are not implemented. | The story boundary is absent because its lifecycle is incomplete. The correct placeholder is an honest current relation containing zero established settlements while outstanding responsibilities continue through implemented lower protocols—not a fabricated success and not omission of this line. |
| `reflectDeliverySettlements(settlements)` | Production performs quiescent graph refresh and observes tracker completion performed elsewhere. Executor completion and candidate construction do not mutate the tracker task to completed ([issue 53 scenarios](../docs/scenarios/issue-53-refresh-complete-task-pipelines.md), [issue 56 scenarios](../docs/scenarios/issue-56-queue-accepted-integration.md)). | There is no settlement-to-tracker reflection composition. It can be wired now with an exhaustive projection whose current implemented settlement set produces no mutation requests; later accepted settlement variants add explicit tracker protocols behind the same boundary. |
| `return yield* ...` | The prototype reflection consumes a long-lived signal and returns `void`. Production `runDeliveryActivation` instead decides `RunFinalityDecision`; `runWorkflow` and `runRecoveredWorkflow` use that result to decide whether to append Run termination ([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L351), [run.ts](../packages/orchestrator/src/coordination/run/run.ts#L390)). | The outer Effect's lifetime and result are unresolved. Planning must decide whether reflection returns finality or a runtime-coloured wrapper derives finality after the flat story reaches quiescence. It cannot silently drop finality or bury another delivery loop beside the story. |

## The composed stories and their colours

The prototype has four lower stories, not merely three. They are the first
composition boundaries that the production design must preserve.

| Composition | Visible reading | Colour at this level | Hidden lower colours |
|---|---|---|---|
| `boundedParallelTickets` | current frontier + current policy → checked desired tickets | **Projection** | Runtime may maintain current policy and recompute on either input; no tracker, Git, journal, or executor mutation belongs here. |
| `executorResponsibilities` | desired ticket placements + existing whole-delivery responsibilities → exhaustive situations → reconciled whole-delivery responsibilities | **Projection, then reconciliation** | Exact per-subject journal responsibilities, authority rereads, intent recording, workflow actions, admission ownership, attempt control, and process-local concurrency are lower evidence and mechanics. The visible relation spans selection through final graph reflection. |
| `deliverySettlements` | reconciled responsibilities → established delivery facts | **Reconciliation** | Serialized integration, candidate verification, accepted-head promotion, exact cleanup/disposition, journal intent/observation, and retry live behind this boundary. |
| `reflectDeliverySettlements` | established delivery facts → tracker reflection | **Projection, then action** | The settlement-to-request mapping is pure; intent, tracker mutation, observation, and reconcile-before-retry are action-coloured. |

The outer `delivery` Effect is composition code: it stays flat by crossing a
colour only through one of these named lower stories. Runtime-coloured code
owns signal subscription lifetime, coalescing, bounded fibers, interruption,
and restart. It may interpret the relationships but must not replace their
domain meaning with `Ref`, queue, callback, or wake-up state.

## Production-facing code shapes

These shapes are architectural proposals, not typechecked implementation.
They deliberately keep the accepted outer story unchanged while showing where
current production mechanisms belong.

### 1. A real current graph relation

```ts
export interface CurrentSignal<A, E> {
  readonly changes: Stream.Stream<A, E>
}

export class TrackerGraphRelation extends Context.Service<
  TrackerGraphRelation,
  {
    readonly signal: CurrentSignal<CompleteAcceptedTaskGraph, TrackerGraphError>
    readonly reflects: (
      requests: CurrentSignal<TrackerReflectionRequests, TrackerReflectionProjectionError>
    ) => Effect.Effect<void, TrackerReflectionError>
  }
>()("@dalph/TrackerGraphRelation") {}
```

The interface alone does not prove the important contract. Its production
constructor must:

1. validate and reduce the complete journal history;
2. perform the fresh tracker reread required before resumed forward progress
   and accept that observation through the ordinary journal protocol;
3. establish that latest accepted complete graph as the first usable emission
   (synthetic mode begins from its explicit normalized fixture);
4. attach subsequent accepted graph updates without a read/subscribe gap;
5. publish only observations accepted by the journaled workflow protocol
   (synthetic mode uses its explicit in-memory fact relation); and
6. rebuild all process-local signal machinery after interruption or restart.

Effect v4's pinned `SubscriptionRef` is a plausible private mechanism because
its change stream replays the current value and serializes updates. That is an
implementation option, not authority: the tracker and journal retain their
existing ownership, and polling/provider responses do not become graph facts
until the accepted observation protocol says so.

### 2. Bounded desired tickets

```ts
export const boundedParallelTickets = Effect.fn("Delivery.boundedParallelTickets")(
  function* (frontier: CurrentSignal<Frontier, FrontierError>) {
    const policy = yield* RunControlPolicyRelation
    const projection = yield* BoundedParallelTicketsProjection

    return mapEffectCurrentSignal(
      zipLatestCurrentSignals(frontier, policy.signal),
      ([currentFrontier, currentPolicy]) =>
        projection.of(currentFrontier, currentPolicy)
    )
  }
)
```

`BoundedParallelTickets` is a checked desired projection, not proof that a
capacity position is held and not proof that any responsibility began. It
retains its source frontier and negative placement evidence. Existing
responsibilities may make the eventual executor-responsibility relation a
strict superset of these positive tickets.

### 3. Whole-delivery executor-responsibility composition

```ts
export const executorResponsibilities = Effect.fn("Delivery.executorResponsibilities")(
  function* (tickets: CurrentSignal<BoundedParallelTickets, TicketError>) {
    const existing = yield* ExistingExecutorDeliveryResponsibilities
    const reconciliation = yield* ExecutorResponsibilityReconciliation

    const placements = mapCurrentSignal(tickets, ticketPlacementsOf)
    const situations = executorResponsibilitySituations(
      placements,
      existing.signal
    )

    return reconciliation.of(situations)
  }
)
```

Here “executor responsibility” is the declarative delivery-level relation from
the prototype story. It does **not** mean only that a Dalph executor process is
running, and it is not identical to the journal event
`PlannedAttemptExecutorWorkResponsibilityBegan`.

For a selected ticket it begins conceptually before a claim, Attempt, worktree,
or session exists. It remains present while preparation is pending, while an
exact Attempt and agent session exist, after the planned-attempt executor has
reported Terminal, and while integration, cleanup, or tracker reflection is
still outstanding. It ends only when current graph evidence and established
delivery facts show that no consequence remains. This lets the outer story say
truthfully that bounded tickets are the responsibility of executors without
misrepresenting which lower component performs integration or cleanup.

Production's journaled per-subject responsibilities remain essential. They are
the durable, exact evidence from which this broader current relation is
reconstructed; they are not a substitute for the relation itself. The broad
relation is derived and process-local. Selection therefore **does create the
story-level executor-delivery responsibility relationship**, while it does
**not** append or establish a journaled
`PlannedAttemptExecutorWorkResponsibility`. The latter begins only at its exact
accepted executor boundary.

The pure situation algebra must distinguish at least:

- selected with no responsibility;
- selected with one continuing exact responsibility;
- existing responsibility still eligible but outside the desired bound;
- existing responsibility present but constrained;
- existing responsibility absent from a complete graph; and
- contradictory duplicate exact responsibilities.

The reconciliation is where current production's responsibility-first order,
actual task-position admission, owned activation, attempt-control consequences,
post-terminal integration/cleanup consequences, and typed workflow operations
are interpreted. A `ResponsibilityNeeded` situation means that the current
whole-delivery relation must cover the selected ticket; only a later exact
action protocol can append a durable lower responsibility.

### 4. Settlement composition without pretending completion exists

```ts
export const deliverySettlements = Effect.fn("Delivery.deliverySettlements")(
  function* (responsibilities: CurrentSignal<ReconciledResponsibilities, ResponsibilityError>) {
    const reconciliation = yield* DeliverySettlementReconciliation
    return reconciliation.of(responsibilities)
  }
)
```

`DeliverySettlementReconciliation` consumes every whole-delivery
responsibility revision and runs only implemented, accepted lifecycle
protocols. Its output is a current collection of **established** settlement
facts reconstructed from evidence:

```ts
interface DeliverySettlements {
  readonly established: ReadonlyArray<DeliverySettlement>
}
```

At today's production boundary, candidate construction is not an established
delivery settlement. The ticket remains in the executor-delivery
responsibility relation through its lower integration state; `established` is
empty. This makes the line real and governing without inventing promotion,
cleanup, failure, or tracker completion.
When those protocols land, only their proven terminal facts enter
`DeliverySettlement`.

### 5. Reflection composition

```ts
export const reflectDeliverySettlements = Effect.fn("Delivery.reflectDeliverySettlements")(
  function* (settlements: CurrentSignal<DeliverySettlements, SettlementError>) {
    const trackerGraph = yield* TrackerGraphRelation
    const projection = yield* TrackerReflectionProjection
    const requests = projection.of(settlements)

    return yield* trackerGraph.reflects(requests)
  }
)
```

The projection is exhaustive. Today's empty established-settlement collection
produces no tracker mutation. A future integrated-and-disposed settlement can
produce a typed completion request only after its accepted protocol exists.
The reflection adapter records intent, mutates the tracker, observes the
result, and feeds the accepted observation back into the same graph relation.
This closes the story without confusing a tracker request with a delivery fact.

## Reactive, stopped, and restarted behavior

**Inference.** With the contracts above, the flat Effect governs these cases
without retaining a prior stream element as authority:

1. Its scoped runtime starts once, reconstructs the first graph and existing
   lower responsibilities, obtains the required fresh current tracker
   observation, and assembles the usable signal network.
2. A later accepted graph observation changes the frontier, bounded desired
   tickets, and whole-delivery responsibilities. Existing responsibility
   remains in the superset even when its ticket leaves the positive bound.
3. A selected ticket immediately appears as derived executor-delivery
   responsibility. Exact claim, Attempt, worktree, and executor journal facts
   appear only when their action protocols establish them.
4. A terminal executor report changes the lower state but does not remove the
   whole-delivery responsibility. Integration and cleanup continue beneath
   `deliverySettlements`.
5. An established settlement projects to tracker reflection. The resulting
   accepted graph observation flows through the same graph signal and can end
   that ticket's derived responsibility.
6. Interruption discards fibers, subscriptions, buffers, and current
   projections. Restart reconstructs durable lower responsibilities, performs
   the required current tracker read, and recomputes the same endpoint
   relationship; it does not need to replay every missed intermediate
   projection.

The feedback relation is therefore literal:

```text
accepted graph
  -> frontier -> bounded tickets -> executor-delivery responsibilities
  -> established settlements -> tracker reflection
  -> next accepted graph
```

## Outer Effect lifetime and finality

The prototype's `reflectDeliverySettlements` is a long-lived stream consumer,
so running `delivery` once means “own this scoped reactive relation until it
fails, is interrupted, or its consumer decides it is complete.” It returns
`void`. Production currently has another obligation: distinguish
`RunMayTerminate` from `RunMustRemainActive` and append Run termination only in
the former case.

Two code shapes preserve the flat story; choosing between them is required
before implementation planning.

### Option A: reflection returns the finality result

```ts
const finality = yield* delivery
if (finality._tag === "RunMayTerminate") yield* journal.terminateRun(runId)
```

The last unchanged accepted graph and the empty/settled responsibility relation
let `trackerGraph.reflects(...)` finish with `RunFinalityDecision`. This keeps
the exact outer lines, but makes tracker reflection appear to own a run-level
decision that may be broader than its domain.

### Option B: one runtime-coloured wrapper owns finality

```ts
const finality = yield* runDeliveryRuntime({
  relation: delivery,
  decideFinality: currentDeliveryFinality
})
if (finality._tag === "RunMayTerminate") yield* journal.terminateRun(runId)
```

The wrapper owns scoped consumption, quiescence, interruption, and finality,
while `delivery` remains the only domain relation it interprets. This is the
cleaner colour boundary, but only if `runDeliveryRuntime` cannot assemble or
bypass a second frontier/admission loop.

No decision is made here. What is ruled out is preserving today's hidden
`runDeliveryActivation` loop as the real owner while adding a decorative
`delivery` Effect beside it.

## Size of the remaining refactor

**Inference.** This is a substantial coordination refactor, not the
medium-small #178 prefactor, but it is not a rewrite of tracker, journal, Git,
executor, admission, or integration protocols. The broad production surfaces
are:

- one checked current-signal abstraction and reactive tracker-graph relation;
- one flat production `delivery` composition plus its four lower compositions;
- one new whole-delivery executor-responsibility projection over existing
  graph and journal evidence;
- relocation of the current activation/admission machinery beneath that
  responsibility composition;
- truthful empty-established-settlement and no-request reflection adapters
  until later protocols add real facts; and
- deterministic signal/restart tests, existing scenario regressions, and a
  source boundary proving that application entry points cannot bypass the
  flat story.

The first reviewable implementation should be a vertical skeleton through all
seven outer lines, not four unrelated internal cleanups. It may interpret much
of the existing behavior through adapters immediately, while incomplete
settlement/reflection remain explicitly empty. Only after that skeleton is
accepted should work be split along its colour boundaries.

## What happens to the current activation runtime

**Inference.** Most of commit `3997fff9c` remains useful, but it moves beneath
the stories:

- journal reduction and fresh/recovered frontier logic supply lower exact
  responsibility and situation evidence for the broader executor-delivery
  relation;
- `TaskAdmissionController` and `makeActivationCoordinator` interpret the
  executor-responsibility relation;
- `runFreshWorkflowStep` and recovered transition interpreters remain typed
  action boundaries;
- integration admission and candidate construction interpret unsettled
  delivery responsibility;
- completion queues, acknowledgements, scoped fibers, wakeups, phase drains,
  and quiescent refresh are runtime-coloured implementation details.

This is a re-seaming plus one missing domain projection, not a rewrite of
accepted protocols. However, it is larger than #178: production currently
merges responsibility-aware and fresh frontiers before admission, whereas the
fixed outer story first projects bounded desired tickets and then composes them
with a whole-delivery executor responsibility relation. The lower
`executorResponsibilities` story must prove that existing ready responsibility
still wins, capacity remains correct, a terminal executor report does not end
delivery responsibility, and graph negative space does not erase obligations.

## Planning exit gate

Do not create another implementation ticket until review accepts all of the
following in code form:

1. the literal outer `delivery` Effect;
2. all four lower stories above;
3. the current-signal first-value and restart contract;
4. the exact placement of projection, reconciliation, action, and runtime
   colours;
5. the mapping of every current production mechanism into one lower story;
6. the honest empty-settlement/no-reflection behavior for missing protocols;
7. the explicit outer lifetime/finality code shape; and
8. scenario-to-test mappings proving existing responsibility priority,
   capacity, graph removal, restart, dry-run, executor reporting, integration
   ordering, and no premature tracker completion.

#178 should remain paused. Immutable fresh/recovered route provenance is a
valid local finding, but it belongs inside the accepted executor-responsibility
and runtime shape. Implementing it first would again optimize the current
composition without proving convergence on the governing outer Effect.

## Remaining risks and open decisions

- The prototype `CurrentSignal` documents but does not enforce its initial
  current-value guarantee. Production needs a constructor and deterministic
  interruption/restart tests, not just this interface.
- The exact boundary between graph-only frontier projection and production's
  responsibility-aware runnable frontier is the main design risk. Hiding
  responsibility inside `TrackerGraphRelation` would violate authority and is
  not an acceptable shortcut.
- `ExecutorResponsibilities` needs a distinct production domain type so it
  cannot be confused with `PlannedAttemptExecutorWorkResponsibility` or with a
  currently running executor process. Its full-lifecycle meaning must be
  documented above that type.
- “Bounded tickets” must not be confused with process-local position ownership.
  The accepted admission protocol still needs one atomic owner for reservation,
  registration, and runner start.
- An empty established-settlement projection is honest only if lower
  outstanding integration responsibility remains observable and active. It
  cannot be used to declare finality.
- Long-lived signal consumption must be scoped, backpressured where needed,
  and restartable; stream buffers and cursors are never recovery proof.
- The current duplicate journal folds and `checkedTurn` provenance remain
  maintenance findings, but resolving them before the story boundaries are
  accepted would repeat the planning error.
