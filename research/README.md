# Dalph research index

This directory contains decision inputs, source audits, architecture studies,
and historical experiments. This index organizes them by the questions that
matter to Dalph now.

Research documents are evidence, not product requirements. Accepted issues,
operational scenarios, architecture documents, and specifications remain
authoritative.

## Start here

| Question | Current document | Status |
|---|---|---|
| Does Dalph's main idea overlap serious competitors? | [Graph-bounded, restorable competitive wedges](./graph-bounded-restorable-competitive-wedges.md) | Current first comparison. The technical conclusions need the deeper reliability audit below. |
| What mental model does each control plane use? | [Control-plane mental-model atlas](./control-plane-mental-model-atlas.md) | Current source-inferred synthesis; no crash experiments are claimed. |
| Which parts of Dalph are architecture, implementation, or proven behavior? | [Dalph competitive evidence ledger](./dalph-competitive-evidence-ledger.md) | Current revision-by-revision evidence boundary. |
| How will we compare reliability and maintainability? | [Control-plane reliability architecture plan](./control-plane-reliability-architecture-plan.md) | Current research plan. |
| What did the first technical source sample find? | [Control-plane reliability architecture pre-study](./control-plane-reliability-architecture-prestudy.md) | Historical first source sample; the ten full architecture cards are now complete. |
| Which source repositories and closed-product documents were captured? | [Competitor reference index](../.references/COMPETITORS.md) | Current pinned-source index. |
| What does Chartr actually implement? | [Chartr source comparison](./chartr-source-comparison.md) | Current source audit; Chartr is cockpit prior art, not a delivery control plane. |

## Current research themes

### 1. Competitor intersection

The important question is not whether another tool has a Kanban board or starts
several agents. It is whether it combines:

- dependency-based task selection;
- a limit on simultaneous work;
- isolated Git work for each task;
- pause, restart, and recovery;
- agent execution;
- safe combination of concurrent results.

Documents:

- [Graph-bounded, restorable competitive wedges](./graph-bounded-restorable-competitive-wedges.md)
- [Second-pass control-plane market scan](./control-plane-market-second-pass.md)
- [Initial control-plane competitor scan](./control-plane-competitors-2026-07.md)
- [Market and adoption alternatives](./market-and-adoption-alternatives.md)

The last document uses historical Ralph terminology and is retained as earlier
decision evidence, not as the current Dalph product description.

### 2. Reliability and maintainability

This is the next deep research track. It asks how each serious open-source
competitor stores workflow state, limits parallel work, survives a crash,
resumes an agent, repairs incomplete operations, structures its code, swaps
production and test services, and verifies its state transitions.

Unless a document names a completed experiment result, competitor restart and
failure behavior is inferred from pinned source code, repository tests, and
first-party documentation. The current comparison contains no completed
competitor crash-injection result.

Documents:

