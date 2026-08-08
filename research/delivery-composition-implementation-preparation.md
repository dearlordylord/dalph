# Delivery composition implementation preparation

Status: implementation preparation governed by accepted specification #190,
not a released naming commitment.

This document prepares a structural repair of the production delivery
composition. It records the decisions reached while reviewing the implementation
after issues #179–#184. Issue #190 owns the accepted behavior under
`docs/OPERATIONAL-SCENARIOS.md`; this note supplies its detailed mismatch and
implementation-preparation record.

## Outcome required from the repair

The production `delivery` Effect must remain readable as one descriptive story:

```text
accepted tracker graph observation
    → delivery frontier
    → bounded tickets
    → retained ticket responsibilities
    → established delivery settlements
    → delivery consequences for the tracker
```

The function body and every type flowing into and out of it are the story. A
seven-line body is not one-level code when its result also exposes admission
positions, process-local revisions, finality, tracker reread controls, or a
general recomputation command.

The repair must preserve the accepted authority model:

- The tracker owns task identity, lifecycle, dependencies, grouping, membership,
  and claims.
- The journal owns only accepted workflow history.
- Git, the executor, and integration resources retain their existing authority.
- Derived frontiers, bounded selections, delivery descriptions, action ownership,
  and stream positions remain process-local.
- Fresh and recovered Run initialization remain distinct. The delivery story
  does not branch on how its accepted inputs were initialized.

## Concrete behavior to preserve

### A newly observed eligible task begins one delivery

The operator starts a Run for one explicit tracker target with task-work
capacity one. That Run start is standing authorization to coordinate tasks that
later enter the target closure and become eligible; there is no separate
per-task approval.

Dalph records the Run beginning, reads the tracker, and accepts a graph
observation containing open task A with no unfinished prerequisite. Delivery
places A in the graph frontier and the current bounded ticket set. The action
path claims A, plans one exact attempt, prepares its worktree, and begins its
executor-work responsibility.

The repair must not turn graph discovery into responsibility, admission, a
claim, or executor work. Each remains established only at its existing boundary.

### A responsible ticket loses current graph placement

Dalph has already established an exact responsibility for task A. A later
complete tracker observation no longer places A in the target closure, places A
outside the current bound, closes it externally, or gives it an unfinished
prerequisite.

Delivery retains A because its exact responsibility still exists. It combines
that responsibility with the new negative-space placement and derives the
existing wait, suspension, reconciliation, isolation, cleanup, or disposition
meaning. It must not erase A merely because A is absent from the current
positive ticket selection.

### A later graph observation introduces new eligible work

The active Run remains authorized for its tracker target. A later accepted graph
observation places task B in the target closure and proves B open with every
prerequisite completed. Delivery reacts to that observation and may place B in
the bounded ticket set. B still begins no durable responsibility until its first
accepted ambiguity-crossing intent.

The Run-stabilization composition observes this changed delivery result and is
no longer quiescent. It does not itself discover or select B.

### One task continues after coordinator loss

The Run has one open task A. Dalph has acquired A's claim, planned attempt A0,
prepared A0's exact worktree, and recorded executor-work responsibility for A0.
The coordinator process then dies before a terminal executor report.

By default the journal, tracker state, and Git/worktree state survive. The
coordinator's fibers and process-local action ownership disappear. The current
milestone executor shares that process lifetime, so its in-memory activity also
disappears.

After restart Dalph reconstructs responsibility for A0, accepts fresh tracker,
claim, and worktree observations, and asks the executor to continue A0. It does
not plan A1, create another claim, create another worktree, or treat process loss
as executor completion.

The same scenario must run through ordinary application code with controlled
service implementations. Neither delivery code nor authored cassette data may
branch on or name a fake execution mode.

### An incomplete Run has no current action

After a fresh complete tracker read, ten target tasks are unfinished but each
has an exact reason that prevents its next action, such as named unfinished
prerequisites, Pause, isolation, or an occupied integration resource. No action
is admitted or running.

