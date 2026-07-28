# Reducer Lab design decisions

Date: 2026-07-26

Status: accepted design direction after the issue #131 prototype grill

## Purpose and status

The Reducer Lab is a maintained developer environment for manually exploring
Dalph behavior. It is not an operator interface, production control plane, or
second implementation of the orchestrator.

The current browser application under
[`prototypes/reducer-lab`](../../prototypes/reducer-lab) remains a prototype.
Promotion means retaining the useful developer environment and its behavioral
contracts while allowing the FoldKit view, graph renderer, and other
presentation experiments to be replaced.

The Lab must help a developer:

- change controlled external facts;
- ask Dalph to observe those facts;
- inspect reconstructed state, frontier, admission, and finality;
- execute a legal next workflow move;
- crash, restart, undo, redo, and fork the exploration history; and
- see where production behavior is absent or not yet exposed by the Lab.

Readable output is diagnostic evidence, not a correctness proof. Quint model
checking, model-to-code conformance, production tests, and Lab exploration
remain distinct activities.

## Accepted ownership boundaries

The promoted Lab uses four layers:

```text
production reducers and selectors
              |
              v
          Lab driver
              |
              v
        pure presenter
              |
              v
            FoldKit
```

### Production reducers and selectors

Production code owns workflow semantics. It reconstructs journaled state,
derives the runnable frontier, applies admission limits, decides finality, and
selects legal production transitions. The Lab must consume the issue #132
activation seam when it lands rather than implement another scheduler.

Production code must not acquire Lab wording, panels, button groups, CSS intent,
branch navigation, graph-renderer types, or scenario-picker concepts.

### Lab driver

The driver owns the controlled development environment around production
semantics. It may change fake task-tracker, Git, task-work-provider, executor,
and coordinator-process facts; select crash cut points; invoke real production
operations; and reconstruct a new semantic snapshot.

The driver must not directly assign reducer state or invent journal events as a
shortcut. Journal events should result from invoking the real operation and
interpreter boundaries. When production cannot perform a behavior, the driver
reports a capability gap instead of simulating a successful production
transition.

The driver returns both:

- production-selected workflow moves; and
- controlled-environment commands, such as changing capacity, editing tracker
  authority, observing it, crashing, and restarting.

These categories remain explicit because changing an external authority is not
a reducer-selected workflow transition.

### Pure presenter

The presenter converts one semantic driver snapshot into a display-ready view
model. It owns labels, explanations, ordering, grouping, status text, and
styling intent, including the presentation of available and unavailable
actions.

It does not execute actions, decide whether a move is legal, mutate authority,
or reconstruct domain state. FoldKit therefore never has to infer domain
meaning from production unions.

### FoldKit

FoldKit renders the presenter output and owns view-local interaction:

- branch and cursor navigation;
- undo, redo, and history forks;
- panel and graph-projection selection;
- graph-card edit drafts; and
- dispatch of a selected semantic move or explicit Lab command.

FoldKit does not manufacture journal input or decide production transition
availability.

## Available moves and execution contract

Each offered production move has a stable opaque `moveId`. The UI sends that
identity back to the driver; it does not construct the journal event or
operation payload represented by the move.

Immediately before execution, the driver revalidates the selected move against
the exact facts from which it was offered. The governing contract is:

> Execute the selected move against the exact facts from which it was offered.

A separate `snapshotRevision` is conditional rather than a Dalph domain
concept:

- in one synchronous process with the exact immutable snapshot object, object
  identity or the snapshot itself is sufficient;
- across a worker, asynchronous queue, RPC, or serialization boundary, an
  opaque revision is a valid optimistic-concurrency token; and
- no Lab snapshot revision belongs in Dalph domain state or the workflow
  journal without an independently accepted production requirement.

Unavailable moves remain visible when doing so explains production behavior.
The presenter disables them and states the exact reason, such as waiting for
capacity, stopped coordinator, missing Lab driver support, or absent production
pause state. This makes a production capability gap visible without pretending
the transition is legal.

## Graph editing

Graph editing controls the Lab's fake task-tracker authority. It is not a set of
production workflow moves.

The initial interaction is ordinary task-card CRUD:

- a stable `TaskId`;
- normalized task-work title and body;
- tracker lifecycle;
- prerequisite task identities; and
- optional parent/group identity.

Claims are shown and controlled separately because a task claim is not part of
the authored task-work specification or a graph relationship.

FoldKit owns the unsaved form draft. Saving sends a complete task replacement
to an explicit, replayable Lab driver command. A save changes only controlled
tracker authority; it does not silently append a graph observation or update
reconstructed Dalph state. The developer must separately select **Observe**.

The graph is view-only. Card editing, not direct node dragging or edge drawing,
is the first editing surface. Direct graph manipulation may be reconsidered
later, but it is outside the promotion scope.

## Two graph projections and durable observation coverage

The Lab can display two related but non-equivalent graph projections:

1. **Latest successful normalized observation** — the last graph snapshot
   produced by the task-tracker read boundary and therefore the graph most
   recently seen successfully by Dalph. It is not necessarily current.
2. **Controlled tracker authority** — the Lab's current fake external task
   tracker, including unsound or invalid topology used to exercise failures.

