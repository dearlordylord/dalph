# Resumable and Pausable Frontier Planning Map

Status: durable Wayfinder-bootstrap artifact; no implementation is authorized
by this document.

## Purpose

This document preserves the decisions and feedback produced while reviewing
ticket #112. It routes later research, Wayfinder, specification, formal-model,
and implementation sessions. A handoff may point at this document and the
artifacts it names, but a handoff is not the durable source of truth.

This is not intended to become a second permanent specification. Its lifecycle
is:

1. remain the durable source for charting the Wayfinder map;
2. become a frozen input linked by that map once W0 finishes;
3. remain available while investigation decisions move into their owning
   Wayfinder tickets and accepted specifications;
4. be deleted in the W10 specification change only after every still-valid
   decision has one canonical home and the Wayfinder map retains the historical
   route.

Deletion is therefore an explicit, reviewed migration of authority, not routine
cleanup after a handoff.

## Restart capsule

A fresh session must be able to continue without the conversation that created
this file.

### Repository state when this capsule was written

- Repository: `git@github.com:dearlordylord/dalph.git`
- Branch: `master`
- Baseline `HEAD`: `8977b93b3`
- Ticket under review:
  [Recover every legal managed-run durable prefix](https://github.com/dearlordylord/dalph/issues/112)
- Relevant implementation range: `6bff06f78..8977b93b3`
- Recovery commits:
  - `695938fc6 feat(orchestrator): resume durable workflow stages`
  - `33c9a5ca8 fix(orchestrator): fail closed across recovery frontier`
  - `8977b93b3 fix(orchestrator): classify pre-attempt recovery gaps`
- Persistence requirement: do not start W0 until this file is committed. An
  untracked copy is not safe across a fresh clone, worktree cleanup, or another
  operation that discards untracked files.
- The implementation session reported `pnpm check:all` passing after
  `8977b93b3`; this capsule does not claim that it was rerun afterward.

### Current coordination state

- No Wayfinder map or Wayfinder child ticket has been created for this effort.
- No handoff document has been created.
- No code change is authorized by this planning session.
- All feedback supplied in the conversation through the creation of this
  capsule has been incorporated into this file.
- The original Plannotator session was interrupted and was not restored with
  its browser-local feedback. Feedback manually pasted into the conversation is
  preserved here. Any annotation that still exists only in the browser and was
  never supplied cannot be recovered from this file.
- No further human feedback is expected before W0. The lost browser-local
  annotations are historical loss, not a pending prerequisite.

### Human direction that must survive restart

- Work as a planner until the specification and issue map are ready; do not
  implement findings directly from this file.
- Use normal language. State the concrete actor, action, and boundary before
  canonical shorthand.
- Specifications are the destination; Wayfinder investigation issues are the
  steps used to discover the route.
- A reaction of “yes,” “verify,” or “ok” accepts and preserves the referenced
  finding; it does not dismiss it.
- Do not preserve current code by default. After the model and specifications
  are accepted, explicitly decide whether to retain, refactor, replace, or
  delete it.
- Do not begin a rewrite before that architecture decision.
- Do not treat a later handoff as the source of truth. Handoffs point to durable
  repository or tracker artifacts.

### Immediate continuation

1. Read this complete file, `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`, and
   `docs/adr/0002-planned-task-attempt-admission.md`.
2. Commit this file alone as the Wayfinder-bootstrap artifact.
3. Create a narrow W0 handoff that references the committed file, ticket #112,
   and `6bff06f78..8977b93b3`.
4. Run W0 to chart the map only; do not resolve W1 or change code in that
   session.

The review exposed a larger destination than startup recovery alone:

> Dalph traverses the task graph through a bounded, durable, reconstructible,
> pausable frontier. A whole run, one task, or a dependency-defined part of the
> graph can be paused and later resumed. After a crash or pause, Dalph rereads
> the authorities that own current facts, reconciles those facts with its
> recorded intentions and observations, and continues every unaffected legal
> branch.

The existing recovery implementation must not be extended piecemeal until this
destination is specified. If the resulting specification contradicts the
current design, an architecture review must decide whether to retain, refactor,
or replace that code. Rewriting is permitted if necessary but is not assumed in
advance.

## Decisions already made

These are inputs to the future Wayfinder map, not questions to reopen without
new contradictory evidence.

1. Recovery means resuming orchestration, not merely diagnosing unfinished
   work.
2. A valid durable history ending before an ordinary next action does not by
   itself justify blocking application startup.
3. One recovery activation must not stop merely because it appended one new
   durable fact. It continues until all immediately actionable work has
   advanced, a named wait condition applies, an explicit disposition is
   recorded, or a genuinely ambiguous boundary is isolated.
4. No available worker capacity means wait for capacity while other legal work
   continues. It is not a fatal application error.
5. Dalph rereads and reconciles the current tracker claim, task graph, Git
   state, execution resources, evidence, review state, and other relevant
   authorities after interruption.
6. If Dalph no longer owns a resource, it explicitly records the resulting
   responsibility/disposition and stops treating that resource as its own. The
   loss must not silently disappear, but it must not unnecessarily freeze
   unaffected graph branches.
7. The normal workflow and restart workflow use one operation algebra and the
   same capacity, scheduling, reconciliation, and safety rules.
8. Crashes and pauses share a reconstruction and reconciliation core. A pause
   may additionally create an intentional quiescence boundary that a crash
   cannot guarantee.
9. Later recovery stages must be represented explicitly enough that extending
   evidence, review, handback, rework, or disposition behavior forces an
   exhaustive reducer and model update.
10. The final fresh-review-cycle concern from the choices audit is skipped.
    The earlier claim that all findings were closed has already been corrected;
    it creates no separate work item.

## Required conceptual correction

The unit being recovered is not “a task ID that lacks a claim intent.” That is
only one possible local symptom.

Dalph observes task-graph facts when a workflow interaction calls for an
authority read. That interaction may reread one task, its dependencies, or a
larger graph region. Polling is not a core assumption: a polling policy may be
added later without changing the graph-knowledge, reducer, or workflow core.

Each observation is a durable journal event in one canonical,
provider-independent task-graph format. A GitHub Issues adapter, an Obsidian
Markdown adapter, or another tracker adapter must produce the same domain
shapes without leaking provider fields into the reducer.

Folding the journal reconstructs Dalph's durable graph knowledge: the latest
recorded knowledge for the task identities, dependency edges, and graph regions
that Dalph has observed. This reconstructed knowledge is what Dalph knew after
its recorded observations; it is not proof of the authorities' current state.

An observation event records:

- the canonical task and dependency facts returned by the adapter;
- when and through which operation they were observed;
- the observed region or subjects to which those facts apply;
- the adapter's canonical revision or consistency evidence, when available;
- enough absence/completeness semantics to know what the observation is allowed
  to replace in the reconstructed graph knowledge.

An adapter may need several provider reads to produce one canonical
observation. The boundary contract must say which graph facts those reads cover
and what consistency, revision, or pagination guarantee relates them. The
journal does not need provider response dumps or provider-specific diffs.
Instead, it records the resulting canonical observation. The reducer applies
that event to the reconstructed graph knowledge according to its declared
coverage and completeness semantics.

Updating knowledge for a downstream task that has not started must not trigger
special imperative code. The reducer updates that graph region declaratively;
frontier derivation later decides whether the change affects anything currently
selectable.

While Dalph works, its knowledge changes because:

- an adapter returns a newer observation;
- Dalph performs an acknowledged operation at an external boundary;
- another actor changes tracker, Git, worktree, task-work-provider, executor,
  agent-session, evidence, or review state;
- an authority becomes temporarily unreadable;
- a pause or crash creates time during which any of those changes may occur.

From reconstructed graph knowledge plus any fresh authority reads required at
an ambiguity-crossing boundary, Dalph derives the current bounded frontier. The
journal durably stores canonical observation events, not a current-frontier
rollup. The reducer reconstructs graph knowledge and must not assume that Dalph
personally caused every world change.

## Authority and controllability rule

Every future specification must identify the concrete actor, action, and
boundary before introducing shorthand.

The tracker owns task identity, lifecycle, dependencies, grouping, revisions,
and claims. Git owns commits, refs, worktree registration, index, and working
tree facts. The task-work provider and executor own their session, work-unit,
process, and observable-log facts. Dalph's journal owns only Dalph-recorded
workflow history.

Observed external changes must be classified rather than rejected uniformly:

1. A compatible external change can be accepted into the next derived state.
2. A lost responsibility can receive an explicit disposition and release the
   affected branch.
3. A temporarily unreadable authority can produce a retry or wait condition.
4. An ambiguous change that makes a destructive action unsafe can isolate the
   exact resource or branch for repair.
5. A contradiction that invalidates the managed history itself can fail closed.

The specification must not demand impossible control. Manual edits to unstaged
files, agent-session logs, or provider-native state may be observable fully,
partially, or not at all. Each boundary needs an explicit capability statement:

- what Dalph can authoritatively read;
- what change identity or revision it can compare;
- what it can safely mutate;
- what it can only notice approximately;
- what it cannot observe;
- which uncertainty requires isolation and which merely requires accepting
  that the outside world is not exclusively Dalph-owned.

Stringency must follow actual boundary capabilities rather than an assumption
of exclusive ownership.

## Pause destination

The specification must distinguish at least:

- a request to pause a whole run;
- a request to pause one task;
- the graph portion made unrunnable because it depends on a paused task;
- any additional subtree semantics intentionally selected by policy;
- a task for which no new action may begin;
- an in-flight external operation that is reconciling or reaching a safe
  boundary;
- a task-work process that supports suspension;
- a process that can only be allowed to finish, interrupted, or explicitly
  abandoned;
- a confirmed paused/quiescent state;
- a request to resume.

Pausing one task implicitly changes the runnable frontier. The exact edge
direction must be specified rather than inferred from the word “subtree”:
dependents normally become unrunnable, while prerequisites may remain useful to
other tasks.

Resumption repeats the same essential work as crash recovery: reread current
authority facts, compare them with durable history, derive the current frontier,
and perform the next legal actions. It must explicitly handle tasks that were
edited, completed, closed, unblocked, newly blocked, claimed elsewhere, or
removed from the target closure during the pause.

## Transition-system framing

The intended model is close to a state machine over Dalph's reconstructed graph
knowledge:

- the journal reducer folds canonical events into reconstructible knowledge and
  workflow responsibility;
- frontier derivation is a pure view over that reduced state;
- operation selection chooses a legal transition from the derived frontier;
- an interpreter performs the selected boundary action;
- the resulting canonical observation or acknowledgement becomes another
  durable event.

Pause, resume, crash, wait-for-capacity, responsibility loss, and isolation are
part of this transition system. They are not exceptional control paths attached
outside the normal workflow.

The Wayfinder work must decide whether one reducer owns the complete transition
state or several composable reducers own graph knowledge, workflow history,
resource responsibility, and pause state. It must preserve the distinction
between a pure reducer/state machine and the external effects that supply new
events.

## Wayfinder destination

Create one Wayfinder map named:

**Specify bounded resumable and pausable graph-frontier orchestration**

Destination:

> Accepted domain language, ADRs, workflow rules, formal model, and an
> implementation-ticket dependency graph that completely specify bounded task
> graph traversal across ordinary execution, whole-run pause, task/subtree
> pause, coordinator crash, external world changes, and resume.

The specifications are the destination. Investigation issues are the steps.
The Wayfinder map remains an index; each resolved decision lives in exactly one
child ticket or linked artifact.

No implementation ticket is actionable until the specification-synthesis
ticket closes.

## Preserved findings awaiting Wayfinder

Deferring execution until the Wayfinder map exists does not invalidate the
coding, testing, or research findings already raised. W0 must preserve them as
map inputs and route each one to an owning investigation ticket.

### Code and architecture findings

- Pre-attempt recovery currently reports unfinished ordinary work instead of
  selecting and performing the next legal operation.
- One startup recovery invocation can stop after recording one new durable fact
  even though another action is immediately available.
- Later evidence, review, handback, rework, and disposition gaps are grouped too
  broadly for exhaustive transition handling.
- Reconciliation and fresh eligibility checks are inconsistent across early,
  unresolved, and later workflow stages.
- Current reduction can infer claim-selection responsibility merely because a
  task appeared in an observed eligible graph.
- Ordinary execution and recovery do not yet share one bounded capacity and
  frontier controller.
- A branch-local contradiction or lost resource can become a global startup
  blocker.
- Current code may need refactoring or replacement after the accepted model is
  known; this remains an explicit later architecture decision.

### Test and formal-model obligations

- The capacity-one/two-eligible-tasks crash scenario must prove that observation
  is not mistaken for selection.
- Every legal durable fact-to-next-intent boundary must be exercised through
  both the in-memory seam and SQLite production reopening.
- The matrix must include whole-run pause, task/dependency pause, resume, crash,
  and relevant external world changes.
- The Quint model must cover the bounded graph frontier, not only a single task
  attempt or session.
- A broader property generator remains conditional and lower priority, but is
  not rejected; W9 decides whether it adds useful coverage.

### Research obligations

- W2 audits all current specification and code assumptions against the corrected
  destination.
- W7 verifies whether worktree and session retries retain one operation identity
  or legitimately create another.
- W1 researches and decides canonical partial-observation coverage,
  completeness, absence, revision, and replacement semantics.
- W6 records the real observability and control limits of tracker, Git,
  worktree, provider session, agent log, evidence, and reviewer boundaries.
- W11 decides retain/refactor/replace/delete only after the specification and
  formal model are accepted.

## Readiness before W0

No finding above is to be implemented, disproved, or resolved before handing
off W0. This is a sequencing boundary, not an invalidation. Code changes,
prototypes, formal modeling, tests, and research belong to their named
Wayfinder tickets so their decisions are visible in the shared map.

Before W0:

1. commit this file as a standalone planning artifact so another workspace can
   address it by repository path;
2. create one narrow handoff for charting the Wayfinder map.

W0 itself loads ticket #112 and verifies the tracker-specific operations needed
to create the map, child tickets, claims, and blocking edges.

## Planned dependency graph

```text
W0  Chart the Wayfinder map
 |
 +--> W1  Model authority, observation, knowledge, and responsibility
 |     |
 |     +--> W3  Specify pause subjects and safe pause boundaries
 |     |
 |     +--> W4  Specify frontier derivation, scheduling, and capacity
 |     |
 |     +--> W5  Specify recovery activation and explicit stage taxonomy
 |     |
 |     +--> W6  Specify reconciliation of external changes
 |
 +--> W2  Audit current specs, ticket #112, and implementation assumptions
 |     |
 |     +--> W7  Verify operation-identity reuse and retry legality
 |
 +----------- W3, W4, W5, W6, W7
                         |
                         v
                 W8  Build and check the Quint model
                         |
                         v
                 W9  Define MBT and crash/pause prefix coverage
                         |
                         v
                W10  Synthesize accepted specs and ADR changes
                         |
                         v
                W11  Audit architecture against the accepted model
                         |
                         v
                W12  Create implementation tickets and blocking edges
```

W1 and W2 may run in parallel. W3 through W7 may run in parallel only after
their stated inputs are resolved. Each Wayfinder session resolves at most one
ticket.

## Wayfinder tickets

### W0 — Chart the Wayfinder map

Type: grilling, human in the loop.

Use the `wayfinder`, `grill-with-docs`, and `domain-modeling` skills. Create the
map and only the currently sharp investigation tickets. Keep later uncertainty
in the map's “Not yet specified” section. Do not resolve a ticket in the
charting session.

Input: this document, ticket #112, and the current recovery implementation
baseline. The accepted choices-audit dispositions and human feedback must be
read from this durable file rather than a `/tmp` copy.

Output: the tracker-native Wayfinder map, child tickets, and blocking edges.

### W1 — Model authority, observation, knowledge, and responsibility

Type: grilling, human in the loop.

Decide and document:

- the difference between current authority facts, historical observations,
  reconstructed durable graph knowledge, durable intentions, acknowledged
  effects, and derived frontier state;
- the meaning of a graph observation assembled from multiple provider reads;
- the provider-independent canonical observation shapes and their coverage,
  absence, completeness, and replacement semantics;
- the consistency/revision guarantees required from tracker adapters;
- how newly observed world changes update Dalph's knowledge;
- how Dalph records relinquished responsibility without claiming ownership of
  externally controlled history;
- which conditions are local branch dispositions versus whole-run blockers.

Use `domain-modeling` and produce or amend ADRs and `docs/CONTEXT.md`.

### W2 — Audit current specifications and implementation assumptions

Type: research, agent-driven.

Compare ticket #112, current ADRs, architecture, reducers, production startup,
capacity control, and tests against every decision in this document. Report:

- missing specifications;
- specifications contradicted by the new destination;
- code that assumes recovery is startup-only diagnosis;
- code that assumes every observed eligible task was selected for execution;
- code that persists or treats derived knowledge as authority;
- code that globally blocks on a branch-local issue;
- code whose structure prevents pause or partial pause.

This is an inventory, not a fix.

### W3 — Specify whole-run, task, and dependency pause semantics

Type: grilling, human in the loop.

Define the concrete pause command, its durable intent, the safe boundary for
each kind of in-flight action, confirmation of paused state, and resume. Decide
how task pause affects dependents, shared prerequisites, grouping edges, claims,
capacity, sessions, worker processes, integration, review, and cleanup.

Explicitly model authority changes during the pause.

### W4 — Specify bounded frontier derivation, scheduling, and capacity

Type: grilling, human in the loop.

Replace the local question “does an observed task ID need a claim?” with the
whole traversal model:

- derive runnable work from the latest usable graph knowledge;
- update an unstarted downstream graph region declaratively without coupling
  the observation path to execution-stage code;
- distinguish observation from selection;
- make selection policy deterministic where required, or define allowed
  nondeterminism explicitly;
- record intent before the first ambiguity-crossing effect;
- recompute uncommitted choices after restart;
- keep capacity bounded across ordinary work and resumed work;
- wait when capacity is occupied;
- continue unaffected branches when another branch is paused, waiting,
  disposed, or isolated;
- never persist the derived frontier as authority.

The capacity-one/two-eligible-tasks crash scenario from choices-audit item 5 is
a required acceptance example.

### W5 — Specify recovery activation and explicit durable stages

Type: grilling, human in the loop.

Specify that recovery re-enters the normal workflow. Cover all pre-attempt and
post-attempt gaps explicitly, including:

- claim selection needed and claim request unresolved;
- claimed-task eligibility observation needed and unresolved;
- attempt plan recording needed and unresolved;
- worktree reconciliation needed and unresolved;
- session establishment needed and unresolved;
- execution needed and unresolved;
- evidence sealing needed and unresolved;
- reviewer invocation or technical retry needed, unresolved, or waiting;
- semantic review result needed or unresolved;
- findings handback needed and unresolved;
- same-session rework needed and unresolved;
- current executor-protocol outcome needed and unresolved;
- integration needed and unresolved;
- completion-claim transition, tracker completion, confirmation, and exact
  completion-claim deletion needed or unresolved;
- protocol-declared resource disposition needed or unresolved;
- terminal, waiting, paused, isolated, and responsibility-relinquished states.

Resolve choices-audit items 1, 2, 3, and 4 according to the decisions in this
document. A recovery activation continues through immediately actionable stages
instead of returning after its first append. Represent recovery as the same
non-persisted per-responsibility transition frontier used by ordinary
coordination, not as one mutually exclusive stage per attempt. Current
evidence, review, handback, and rework operations remain concrete
executor-protocol stages rather than universal Dalph core stages.

### W6 — Specify reconciliation when the world changes

Type: grilling plus research, human in the loop for policy choices.

Build a boundary-by-boundary matrix for changes during ordinary work, pause, or
crash:

- task edited, completed, closed, reopened, newly blocked, or removed;
- claim unchanged, missing, replaced, foreign, or unreadable;
- target branch or planned Base SHA changed;
- worktree missing, moved, dirty, manually edited, or registered differently;
- task-work session or process finished, vanished, was replaced, or is
  unreadable;
- agent-session log or provider-native metadata changed manually;
- evidence, reviewer, or handback state changed;
- authority reads from different times disagree.

For each cell decide: accept and update knowledge, retry/wait, reconcile an
existing intent, record disposition and relinquish responsibility, isolate the
exact branch/resource, or fail the managed history.

Do not overfit strict guarantees to logs, unstaged edits, or provider state that
the adapter cannot authoritatively version or lock.

### W7 — Verify duplicate intents and retry identity

Type: research, agent-driven.

This schedules choices-audit item 6 without changing code.

Enumerate every current and accepted future retry/reconciliation path for
worktree creation/reconciliation and task-work-session establishment. Determine
whether a legal retry always keeps the original `OperationId`, or whether any
protocol legitimately creates a second intent for the same planned attempt.

The result must either:

- justify categorical duplicate rejection as an invariant; or
- identify the exact new domain phenomenon and causal rule that permits another
  operation identity.

### W8 — Build and check the Quint model

Type: prototype/research, agent-driven after the domain decisions.

Use `quint-modeling`, consulting `quint-lang`. Model the bounded frontier rather
than only one attempt. Include:

- canonical graph observations, partial-region knowledge updates, and knowledge
  revision;
- selection, capacity, and waiting;
- claims and responsibility;
- whole-run and task/dependency pause;
- crash at every intent/outcome boundary;
- fresh authority observations after interruption;
- compatible external changes, lost ownership, unreadability, ambiguity, and
  isolation;
- independent progress of unaffected branches;
- explicit subject-specific final outcomes and non-actionable reasons.

Required properties include bounded execution, no action without the required
durable intent, no duplicate ambiguity-crossing effect, no use of stale
authority evidence as current truth, no global deadlock from a branch-local
pause or lost resource, and progress from every legal prefix when a next action
or wait transition exists. State the finite actors, resources, retry bounds,
and trace depth under which exploration is exhaustive. Use `quint verify` to
check the bounded reachable state space; sampled `quint run` witnesses remain
useful for model construction but do not count as exhaustive verification.

### W9 — Define model-based and crash/pause-prefix test coverage

Type: research, agent-driven after the Quint model stabilizes.

This schedules choices-audit item 7. Generate the accepted event/operation
chains, truncate after every durable fact and intent, and exercise both
in-memory recovery and SQLite production reopening. Include pause/resume and
external-change matrices, not only coordinator death.

Connect the Quint actions to Dalph's public deterministic test controls through
`quint-connect` and compare modeled state with the real core reducers after
every action. State separately which bounded model properties were exhaustively
verified and which implementation traces were sampled. The current
task-work-session recovery MBT's fixed trace sample is prior art, not evidence
that every bounded implementation interleaving was replayed.

Choices-audit item 8 is conditional and lower priority: add a general arbitrary
for complete legal attempt histories only if the Quint model and coverage audit
show that it provides meaningful additional state-space coverage. If relevant,
schedule it near the end of this ticket, after the required boundary matrix.

### W10 — Synthesize specifications and ADR changes

Type: task, agent-driven synthesis with human review.

Use `to-spec` only after W1 and W3–W9 are resolved. Update canonical domain
language and architecture references instead of duplicating them in a new
parallel vocabulary. The resulting specification must preserve every declared
acceptance scenario and state the remaining fog explicitly.

The published specification must name Quint modeling and bounded verification
as a blocking specification deliverable before core-reducer implementation
tickets. It must then name code-connected model-based conformance against those
reducers as an implementation gate. Quint cannot be reduced to an optional
testing note added after implementation.

This closes the Wayfinder destination only if there is no unresolved policy or
domain question required before implementation planning.

### W11 — Audit the current architecture against the accepted model

Type: research, agent-driven.

Use `improve-codebase-architecture` and `code-review` against the accepted
specification. Classify each relevant component as retain, refactor, replace, or
delete. Pay special attention to:

- `runWorkflow` as a one-shot traversal;
- production recovery as startup-layer construction;
- split capacity control between ordinary and resumed work;
- `ManagedRunRecoveryStageEntry` as a local recovery taxonomy;
- global `StartupRecoveryBlocked` aggregation;
- reducers that infer selection from graph membership;
- assumptions of exclusive control over worktrees, provider sessions, or logs.

Do not preserve existing code merely because it exists. Do not rewrite it
merely because the destination is broader.

### W12 — Create implementation tickets and blocking edges

Type: task, agent-driven after W11.

Use `to-tickets`. Create tracer-bullet implementation tickets with native
blocking edges. Each ticket must declare its acceptance scenarios and its
relationship to the Quint model and MBT coverage.

Likely delivery ordering, subject to W11:

1. domain types, events, and adapter capability contracts;
2. reducer and workflow-algebra changes;
3. unified capacity/frontier coordinator;
4. pause and resume operations;
5. recovery/reconciliation continuations;
6. SQLite reopening, MBT, and production-composition coverage;
7. migration or deletion of superseded recovery code;
8. repeated domain/spec, architecture/connascence, and code-review passes.

## Handoff routing

Handoffs are generated only at session boundaries and always point back to the
Wayfinder map, the resolved ticket, and this planning source.

The handoff order is:

1. **Charting handoff → W0.** Reference this committed file, ticket #112, the
   current recovery commit range, and the canonical context/architecture/ADR
   documents. Instruct the session to chart only; it must not resolve a ticket
   or change code.
2. **Parallel first-frontier handoffs → W1 and W2.** W1 is a live
   `domain-modeling`/`grill-with-docs` session. W2 is an agent-driven audit. Each
   handoff references its claimed Wayfinder ticket and avoids copying this
   document.
3. **Decision handoffs → W3–W7 as their blockers close.** W3–W6 follow W1. W7
   follows W2. They may proceed in parallel, but each handoff covers exactly one
   claimed ticket and one session resolves at most one ticket.
4. **Formalization handoff → W8, then coverage handoff → W9.** W8 receives the
   resolved domain decisions. W9 receives the checked Quint model and its named
   properties.
5. **Synthesis handoff → W10, architecture handoff → W11, ticketing handoff →
   W12.** These run in strict order. W10 references decision artifacts rather
   than duplicating them. W11 receives the accepted specification and exact
   implementation baseline. W12 receives the accepted specification,
   architecture-audit result, formal-model properties, and test obligations.

After W12, implementation sessions receive one ticket at a time according to
the tracker-native blocking graph.

No handoff may silently promote an unresolved assumption into a decision.

## Choices-audit disposition

| Audit item | Planned disposition |
| --- | --- |
| 1. Pre-attempt stages block | Correct through W5; ordinary next actions resume. |
| 2. One activation advances one fact | Correct through W5; continue to action, wait, disposition, isolation, or terminal state. |
| 3. Later stages grouped | Accepted finding; specify explicit stages in W5. |
| 4. Early unresolved operations skip eligibility preflight | Accepted finding; resolve stage-specific reconciliation order in W5 and W6. |
| 5. Observed tasks over-classified | Accepted and broadened; specify the complete evolving graph-knowledge and frontier model in W1 and W4. |
| 6. Duplicate intents rejected | Verify in W7 before retaining or changing the invariant. |
| 7. Coverage not exhaustive | Accepted; define the crash/pause and external-change matrix in W9. |
| 8. Partial property test | Conditional, low priority, near the end of W9. |
| 9. Fresh review cycle incomplete | Skip; no standalone work. |
| 10. Closure overstated | Already corrected; no standalone work. |

## Planning boundary

Until W10 produces accepted specifications and W12 creates the implementation
graph:

- do not patch ticket #112 further;
- do not treat the three existing recovery commits as an architecture to
  preserve;
- do not begin a rewrite;
- do not convert this document directly into implementation tasks;
- do not claim that crash recovery, pause, graph-frontier traversal, or external
  reconciliation is fully specified.