The Run is quiescent but delivery is not complete. Dalph exposes every exact
non-progress reason and its exact wake occurrence. Under the current policy the
process exits, the Run remains unterminated and recoverable, and a later
invocation reconstructs it and obtains fresh authority facts. Continuous
waiting, polling, and subscription policy are deferred.

### A fresh unchanged graph can prove something new

Dalph reaches quiescence using graph observation G1. Before considering normal
termination it performs one later complete tracker read. The provider returns
the same normalized graph contents.

The accepted tracker signal still publishes a new observation identity and
freshness boundary. Equal graph contents do not erase the fact that the later
read happened after quiescence. Normal termination additionally requires every
task in the live target closure to be completed successfully and every
Dalph-owned responsibility and resource to be settled.

## The feedback model

Delivery participates in both directions of one feedback system:

```text
accepted tracker observation
        ↓
delivery consequences
        ↓
proposed tracker change
        ↓
tracker action protocol
        ↓
later accepted tracker observation
```

The meaning of a tracker change belongs to delivery. For example, a future
established settlement may mean that one task should be marked completed. The
action-coloured interpreter records the required intent, sends the tracker
request, and records its established result. A mutation acknowledgement never
changes the accepted graph by itself. A later tracker read supplies the next
graph observation.

Delivery therefore describes tracker writes but never imperatively mutates its
input graph signal.

Current production establishes no `DeliverySettlement` values and the
`DeliveryReflection` projection proposes no tracker-reflection action. That is
an honest incomplete feature, not evidence of an implemented completion rule.
The structural repair must preserve the compositional position without
inventing settlement or reflection behavior.

## Current-first tracker observations

The tracker capability should expose the latest accepted observation first and
later accepted observations afterward. Its value must distinguish:

- normalized graph contents;
- the exact logical read that observed them;
- the accepted freshness or journal boundary needed by later proof.

An unchanged reconfirmation is a new observation even when its normalized graph
contents equal the prior observation. Delivery carries the exact source
observation in each emitted value so a consumer cannot interpret consequences
derived from G1 as though they came from later G2.

Tracker caching, polling, webhook intake, and explicit read scheduling remain
behind tracker and observation-coordination services. Crossing the tracker
boundary still uses the accepted intent-and-observation protocol. Delivery only
consumes the accepted observation signal.

## Composition and function colours

The provisional colour language from the prototype remains useful as a review
rule:

- Descriptive code relates current immutable domain values and current-value
  signals without changing an authority.
- Reconciliation code obtains the authority evidence needed to decide an exact
  outstanding responsibility.
- Action code records intent where required, crosses one named boundary,
  observes the result, and records the established workflow fact.
- Runtime code owns subscription lifetime, admitted actions, bounded resources,
  interruption, and process wake-up.

A composition may call a differently coloured lower composition through a
named boundary. It must not return lower-colour mechanics while claiming that
its own story stopped before that colour change.

The intended composition is:

```text
DESCRIPTIVE

Tracker observation signal ───────────────┐
Accepted responsibility signals ──────────┼→ delivery
Run control-policy signal ────────────────┘     ↓
                                             one coherent current
                                             delivery value
                                                   ↓
                                           action-consequence planning
                                                   ↓
                                           executable action proposals

RUNTIME / ACTION

executable proposals + live action ownership
                        ↓
                  action controller
                        ↓
                  boundary interpreters
                        ↓
             accepted facts and observations
                        ↓
             descriptive input signals change

RUN STABILIZATION

current delivery value + live action ownership
                        ↓
              quiescence and exact reasons
                        ↓
          tracker reconfirmation when completion is possible
                        ↓
                    Run finality
```

Initial graph establishment and final tracker reconfirmation are tracker-
observation requirements, not hidden delivery reflection actions. Their domain
requirements join executable delivery proposals only after their respective
descriptive compositions have produced them.

## Intended delivery output

Names in this section are illustrative and must not be copied mechanically.

`delivery` should return one current-first signal of one causally complete
descriptive value. Conceptually that value contains:

```ts
interface DeliveryConsequences {
  readonly graphObservation: AcceptedTrackerGraphObservation
  readonly frontier: DeliveryFrontier
  readonly tickets: BoundedParallelTickets
  readonly ticketDeliveries: TicketDeliveries
  readonly settlements: DeliverySettlements
  readonly trackerConsequences: TrackerDeliveryConsequences
}
```

Retaining the intermediate projections is acceptable because they explain how
the final consequences follow from the source observation. They must be one
coherent value, not independently sampled signals that a consumer can combine
across revisions.

The value does not contain:

- a process-local relation revision;
- a general `invalidate` or recompute command;
- currently held runtime positions;
- live action ownership;
- Run finality;
- quiescence or permission to reread the tracker;
- adapter routes, newly allocated operation identities, or Effect fibers.

Delivery produces domain consequences, not runtime-ready action proposals. A
later descriptive composition adds exact operation-identity requirements,
resource requirements, ordering evidence, and interpreter routes. Live action
ownership then prevents the runtime from starting the same proposal twice.

While a request is in flight, the underlying domain requirement remains until
accepted evidence changes it. For example, while Dalph is asking the tracker to
claim A, delivery still says that A needs a proven claim. The action controller
separately knows that the exact claim request is already running. After process
loss that live knowledge disappears, while the journaled intent makes recovery
reconcile the request before any repeat.

## Quiescence and Run stabilization

Quiescence is only the current process-local fact that:

- no executable delivery action is currently available; and
- no admitted delivery action is still running.

It does not mean that delivery is complete, that the graph is fresh enough for
termination, that no responsibility remains, or that the process should poll.

Delivery owns each ticket's exact standing and every responsibility's exact
non-progress reason and wake occurrence. Run stabilization does not reconstruct
or generalize those reasons. It combines that descriptive result with live
action ownership and reports quiescence.

When quiescence could permit normal completion, Run stabilization requires a
later complete tracker observation. If the later observation introduces an
actionable task, delivery changes and quiescence ends. If it confirms that the
target and all owned work are settled, the Run may terminate normally. If the
Run remains incomplete with no current action, the current policy returns a
must-remain-active result, exits the process, and leaves the Run recoverable.

Future configuration may choose to keep such a process alive, poll, or await a
push observation. That policy is outside the first repair.

## Strict use of `Relation`

`Relation` should name a value that exposes the related sides and states or
enforces the law connecting them. It must not be a general suffix for a signal,
service, projection, command port, or runtime bundle.

Likely consequences include:

- `TrackerGraphRelation` becomes a precisely named accepted observation signal
  or tracker-observation capability.
- `DeliveryRuntimeRelation` disappears rather than being mechanically renamed.
- pure derivations use `Projection` only when they actually project one value
  into another;
- a current-value source is named as a signal or by the domain phenomenon it
  exposes.

No final production names are chosen by this preparation.

## Ordinary fresh and recovered initialization

Fresh and recovered initialization are one real axis:

- Fresh initialization allocates and begins one new durable Run before delivery
  can act.
- Recovered initialization discovers and validates one existing unterminated
  Run, reconstructs its policy and responsibilities, and obtains the required
  current authority observations.

Both install the same domain services and run the same delivery composition.
Delivery neither receives nor branches on `Fresh` or `Recovered`.

Real versus controlled/in-memory service implementations are a separate
application-wiring axis. They must not produce a third workflow route. Every
interpretation exposes the same domain facts through the same ports. For
example, an in-memory tracker changes its own in-memory claim state and an
ordinary later read observes that claim. An in-memory executor reports through
the ordinary planned-attempt executor boundary. The supplied journal determines
the available persistence guarantee.

## Cassette restoration model

Authored cassettes describe domain starting facts, boundary results, coordinator
lifecycle controls, and domain-visible expected behavior. They do not name fake
services or an executor implementation. Application wiring supplies controlled
service implementations beneath ordinary ports.

The default simulated coordinator-loss model is:

- journal survives;
- tracker state survives;
- Git and worktree state survive;
- coordinator memory, fibers, subscriptions, and live action ownership disappear;
- the current same-process executor and its in-memory agents disappear.

