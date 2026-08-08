# Coding-agent control-plane competitor scan

**Research date:** 2026-07-30
**Scope:** New or materially changed competitors beyond
[`market-and-adoption-alternatives.md`](./market-and-adoption-alternatives.md), with
special attention to products that could own the control plane rather than only
the operator cockpit. This is research only; it changes no Dalph runtime behavior.

## Answer in one paragraph

Yes. **HerdOS is now a direct control-plane competitor**, and it is the closest
source-visible implementation found to Dalph's intended end-to-end delivery
loop. **Kandev** is the strongest broader operator product and can compete for
the same user even though its own task/workflow database, rather than an
external tracker graph, owns the work. **Paperclip** is a genuine control plane
for autonomous-agent organizations, with stronger budgeting, governance,
durability, and generic recovery than most coding-agent tools, but it is not a
Git-delivery convergence controller. Coder Agents, Agent Orchestrator,
Overstory, and Multica occupy adjacent slices. No reviewed product implements
the whole Dalph contract: external tracker graph authority, immutable planned
Base SHA per attempt, separated Git/tracker/executor/journal authority,
intent/observation reconciliation across ambiguous effects, accepted-head
integration, and disposition-typed fail-closed cleanup.

## What counts as a control plane here

A product is not in this group merely because it launches several terminals or
shows a Kanban board. It must mechanically decide at least several of:

1. which task is eligible to run;
2. whether a worker may claim it;
3. which capacity or execution resource it consumes;
4. which checkout and Git lineage it receives;
5. how completion evidence is reviewed;
6. when changes may integrate;
7. what happens after a crash, timeout, duplicate trigger, or ambiguous effect.

That definition produces three useful groups.

| Group | Serious members | Competitive meaning for Dalph |
|---|---|---|
| Delivery control planes | **HerdOS**, Symphony, Agent Orchestrator, Overstory | They attempt to control work from task dispatch through Git delivery. HerdOS is the new closest direct competitor. |
| Product/work control planes | **Kandev**, **Paperclip**, Multica | They own tasks, sessions, approvals, and/or agent organizations. They can win the user without matching Dalph's authority model. |
| Execution/security control planes | Coder Agents | They own environments, identity, model access, cost, and audit, but not the delivery graph or accepted-head convergence. They are more likely substrate or integration partners. |

Chartr remains outside this group. It is a cockpit and execution-session manager,
not a durable delivery controller; see
[`chartr-source-comparison.md`](./chartr-source-comparison.md).

## Ranked new findings

### 1. HerdOS — direct competitor

**Verdict:** The strongest direct competitor discovered in this scan.