An adaptive selector offers `Auto`, each individual graph projection, and `Compare`.
`Auto` collapses projections that are equal. `Compare` keeps the selected
`TaskId` and viewport synchronized where practical. The Lab should not consume
screen space showing identical copies.

The current reducer retains target-closure membership rather than dependency or
grouping topology. The Lab therefore renders **journal-reconstructed observation
coverage** as a membership-and-diagnostics panel, not a graph. It must show
retained task identities, observation conflicts/counts, and staleness
limitations without filling missing edges from current authority or the latest
read.

## Invalid graph semantics

Controlled tracker authority may deliberately contain duplicate edges, missing
endpoints, self-edges, dependency cycles, or containment cycles. That invalid
raw topology is valid Lab input because exercising the read boundary is part of
the Lab's purpose.

It is not a valid production `TaskDagSnapshot`.

Production graph projection accumulates typed issues, including distinct
`Cycle` and `ContainmentCycle` witnesses, and returns
`TaskDag.GraphProjectionError`. The reader exposes no partial or schedulable
snapshot. The journaled interpreter records graph-observation intent before the
read and records `TrackerGraphOutcomeObserved` only after a successful read.

Consequently, after an invalid observation attempt:

- controlled tracker authority displays the invalid topology and diagnostics;
- the observation attempt displays its typed failure;
- the latest successful normalized observation does not advance;
- best available durable graph knowledge changes only if a successful graph
  outcome was journaled; and
- prior durable knowledge, when present, is explicitly stale rather than proof
  of current authority.

If the first read is invalid, there is no successfully observed graph and no
durable graph knowledge. An unreadable or invalid read cannot prove a current
tracker fact merely because an older observation exists.

See
[`task-dag.ts`](../../packages/orchestrator/src/task-dag.ts),
[`tracker-graph-reader.ts`](../../packages/orchestrator/src/tracker-graph-reader.ts),
[`journaled-workflow-interpreter.ts`](../../packages/orchestrator/src/journaled-workflow-interpreter.ts),
and
[`reconstructed-managed-run.ts`](../../packages/orchestrator/src/reconstructed-managed-run.ts).

## Graph-renderer decision

The graph renderer is an interchangeable view adapter.

The presenter supplies a stable `TaskGraphProjection`. Renderer-specific node,
edge, event, and layout types must not escape the adapter. The first experiment
may use Cytoscape.js mounted through FoldKit with the existing Dagre layout
ideas from [`prototypes/execution-trace`](../../prototypes/execution-trace).
React Flow is not selected because it would introduce a second React-owned UI
island beside FoldKit.

Cytoscape.js is not an architectural commitment. A different renderer may
replace it without changing the driver, presenter contract, or graph
projection. This reversibility is intentional and does not warrant a production
ADR.

## Behavioral parity

The Lab must follow the production reducer and selector feature set without
depending on maintainers to remember a parallel button list.

The promotion target retains the coverage-registry approach described in
[`reducer-lab-parity-audit.md`](reducer-lab-parity-audit.md). Every tag in the
relevant production unions is exhaustively classified as:

- `Interactive`;
- `Observable`; or
- `IntentionallyExcluded`, with a reason.

At minimum, the registries cover workflow operations, journal events,
responsibility entries, responsibility dispositions, runnable-frontier
transitions, frontier explanations, and run-finality decisions. Adding a
production union tag must break typechecking until its Lab status is chosen.
Every interactive classification needs a driver-level reachability scenario.

Calling the real browser-safe driver supplies behavioral parity. The presenter
still requires deliberate human design; exhaustive union coverage cannot
automatically produce useful wording or layout.

## Browser boundary

The Lab needs no backend. Pure Effect modules, reducers, selectors, schemas,
and test authorities can run in the browser after browser-safe common modules
are isolated properly.

The current prototype reaches a static `@effect/platform-node` import through
the all-events and evidence dependency chain and temporarily aliases the unused
adapter to a shim. Promotion requires extracting a browser-safe production core
or otherwise removing that import path. The shim is prototype evidence, not the
production architecture.

Production structure may need to change only at these seams:

- expose browser-safe reducer, selector, schema, and activation modules;
- keep platform interpreters outside that common dependency direction;
- expose the issue #132 activation contract without UI concepts; and
- maintain test-support authorities and reachability scenarios beside, but not
  inside, production domain state.

## Scenarios

There is no scenario editor, import/export format, or scenario picker in the
current promotion scope.

A later scenario picker is desirable only when canonical scenarios:

1. originate in test modules;
2. execute as tests before being exposed in the Lab;
3. are automatically bundled into the frontend; and
4. remain read-only in the Lab.

This prevents frontend-authored examples from becoming a second behavioral
specification. Until that test-to-Lab pipeline exists, developers explore by
editing controlled authorities and applying available moves.

## Deferred implementation contingencies

The grill is complete. The remaining unknowns are implementation contingencies,
not unresolved product decisions:

- issue #132 will determine the exact activation API consumed by the driver;
- asynchronous activation will determine whether an explicit opaque snapshot
  revision is useful;
- the Cytoscape.js experiment will test renderer fit without committing the
  architecture to it; and
- future graph-knowledge work will determine when the durable projection can
  display dependency and grouping facts rather than membership alone.

No deferred item authorizes a second scheduler, UI-authored journal events,
duplicated tracker authority, persisted frontier state, or renderer types in
the driver contract.