A cassette states only exceptions to that default. Restart builds a new ordinary
application scope around the surviving stores and invokes ordinary recovered
initialization.

Existing cassette evidence already expresses exact claim observation as
`TaskClaimObserved` with `claimState: "Exact"`. Attempt continuity is expressed
by one `AttemptId` across planning, executor-work responsibility, and the later
executor report, not by inventing `sameAttempt` terminology. Exact expected
protocol and orchestration evidence also reject unexpected duplicate planning
or responsibility occurrences.

One possible assertion gap requires source confirmation during implementation:
current authored evidence does not clearly distinguish initial
`TaskWorktreeReady` from a recovered reread that verifies the existing exact
planned worktree. Add a specialist-facing assertion only if no existing domain
projection can prove that recovery check.

## Current source mismatches

The repair starts from these verified mismatches:

1. `delivery` currently returns `DeliveryRuntimeRelation`, whose type includes
   descriptive state, executable proposals, finality inputs, admission state,
   process-local synchronization, and a command-like invalidation port.
2. `reflectDeliverySettlements` silently reacquires `TrackerGraphRelation` and
   invokes `DeliveryRuntimeAssembly`; the visible story does not say that it is
   assembling tracker-read proposals or a runtime contract.
3. `DeliveryRuntimeEvaluation` carries `acceptedAt`, `quiescence`, `revision`,
   and `taskWork` beside delivery meaning. These belong to finality proof,
   stabilization, reactive/runtime synchronization, and admission respectively.
4. `current` and `proposedActions` are exposed independently even though the
   runtime consumes the combined `evaluations` signal. The public result permits
   incoherent or unnecessary sampling.
5. `invalidate` combines accepted-fact change, action completion, and tracker
   reconfirmation request. These are different domain phenomena with different
   owners.
6. Tracker graph read proposals are merged into the action frontier through
   final assembly even though the delivery story visibly reads only the graph
   signal.
7. `flat` appears in production function names, tests, comments, and source-
   conformance vocabulary even though it describes a review property, not a
   domain phenomenon.
8. `SyntheticCurrentDeliveryFrame`, `SyntheticExecutorFacts`,
   `SyntheticExecutorSituation`, synthetic relation/action modules, and a
   synthetic bootstrap route leak service choice into shared delivery logic.
9. Authored cassette data and comments expose controlled-fake executor wording,
   even though cassette domain input should use the ordinary executor boundary.
10. `Relation` names signals, service bundles, and mixed command/query objects
    without one enforced meaning.
11. Current production reflection contains no established settlement-to-tracker
    rule. Structural work must not silently fill that product gap.

## Preparation slices

These are reviewable migration slices, not yet tracker tickets. Every slice must
leave the ordinary fresh, recovered, cassette, dry-run, deterministic-test,
live-fake, and production interpretations on one workflow algebra.

### 1. Establish one coherent descriptive delivery result

- Introduce the current-first accepted graph observation value with observation
  identity/freshness.
- Make the source observation flow through one coherent delivery value.
- Keep all current delivery projections and negative-space responsibility
  behavior.
- Move final runtime assembly out of `reflectDeliverySettlements`.
- Preserve the literal readable delivery-level composition and verify its
  result type contains only descriptive concepts.

### 2. Separate delivery consequences from executable proposals

- Keep domain consequences in the delivery result.
- Move operation identity, admission requirements, ordering, and adapter routes
  into a named descriptive action-planning composition.
- Preserve exact proposal identity and ownership-conflict failure behavior.
- Keep tracker initial-read and reconfirmation requirements outside delivery
  reflection.

### 3. Replace invalidation with owned reactive inputs

- Accepted journal changes update accepted-fact signals automatically.
- Tracker observations update the accepted graph signal automatically, including
  unchanged reconfirmations.
- The action controller exposes current live action ownership as a testable
  current value.
- Action completion changes domain descriptions only through the named accepted
  fact or authority-observation source that owns its result; it changes live
  ownership through the action controller.
- Remove the general invalidation protocol and its revision-await handshake only
  after equivalent lost-wakeup and duplicate-start tests exist.