- [Research plan](./control-plane-reliability-architecture-plan.md)
- [Technical pre-study](./control-plane-reliability-architecture-prestudy.md)
- [Cross-product mental-model atlas](./control-plane-mental-model-atlas.md)
- [Dalph architecture/implementation/evidence ledger](./dalph-competitive-evidence-ledger.md)
- [Cross-product reliability mechanism matrix](./control-plane-reliability-mechanism-matrix.md)
- [Common crash experiment protocol](./control-plane-crash-experiment-protocol.md)
- [Product-specific crash-experiment specifications](./experiments/README.md)
- [Crash-experiment readiness matrix](./control-plane-crash-readiness-matrix.md)
- [Symphony C0 preflight harness](./experiments/harnesses/symphony/README.md) — implemented and safely blocked on this host before starting Symphony.
- [Competitor architecture cards](./cards/README.md)
- [Gas Town and Beads architecture card](./cards/gastown-beads-reliability-architecture.md) — source audit complete; the current comparison makes source-inferred crash claims only.
- [HerdOS architecture card](./cards/herdos-reliability-architecture.md) — source audit complete; the current comparison makes source-inferred crash claims only.
- [OpenAI Symphony and Elixir/OTP architecture card](./cards/symphony-otp-reliability-architecture.md) — source audit complete; the current comparison makes source-inferred crash claims only.
- [Paperclip architecture card](./cards/paperclip-reliability-architecture.md) — source audit complete; the current comparison makes source-inferred crash claims only.
- [Agent Kanban architecture card](./cards/agent-kanban-reliability-architecture.md) — source audit complete; read it with the separately pinned AMA execution-plane card below.
- [Any Managed Agents architecture card](./cards/any-managed-agents-reliability-architecture.md) — source audit complete; this resolves Agent Kanban's execution-plane dependency and finds real D1 admission/session recovery alongside create, lease-claim, retention, and live-process gaps.
- [AIF Handoff architecture card](./cards/aif-handoff-reliability-architecture.md) — source audit complete; its strongest ambiguity-aware recovery is the optional local-commit gate, not the complete agent workflow.
- [Kandev architecture card](./cards/kandev-reliability-architecture.md) — source audit complete; it has the strongest local persistence and exact-surviving-worktree restoration found so far, while provider context, logs, worktree contents, and the live runtime remain separate recovery problems.
- [Warren architecture card](./cards/warren-reliability-architecture.md) — source audit complete; exact provider-handle reattachment is real, while dispatch and plan-child creation retain crash gaps and Kubernetes workspaces lose unpushed work with the pod. Read it with the Burrow local-runtime card below.
- [Burrow architecture card](./cards/burrow-reliability-architecture.md) — source audit complete; it persists local run/events/workspaces but terminalizes interrupted runs instead of adopting their processes or Codex context.
- [Durable journal and recovery protocol](./durable-journal-and-recovery-protocol.md)
- [Execution state machine and tooling boundary](./execution-state-machine-and-tooling-boundary.md)
- [Resumable frontier architecture decision](./resumable-frontier-architecture-decision.md)
- [Resumable frontier specification and implementation audit](./resumable-frontier-specification-and-implementation-audit.md)

### 3. Effect and durable workflow

The research question is not “is Effect better than Go or Elixir?” It is:

> Can Dalph's Effect architecture make difficult user-visible behavior easier
> to implement, verify, and maintain than the architectures used by the
> competitors?

That requires comparing Effect services, layers, schemas, scoped concurrency,
and workflow interpretation with:

- Elixir/OTP supervision and actor state;
- Go daemons, locks, watchdogs, and repair commands;
- database transactions and execution locks;
- event logs and reducers;
- durable workflow engines such as Effect Workflow or Temporal;
- ordinary job queues and restart sweeps.

Documents:

- [Effect, Effect Workflow, and OTP for Dalph durability](./effect-otp-durable-workflow-comparison.md)
- [Declarative Effect story and validation stack](./declarative-effect-story-and-validation.md) — exploratory candidate language connecting a graph signal, projections, composed delivery settlement, Quint, and conformance testing.
- [Delivery-story production integration](./delivery-story-production-integration.md) — source audit and phased migration for making story-shaped Effects the governing production coordination code without duplicating production responsibility, admission, or recovery models.
- [Post-cutover responsibility-composition decision](./issue-177-responsibility-composition-decision.md) — source-backed audit of the governing delivery activation at `3997fff9c`; chooses one focused non-behavioral prefactor to carry fresh/recovered transition provenance without hidden mutable dispatch state.
- [Effect Workflow prerequisite subgraph](./effect-workflow-prerequisite-subgraph.md)
- [Effect analyzer and Quint evaluation](./effect-analyzer-quint-evaluation.md)
- [Deterministic orchestrator verification strategy](./deterministic-orchestrator-verification-strategy.md)
- [Source-code module structure](./source-code-module-structure.md)
- [Technical reliability research plan](./control-plane-reliability-architecture-plan.md)

The prerequisite-subgraph document is a dependency map, while the new
Effect/Workflow/OTP comparison evaluates the pinned runtime and durability
model. Adoption remains undecided and requires SQL-backed crash experiments.

