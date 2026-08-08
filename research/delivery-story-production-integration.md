# Integrating the delivery stories into production

Status: production-integration research. This document changes no Dalph
runtime behavior. The prototype remains exploratory; accepted scenarios,
architecture decisions, and production types win wherever they disagree.

Prototype reviewed at `dc69e6cbf` on branch
`prototype/attempt-control-reducer`. `controlAttemptTurn` is outside this
study.

## Answer

Dalph is ready to make a small set of story-shaped Effects the governing
production code, but it is **not** ready to copy the prototype's types or its
linear dataflow into production.

The production system already contains most of the difficult machinery:

- journal reconstruction produces one validated run state from distinct pure
  reducers ([reconstructed state](../packages/orchestrator/src/coordination/reconstruction/state.ts#L100),
  [composed reducer](../packages/orchestrator/src/coordination/reconstruction/reduce.ts#L178));
- one pure selector derives ordered transitions and explanations from durable
  responsibility plus fresh facts
  ([frontier derivation](../packages/orchestrator/src/coordination/frontier/frontier.ts#L483));
- one process-local admission controller owns task-work positions
  ([controller contract](../packages/orchestrator/src/coordination/admission/controller.ts#L40));
- one scoped activation coordinator coalesces triggers, excludes work that
  already has a live owner, reserves capacity, and starts owned runners
  ([activation input](../packages/orchestrator/src/coordination/activation/coordinator.ts#L148),
  [coordinator construction](../packages/orchestrator/src/coordination/activation/coordinator.ts#L281)); and
- production, dry-run, and tests already interpret common workflow operations
  with Layers
  ([interpreter contract](../packages/orchestrator/src/workflow/interpretation/interpreter.ts),
  [dry-run composition](../packages/dalph/src/application/composition.ts),
  [production composition](../packages/dalph/src/application/production.ts)).

The first integration should therefore extract and name the existing
production relationship, then make the existing runtime call it. It should
not introduce a second scheduler, a second responsibility model, or a stream
network alongside the trigger-based runtime.

The governing production relationship is not quite the prototype sentence

```text
graph -> frontier -> bounded tickets -> executor responsibilities
      -> delivery settlements -> tracker graph
```

because production responsibility is already an input to frontier derivation.
The faithful relationship is:

```text
recorded graph knowledge + reconstructed per-subject responsibility
                         + fresh authority facts
    -> runnable transitions and explained non-runnable responsibility

runnable transitions + current policy + occupied task positions
                     + live activation ownership
    -> bounded owned activations

owned activations -> workflow operations -> recorded events
                  -> reconstructed responsibility and graph knowledge

accepted integration responsibility -> integration lifecycle
                                    -> delivery settlement
                                    -> tracker reflection
                                    -> later recorded graph knowledge
```

This is still one delivery story. It is a feedback relation whose runtime
interpretation repeatedly works toward agreement; it is not a one-way pipeline
that creates executor responsibility directly from a selected tracker ticket.

## Where the prototype intersects production

| Prototype composition | Existing production correspondence | Integration verdict |
| --- | --- | --- |
| `delivery` | `runWorkflowWithStartup` builds the initial graph observation, merges fresh stages with recovered transitions, creates admission and activation, processes completions, refreshes the graph at quiescence, and derives finality ([run composition](../packages/orchestrator/src/coordination/run/run.ts#L134), [live loop](../packages/orchestrator/src/coordination/run/run.ts#L344)). | Refactor and elevate. This is the current governing algorithm, but its story is obscured by stage construction, queue plumbing, and fresh/recovered arbitration in one file. |
| graph relation | Tracker reads are already journal-first operations. A read intent is appended, a prior exact outcome is reused, otherwise the tracker is called and its observation is appended before reconstructed graph knowledge is returned ([journaled tracker read](../packages/orchestrator/src/workflow-journal/journaled-interpreter.ts#L43)). | Reuse. Do not add prototype `CompleteTrackerGraph`; production graph facts carry target closure, coverage, grouping, lifecycle, prerequisites, revision, and observation evidence. |
| `frontierOf` | `deriveRunnableFrontier` consumes fresh eligible tasks, reconstructed responsibility, and exactly one fresh-facts value per responsibility; it gives existing responsibility journal-order priority and emits explanations for waits and constraints ([frontier input and output](../packages/orchestrator/src/coordination/frontier/frontier.ts#L231), [derivation](../packages/orchestrator/src/coordination/frontier/frontier.ts#L483)). | Reuse and expose through a clean composition. The prototype's lifecycle/prerequisite-only frontier is too small. |
| `boundedParallelTickets` | `TaskAdmissionController.admit` reserves at most one transition in one atomic call; the activation coordinator repeatedly derives and admits while earlier runners remain live, allowing capacity-N overlap ([admission API](../packages/orchestrator/src/coordination/admission/controller.ts#L46), [activation pass](../packages/orchestrator/src/coordination/activation/coordinator.ts#L397)). | Refactor the composition, retain the protocol. “Bounded tickets” may remain story language, but the production value is bounded owned transitions plus exact task positions, not merely a set of task IDs. |
| `executorResponsibilities` | A planned-attempt responsibility begins only after the attempt and worktree protocol reach the executor boundary; it is reconstructed from `PlannedAttemptExecutorWorkResponsibilityBegan`, and reports retain exact `(RunId, AttemptId)` correlation ([responsibility type](../packages/orchestrator/src/coordination/reconstruction/state.ts#L24), [responsibility reducer](../packages/orchestrator/src/coordination/reconstruction/reduce.ts#L57), [executor protocol scenarios](../docs/scenarios/planned-attempt-executor-boundary.md)). | Redesign around production semantics. Do not derive a responsibility merely because a ticket is selected. |
| `deliverySettlements` | Production has accepted-result integration responsibility, journal-position FIFO, an integration-start cutoff, per-target serialization, candidate construction, sealed target verification, and exact-head promotion or preserved reconciliation ([integration admission](../packages/orchestrator/src/workflow/protocols/integration-admission/protocol.ts), [target verification](../packages/orchestrator/src/workflow/protocols/target-verification/protocol.ts), [target promotion](../packages/orchestrator/src/workflow/protocols/target-promotion/protocol.ts)). | Extend only as later scenarios land. Tracker completion, cleanup, and final settlement are not yet a reachable complete production lifecycle. |
| `reflectDeliverySettlements` | Current quiescent refresh sees tracker completion performed elsewhere, but Dalph does not yet implement the complete tracker-completion mutation as the result of verified promotion ([issue 53 scenario](../docs/scenarios/issue-53-refresh-complete-task-pipelines.md), [issue 60 promotion](../docs/scenarios/issue-60-promote-or-reconcile.md)). | Keep the story seam, but do not fabricate its successful production implementation. Issues #61/#141 must supply the missing chronological protocols. |

## The important mismatch: frontier already depends on responsibility

The prototype computes ticket placement from a graph and capacity choice, then
compares that placement with existing executor responsibilities. Its algebra
is useful: it retains selected, eligible-but-outside-the-bound, present-but-not
runnable, absent, continuing, needed, no-longer-selected, and conflicting
situations (prototype commit `dc69e6cbf`,
`prototypes/attempt-control-reducer/src/delivery.ts`, “KnownTicketPlacement”
through “ExecutorResponsibilitySituations”).

Production has made a stronger decision. It tracks responsibility for each
exact workflow operation or external resource, not one flag per ticket or
attempt ([ADR 0005](../docs/adr/0005-track-workflow-responsibility-per-subject.md)).
The runnable frontier is derived **from** those outstanding responsibilities
and their fresh authority facts. It orders ready responsibility before fresh
work; capacity is applied only afterward ([ADR 0009](../docs/adr/0009-separate-frontier-from-bounded-admission.md)).

That difference has concrete consequences:

1. Selecting a fresh task reserves process-local capacity but creates no
   durable workflow responsibility. The exact first operation intent does.
2. A selected task still has to acquire/verify its claim, reread its work
   specification, plan an exact attempt, and reconcile its worktree before an
   executor responsibility can begin.
3. Removing a task from the latest eligible set cannot erase its claim,
   worktree, executor, integration, or cleanup obligations. Each is explained
   and settled independently.
4. Existing responsibility may remain the first runnable work even when new
   fresh tasks sort earlier.

Therefore the first production story must not expose
`executorResponsibilities(boundedTickets)` as if admission creates the
responsibility. A production-shaped lower composition can instead read as:

```ts
const state = yield* reconstructedRunState(runId)
const facts = yield* responsibilityFacts(state.responsibility)
const frontier = runnableFrontierOf({ state, facts })
const activations = yield* boundedActivations(frontier)

return yield* reconcileOwnedActivations(activations)
```

Names remain candidates. The architectural point is that responsibility is
both reconstructed input and a possible durable consequence of executing an
owned transition. This preserves the accepted causal boundary.

The prototype placement algebra should not be discarded. It is a useful
candidate for the narrower future question “what current graph evidence
explains the fate of an already-existing executor responsibility?” Production
already represents much of that negative space as typed frontier explanations,
including membership, lifecycle, claim, Git, dependency, pause, and unreadable
fact constraints ([frontier explanation algebra](../packages/orchestrator/src/coordination/frontier/frontier.ts#L103)).
The right migration is to compare and consolidate those meanings, not install
a parallel placement model.

## CurrentSignal and Stream: not the first migration

The prototype uses `CurrentSignal<A, E>` as a stream whose first emission is
documented as the current reconstructed value, but the type does not enforce
that promise (prototype commit `dc69e6cbf`,
`prototypes/attempt-control-reducer/src/delivery.ts`, “Deferred finding (5)”).
That guarantee matters here: after a week-long stop, a subscriber must begin
from a fresh journal reconstruction and current authority reads, not wait for
the next change or consume a stale replay buffer.

Production already has a safer runtime shape for the current milestone:

- restart reconstructs durable state and rereads current authorities;
- order-free causes wake one scoped activation coordinator;
- each activation pass reads the frontier again;
- live ownership is excluded before atomic admission; and
- quiescence causes one complete tracker refresh before the run returns
  ([activation coordinator](../packages/orchestrator/src/coordination/activation/coordinator.ts#L281),
  [run loop](../packages/orchestrator/src/coordination/run/run.ts#L429)).

Use that trigger + fresh-read runtime for the first story integration. Express
the governing code as Effects returning current immutable values for one turn,
while the existing runtime owns repetition, wakeups, concurrency, and
interruption. This is not less reactive: a graph observation, recorded result,
capacity change, restart, or resume causes another derivation from current
facts. It avoids making delivery correctness depend on an unproven stream
initialization contract.

`CurrentSignal` or an Effect `SubscriptionRef`-backed abstraction may be
reconsidered after its contract can make these states distinguishable:

- reconstructing the first current value;
- current value established;
- update after that value;
- source failed or ended; and
- subscriber interrupted and restarted.

The contract must also prove that changes cannot be lost between establishing
the initial value and attaching update observation. Until then, Streams are a
runtime implementation option below the story colour, not the governing
domain interface.

## Target production shape

The first target should be a small, executable `delivery-activation` module in
`packages/orchestrator/src/coordination/delivery/`. It should own the readable
relationships and import lower production capabilities; it should not own
tracker, Git, journal, or executor adapters.

A plausible first shape separates one freshly derived relationship from the
runtime that repeats it:

```ts
export const deliveryActivation = Effect.fn("Delivery.activate")(function* (
  input: DeliveryActivationInput
) {
  const runtime = yield* DeliveryRuntime

  return yield* runtime.reconcile(input, deliveryActivationTurn)
})

export const deliveryActivationTurn = Effect.fn("Delivery.activationTurn")(function* (
  input: DeliveryActivationInput
) {
  const current = yield* currentDeliveryState(input.runId)
  const frontier = yield* runnableDeliveryFrontier(current)
  const activations = yield* boundedActivations(frontier)

  return yield* runOwnedActivations({ activations, current })
})
```

These are illustrative boundaries, not accepted names or signatures. The
existing activation coordinator remains the runtime-coloured interpreter of
the relation: it turns order-free wakeups and current derivations into scoped
owned runners. Its `OwnedTransitionExecution` nominal capability already
prevents arbitrary code from recording an operation intent or binding and
releasing a planned-attempt position
([owned execution capability](../packages/orchestrator/src/coordination/activation/coordinator.ts#L61)).
The refactor should move plumbing behind this story rather than weaken that
boundary.

Do **not** wire the prototype's full outer `delivery` composition yet. A real
`deliverySettlements` must establish integration, verification, promotion,
tracker completion, and resource disposition; a real
`reflectDeliverySettlements` must execute the accepted tracker protocol. Those
facts do not yet exist end to end. A placeholder “no settlement” value would
make the outer story a facade and could falsely imply that the complete
relationship governs production. Until #59/#60/#61/#141 land, existing
integration admission and candidate construction remain typed transitions
inside `deliveryActivation`; executor `Terminal Accepted` and
`IntegrationCandidateConstructed` never imply tracker completion.

The production outer `delivery` should be wired only when settlement and
reflection are truthful. Its later shape may compose the activation,
settlement, and reflection relations concurrently or per reconciliation turn;
it must not run activation to completion and only then begin settlement.

## Making the stories priority-1 governing code

“Priority 1” should mean more than prominent filenames. The production design
should make alternate imperative paths hard to represent:

1. **One application entry.** `runWorkflow`, `runRecoveredWorkflow`, and
   `runSyntheticWorkflow` construct startup facts and then invoke the same
   `deliveryActivation` Effect during the first migration, and later the same
   complete `delivery` Effect. None owns another scheduling loop
   ([current entry points](../packages/orchestrator/src/coordination/run/run.ts#L495)).
2. **One transition algebra.** The story produces the existing closed
   `RunnableFrontierTransition` union. Adapters receive exact operations only
   through the owned-transition interpreter; they cannot enqueue tasks or
   choose later workflow steps.
3. **One durable route.** Production mutation Layers keep intent, external
   effect, outcome observation, and replay/reconciliation together. The story
   never appends ad hoc state or treats an adapter return as reconstructed
   authority ([journaled interpreter](../packages/orchestrator/src/workflow-journal/journaled-interpreter.ts)).
4. **One responsibility model.** New protocols extend
   `WorkflowResponsibilityEntry` and its reducers/frontier rules. They do not
   add a story-local executor set, queue table, or persisted projection.
5. **Opaque checked outputs.** Pure constructors or private module exports
   create admitted/owned/settled proofs. An adapter cannot construct a
   `DeliverySettlement` from an executor report alone.
6. **Composition-root enforcement.** Production, dry-run, fake, and test
   Layers provide interpretations of the same services. No mode-specific
   story branches on “production” or “test.”
7. **Package surface enforcement.** Export the governing story entry points
   and domain algebras from `@dalph/orchestrator`; keep runner capabilities and
   lower constructors package-private wherever tests do not require an
   explicit conformance seam.
8. **Architecture tests.** Add a small source/dependency test that rejects
   application imports of lower runner modules once the public story exists.
   This is a guardrail for accidental bypass, not a substitute for scenario
   tests.

This arrangement lets lower slices remain independently testable without
becoming alternate applications. Pure projection tests call pure functions;
protocol tests call their explicit seams; only the delivery story owns the
production lifecycle.

The first alternate workflow to remove is `FreshWorkflowStage.run`. A fresh
stage currently packages one selected transition with an imperative callback
that performs the boundary and returns the **next** stage; `run.ts` stores
those stage objects in a `Ref`, invokes a stage through the activation runner,
then replaces it with the callback's returned successor
([stage contract](../packages/orchestrator/src/coordination/run/fresh-activation.ts),
[stage execution and replacement](../packages/orchestrator/src/coordination/run/run.ts#L402)).
That callback chain is a second workflow representation beside reconstructed
responsibility plus `RunnableFrontierTransition`. It is the clearest place
where the current production system does not yet obey the priority-1 story.

Eliminating it means that a completed operation records facts, then the next
delivery turn reconstructs/derives the next transition from those facts. It
does not mean replacing `FreshWorkflowStage` with another continuation object
under a new name. During migration, characterization tests must prove that
claim, eligibility, specification, plan, worktree, and executor chronology is
unchanged.

## Migration order

### Phase 0 — freeze observable behavior

Add characterization assertions around the current `runWorkflowWithStartup`
path before moving it. No runtime behavior changes. The existing authored
cassettes already cover restart, graph refresh, capacity, localized conflict,
executor correlation, integration order, and the integration cutoff; reuse
them as the equivalence oracle rather than creating a second scheduler.

### Phase 1 — extract the governing activation story

Create `coordination/delivery/` and move, without semantic changes:

- reconstruction/fresh-fact acquisition behind `currentRunState` or an
  equally precise name;
- fresh/recovered frontier arbitration behind one composition;
- policy observation and admission behind `boundedActivations`; and
- activation coordinator driving behind `deliveryActivation`.

Keep `deriveRunnableFrontier`, `TaskAdmissionController`, and
`makeActivationCoordinator` unchanged first. Replace
`runWorkflowWithStartup`'s direct loop with the new story. This is primarily
refactor/reuse, not new behavior.

As part of this phase, replace `FreshWorkflowStage.run -> next
FreshWorkflowStage` with journaled operation results followed by ordinary
frontier re-derivation. This removes the most important competing imperative
path rather than merely wrapping it in `deliveryActivation`.

### Phase 2 — make responsibility composition explicit

Extract production responsibility-fact acquisition from the large
`recovery-activation.ts` module and present it as a lower story-shaped
composition. Reuse `WorkflowResponsibilityState`, exact correlation, fresh-fact
types, and frontier explanations. Compare the prototype placement algebra with
the production explanation algebra and add a domain type only where it names a
missing phenomenon.

Do not create executor responsibility at ticket selection. The durable
`PlannedAttemptExecutorWorkResponsibilityBegan` action remains the boundary
between an admitted workflow transition and an owned executor obligation.

### Phase 3 — expose incomplete settlement honestly

Keep existing integration admission and candidate construction visible as
ordinary activation transitions. Define the production settlement/reflection
contracts and their type barriers only when the first accepted downstream
protocol needs them. Do not create a placeholder settlement implementation.

### Phase 4 — implement settlement and reflection incrementally

The same story has now been extended for:

1. #59 candidate verification; and
2. #60 exact-head compare-and-set promotion and ambiguous-result
   reconciliation.

The remaining extensions are #61 tracker completion and fresh confirmation,
then #141 complete integration disposition, cleanup, and run finality.

Each protocol contributes new events, reducer state, fresh facts, frontier
transitions/explanations, an interpreter branch, and adapter contract tests.
The outer delivery story should change little: this is the test that it is at
the right abstraction level.

### Phase 5 — evaluate a true current-value signal

After the Effect-per-turn story is stable, prototype a `CurrentSignal`
interpreter against the same story contracts. Require deterministic tests for
initial reconstruction, no lost update at subscription, interruption, restart,
source failure, and week-later current-authority changes. Adopt it only if it
removes runtime plumbing without creating a second authority or changing the
story's values.

## Scenario-to-test map for future implementation

No implementation phase may begin without its accepted operational scenarios.
The mappings below identify existing coverage and the additional seams the
refactor must preserve.

| Concrete scenario | Existing proof to preserve | Story-level proof to add |
| --- | --- | --- |
| A later recorded tracker observation makes dependent B eligible after A; executor completion alone does not. | `continues the same run with B only after a recorded refresh reports A completed` in [cassette scenarios](../packages/dalph/test/cassettes/scenario.test.ts#L854); accepted chronology in [issue 53](../docs/scenarios/issue-53-refresh-complete-task-pipelines.md). | Run through public `deliveryActivation`; assert no lower application loop or stage continuation is invoked and B appears only after the recorded observation. |
| Capacity N permits overlapping runners but never N+1, and contraction does not preempt existing holders. | Coordinator examples and generated capacity properties in [activation tests](../packages/orchestrator/src/coordination/activation/coordinator.test.ts#L152) and [property tests](../packages/orchestrator/src/coordination/activation/coordinator.property.test.ts). | Call `boundedActivations` through the story using gates; assert identical owned-transition chronology before and after extraction. |
| A responsible task leaves complete membership while independent B continues. | Accepted [issue 55 chronology](../docs/scenarios/issue-55-localize-task-conflicts.md) and frontier test `keeps a removed task's executor responsibility behind a task-membership constraint` ([frontier tests](../packages/orchestrator/src/coordination/frontier/frontier.test.ts#L437)). | Public delivery-activation test proves the responsibility becomes an explained constraint, is not deleted, and independent work is admitted. |
| Dalph and the same-process fake restart with unfinished `(RunId, AttemptId)` work. | `recreates the fake executor and continues the same attempt after shared process death` ([executor protocol tests](../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.test.ts#L329)). | Fresh and recovered entry points both invoke the same delivery story; source/trace assertion proves there is no recovery-only scheduler. |
| Two accepted results retain journal FIFO and cross one integration-start cutoff after restart. | [issue 56 chronology](../docs/scenarios/issue-56-queue-accepted-integration.md), integration protocol tests ([integration admission tests](../packages/orchestrator/src/workflow/protocols/integration-admission/protocol.test.ts#L307)), and cassette restart coverage ([scenario test](../packages/dalph/test/cassettes/scenario.test.ts#L300)). | Public delivery-activation test proves integration remains a transition from the same frontier and does not consume task-work capacity. |
| Current graph or policy changes wake another derivation. | Production capacity scenario ([production test](../packages/dalph/test/scenarios/production.test.ts#L178)) and activation trigger tests ([coordinator tests](../packages/orchestrator/src/coordination/activation/coordinator.test.ts#L32)). | Controlled story runtime changes the graph/policy after first derivation; assert the next derivation observes it without restarting the application. |
| Restart begins from a freshly reconstructed current value rather than waiting for a future update. | Current journal recovery and restart cassettes provide the factual baseline; no `CurrentSignal` contract exists. | Required before Phase 5: interrupt before subscription, between initial read and update attachment, and after attachment; assert no lost or stale current value. |
| Verified promoted work alone may request tracker completion, followed by tracker confirmation and cleanup. | Verification and exact promotion are implemented; tracker completion and cleanup are not. | Blocked until #61/#141 scenarios name every boundary, crash point, retry, visible result, and forbidden result. Then add pure authorization, protocol, adapter-contract, crash-cut, and public-delivery scenario tests. |

## Main risks

- **Copying the prototype domain.** This would weaken production graph
  evidence and create a second responsibility model. Reuse production types
  first.
- **Making “story” a facade.** If `deliveryActivation` simply calls the old
  monolithic loop, or retains `FreshWorkflowStage.run` as the real workflow,
  while other entry points can still call lower runners, it does not govern
  the system. Move ownership of the lifecycle and narrow the public surface.
- **Confusing reactivity with Streams.** Reactivity is the guarantee that a
  relevant change causes derivation from current facts. A Stream is one
  interpreter and currently lacks the necessary first-current-value proof.
- **Premature settlement.** Executor acceptance, candidate construction, Git
  promotion, tracker completion, and cleanup are distinct facts. Collapsing
  them would release dependants or resources too early.
- **A giant story module.** `run.ts` and `recovery-activation.ts` already show
  the cost of mixing story and mechanics. Keep clean compositions visible and
  end each at a named projection-, reconciliation-, action-, or runtime-colour
  change; the lower module tells the next story.
- **Test duplication.** Do not build a story-specific expected scheduler.
  Existing cassettes and controlled authorities supply observations; tests
  inspect selected operations and final authority facts.

## Recommendation

Start with Phases 0 and 1 as one behavior-preserving implementation ticket.
Its plan should state that no user-visible behavior changes and map the
existing accepted scenarios to the extracted public `deliveryActivation`
entry. If the work changes operation selection or chronology, it is no longer
this refactor and needs a separately accepted scenario. The success criterion
is structural and executable: every production, recovered, dry-run, and
cassette activation enters through the same readable delivery-activation
composition, `FreshWorkflowStage.run` no longer encodes a second workflow, and
all current scenario traces remain unchanged.

Then perform Phase 2 separately. It contains the real domain work: reconciling
the prototype's placement language with Dalph's stronger per-subject
responsibility and frontier explanation model. Settlement/reflection should
remain a prototype boundary and a deferred production composition until the
later integration protocol issues make it truthful.
