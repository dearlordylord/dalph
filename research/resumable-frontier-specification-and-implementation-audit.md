# Resumable frontier specification and implementation audit

Status: inventory for
[Audit current specifications and implementation assumptions](https://github.com/dearlordylord/dalph/issues/116).
This document records locations and routes later decisions. It does not fix the
code or specifications, and it does not decide whether any component should be
retained, refactored, replaced, or deleted.

## Audit boundary

- Wayfinder destination:
  [Specify bounded resumable and pausable graph-frontier orchestration](https://github.com/dearlordylord/dalph/issues/114).
- Bootstrap source:
  [`docs/RESUMABLE-FRONTIER-PLANNING-MAP.md`](../docs/RESUMABLE-FRONTIER-PLANNING-MAP.md)
  at `5dc8f38c29d267b1aeabc88faa071c294e49818b`.
- Originating implementation specification:
  [Resume every legal durable workflow stage after coordinator death](https://github.com/dearlordylord/dalph/issues/112).
- Recovery implementation range: `6bff06f78..8977b93b3`.
- Current audited source: `master` at
  `5dc8f38c29d267b1aeabc88faa071c294e49818b`.
- Canonical documents:
  [`docs/CONTEXT.md`](../docs/CONTEXT.md),
  [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md),
  [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md),
  [`docs/CODE_REVIEW.md`](../docs/CODE_REVIEW.md),
  [ADR 0001](../docs/adr/0001-versioned-journal-evolution.md), and
  [ADR 0002](../docs/adr/0002-planned-task-attempt-admission.md).

The audit inspected the reducer, startup composition, ordinary workflow,
recovery continuations, graph observation payload, capacity control, focused
tests, property tests, SQLite reopening coverage, and current Quint model.
“Absent” below means that no implementing location was found. Absence preserves
the finding; it does not decide the later design.

## Preserved code and architecture findings

### A1. Pre-attempt ordinary work becomes a startup problem instead of a next action

**Locations**

- [`ManagedRunRecoveryStageEntry`](../packages/orchestrator/src/managed-run-recovery-stage.ts#L11-L60)
  declares claim, eligibility-refresh, and attempt-plan stages.
- [`deriveManagedRunRecoveryStage`](../packages/orchestrator/src/managed-run-recovery-stage.ts#L182-L250)
  creates those stages.
- [`recoverExactRunAfterCoordinatorDeath`](../packages/orchestrator/src/workflow-recovery.ts#L348-L383)
  continues only missing worktree, session, and execution operations. Every
  other nonterminal stage becomes `RecoveryProgressIssue`.
- The focused test
  [`does not treat an observed eligible task without a claim intent as terminal`](../packages/orchestrator/src/managed-run-recovery-stage.test.ts#L337-L445)
  explicitly expects `TaskClaimAcquisitionNeeded` to fail before selecting an
  operation.

**Current assumption or gap**

The reducer treats every task recorded by a graph observation as unfinished
pre-attempt work, but recovery has no operation-selection path for claim
acquisition, post-claim eligibility observation, or attempt-plan recording.
The coordinator therefore reports the ordinary work as a startup issue.

**Destination conflict or unresolved decision**

The destination requires recovery to re-enter ordinary orchestration and select
the next legal action. It also requires graph observation to remain distinct
from selection, so the later design must first decide which observed task, if
any, becomes Dalph's responsibility.

**Owning children**

- [Model authority, observation, knowledge, and responsibility](https://github.com/dearlordylord/dalph/issues/115)
  owns the observation/responsibility distinction.
- [Specify bounded frontier derivation, scheduling, and capacity](https://github.com/dearlordylord/dalph/issues/118)
  owns selection from the derived frontier.
- [Specify recovery activation and explicit durable stages](https://github.com/dearlordylord/dalph/issues/119)
  owns the next transitions for pre-attempt stages.

### A2. One recovery activation stops after one durable append

**Locations**

- [`recoverExactRunAfterCoordinatorDeath`](../packages/orchestrator/src/workflow-recovery.ts#L330-L365)
  returns success as soon as any reconciliation phase or one missing-stage
  continuation increases journal length.
- The focused test
  [`advances an exact planned attempt once and rejects a silent continuation`](../packages/orchestrator/src/managed-run-recovery-stage.test.ts#L948-L1121)
  expects success after recording worktree readiness while the immediately
  actionable session-establishment stage remains.

**Current assumption or gap**

Appending one fact is treated as sufficient progress for one startup recovery
call. The caller does not continue the reduced transition system to the next
actionable stage.

**Destination conflict or unresolved decision**

One activation must continue until actionable work reaches a named wait,
pause, isolation, relinquished-responsibility state, explicit disposition, or
terminal state.

**Owning child**

[Specify recovery activation and explicit durable stages](https://github.com/dearlordylord/dalph/issues/119).

### A3. Later evidence, review, handback, rework, and disposition gaps are one stage

**Locations**

- [`ManagedRunRecoveryStageEntry`](../packages/orchestrator/src/managed-run-recovery-stage.ts#L46-L60)
  has one `ImplementationConvergencePending` variant for every post-execution
  nonterminal state.
- [`stageForAttempt`](../packages/orchestrator/src/managed-run-recovery-stage.ts#L145-L167)
  selects that variant as soon as one execution outcome exists.
- [`recoverImplementationConvergences`](../packages/orchestrator/src/implementation-convergence-recovery.ts#L19-L230)
  discovers evidence, review, handback, rework, and disposition state through
  optional values and imperative branches outside the total recovery-stage
  union.

**Current assumption or gap**

The reducer exposes no distinct durable stages for evidence sealing, review
intent/result, findings handback, same-session rework, retry deferral, or final
disposition. Adding a later workflow phenomenon does not force an exhaustive
recovery-stage update.

**Destination conflict or unresolved decision**

The destination requires an explicit taxonomy and exhaustive next transition
for each legal later prefix.

**Owning child**

[Specify recovery activation and explicit durable stages](https://github.com/dearlordylord/dalph/issues/119).

### A4. Fresh eligibility and reconciliation order varies by stage

**Locations**

- [`refreshPlannedAttemptEligibility`](../packages/orchestrator/src/workflow-stage-recovery.ts#L91-L168)
  reads the exact current claim, but only the following generic graph read is
  journaled. The claim check itself has no durable eligibility-observation
  intent or typed outcome.
- [`continuePlannedTaskAttemptStage`](../packages/orchestrator/src/workflow-stage-recovery.ts#L177-L266)
  performs that refresh before selecting a missing worktree, session, or
  execution operation.
- [`recoverExactRunAfterCoordinatorDeath`](../packages/orchestrator/src/workflow-recovery.ts#L319-L342)
  performs the same preflight for an initially
  `ImplementationConvergencePending` stage, then recovers unresolved worktree,
  session, and execution intents without the same preflight.
- [`recoverTaskWorktreeReconciliations`,
  `recoverTaskWorkSessionEstablishments`, and
  `recoverTaskExecutions`](../packages/orchestrator/src/workflow-operation-recovery.ts#L73-L144)
  reconcile unresolved intents directly.
- [ADR 0002](../docs/adr/0002-planned-task-attempt-admission.md#coordinator-death-recovery-rules)
  requires a durable `ObserveClaimedTaskEligibility` operation and typed
  positive or negative result; a generic graph outcome is not eligibility
  evidence.

**Current assumption or gap**

A process-local exact-claim read plus a durable generic graph outcome is treated
as sufficient fresh eligibility lineage for newly selected later operations.
An unresolved operation follows its existing reconciliation protocol without
the same current-eligibility preflight. The specifications do not yet decide the
stage-by-stage order among responsibility checks, fresh eligibility, and
reconciliation of an already-recorded ambiguity-crossing intent.

**Destination conflict or unresolved decision**

The current implementation does not implement ADR 0002's durable eligibility
boundary. The broader destination also requires one explicit reconciliation
order for ordinary work, crash recovery, pause, and resume.

**Owning children**

- [Specify recovery activation and explicit durable stages](https://github.com/dearlordylord/dalph/issues/119)
  owns stage-specific ordering.
- [Specify reconciliation when the world changes](https://github.com/dearlordylord/dalph/issues/120)
  owns the boundary-specific classification of changed authority facts.

### A5. Graph observation creates task-selection responsibility

**Locations**

- [`WorkflowOutcome.TrackerGraphObserved`](../packages/orchestrator/src/workflow-outcome.ts#L6-L36)
  records only a tracker revision and every task ID in topological order. It
  records no canonical task/dependency facts, observed region, coverage,
  absence, completeness, or replacement semantics.
- [`deriveManagedRunRecoveryStage`](../packages/orchestrator/src/managed-run-recovery-stage.ts#L226-L250)
  turns every observed task ID without a claim or plan into
  `TaskClaimAcquisitionNeeded`.
- [`runWorkflow`](../packages/orchestrator/src/workflow-run.ts#L54-L89)
  takes the initially eligible snapshot as the complete candidate list and
  starts one claim path for each candidate.
- The pre-attempt property
  [`classifies every generated pre-attempt fact-to-next-intent crash prefix`](../packages/orchestrator/src/managed-run-recovery-stage.property.test.ts#L74-L155)
  requires graph observation to create exactly one claim-needed recovery entry.

**Current assumption or gap**

The durable graph payload cannot reconstruct graph knowledge, yet its task-ID
membership creates claim-selection responsibility. Because the payload contains
`topologicalOrder()` rather than eligible task IDs, the reducer can also create
claim-needed entries for blocked or closed tasks.

**Destination conflict or unresolved decision**

The destination distinguishes current tracker facts, canonical historical
observations, reconstructed knowledge, derived frontier membership, selection,
capacity admission, and responsibility. None of the required partial
observation semantics is represented.

**Owning children**

- [Model authority, observation, knowledge, and responsibility](https://github.com/dearlordylord/dalph/issues/115)
  owns the canonical observation and reconstructed-knowledge model.
- [Specify bounded frontier derivation, scheduling, and capacity](https://github.com/dearlordylord/dalph/issues/118)
  owns the selection and responsibility transition.

### A6. Ordinary and resumed work use separate capacity/frontier control

**Locations**

- [`runWorkflow`](../packages/orchestrator/src/workflow-run.ts#L45-L68)
  receives `TaskWorkCapacity`; its
  [`Effect.forEach`](../packages/orchestrator/src/workflow-run.ts#L67-L313)
  bounds the entire ordinary per-task path.
- [`continuePlannedTaskAttemptStage`](../packages/orchestrator/src/workflow-stage-recovery.ts#L238-L265)
  emits `TaskExecutionAdmitted` and calls the executor without a capacity
  capability.
- [`recoverExactRunAfterCoordinatorDeath`](../packages/orchestrator/src/workflow-recovery.ts#L348-L361)
  loops over recovered attempts without the ordinary controller or accounting
  for provider work already running after restart.
- [`productionWorkflowInterpreterLayer`](../packages/orchestrator/src/production-application.ts#L170-L205)
  performs recovery while constructing the startup Layer, before it returns the
  interpreter used for ordinary work.

**Current assumption or gap**

The configured bound controls a one-shot ordinary traversal only. Recovery can
admit execution without a shared permit, has no durable wait state when
capacity is full, and cannot continue unaffected ordinary work concurrently
with recovered work.

**Destination conflict or unresolved decision**

Ordinary and resumed work must use one bounded frontier controller. The later
specification must decide selection order, permitted nondeterminism, capacity
reconstruction, and waiting.

**Owning child**

[Specify bounded frontier derivation, scheduling, and capacity](https://github.com/dearlordylord/dalph/issues/118).

### A7. A branch-local problem blocks application startup

**Locations**

- [`observeManagedRunAuthorities`](../packages/orchestrator/src/workflow-recovery.ts#L128-L302)
  converts each unreadable or contradictory authority observation into a
  run-scoped issue.
- [`productionWorkflowInterpreterLayer`](../packages/orchestrator/src/production-application.ts#L170-L205)
  aggregates issues from every discovered run and fails Layer construction with
  one `StartupRecoveryBlocked`.
- [`StartupRecoveryBlocked`](../packages/orchestrator/src/production-application.ts#L42-L58)
  has no branch, resource-isolation, responsibility-relinquishment, wait, or
  unaffected-continuation variant.
- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#durability-and-reconstruction)
  currently says startup fails closed after collecting issues, without
  distinguishing a managed-history contradiction from a branch-local authority
  problem.

**Current assumption or gap**

Every preserved recovery issue prevents the production interpreter from
starting. The code cannot record that Dalph lost responsibility, isolate one
resource, wait for one authority, or continue another legal branch.

**Destination conflict or unresolved decision**

Only a condition preventing every legal continuation can block a whole run.
The later policy must classify each boundary observation and decide whether the
affected scope is a resource, branch, run, or application.

**Owning children**

- [Model authority, observation, knowledge, and responsibility](https://github.com/dearlordylord/dalph/issues/115)
  owns branch-local responsibility and disposition.
- [Specify reconciliation when the world changes](https://github.com/dearlordylord/dalph/issues/120)
  owns the boundary-by-boundary classifications.
- [Specify recovery activation and explicit durable stages](https://github.com/dearlordylord/dalph/issues/119)
  owns the resulting wait, isolation, relinquishment, and terminal stages.

### A8. The current implementation's disposition is deliberately undecided

**Locations**

- The one-shot controller is
  [`runWorkflow`](../packages/orchestrator/src/workflow-run.ts#L45-L313).
- Recovery is embedded in
  [`productionWorkflowInterpreterLayer`](../packages/orchestrator/src/production-application.ts#L64-L205).
- The local recovery taxonomy is
  [`ManagedRunRecoveryStageEntry`](../packages/orchestrator/src/managed-run-recovery-stage.ts#L11-L86).
- The global blocker is
  [`StartupRecoveryBlocked`](../packages/orchestrator/src/production-application.ts#L42-L58).

**Current assumption or gap**

These locations encode the startup-recovery design described above. This audit
does not infer that missing destination behavior invalidates all of their
protocol code, and it does not treat their existence as a reason to preserve
their architecture.

**Destination conflict or unresolved decision**

Retain/refactor/replace/delete depends on the accepted domain model, workflow
rules, and checked formal model and therefore cannot be decided in this child.

**Owning child**

[Audit architecture against the accepted model](https://github.com/dearlordylord/dalph/issues/125).

## Preserved test and formal-model findings

### T1. Capacity one, two eligible tasks, and a crash is absent

**Locations**

- [`reserves no more than the configured concurrent task attempts`](../packages/orchestrator/src/workflow.test.ts#L441-L473)
  tests two ordinary concurrent paths with capacity two and interrupts the live
  fiber before work proceeds.
- [`task-work-capacity.test.ts`](../packages/orchestrator/src/task-work-capacity.test.ts)
  tests only configuration bounds.
- No test combines two eligible tasks, capacity one, durable observation, a
  crash before selection, and restart.

**Current assumption or gap**

Existing tests do not prove that observing both tasks selects at most one or
creates responsibility for at most one.

**Destination decision**

Frontier selection and capacity semantics must first be specified, then this
scenario must become required model-based and implementation coverage.

**Owning children**

- [Specify bounded frontier derivation, scheduling, and capacity](https://github.com/dearlordylord/dalph/issues/118).
- [Define model-based and crash/pause-prefix test coverage](https://github.com/dearlordylord/dalph/issues/123).

### T2. Legal fact-to-next-intent coverage is partial

**Locations**

- [`managed-run-recovery-stage.property.test.ts`](../packages/orchestrator/src/managed-run-recovery-stage.property.test.ts)
  generates one acknowledged-plan prefix and five pre-attempt prefixes, not the
  complete workflow algebra.
- [`managed-run-recovery-stage.test.ts`](../packages/orchestrator/src/managed-run-recovery-stage.test.ts#L174-L235)
  classifies early gaps, then groups every later successful-execution prefix as
  `ImplementationConvergencePending`.
- [`production-application.test.ts`](../packages/orchestrator/src/production-application.test.ts#L76-L219)
  reopens SQLite for one unresolved session-establishment boundary. It does not
  truncate and reopen every legal prefix.

**Current assumption or gap**

Focused examples cover selected recovery paths. They do not enumerate every
durable fact-to-next-intent boundary through both in-memory reduction/recovery
and production SQLite reopening.

**Destination decision**

The exhaustive stage taxonomy and checked formal model must define the legal
prefix set before the coverage matrix is finalized.

**Owning children**

- [Specify recovery activation and explicit durable stages](https://github.com/dearlordylord/dalph/issues/119).
- [Define model-based and crash/pause-prefix test coverage](https://github.com/dearlordylord/dalph/issues/123).

### T3. Pause, resume, and external-change coverage is absent

**Locations**

- No production type, workflow operation, reducer event, or test under
  `packages/orchestrator` names a pause request, paused/quiescent state, or
  resume request.
- The only current pause wording in
  [`docs/CONTEXT.md`](../docs/CONTEXT.md#run-termination) says that a paused run
  is not a run termination; it does not define pause.
- Existing recovery tests cover selected tracker, Git, session, execution,
  evidence, and review observations, but no whole-run pause, task/dependency
  pause, resume, or unaffected-branch progress matrix.

**Current assumption or gap**

Pause is not a represented domain phenomenon, so neither code nor tests can
express its intent, safe boundary, quiescence proof, affected graph region, or
resumption after external changes.

**Destination decision**

Pause subjects and safe boundaries, external-change reconciliation, and the
resulting coverage matrix all remain open.

**Owning children**

- [Specify whole-run, task, and dependency pause semantics](https://github.com/dearlordylord/dalph/issues/117).
- [Specify reconciliation when the world changes](https://github.com/dearlordylord/dalph/issues/120).
- [Define model-based and crash/pause-prefix test coverage](https://github.com/dearlordylord/dalph/issues/123).

### T4. The current Quint model covers one session operation, not the graph frontier

**Locations**

- [`specs/taskWorkSessionRecovery.qnt`](../specs/taskWorkSessionRecovery.qnt#L1-L26)
  explicitly models one session-establishment operation.
- Its state has no task graph, frontier, capacity, pause, branch responsibility,
  or external-change scope.

**Current assumption or gap**

The current model can support the later retry-identity investigation, but it
cannot prove bounded graph traversal, independent branch progress, pause, or
resume properties.

**Destination decision**

The accepted domain and policy decisions must be formalized as a new bounded
frontier model.

**Owning children**

- [Build and check the Quint model](https://github.com/dearlordylord/dalph/issues/122).
- [Define model-based and crash/pause-prefix test coverage](https://github.com/dearlordylord/dalph/issues/123).

### T5. A broader legal-history generator remains conditional

**Locations**

- [`managed-run-recovery-stage.property.test.ts`](../packages/orchestrator/src/managed-run-recovery-stage.property.test.ts)
  uses narrow generators for selected prefixes.
- No generator constructs complete legal multi-task histories across the
  accepted future operation algebra.

**Current assumption or gap**

There is not yet evidence that a broad arbitrary adds useful state-space
coverage beyond traces generated from the future Quint model and required
boundary matrix.

**Destination decision**

The generator remains optional and lower priority until the model and coverage
audit can compare its value with required trace-prefix coverage.

**Owning child**

[Define model-based and crash/pause-prefix test coverage](https://github.com/dearlordylord/dalph/issues/123).

## Current specification conflicts and absences

1. [ADR 0002](../docs/adr/0002-planned-task-attempt-admission.md#causal-graph)
   says a generic `TrackerGraphOutcomeObserved` cannot authorize planning, but
   current workflow and recovery code still use generic graph observation plus
   `TrackerExecutionAdmitted` terminology. The concrete durable
   `ObserveClaimedTaskEligibility` intent and typed positive/negative outcomes
   are absent from the implementation.
2. [`docs/CONTEXT.md`](../docs/CONTEXT.md#managed-run-recovery-stage) and
   [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#durability-and-reconstruction)
   describe every “unfinished pre-attempt task” as a recovery-stage entry. They
   do not distinguish a task known from an observation from a task selected into
   Dalph's responsibility.
3. [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#durability-and-reconstruction)
   requires rejection of inert recovery but permits any durable append to count
   as progress. It does not yet require one activation to continue through all
   immediately actionable stages.
4. The same architecture section says startup fails closed after collecting
   issues. It does not classify which issues invalidate managed history, isolate
   one branch or resource, create a wait condition, or block the whole run.
5. No canonical document defines graph-observation region, coverage,
   completeness, absence, revision, replacement, or partial multi-read
   semantics. The implementation payload records only revision and task IDs.
6. No canonical document, ADR, domain type, or workflow operation defines a
   whole-run pause, task pause, dependency-defined pause, safe pause boundary,
   quiescence proof, or resume command.
7. Issue 112 specifies exhaustive recovery for the then-current workflow and
   exact planned attempts. It does not specify the broader evolving graph
   frontier, unified capacity, pause, responsibility loss, or unaffected branch
   progress. Its still-valid exact-attempt and intent-before-effect requirements
   remain inputs rather than a complete destination specification.

All specification changes are synthesized only after the owning investigations
resolve, by
[Synthesize accepted specs and ADR changes](https://github.com/dearlordylord/dalph/issues/124).

## Existing behavior that remains an input, not a conclusion

- The journal stores workflow history, and
  [`ManagedRunRecoveryStage`](../packages/orchestrator/src/managed-run-recovery-stage.ts#L79-L86)
  remains a derived value rather than persisted authority.
- Acknowledged planned attempts retain exact task, revision, Base SHA, branch,
  worktree, executor, session locator, and attempt identity.
- Recovery of an already-recorded ambiguity-crossing worktree, session, or
  execution intent reuses that operation rather than silently planning a
  replacement.
- Ordinary and recovery paths call the same `WorkflowInterpreter` operation
  handlers, although they do not yet share one operation-selection and capacity
  controller.

These observations do not decide the later architecture classification.

## Bootstrap research-obligation routing

| Bootstrap obligation | Current location or absence | Owner |
| --- | --- | --- |
| Audit current specification and code assumptions | This inventory | [Audit current specifications and implementation assumptions](https://github.com/dearlordylord/dalph/issues/116) |
| Decide partial-observation coverage, completeness, absence, revision, and replacement semantics | Absent; current payload is [`TrackerGraphObserved`](../packages/orchestrator/src/workflow-outcome.ts#L6-L36) | [Model authority, observation, knowledge, and responsibility](https://github.com/dearlordylord/dalph/issues/115) |
| Verify worktree and session retry identity | Duplicate worktree/session intents are categorically rejected in [`managed-history.ts`](../packages/orchestrator/src/managed-history.ts#L674-L705); current session behavior is modeled in [`taskWorkSessionRecovery.qnt`](../specs/taskWorkSessionRecovery.qnt) | [Verify duplicate intents and retry identity](https://github.com/dearlordylord/dalph/issues/121) |
| Record real observability and control limits at each boundary | No complete capability matrix exists | [Specify reconciliation when the world changes](https://github.com/dearlordylord/dalph/issues/120) |
| Decide retain/refactor/replace/delete after accepted model | Deliberately not decided here | [Audit architecture against the accepted model](https://github.com/dearlordylord/dalph/issues/125) |

No additional sharp child emerged from this audit. The existing children above
own every preserved finding, so no fog graduates and no new blocking edge is
required.

## Standards

The independent standards review found three hard conflicts and one judgement
call:

1. The process-local exact-claim check followed by a generic durable graph
   outcome does not implement ADR 0002's exact durable eligibility boundary.
   The related property test also accepts a planned attempt with no causal
   eligibility predecessor.
2. Recovery admits task execution without the configured task-work-capacity
   controller or accounting for execution already running at restart.
3. Recovery returns after the first per-stage failure, so a problem on one
   attempt can hide independent reconciliation facts on later attempts despite
   the architecture's collection requirement.
4. `admission` and `TrackerExecutionAdmitted` are a possible Mysterious Name:
   they compress graph reading, exact-claim verification, eligibility, and
   execution admission into obsolete shorthand.

## Spec

The independent specification review found seven preserved gaps:

1. Pre-attempt claim, eligibility, and plan stages report a typed startup issue
   instead of selecting ordinary next work.
2. Recovery intentionally stops after one durable append.
3. Post-execution stages are not exhaustively represented.
4. Graph observation is promoted to selection responsibility.
5. Ordinary and resumed work lack one bounded frontier/capacity controller and
   explicit wait/pause/isolation states.
6. Branch-local issues become global startup failure.
7. Required fact-to-next-intent, pause/resume, external-change, and SQLite
   reopening coverage is incomplete or absent.

Review summary: Standards has three hard findings and one judgement-call smell;
the highest-risk standard conflict is execution outside shared capacity. Spec
has seven findings; the broadest is the missing observation-to-selection
boundary that the future graph-frontier controller depends on.
