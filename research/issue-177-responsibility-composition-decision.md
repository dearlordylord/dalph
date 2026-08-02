# Post-cutover responsibility-composition decision

Status: source-backed decision for
[issue 177](https://github.com/dearlordylord/dalph/issues/177).

Audited baseline: `master` at
`3997fff9cbb32f13aeeb11eada3444a62fb916d1`. The exploratory prototype at
`dc69e6cbf` was used only to name the questions. All behavior claims below come
from the committed production source and tests at the audited baseline.

## Decision

**Outcome 2 — focused prefactor.** The post-cutover workflow is one real
activation path and its responsibility semantics are sound enough to retain.
One non-behavioral structural change is warranted: keep the selected
transition's fresh-or-recovered execution provenance in the immutable value
that the activation coordinator selects, instead of discarding that provenance
and recovering it later from `checkedTurn`, a private mutable `Ref`.

This is not a behavioral redesign. The audit found no missing accepted behavior
in the eight cases below. It also found no reason to change responsibility,
frontier, admission, journaling, or authority semantics.

Evidence labels used below:

- **Source fact** means the committed implementation directly establishes the
  claim.
- **Test evidence** means a committed test asserts the claim.
- **Inference** means an architectural interpretation of those facts; it is not
  a runtime guarantee derived from Effect, TypeScript, or naming.

## The implemented architecture in plain language

On startup, Dalph reads journal history and current tracker facts. For each
turn, it independently obtains the transitions needed by already-recorded
responsibilities and derives the next step for eligible tasks that have no
responsibility. It removes a recovered transition when the same task has a
fresh step, combines the remaining transitions, applies current task capacity,
and gives one exact transition to a scoped runner. The runner calls one typed
tracker, Git, journal, integration, or executor boundary. When that call has
been accepted into journal history—or into the synthetic dry-run fact list—the
next turn derives again.

**Source fact.** Fresh, recovered, and synthetic entry points all call
`runDeliveryActivation`; there is one activation coordinator in that function
([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L64),
[entry points](../packages/orchestrator/src/coordination/run/run.ts#L390)). The
source-boundary test rejects restoration of the callback-linked stage chain and
application-level imports of delivery internals
([source-boundary test](../packages/dalph/test/conformance/delivery-activation-source-boundary.test.ts#L15)).

**Inference.** This is one control loop with two projection inputs, not two
schedulers. `RunRecoveryActivation` supplies the already-recorded side;
`deriveFreshWorkflowDecisions` supplies the not-yet-responsible side. Admission
and live activation ownership are shared.

## Function colours

| Colour | Committed owner | What crosses the boundary |
|---|---|---|
| Immutable reconstruction and projection | Journal reducers reconstruct graph knowledge, pause, responsibility, policy, and history ([reduce.ts](../packages/orchestrator/src/coordination/reconstruction/reduce.ts#L22)); `deriveRunnableFrontier` maps exact responsibility plus fresh facts to transitions or explanations ([frontier.ts](../packages/orchestrator/src/coordination/frontier/frontier.ts#L482)); `deriveFreshWorkflowDecisions` maps a delivery frame to fresh steps ([fresh-workflow.ts](../packages/orchestrator/src/coordination/run/fresh-workflow.ts#L280)). | Immutable records, graph snapshot, responsibility, fresh facts, pause, and policy enter; transitions and explanations leave. |
| Reconciliation | `readDeliveryActivationTurn` combines recovered and fresh results, giving fresh work for a task precedence over a recovered transition for that same task ([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L137)). | A `RunnableFrontier` plus a separate array of paired fresh steps. |
| Typed action | `runFreshWorkflowStep` exhaustively interprets fresh-step tags ([run-fresh-workflow-step.ts](../packages/orchestrator/src/coordination/run/run-fresh-workflow-step.ts#L105)); recovered tags go through `RunRecoveryActivation.runTransition` ([recovery-activation.ts](../packages/orchestrator/src/coordination/run/recovery-activation.ts#L1903)). | One owned transition and the private capability to bind intent or an executor position. |
| Runtime | The activation coordinator owns trigger coalescing, live ownership, scoped fibers, and handoff ([coordinator.ts](../packages/orchestrator/src/coordination/activation/coordinator.ts#L277)); the admission controller owns process-local positions ([controller.ts](../packages/orchestrator/src/coordination/admission/controller.ts#L149)); `run.ts` owns completion acknowledgement and repetition ([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L116)). | Order-free causes enter. Selected runners, completion wakeups, and final scope cleanup remain process-local. |

**Inference.** The colour boundary is generally clean: pure functions do not
start fibers or call providers, and adapters do not choose tasks. The exception
is transition provenance at the reconciliation-to-runtime handoff, described
under “Material finding.”

## Eight production traces

### 1. A fresh eligible task has no responsibility

**Source fact.** `CurrentDeliveryFrame` supplies the latest accepted graph,
pause, responsibility, current policy, and journal or synthetic facts; it
explicitly excludes runtime ownership and task positions
([current-delivery-relation.ts](../packages/orchestrator/src/coordination/run/current-delivery-relation.ts#L24)).
`deriveFreshWorkflowDecisions` excludes tasks with a still-owning reconstructed
responsibility, tasks under Pause, and tasks absent from current eligibility
([fresh-workflow.ts](../packages/orchestrator/src/coordination/run/fresh-workflow.ts#L280)).
For a remaining task it derives exactly one next step, initially a focused
current-graph read and then claim, post-claim graph, specification, plan,
worktree, and executor steps from accepted facts
([fresh-workflow.ts](../packages/orchestrator/src/coordination/run/fresh-workflow.ts#L82)).

The activation coordinator excludes live owners, asks admission for the first
permitted transition, registers exact live ownership, and forks the runner
([coordinator.ts](../packages/orchestrator/src/coordination/activation/coordinator.ts#L494)).
Typed external calls begin only in `runFreshWorkflowStep`
([run-fresh-workflow-step.ts](../packages/orchestrator/src/coordination/run/run-fresh-workflow-step.ts#L116)).

**Test evidence.** The production-shaped run test takes one fresh task through
the complete attempt while a changed focused graph removes another unstarted
task ([run.test.ts](../packages/orchestrator/src/coordination/run/run.test.ts#L489)).

### 2. An existing responsibility becomes runnable

**Source fact.** Every recovery-frontier read folds current journal history,
derives fresh authority facts for every reconstructed responsibility, and feeds
them to `deriveRunnableFrontier`
([recovery-activation.ts](../packages/orchestrator/src/coordination/run/recovery-activation.ts#L1256)).
The pure frontier orders runnable responsibility by original journal position
before fresh work and emits a typed issue when facts are missing or duplicated
([frontier.ts](../packages/orchestrator/src/coordination/frontier/frontier.ts#L482)).
The combined turn removes fresh decisions for tasks still owned by
responsibility, then sends recovered transitions through the same admission and
ownership coordinator ([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L150)).

**Test evidence.** A recovered executor transition runs once through the shared
activation loop ([run.test.ts](../packages/orchestrator/src/coordination/run/run.test.ts#L412)); frontier tests prove journal-position ordering
([frontier.test.ts](../packages/orchestrator/src/coordination/frontier/frontier.test.ts#L100)).

### 3. A graph change removes an unstarted task

**Source fact.** Fresh derivation intersects the candidate graph with the
currently eligible task IDs before constructing decisions
([fresh-workflow.ts](../packages/orchestrator/src/coordination/run/fresh-workflow.ts#L313)).
Because graph membership does not create responsibility, an unstarted removed
task has no durable cleanup obligation.

**Test evidence.** The authored cassette changes `{A,C}` to `{A,D}`, keeps
unstarted C out of responsibility, and later selects D
([scenario.test.ts](../packages/dalph/test/cassettes/scenario.test.ts#L1075)).

**Inference.** This is the required negative-space distinction: absence from a
complete current graph removes unstarted eligibility; it does not erase an
already-recorded responsibility.

### 4. A responsible task is present but outside current bounded admission

**Source fact.** Production has no durable “inside/outside bounded ticket set.”
Responsibility remains in reconstructed state regardless of capacity. The
frontier derives its transition first; the admission controller either selects
it or adds `CapacityWait` while retaining every position and responsibility
([controller.ts](../packages/orchestrator/src/coordination/admission/controller.ts#L125)).
An already reconstructed planned-attempt position remains held even after a
capacity decrease ([controller.ts](../packages/orchestrator/src/coordination/admission/controller.ts#L149)).

**Test evidence.** A safely suspended responsibility that becomes runnable
waits while other task positions fill capacity, is identical after controller
restart, and is admitted before fresh work after one position is released
([frontier.test.ts](../packages/orchestrator/src/coordination/frontier/frontier.test.ts#L174)).

**Inference.** “Outside admission” means “not chosen on this turn,” not “outside
responsibility.” No cleanup or warning follows solely from capacity pressure.

### 5. A responsible task leaves membership or becomes constrained

**Source fact.** Current complete graph evidence is converted into typed
membership, lifecycle, claim, Git, specification, pause, and unreadable-fact
dispositions. Running executor work is first asked to suspend; after a
`SafelySuspended` report the same responsibility becomes a local explanation
instead of disappearing
([recovery-activation.ts](../packages/orchestrator/src/coordination/run/recovery-activation.ts#L617),
[frontier.ts](../packages/orchestrator/src/coordination/frontier/frontier.ts#L275)).

**Test evidence.** A removed running task yields
`SuspendPlannedAttemptExecutorWork`, then
`PlannedAttemptTaskMembershipConstraint`; terminal-without-success and changed
specification produce their own later explanations
([recovery.test.ts](../packages/orchestrator/src/coordination/frontier/recovery.test.ts#L842)).
A claim responsibility that leaves membership remains present with a task-local
constraint ([recovery.test.ts](../packages/orchestrator/src/coordination/frontier/recovery.test.ts#L267)).

### 6. An executor report changes responsibility and task-position consequences

**Source fact.** Before the first executor call, the protocol appends
`PlannedAttemptExecutorWorkResponsibilityBegan`; after the call it verifies
exact `(RunId, AttemptId)` correlation and appends the report
([protocol.ts](../packages/orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol.ts#L30)).
The owned runner binds the task position to the exact attempt before starting
or continuing, retains it for `Running`, and releases it for `SafelySuspended`
or `Terminal` ([run-fresh-workflow-step.ts](../packages/orchestrator/src/coordination/run/run-fresh-workflow-step.ts#L240),
[recovery-activation.ts](../packages/orchestrator/src/coordination/run/recovery-activation.ts#L1883)).
Terminal reports become frontier explanations and accepted results may create a
separate integration responsibility.

**Test evidence.** Frontier tests retain the terminal report for the exact
attempt and allow finality only under the tested settled conditions
([frontier.test.ts](../packages/orchestrator/src/coordination/frontier/frontier.test.ts#L147)).

### 7. Restart reconstructs the same unfinished planned attempt

**Source fact.** Recovery folds the journal, reconstructs a task position for
every executor responsibility without a safe or terminal report, and uses the
same recorded `PlannedTaskAttempt` in continuation transitions
([recovery-activation.ts](../packages/orchestrator/src/coordination/run/recovery-activation.ts#L1777)).
The current delivery relation also rebuilds its initial immutable frame from
accepted journal history ([current-delivery-relation.ts](../packages/orchestrator/src/coordination/run/current-delivery-relation.ts#L83)).

**Test evidence.** A newly constructed relation sees the same latest graph
after restart ([current-delivery-relation.test.ts](../packages/orchestrator/src/coordination/run/current-delivery-relation.test.ts#L87)); recovered admission produces the same wait/selection under the same occupied positions
([frontier.test.ts](../packages/orchestrator/src/coordination/frontier/frontier.test.ts#L174)).

### 8. Dry-run reaches equivalent decisions without a durable journal

**Source fact.** `makeSyntheticCurrentDeliveryRelation` holds graph and accepted
workflow facts in a process-local `Ref`, but exposes the same
`CurrentDeliveryFrame` fields and the same fresh-decision function
([current-delivery-relation.ts](../packages/orchestrator/src/coordination/run/current-delivery-relation.ts#L127)).
`runSyntheticWorkflow` calls the same `runDeliveryActivation`; successful step
results are accepted into the synthetic relation before the next turn
([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L237),
[run.ts](../packages/orchestrator/src/coordination/run/run.ts#L426)).

**Test evidence.** The dry CLI traverses the planned-attempt workflow through
simulated claim, plan, and worktree operations
([cli.test.ts](../packages/dalph/src/application/cli.test.ts#L46)).

**Inference.** Decision equivalence is structural for the fresh path, not proof
that dry-run simulates crash recovery. Synthetic mode deliberately has empty
durable responsibility and no recovered-transition capability.

## Authority, negative space, and duplicate representation

**Source fact.** Responsibility is authoritative per exact journaled subject:
operation responsibilities use `OperationId`; executor responsibility uses the
exact planned attempt and correlation key
([state.ts](../packages/orchestrator/src/coordination/reconstruction/state.ts#L25)).
Complete tracker observations explain task absence. They do not mutate or
replace responsibility. Runtime ownership and positions are absent from the
delivery frame and live only in the coordinator and admission controller.

**Source fact.** Responsibility is represented twice during one combined turn:
the current delivery relation reconstructs it into `frame.responsibility`, and
`recovery.readFrontier` independently reconstructs it to derive recovered
transitions. Fresh derivation uses the first copy plus the same frame's full
`workflowHistory` to decide which historical entries suppress the fresh chain;
recovered derivation uses the second copy to choose dispositions and next
transitions
([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L137),
[current-delivery-relation.ts](../packages/orchestrator/src/coordination/run/current-delivery-relation.ts#L89),
[recovery-activation.ts](../packages/orchestrator/src/coordination/run/recovery-activation.ts#L668)).

**Source fact.** `responsibilityStillOwnsTask` is a second, narrower
interpretation of responsibility history
([fresh-workflow.ts](../packages/orchestrator/src/coordination/run/fresh-workflow.ts#L248)). It does not answer the same question as
`deriveJournalResponsibilityFacts`. It answers whether a recorded entry should
prevent the same-process fresh workflow from deriving its next step. For
example, a same-process executor responsibility with a `Running` report is
allowed back into `journaledStepFor`, which derives
`ContinuePlannedAttemptExecutorWork`; a responsibility reconstructed at process
startup is excluded through `recoveredAttemptIds` and handled by the recovered
frontier instead. Claim and worktree entries similarly stop suppressing the
fresh chain after their matching outcomes, although their historical entries
remain in `WorkflowResponsibilityState`.

**Inference.** This is duplicate projection, not duplicate authority: both
copies are folds of the workflow journal and neither is persisted separately.
The completion acknowledgement prevents the ordinary next turn until the
current result has been accepted and the delivery relation refreshed
([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L230)). No test or
source path establishes a conflicting user-visible decision at this baseline.
The narrow helper and the full disposition projection could drift when a
responsibility family or outcome is added; a maintainer currently has to know
that both exist. That is a real maintenance risk, but the source also shows that
their answers intentionally differ for same-process and startup-recovered
executor work. Unifying them is not safely the same non-behavioral change as
carrying transition provenance. It would change the boundary between fresh and
recovered execution and therefore needs its own contradictory source evidence
or accepted behavior before work is opened. This audit records the risk but
does not create a second cleanup ticket.

## Material finding: transition provenance becomes hidden mutable state

**Source fact.** `readDeliveryActivationTurn` returns both `fresh` decisions and
the merged frontier. Before the coordinator sees it, `readFrontier` stores the
whole turn in `checkedTurn` and returns only the frontier. After the coordinator
selects a transition, `runTransition` reads `checkedTurn`, searches by selected
transition identity, and decides whether to call the fresh-step interpreter or
the recovered interpreter ([run.ts](../packages/orchestrator/src/coordination/run/run.ts#L131),
[run.ts](../packages/orchestrator/src/coordination/run/run.ts#L167),
[run.ts](../packages/orchestrator/src/coordination/run/run.ts#L197)). The
activation coordinator's deterministic checkpoints expose frontier, admission,
and ownership, but not this external dispatch state
([coordinator.ts](../packages/orchestrator/src/coordination/activation/coordinator.ts#L87)).

**Inference.** A maintainer must reconstruct an implicit invariant:
`checkedTurn` must be the exact turn from which the selected transition came.
If that relationship is broken during a later refactor, an unchanged
`RunnableFrontierTransition` can be sent to the wrong interpreter. Unit tests
can verify fresh derivation and coordinator selection independently while
missing that lost provenance. This is a material deterministic- and
model-based-test seam, not a naming preference.

## Mental-model comparison

| Candidate model | Fit | Evidence and limit |
|---|---|---|
| Immutable functional core plus Effectful interpreters | Strong but not complete | Reducers and frontier/fresh derivations are pure; `runFreshWorkflowStep`, recovery transition routing, and `WorkflowInterpreter` perform Effects. The live composition still relies on `Ref`, queues, semaphores, and fibers. Functional vocabulary alone proves no crash guarantee. |
| Reducer or event-fold reconstruction | Strong for Dalph journal history | Distinct pure reducers reconstruct graph knowledge, responsibility, pause, policy, and history. External tracker, Git, and executor authorities are reread; their full histories are not event-sourced into Dalph. |
| Projection, reconciliation, typed actions | Best description | Frames and frontiers are projections; the combined turn reconciles fresh and recorded work; closed step/transition unions begin typed actions. The provenance finding is exactly where reconciliation currently loses one typed distinction before action. |
| Ports and adapters | Strong at external boundaries | `WorkflowInterpreter`, `JournalStore`, executor, planners, trace, and control services are injected ports with live, fake, test, or dry adapters. The activation loop is domain composition, not an adapter. |
| Actor-like runtime ownership | Partial and useful | One scoped coordinator owns private mutable ownership, signals, and child fibers. It resembles an actor, but journal responsibility and external authority facts are not actor mailbox state. Restart reconstructs rather than reviving the actor. |
| Durable workflow or event-sourced coordination | Partial, bespoke | Intent/result records and folds provide durable continuation. There is no general durable-workflow engine here, no persisted program counter, and no claim that every Effect resumes automatically. Recovery rederives from history and fresh authority evidence. |

## Determinism, model-based testing, and compensation

**Source fact.** Pure reducers and projections are directly deterministic for
their explicit inputs. The activation coordinator provides deterministic
checkpoints for ownership/admission tests, and property tests cover capacity
and exact delayed release
([coordinator.property.test.ts](../packages/orchestrator/src/coordination/activation/coordinator.property.test.ts#L19)). Production task/Git reconciliation is exercised by model-based conformance tests
([task-fact MBT](../packages/dalph/test/conformance/task-fact-reconciliation.mbt.test.ts#L328),
[Git MBT](../packages/dalph/test/conformance/git-reconciliation.mbt.test.ts#L328)).

**Inference.** The hidden `checkedTurn` relation is the one important decision
input not carried through those deterministic surfaces. Making provenance an
immutable selected value lets a model or generated test compare “selected
fresh step” versus “selected recovered transition” without observing a private
`Ref` or recreating runtime timing.

**Source fact.** Compensation is boundary-specific, not a universal rollback:
the activation handoff cancels a pre-intent reservation when ownership cannot
be established, while post-intent work retains journal responsibility for
reconciliation ([coordinator.ts](../packages/orchestrator/src/coordination/activation/coordinator.ts#L409)). Executor positions release only on a safe or terminal report. Scope finalization shuts down triggers and acknowledges waiting callers; it does not erase durable responsibility
([coordinator.ts](../packages/orchestrator/src/coordination/activation/coordinator.ts#L551)).

**Inference.** The focused prefactor neither adds nor removes rollback. It must
preserve the exact point at which the selected route receives
`OwnedTransitionExecution`, so existing cancellation, intent binding, position
binding, and restart reconstruction remain unchanged.

## Implementation-ready follow-up

Publish one ticket: **Carry immutable transition provenance through activation
selection**.

Exact seam and constraints:

1. Introduce a package-internal immutable activation-plan value containing the
   `RunnableFrontier` and the exact runner/route associated with each selectable
   transition from that same derivation.
2. Let `makeActivationCoordinator` read one activation plan per pass and fork
   the runner captured by that plan after admission and ownership registration.
   The plan may be generic/opaque to the coordinator; the coordinator must not
   learn fresh-workflow tags or recovered-transition policy.
3. In `runDeliveryActivation`, construct fresh and recovered routes while
   reconciling the turn. Delete `checkedTurn` and the later identity-based
   search that guesses the route.
4. Do not change `WorkflowResponsibilityState`, `RunnableFrontierTransition`,
   admission ordering, capacity semantics, journal events, operation IDs,
   authority reads, workflow interpreters, completion acknowledgement, or
   fresh/recovered precedence. In particular, do not fold
   `responsibilityStillOwnsTask` or the two responsibility reconstructions into
   this prefactor.
5. Add a deterministic test in which fresh and recovered candidates coexist,
   the coordinator selects each under capacity, and the selected immutable
   route reaches only its matching interpreter. Retain the eight evidence
   paths above as regression coverage.
6. Keep the source-boundary assertion that there is one activation coordinator
   and no callback-linked stage chain; add an assertion that `checkedTurn` is
   absent.

Blocking edges: the follow-up depends on completed cutover issue #176 and this
decision issue #177. It does not block unrelated delivery-settlement work and
does not require new operational scenarios because it changes no accepted
runtime behavior.

## Rejected outcomes

- **No follow-up** was rejected because the mutable provenance handoff is a
  real hidden input to action routing and weakens deterministic/MBT locality.
- **Behavioral redesign** was rejected because all eight requested behaviors
  have a coherent production path and supporting tests; no contradictory or
  missing user-visible behavior was established.
- A broader “single snapshot for every journal projection” refactor was
  rejected for now. Duplicate reconstruction is visible and costs readability,
  but both values have one journal authority and the audit found no conflicting
  behavior that justifies widening this ticket.
- Combining responsibility-disposition consolidation with the immutable-route
  prefactor was rejected. The former can affect whether same-process `Running`
  work follows the fresh continuation or startup-recovery path; the latter only
  preserves provenance that the current turn already selected.