The repository was inspected at
[`afb8e527fee2f9081963310bad1645bdc2806d68`](https://github.com/herd-os/herd/tree/afb8e527fee2f9081963310bad1645bdc2806d68).
This is not only README positioning:

- GitHub Issues and labels are work items, milestones are batches, Actions run
  workers, and a batch PR is the integration result. The project explicitly
  calls GitHub its source of truth and uses no local database
  ([architecture](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/docs/design/architecture.md#L93-L145)).
- The planner creates a task DAG; the implementation rejects cycles and computes
  dependency tiers using Kahn's algorithm
  ([DAG source](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/dag/dag.go#L8-L85)).
- Workers are bounded by `max_concurrent`, start from the batch branch, execute
  on separate worker branches, validate, push, and report. The integrator
  consolidates completed branches and dispatches the next tier
  ([execution design](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/docs/design/execution.md#L9-L97)).
- Consolidation is milestone-wide and idempotent. GitHub Actions concurrency
  groups serialize ordinary integration, and a losing non-fast-forward writer
  marks the affected issue failed for retry
  ([GitHub integration](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/docs/design/github-integration.md#L192-L216)).
- Review is tied to the exact current PR head. It uses an application-level,
  GitHub-backed compare-and-swap lock; malformed state fails closed, and review
  results record their head SHA
  ([review locking](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/docs/design/github-integration.md#L220-L238)).
- The monitor cancels overlong runs, detects an in-progress issue with no live
  Action, performs bounded redispatch with backoff, deduplicates retry triggers,
  and escalates after exhaustion
  ([monitor source](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L72-L147)).

This intersects almost every visible part of Dalph: tracker-owned task state,
dependency-aware dispatch, concurrency limits, isolated Git work, integration,
review/fix cycles, CI repair, recovery, and operator visibility.

The remaining differences are structural, not cosmetic:

- HerdOS is GitHub-native today. Its platform interface anticipates other
  providers, but the shipped authority, locks, triggers, audit trail, and
  execution substrate are GitHub artifacts.
- A worker receives the current batch branch at execution time. It does not
  model Dalph's planned immutable Base SHA as a first-class per-attempt
  invariant.
- Issues, labels, PR comments, special lock branches, Action logs, and committed
  progress markers collectively serve both authority and workflow history.
  Dalph intends a narrower journal that does not duplicate tracker, Git, or
  executor facts.
- Recovery is pragmatic and sometimes lossy. If a resumed branch cannot merge
  the changed batch branch, HerdOS deletes the stale worker branch and starts
  fresh, explicitly accepting loss of partial work
  ([retry resume](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/docs/design/execution.md#L212-L250)).
- It has good operation-specific idempotency, but not a general
  intent-before-effect / observe-afterward / reconcile-before-retry algebra
  shared by dry-run, fake, and production.

**Competitive conclusion:** For a GitHub-only team willing to let GitHub Actions
be the execution and workflow substrate, HerdOS already does much of what a
buyer might expect Dalph to do. Dalph cannot differentiate with “DAG + parallel
agents + review + retry” alone.

### 2. Kandev — strongest product competitor, partial control-plane competitor

**Verdict:** More likely to compete for adoption and daily operator attention
than to substitute for Dalph's delivery semantics.

The repository was inspected at
[`21742aa3ef85c2ed1bfc8e2714d14799599cecac`](https://github.com/kdlbs/kandev/tree/21742aa3ef85c2ed1bfc8e2714d14799599cecac).
Kandev has substantial shipped machinery:

- Its own workspace contains repositories, workflows, tasks, integrations, and
  defaults; a task owns workflow position, repository attachments, sessions,
  and a plan
  ([task model](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/tasks-and-workflows.md#L8-L22)).
- Local and worktree executors are supported. A task can have multiple
  repositories, one worktree per repository, recorded branches, cumulative
  review, PR associations, and local/Docker/SSH/cloud execution
  ([feature status](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/feature-status.md#L48-L85)).
- Workflow steps can enforce WIP limits and trigger agent starts, explicit
  completion, transitions, and review behavior.
- Git operations are serialized per repository operator, and the underlying Git
  repository remains authoritative for commit state
  ([Git operations](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/git-operations.md#L47-L90)).

The key boundary is authority. Jira and Linear launch paths copy an external
item into Kandev and do not create a durable task association. GitHub and GitLab
associations are richer, but Kandev still owns the task and workflow state
([integration status](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/feature-status.md#L74-L85)).
Its autonomous “Office” coordination, dependencies, routines, budgets, and
approvals are explicitly feature-gated and in progress, not part of the
supported regular task contract
([Office boundary](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/feature-status.md#L91-L104)).

Its Git safety semantics also differ materially. Worktree creation may continue
from a possibly stale local ref after a remote fetch failure, cleanup-script
failure does not stop destructive worktree removal, and task deletion force
deletes local branches
([worktree lifecycle](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/git-operations.md#L22-L45),
[cleanup](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/git-operations.md#L167-L175)).

**Competitive conclusion:** Kandev is a credible “one product for tasks,
agents, worktrees, review, and PRs” alternative. Dalph's differentiation is the
authority and correctness contract, not breadth of UI or agent adapters.

### 3. Paperclip — real generic control plane, adjacent to delivery

**Verdict:** A control-plane competitor at the category level, not yet a direct
Git-delivery substitute.

The repository was inspected at
[`d5b9f6c8c9d9edb0c9796df86c61826b11400b5b`](https://github.com/paperclipai/paperclip/tree/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b).
Paperclip explicitly separates its control plane from external agent execution.
It owns companies, agents, goals, issues, blockers, budgets, approvals,
heartbeats, and governance; adapters invoke and observe agents wherever they run
([product contract](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/PRODUCT.md#L5-L81)).

Relevant implemented ideas include atomic issue checkout and execution locks,
first-class blockers, persistent context across heartbeats, budget hard stops,
durable activity, orphaned-run recovery, watchdog reconciliation, and
idempotency keys for wakeups
([README](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/README.md#L159-L278),
[watchdog design](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/TASK-WATCHDOG.md#L83-L105)).
It also has project execution workspaces and Git-worktree realization, although
the repository still labels issue-scoped worktree support experimental
([worktree note](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/experimental/issue-worktree-support.md#L1-L32)).

Paperclip deliberately owns the issue ledger and says it is not a code-review
tool. It lacks a mechanically defined accepted-head integration protocol and
the Git/tracker authority separation central to Dalph.

**Competitive conclusion:** Paperclip is the best source-visible comparison for
generic control-plane durability, governance, budgets, and recovery. A team
that accepts Paperclip as its task authority may not need Dalph; a team whose
existing tracker and Git provider must remain authoritative still has a
different problem.

## Other candidates worth tracking

### Agent Orchestrator

Agent Orchestrator has matured into a substantial local feedback controller:
per-session worktrees, broad CLI-agent adapters, terminal supervision, PR
awareness, and automatic routing of CI failures, review comments, and merge
conflicts back to workers
([official repository](https://github.com/Untrivial-ai/agent-orchestrator)).
It is a direct competitor for supervised parallel coding. The current product
description still centers sessions and individual PR feedback rather than an
external dependency graph, immutable attempt bases, or repository-wide
accepted-head convergence. It was covered in the earlier survey, but should
remain in the control-plane watchlist rather than the cockpit-only list.

### Overstory

Overstory has an increasingly control-plane-shaped local fleet: tracker state,
worktrees, a merge queue, typed agent messaging, layered watchdogs, checkpoint
recovery, and role enforcement
([official repository](https://github.com/jayminwest/overstory)). Its own
SQLite-backed coordination and merge state, plus its agent-team topology, make
it closer to a self-contained fleet runtime than Dalph's clean external
authority model. It remains a serious implementation reference.

### Coder Agents

Coder is a real infrastructure and security control plane: it provisions
Terraform-defined environments, runs the model loop in the control plane,
keeps model credentials out of workspaces, and centralizes identity,
governance, cost, and audit
([official repository](https://github.com/coder/coder)). It does not own the
task DAG, claims, review convergence, or Git integration protocol. Treat it as
a potential execution substrate or enterprise integration, not the same
product.

### Multica

Multica is an issue-centric agent teammate product and could grow into this
space. Its maintainers currently acknowledge that strict workflow ordering,
conditionals, retries, timeouts, and state-machine enforcement are not shipped;
“Squads” provide emergent agent handoff instead
([workflow issue](https://github.com/multica-ai/multica/issues/1943)).
It is a future threat to watch, not a present substitute for deterministic
control-plane behavior.

### Symphony

Symphony remains the cleanest prior specification for tracker-driven
reconciliation and the strongest conceptual comparison from the earlier
survey. HerdOS now appears to be the stronger direct, end-to-end,
source-visible implementation competitor because it includes Git integration,
review repair, CI repair, health monitoring, and landing.

## Capability comparison

Legend: **Yes** means mechanically central in inspected source/docs; **Partial**
means present with a materially different authority or safety contract; **No**
means absent from the reviewed product boundary.

| Capability | HerdOS | Kandev | Paperclip | Agent Orchestrator | Dalph intended contract |
|---|---:|---:|---:|---:|---:|
| External tracker is task/DAG authority | **Yes, GitHub only** | No | No | Partial | **Yes, provider-neutral** |
| Dependency-aware mechanical frontier | **Yes, tiers** | Partial | Partial, blockers | Partial | **Yes** |
| Bounded worker dispatch | **Yes, global cap** | **Yes, workflow WIP** | **Yes, policies/budgets** | Partial | **Yes, resource-specific** |
| Exact immutable Base SHA per attempt | No | Partial | No | Partial | **Yes** |
| Isolated task Git workspace | Partial, fresh Action checkout/branch | **Yes, worktrees** | Partial/experimental | **Yes, worktrees** | **Yes, exact worktree** |
| Review/fix convergence | **Yes, bounded cycles** | Partial | No, intentionally external | **Yes, feedback loops** | **Yes** |
| Serialized integration to accepted head | Partial, per batch branch/PR | No | No | No evidence | **Yes** |
| Ambiguous-effect reconciliation | Partial, operation-specific | Partial | Partial, generic runs | Partial | **Yes, workflow-wide** |
| Separate workflow journal authority | No | No, own DB owns work | No, own ledger owns work | No | **Yes, journal only** |
| Fail-closed, disposition-typed cleanup | No | No | Partial | No evidence | **Yes** |

## Strategic implications

1. **Treat HerdOS as the primary direct competitor.** A dedicated follow-up
   audit should test its issue claim races, batch-base movement, consolidation
   races, recovery after GitHub API ambiguity, and cleanup behavior with the
   same chronological scenarios used for Dalph.
2. **Do not position Dalph as merely “parallel coding agents with a DAG.”**
   HerdOS already tells that story credibly. Lead with authoritative boundaries,
   exact attempt lineage, reconcile-before-retry, recoverable cleanup, and one
   workflow algebra across fake/dry-run/production.
3. **Treat Kandev as the UX and packaging benchmark.** It demonstrates how much
   product surface buyers may expect around the control plane, even though its
   semantic core differs.
4. **Mine Paperclip for generic control-plane patterns.** Atomic checkout,
   execution locks, idempotent wakeups, budgets, watchdog fingerprints, and
   durable activity are relevant prior art, while its internal issue authority
   should not be copied into Dalph.
5. **Keep the categories explicit.** Coder can be an execution substrate;
   Chartr, Superset, Hive, Orca, and similar tools are primarily cockpits;
   Multica is an emerging work platform. Calling all of them direct competitors
   obscures the much more important HerdOS comparison.

## Recommended next source audit

Audit HerdOS against five Dalph operational scenarios:

1. two dispatchers try to claim the same ready issue;
2. the batch branch moves after a task is planned but before its worker starts;
3. a worker push succeeds but the caller loses the response;
4. two completed workers race to integrate while the accepted head changes;
5. the process crashes between cleanup intent and worktree/branch removal.

Those scenarios will reveal whether HerdOS's impressive operation-specific
guards compose into a coherent recovery model or remain a collection of local
idempotency mechanisms.