### 4. Git lineage and concurrent integration

This track asks what users gain from fixing one starting commit for an attempt,
using one exact worktree, and combining accepted results through a controlled
integration step.

Documents:

- [Concurrent accepted-head integration protocol](./concurrent-accepted-head-integration-protocol.md)
- [Tracker port and reconciliation contract](./tracker-port-and-reconciliation-contract.md)
- [Duplicate intents and retry identity](./duplicate-intents-and-retry-identity.md)
- [Issue 139 Git-fact reconciliation scenario](../docs/scenarios/issue-139-reconcile-git-facts.md)

### 5. Control and resource limits

This track covers the number of tasks allowed to run, what happens to that
limit when work is paused, and why combining Git results may need a different
limit from running agents.

Documents:

- [Operator and resource control surface](./operator-and-resource-control-surface.md)
- [Issue 54 resize task admission scenario](../docs/scenarios/issue-54-resize-task-admission.md)
- [Issue 56 queue accepted integration scenario](../docs/scenarios/issue-56-queue-accepted-integration.md)
- [Issue 131 uncertainty audit](./issue-131-uncertainty-audit.md)

### 6. Verification and formal methods

This track asks whether Dalph and its competitors use explicit state machines,
pure reducers, property tests, model-based tests, fault injection, or formal
models—and what bugs those techniques actually prevent.

Documents:

- [Deterministic orchestrator verification strategy](./deterministic-orchestrator-verification-strategy.md)
- [Quint recovery-gate performance](./quint-recovery-gate-performance.md)
- [Effect analyzer and Quint evaluation](./effect-analyzer-quint-evaluation.md)
- [`specs/`](../specs/)

## Focus decisions for the next competitor audit

- Deep source work focuses on open-source products.
- Gas Town with Beads, HerdOS, Symphony, and Paperclip are the first group.
- Agent Kanban, AIF Handoff, Kandev, and Warren are the second group.
- Any Managed Agents is a source-audited follow-up because Agent Kanban pins it
  as the execution plane that owns runner admission, sessions, and workspaces.
- Burrow is a source-audited follow-up because Warren pins it as the local
  sandbox, worktree, process, and event runtime.
- Closed products are noted as market context but do not receive speculative
  implementation analysis.
- GitHub and GitLab are platform context, not part of this focused technical
  comparison.
- For an open-source product, “not documented” is not enough. A negative claim
  requires searches through source, manifests, tests, migrations, and design
  documents.
- Every difference must state both the implementation consequence and what a
  user would notice. Differences with no meaningful consequence should not be
  treated as competitive advantages.

## Historical and specialized research

These documents remain useful but are not the current entry point:

- [Symphony baseline evaluation](./symphony-baseline-evaluation.md) — older
  snapshot and historical Ralph terminology; useful detailed source evidence.
- [Immutable task-graph evaluation](./immutable-task-graph-evaluation.md)
- [Sandcastle task-substrate evaluation](./sandcastle-task-substrate-evaluation.md)
- [Executor source-boundary evidence](./executor-source-boundary-decision-evidence.md)
- [Review-loop executor decision](./review-loop-executor-source-boundary-decision.md)
- [Ralph execution-contract inventory](./ralph-execution-contract-inventory.md)
- [OptMem project-local memory](./optmem-project-local-codex-memory.md)
- [Workflow action and occurrence classification](./workflow-action-occurrence-classification.md)
- [Cassette size measurements](./cassette-size-measurements.md)

## Index maintenance

When adding research:

1. Put raw source checkouts under `.references/` and pin the revision in
   [the reference index](../.references/COMPETITORS.md).
2. Add the resulting research document under the relevant theme above.
3. Mark whether it is current, historical, partial, or planned.
4. State its evidence boundary: source-verified, official documentation only,
   experimental, or unknown.
5. Prefer ordinary descriptions of what a person or system does before
   introducing Dalph's domain terminology.