### 4. Compose Run stabilization above delivery

- Derive quiescence from executable proposals and live action ownership.
- Preserve exact ticket/responsibility reasons from delivery.
- Own initial graph establishment and final graph reconfirmation as tracker-
  observation requirements.
- Preserve the current incomplete-quiescent policy: return without Run
  termination and leave recovery possible.
- Keep final post-proof accepted-fact checking at the Run termination boundary.

### 5. Remove environment identity from shared logic

- Replace the synthetic fresh-only delivery route with ordinary ports backed by
  controlled/in-memory services.
- Route dry-run and deterministic scenarios through the same accepted domain
  shapes used by ordinary fresh and recovered execution.
- Preserve the authored recovery cassette's surviving stores across a rebuilt
  coordinator scope.
- Remove fake/synthetic identity from authored cassette data and domain
  assertions.
- Keep fresh versus recovered initialization explicit at the application
  boundary.

### 6. Repair vocabulary and conformance guards

- Remove `flat` from production identifiers and source-conformance names.
- Rename or remove `Relation` types according to the strict rule.
- Preserve the review rule—one abstraction level and one function colour per
  visible story—in architecture or development guidance.
- Update source-boundary tests to assert the intended semantic seams rather than
  spelling or line layout.

## Scenario-to-test mapping

| Preserved scenario | Required test evidence |
| --- | --- |
| Newly observed eligible A enters bounded delivery without yet establishing responsibility | Pure delivery projection tests plus a production-shaped fresh-run scenario proving first intent remains the responsibility boundary |
| Responsible A leaves the current graph or current bound | Existing ticket-delivery negative-space examples and property tests retain A with the exact placement reason |
| Later observation makes B eligible | A current-first signal test emits G1 then G2 and proves one coherent delivery value changes from blocked/excluded B to eligible B |
| Coordinator loss continues A0 | Authored cassette destroys the coordinator scope, rebuilds ordinary recovered initialization, and proves one A0 across planning, responsibility, and executor report |
| Equal graph contents are freshly reconfirmed | Tracker signal test proves a second observation identity is emitted; stabilization test proves only the later observation can support its decision |
| Incomplete quiescent Run exits recoverably | Runtime scenario proves no action is available or live, exact reasons remain visible, final graph read occurs once, no termination is appended, and a later recovered invocation is accepted |
| Real and controlled services have the same delivery meaning | Semantic-conformance test compares the public delivery and action traces without any environment tag in the shared domain values |
| In-flight action does not start twice | Deterministic runtime test keeps the underlying consequence present while live action ownership prevents a duplicate start |
| An accepted action result changes delivery without invalidation | Gateway/action test publishes the result through its named fact or authority-observation source and observes the next delivery value without calling a recompute port |
| Recovery verifies existing worktree before continuing | Existing cassette evidence if sufficient; otherwise one narrowly added specialist-facing recovery assertion |

Focused tests should run after every slice. `pnpm check:all` is required before
handoff. `pnpm check:quint` is required once after the final relevant changes;
the structural repair does not by itself require a new Quint model unless it
changes the accepted transition semantics.

## Deferred work

This preparation deliberately does not choose or implement:

- continuous polling, webhook, subscription, or keep-alive policy for an
  incomplete quiescent Run;
- multiple active tracker graphs or a portfolio-level Run manager;
- a production executor's internal agent-session restoration;
- new settlement or tracker-reflection product rules;
- persistence of derived delivery values, frontiers, bounded tickets, action
  ownership, or signal revisions;
- a replacement for the accepted fresh/recovered Run lifecycle;
- final production names for the illustrative types in this document.

## Completion condition for the implementation preparation

Before implementation tickets are cut, the accepted issue or specification
should:

1. adopt the concrete preservation scenarios above or link their existing
   accepted owners;
2. state that the change is structural except for separately named accepted
   behavior;
3. name the exact old public/internal surfaces each slice removes;
4. preserve one literal delivery-level story and its descriptive result type as
   the primary acceptance artifact;
5. include the scenario-to-test mapping in every implementation handoff.
