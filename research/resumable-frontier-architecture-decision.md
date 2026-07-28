# Resumable frontier architecture decision

Status: accepted architecture decision for
[Audit architecture against the accepted model](https://github.com/dearlordylord/dalph/issues/125).
This decision classifies the implementation baseline so that later work can be
sliced without treating either existing code or a rewrite as the default.
It changes no production code and creates no implementation tickets.

## Decision boundary

The audited baseline is `master` at
`652900f1216f578b6a2ddeea23ca20bd15337945`. The controlling inputs are:

- the accepted
  [bounded resumable graph-frontier specification](../docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md);
- the canonical [domain language](../docs/CONTEXT.md),
  [architecture](../docs/ARCHITECTURE.md), and ADRs
  [0004](../docs/adr/0004-compose-pure-managed-run-reducers.md) through
  [0010](../docs/adr/0010-govern-recovery-with-two-quint-models.md);
- the checked
  [`frontierRecovery`](../specs/frontierRecovery.qnt) and
  [`taskWorkSessionRecovery`](../specs/taskWorkSessionRecovery.qnt) models; and
- the earlier
  [specification and implementation audit](resumable-frontier-specification-and-implementation-audit.md).

The decision applies the deletion test at each module. Exact protocols that
would otherwise be duplicated across callers retain useful depth. Modules whose
deletion removes an obsolete orchestration concept, rather than spreading
necessary complexity, are replaced and then deleted.

## Decision

Replace the two current orchestration topologies with one deep control-plane
module. It reconstructs graph knowledge, workflow history, per-subject
responsibility, and pause state; derives every legal per-responsibility
transition; chooses a bounded admission set through one process-local capacity
controller; and executes selected operations through the existing interpreter
seam. Ordinary startup, restart, resume, and every recorded result activate
that same loop until all responsibilities have an exact transition or an
explained wait, pause, isolation, relinquishment, settlement, final outcome, or
typed issue.

This is a control-plane replacement over retained boundary protocols. It is not
a rewrite of the tracker, journal, Git, task-work-provider, evidence, or current
review-protocol implementations.

| Current module or module family | Disposition | Concrete decision |
| --- | --- | --- |
| [`workflow-run.ts`](../packages/orchestrator/src/workflow-run.ts) | Replace, then delete | Replace the one-shot `eligibleTasks()` traversal and whole-task `Effect.forEach` capacity limit with the shared activation, frontier, and admission modules. No compatibility wrapper remains. |
| [`managed-run-recovery-stage.ts`](../packages/orchestrator/src/managed-run-recovery-stage.ts) and [`workflow-stage-recovery.ts`](../packages/orchestrator/src/workflow-stage-recovery.ts) | Replace, then delete | Per-subject responsibility plus the ordinary transition selector supersede `ManagedRunRecoveryStageEntry`. Recovery does not need a second local taxonomy or stage-specific continuation dispatcher. |
| [`workflow-recovery.ts`](../packages/orchestrator/src/workflow-recovery.ts) | Refactor substantially | Retain exact boundary reconciliation functions and typed observations, but move activation and classification into the shared selector. Remove the fixed startup phase list, “one append means return,” and whole-run early returns. |
| [`production-application.ts`](../packages/orchestrator/src/production-application.ts) | Refactor substantially | Keep scoped coordinator ownership and Layer composition. Startup discovers and validates every run, supplies fresh facts to the shared control plane, isolates exact affected regions, and continues independent work. Delete `StartupRecoveryBlocked` after callers consume subject-scoped startup results; only invalid shared history or a shared capability needed by every continuation may fail the whole application. |
| [`managed-history.ts`](../packages/orchestrator/src/managed-history.ts) | Refactor and deepen | Retain ordered total validation, identity checks, and accumulated typed issues. Split the current monolithic fold behind one reconstructed-managed-run interface that composes distinct graph-knowledge, workflow-history, responsibility, and pause reducers. Stop returning a recovery-stage projection. |
| [`task-dag.ts`](../packages/orchestrator/src/task-dag.ts), tracker graph readers, and graph outcome types | Refactor and deepen | Retain provider decoding, identity normalization, closure validation, cycle detection, and deterministic task ordering. Replace `eligibleTasks()` as an orchestration interface with normalized graph facts carrying declared coverage, completeness, consistency, freshness, and proven absence. A graph-knowledge reducer, not graph membership, supplies the selector's facts. |
| [`workflow-operation.ts`](../packages/orchestrator/src/workflow-operation.ts), [`workflow.ts`](../packages/orchestrator/src/workflow.ts), and journaled interpreters | Retain and refactor at the edges | Preserve the operation algebra, `WorkflowInterpreter` seam, Layer substitution, stable `OperationId`, and intent-before-effect ordering. Add accepted control, read, constraint, responsibility, integration, completion, and disposition operations as current consumers require them; remove mode-shaped or obsolete operations only when their callers migrate. |
| Claim, worktree, session-establishment, and task-execution protocol modules | Retain | Their exact identity, immutable payload, causal predecessor, fresh-result-check, typed conflict, and reconcile-before-retry behavior provide leverage across ordinary and restarted execution and correspond to `AmbiguityBoundaryV1`. Adapt their results into the new reconstructed-state reducers instead of reimplementing them. |
| Implementation evidence, review, handback, retry, and convergence modules | Retain as the review-loop executor; refactor behind the executor seam | The accepted review-loop protocol still requires them, so deleting them would lose behavior. The outer control plane must stop treating their internal stages and artifacts as universal Dalph stages. The executor reports outer transitions, waits, correlation identities, provider lifecycle, and outcomes; Dalph owns task-work capacity. For example, an active executor report changes the state of the task's existing position rather than adding an executor-owned position. Issue #127 owns whether later executors make review optional or store different internal evidence. |
| Existing focused protocol, Schema, property, SQLite, and interpreter-equivalence tests | Retain where their production seam survives | Keep tests that prove an exact retained boundary contract. Replace tests that assert `ManagedRunRecoveryStageEntry`, one-shot traversal, or global startup blockage. Every behavior slice also updates the owning Quint model, test-only adapter, semantic trace, and applicable in-memory and SQLite P0–P6 conformance-test cut points. These labels are test vocabulary, never production stages or states. |

## Why the current topology is replaced

### Ordinary and restarted work are different programs

`runWorkflow` reads one snapshot, forks one complete path for every initially
eligible task, and applies `TaskWorkCapacity` to those complete paths.
Production startup separately constructs recovery while building the
`WorkflowInterpreter` Layer. The recovery path selects execution without the
ordinary capacity limit and returns after one durable append. Neither path can
give already-owned responsibility priority over fresh work or continue an
independent task while another task is isolated. Recovery also synthesizes
`recovery:*` operation identities through a separate allocator rule, so the
choice of activation path changes identity allocation.

Deleting either topology does not spread required behavior through callers:
one shared activation module absorbs it. The replacement therefore increases
locality and gives ordinary execution, restart, resume, dry-run, deterministic
tests, and production the same interface and transition algebra.

### The recovery-stage union encodes workflow position, not responsibility

`ManagedRunRecoveryStageEntry` infers unfinished work from observed graph
membership, compresses every post-execution prefix into
`ImplementationConvergencePending`, and assigns one apparent stage to each
attempt. The accepted model permits several independent responsibilities,
constraints, and legal transitions for one attempt at the same time.

Extending this union would encode the Cartesian product rejected by the domain
model. Replacing it with distinct reducers and exact per-responsibility
transitions makes invalid combinations explicit without creating one ever
larger stage enum.

### Global startup failure confuses invalid history with changed external facts

`observeManagedRunAuthorities` rereads resources, but
`productionWorkflowInterpreterLayer` aggregates every unreadable or
contradictory fact into `StartupRecoveryBlocked`. Git changing one worktree or
a provider being unable to report one session can therefore prevent unrelated
runs and branches from starting.

Journal decoding or semantic-history contradictions remain fail-closed for the
affected run because no safe state can be reconstructed. A worktree mismatch,
foreign claim, unavailable session, or unreadable provider result instead
becomes the accepted subject-specific constraint, wait, disposition, or
isolation. The application fails only when a shared capability or shared
managed-history fault prevents every otherwise legal continuation.

## Authority and ownership correction

The task tracker owns tasks and claims; Git owns worktrees and lineage; the
task-work provider owns sessions, work units, and worker observations; and the
executor owns its internal implementation, restoration, review, and artifact
strategy. Dalph owns only its recorded workflow history and outstanding
coordination responsibilities.

Consequently:

- a graph observation never selects a task or creates responsibility;
- dirty worktree content, provider records, executor output, review evidence,
  and agent activity are observations, not proof of Dalph's exclusive control
  or of who changed them;
- a fresh task becomes Dalph's responsibility only when its first exact
  ambiguity-crossing intent is durably recorded;
- loss of permission to change a tracker task does not erase separate
  responsibilities for a worktree, session, invocation, or disposition; and
- current review and evidence artifacts remain usable only through the selected
  executor protocol. They are not universal task-completion authority.

## Implementation slicing constraints

Issue #126 may create tracer-bullet tickets from these slices. The edges below
are architectural blocking edges, not tickets.

1. **Reconstruction seam.** Introduce normalized graph-knowledge events and
   distinct pure graph, workflow-history, responsibility, and pause reducers
   behind one reconstructed-run interface. Preserve current journal decoding,
   upcasting, and exact protocol histories. This blocks every later selector
   slice.
2. **Frontier and admission seam.** Add the pure transition derivation, exact
   explanations, deterministic responsibility-first ordering, and one scoped
   capacity controller. Connect its public actions and projections to
   `frontierRecovery` as part of the same change. This depends on reconstruction.
3. **Shared activation seam.** Drive fresh work and retained responsibilities
   through the selector after every result until only exact explanations
   remain. Migrate ordinary execution and startup recovery to it before
   deleting `runWorkflow`, the recovery-stage union, and the fixed recovery
   phase dispatcher. This depends on frontier and admission.
4. **Control and reconciliation seam.** Add run/task pause commands,
   active-continuation reads, independent constraints, safe-boundary actions,
   exact dispositions, integration, completion, and finality incrementally.
   Each vertical behavior slice includes its authority adapter and the required
   model, semantic-trace, and dual-store prefix coverage. These slices depend
   on reconstruction and the selector but may be split by authority boundary.
5. **Executor seam.** Move the current evidence/review/handback/convergence
   implementation behind an outer protocol without changing its accepted
   behavior. Dalph keeps the capacity requirement outside that protocol. For
   example, the executor reports provider lifecycle while Dalph decides whether
   the transition needs one task-work position. Do not decide configurable
   pipelines here; preserve issue #127's ability to replace this adapter
   without changing the outer frontier and responsibility modules.

### Executor source-boundary reconciliation

The later
[review-loop executor source-boundary decision](review-loop-executor-source-boundary-decision.md)
clarifies the preceding baseline disposition. The retained generic
`WorkflowOperation` and `WorkflowInterpreter` seams contain only
orchestrator-facing members. Review-loop internal operations, events,
validation, reconstruction, artifacts, and provider adapters move behind one
injected executor bundle in an enforced module tree. A stage-name-free test
bundle proves the seam without adding production executor selection.

Issue #127 remains the v2 owner for per-attempt executor identity,
configuration, event routing across multiple executor protocols, missing
executor handling, and operator-visible restart under another executor. The
current v1 source refactor may replace unreleased journal schemas without
preserving repository fixtures as compatibility targets.

No slice may temporarily create a second durable frontier, capacity record,
responsibility rollup, or UI state. A compatibility adapter is acceptable only
while it translates one retained exact boundary protocol into the new reducer;
it must not keep the old scheduler or recovery taxonomy alive.

## Independent review results

### Standards

The standards pass found four hard architecture conflicts and one associated
Mysterious Name judgement:

1. [`workflow-recovery.ts`](../packages/orchestrator/src/workflow-recovery.ts)
   returns the first task-local eligibility issue, and
   [`production-application.ts`](../packages/orchestrator/src/production-application.ts)
   promotes it to application-wide startup failure. This violates the accepted
   rule that one unavailable branch stops another only when the latter requires
   its facts or a shared resource.
2. Recovery treats any increase in journal length as a completed activation.
   The accepted architecture explicitly says that an append alone is not a
   return boundary.
3. Resumed execution emits `TaskExecutionAdmitted` without the shared frontier,
   deterministic responsibility-first ordering, or configured capacity
   controller. Sequential iteration happens to limit this path to one; it does
   not implement the configured admission protocol.
4. One attempt-level `ManagedRunRecoveryStageEntry` cannot represent distinct
   actionable, waiting, isolated, retained, and settled responsibilities.
   `Terminal` and `ImplementationConvergencePending` are also mysterious names:
   neither names the concrete subject or responsibility that is terminal or
   pending.

No other Fowler smell remained material after applying the repository's
documented rules and tooling gates.

### Specification

The specification pass confirmed five structural conflicts:

1. ordinary work, startup recovery, and resume do not invoke the same selector
   after every recorded result;
2. ordinary and resumed invocations do not share one capacity controller or
   responsibility-first admission rule;
3. the recovery-stage union and global startup blocker collapse per-subject
   responsibility and subject-local reconciliation into attempt-wide stages
   and application-wide failure;
4. graph membership and `eligibleTasks()` currently stand in for graph
   knowledge, frontier membership, admission, and durable responsibility; and
5. exact Git, session, and execution reads should remain, but reviewer recovery
   currently reauthorizes an evidence manifest rather than freshly observing
   reviewer-provider state. Provider-owned logs and internal artifacts cannot
   become Dalph authority.

These findings support replacing the control-plane shell while retaining the
exact operation interpreters and boundary protocols. They do not support a
compatibility layer for the historical harness or a blanket rewrite.

## Rejected alternatives and findings

- **Rewrite every protocol.** Rejected because claim, worktree, session, task
  execution, journal, evidence, and review modules already enforce valuable
  exact-boundary invariants. Rewriting them adds risk without solving the
  topology mismatch.
- **Extend `ManagedRunRecoveryStageEntry`.** Rejected because one stage per
  attempt cannot represent multiple responsibilities and independent
  constraints without an invalid-state Cartesian product.
- **Keep startup recovery as Layer construction.** Rejected because recovered
  and fresh work would still use different selectors and capacity control.
  Layer construction should acquire scoped capabilities and start the shared
  control plane, not embody a second workflow.
- **Delete the current review loop now.** Rejected because it is the accepted
  current executor protocol and issue #127 is explicitly non-blocking. It is
  isolated behind the executor seam instead of promoted to universal Dalph
  architecture.
- **Translate Quint state types directly into production types.** Rejected
  because the models are bounded abstractions. Production types implement the
  accepted domain phenomena and expose the versioned projections needed for
  model comparison; the model is not a second production architecture.
