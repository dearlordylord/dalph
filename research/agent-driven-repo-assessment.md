# Agent-driven Dalph: repository assessment

Research dated 2026-09-13. This document changes no runtime behavior: it records existing seams and proposes questions/scenarios for a future accepted design. It is not an implementation specification. Sources below are repository files inspected directly; no live provider calls or tests were needed for this documentation-only assessment.

## Start with what happens

A maintainer asks a reasoning agent to deliver a tracker issue and its prerequisites. The agent selects a root, execution policy, and limits once. A long-lived Dalph host reads the tracker, determines what can proceed, claims tasks, establishes exact worktrees, and asks its executor to work. When one executor finishes, Dalph verifies the report and Git evidence, makes execution capacity available under the existing rules, and drives integration, tracker completion, claim release, and resource disposition. The reasoning agent intervenes when a decision exceeds the chosen policy. The maintainer opens a graph at any time, even after the reasoning agent's client disconnects.

This inversion can largely change who issues high-level directions without moving the existing mechanical workflow back into an LLM. Exposing `create_worktree`, `release_slot`, `close_issue`, and `delete_branch` as a checklist for the agent would defeat the stated objective.

## What exists and what does not

| Need | Repository evidence | Qualification |
| --- | --- | --- |
| Host one durable workflow with injected executor | `packages/dalph/src/application/production.ts`: `productionWorkflowInterpreterLayer` | Existing application composition seam; caller supplies authority adapters, exact targets, executor and optional integration/finality boundaries. Not an already-deployed MCP host. |
| Continue without repeated reasoning-agent calls | Same file: `productionRunReactivationLayer` | Existing owner, accepted controls, timer and tracker-notification hints. Default refresh interval is one minute. Real-time UI updates are a separate concern. |
| Agent implementation behind generic task boundary | `packages/contracts/src/executor.ts` | Existing Begin/Resume/Suspend plus passive observation algebra correlated by exact `(RunId, AttemptId)`. Generic contract hides provider threads, processes, and private workflow. |
| Concrete Codex implementation | `packages/dalph/src/application/codex-planned-attempt-executor.ts`, `codex-app-server.ts`, `codex-attempt-store.ts` | Substantial current implementation and qualification tests, including persistent association and owned activity census. Deployment/real-host qualification must not be inferred merely from source presence. |
| Read graph history and explain causes | `packages/orchestrator/src/presentation/trace-reader.ts` | Production `read`, `readAt`, `causalPredecessor`, graph-at-cursor and historical facets. Last section composes fixed history with caller-supplied current status signal. |
| Visual graph | `prototypes/execution-trace/`, README visual-preview section | Existing disposable browser prototype has synchronized task/causal graphs, replay, actor spans and navigation. It does not execute/import production orchestrator. |
| MCP/control server | No MCP registration or SDK references found under `packages/` | New application transport, authorization and request-redelivery design needed. |
| CLI | `packages/dalph/src/application/cli.ts` | Requires `--dry`; source supports read-only GitHub graph targets as well as fixture workflows. README's fixture-only status is stale. |

Some broad architecture/scenario prose still calls concrete executor work future/unimplemented. Treat source, focused tests and actual qualification evidence separately from these status sentences; the tracker remains the declared authority for delivery status.

## Keep authority boundaries intact

`docs/ARCHITECTURE.md`, `docs/CONTEXT.md`, and the grouped architecture pages assign tasks, lifecycle, dependencies, grouping and claims to the tracker; lineage, refs, commits and worktrees to Git; process/session observations to the execution substrate; and only workflow history to Dalph's journal. An MCP client cannot become another authoritative task database.

The existing exclusive coordinator lock applies to one canonical Git common directory. Several MCP clients should therefore connect to the same owner, rather than each starting an independently mutating coordinator. Durable runtime ownership must not follow a transient chat connection. Conversely, a client disconnect cannot prove an executor stopped; the existing exact executor observation/reconciliation rule must remain the source of that conclusion.

Existing control events identify `Operator` as a logical human actor class. An agent direction must not silently impersonate that class. A future design must decide whether an agent is an authenticated delegate acting under an operator's standing policy, or a distinct initiating actor with its own policy scope. Request identity and authenticated identity are different facts. Current revision-checked controls (`packages/orchestrator/src/control/task-work-capacity.ts`) offer a useful precedent for stale-command rejection, but do not constitute a complete remote authorization design.

## Capacity is not a handle the child returns

`docs/architecture/coordinator-control-and-admission.md` explicitly says the executor does not acquire/release task-work positions. Runtime associates a position with an exact attempt before work begins; an exact terminal or safely suspended report permits release. Safe suspension must prove no executor-owned activity remains running. A missing report, expired token, parent disappearance, or TCP disconnect proves none of these things.

Integration is serialized separately by repository/ref target. Unfinished integration, claims, and cleanup remain obligations after execution releases its position. A task's disappearance from the tracker graph or positive frontier does not erase them. Requiring every worktree deletion before releasing every execution position would change current accepted behavior and reduce concurrency; it should not be smuggled into a bookkeeping API.

If unfinished worktrees can exhaust disk while execution keeps progressing, define an additional resource/admission policy from fresh Git/filesystem evidence. Do not overload the task execution count or persist a derived cleanup queue as a new authority. This is a proposed design question, not an existing generic disk-budget feature.

Cleanup already distinguishes planned worktree disposal, branch disposal after settled worktree removal, and quarantined Integrator predecessor candidate disposal. They have separate exact authorizations, observations, intents, contradictions and settlement (`packages/orchestrator/src/workflow/protocols/disposition-cleanup/`). A child reporting success cannot grant generic permission to delete resources.

## Who executes?

The least disruptive choice is for Dalph's existing executor adapter to start independent provider threads while the orchestrator agent remains a client. The child is logically subordinate to that agent's plan, but its lifecycle is owned and observable through the provider adapter. The current Codex implementation already supplies much of this substrate.

A harness-native subagent could be another executor implementation only if its harness exposes enough exact lifecycle evidence: stable correlation, passive observation, reconciliation after lost start responses, and a safe-suspension/terminal proof covering descendants and background processes. Merely exposing `spawn` and receiving text later is insufficient. If the harness dies with the parent and provides no recoverable evidence, this mode cannot promise the same guarantees.

An executor can internally use several subagents without changing the generic attempt contract. If those subagents work on independently tracked deliverables, they should instead become tracker tasks with explicit dependencies. Tracker grouping is not the provider's spawn tree, and neither is the dependency graph. Current task Pause follows tracker grouping descendants, not dependency edges (`docs/architecture/coordinator-control-and-admission.md`). Copying an agent spawn hierarchy into grouping would therefore change real control behavior.

Current accepted Integrator design uses its own isolated candidate resource and provider thread, even when it shares the app-server process substrate (`docs/adr/0014-isolate-codex-integration-session-threads.md`). An orchestrator chat should not resolve integration by concurrently editing a task worktree outside that boundary.

## What a handle could mean

A proposed child capability could authorize reading one task/attempt, posting diagnostic evidence, requesting clarification, or proposing a result. It should name exact scope and incarnation; it is not proof that work stopped, nor ownership of a scheduler semaphore. The host revokes/reconciles capabilities when attempts change. The host remains responsible even if a child never returns its handle.

Scope delegation needs separate acceptance scenarios for graph edits, review requests and result submission. A child authorized for task A should not gain authority over its support prerequisites merely because they appear in the same graph read. An agent's proposed result is also different from a verified executor report: a read-only MCP submission cannot prove no background writer survives.

## On-demand and live graph

Use the production projection as the common read boundary for MCP and browser. Return dependency and grouping edges separately, task eligibility and exact exclusion reasons, policy-limited selection, actual occupied task positions, integration state, and outstanding resource obligations. Distinguish these views instead of coloring every non-running task simply “blocked.”

Historical graph at `(RunId, JournalPosition)` is immutable and may be stale relative to GitHub. Current graph observations need their provenance/freshness displayed separately from that fixed history. A push notification should tell the client that a newer committed prefix/status is available; it cannot create authoritative tracker facts. On reconnect the client reads a snapshot/current prefix and continues, with no provider mutation caused solely by opening the graph.

## Proposed scenarios and test seams

These are research proposals, not accepted implementation scenarios. Each requires full chronology before implementation under `docs/OPERATIONAL-SCENARIOS.md`.

| Concrete event | Desired result / forbidden result | Existing seam or proposed test |
| --- | --- | --- |
| Agent asks twice to start the same run after losing the first response | One durable run/attempt sequence; no duplicated claim/start | New MCP redelivery contract around `JournaledRunBootstrap`; existing run lifecycle tests |
| Agent client disconnects while two children execute | Host keeps responsibilities and policy; no inferred cancellation or slot release | New host/transport disconnect test; `packages/dalph/src/application/production-reactivation.test.ts` and executor contract tests |
| Child sends terminal result while a descendant still writes | Position retained until exact executor-owned activity proof; no worktree deletion | `codex-planned-attempt-executor.test.ts`, executor contract and activity census tests |
| Child finishes, then Git worktree removal is ambiguous | Execution can release according to terminal proof; exact cleanup obligation survives and reads Git before retry | `packages/dalph/test/conformance/disposition-cleanup-recovery-prefixes.test.ts` plus capacity seam |
| Agent lowers concurrency while three attempts execute | Existing three continue; fresh admission waits until below new ceiling | `packages/orchestrator/src/control/task-work-capacity.test.ts`, admission capacity tests |
| Maintainer opens graph, then disconnects/reconnects | Same committed causal prefix plus distinct current status; no fabricated history or provider reads for historical view | `trace-reader.test.ts`, historical/control disposition tests; new browser/transport stream contract |
| Task is closed/removed externally while its executor is active | Outstanding exact attempt/resource responsibility remains visible | Existing frontier/reconstruction tests; new common presentation contract |
| Parent delegates a support task via a stale handle | Reject unauthorized or superseded scope; no silent graph-grouping or task-identity changes | New capability authorization and tracker mutation request contract |

No implementation or integration gates were run because only this research Markdown file was added.
