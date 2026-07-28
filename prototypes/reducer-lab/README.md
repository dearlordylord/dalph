# Dalph reducer lab prototype

## Prototype question

Can one browser-only developer environment make the authority/observation
boundary, durable reconstruction, runnable frontier, admission, and finality
feel concrete without becoming a second orchestrator or pretending those graph
truths are equivalent?

A browser-only FoldKit prototype for manually exploring current Dalph reducer
behavior. It imports the real journal fold, reconstructed-run reducers, runnable
frontier selector, finality decision, and admission controller directly from
`packages/orchestrator/src`.

No backend or persistence is used. Input history, branches, and projections live
only in the browser tab.

The semantic move inventory is returned by the exploration driver. A separate
pure presenter turns each move into exactly one display action and owns all
labels, explanations, grouping, ordering, and styling intent. It distinguishes:

- moves selected by the real production runnable frontier, including selections
  the Lab cannot drive;
- selection of a Lab fake task-tracker target and a request for production to
  read it, separate from task editing and saving;
- moves selected by the Lab's fixed prototype workflow driver to invoke
  production stages, including fresh-read and executor-replay conveniences;
- synthetic Lab disposition and cardinality cases supplied directly to the
  production responsibility selector, explicitly not authoritative evidence;
- real production recovery activation;
- direct Lab input to the production run-finality selector;
- in-memory Lab coordinator crash, restart, and capacity inputs;
- fake boundary outcomes configured for later production workflow moves; and
- operator pause/unpause requests that production can record without proving
  reconstructed pause state changed.

The palette gives those phenomena separate headings and status labels.
“Production move executable,” “Lab input available,” and “request can be
recorded” are deliberately different claims.

The graph workbench implements the accepted task-card interaction:

- create, edit, and delete stable task identities;
- edit normalized title/body, lifecycle, prerequisite IDs, and parent/group ID;
- preserve deliberately invalid raw edges and endpoints;
- control claims separately from task content and topology; and
- keep the unsaved form draft in FoldKit.

Saving appends a complete, replayable task replacement to controlled external
authority. It does not observe. The developer must separately choose
**Observe tracker authority**. A valid observation appends intent and outcome;
an invalid observation appends intent, displays the real `TaskDag` projection
issues, and leaves the latest successful observation and durable knowledge
unchanged.

The graph selector exposes `Auto`, `Latest`, `Authority`, and `Compare`.
`Auto` collapses equal projections. The latest successful normalized
observation and current fake tracker authority are the primary graph surfaces.
Journal-reconstructed membership is a collapsed **Recovery diagnostics**
disclosure: the current reducer retains target-closure task IDs, but no task
content, lifecycle, dependency edges, or grouping edges.

Each topology-bearing projection is rendered as an actual view-only Cytoscape graph through a
FoldKit custom-element adapter. Dagre lays tasks out left-to-right; solid arrow
edges mean “blocks,” dashed diamond edges mean “contains,” and invalid missing
endpoints appear as explicit placeholder nodes. Cytoscape data, layout, and
browser events remain private to the adapter; the presenter still exposes only
the stable `TaskGraphProjection`.

Capacity, target settlement, claims, and coordinator lifetime are inputs in the
branch history, so undo, redo, and forks restore them consistently. Acting
after undo automatically creates a branch from the displayed immutable input
prefix; the original branch and its future inputs remain unchanged. The
separate **Fork at cursor** control is only an explicit way to name that
decision before acting. During cursor reconstruction there is no current
snapshot, so no semantic move or explicit Lab command can run against the
snapshot from the previous cursor.
Primary and Secondary select two independent controlled tracker targets. Each
retains its own task authority, while observations from both flow through the
same production target-closure reconstruction.

FoldKit dispatches only a semantic move ID and the opaque revision of the
snapshot it rendered. A Command asks the driver to revalidate that exact move;
only the driver can append the hidden semantic input and reconstruct the next
snapshot. FoldKit continues to own branches, cursors, undo/redo, and panels.

`src/reducer-surface.ts` exhaustively classifies the production operation,
journal-event, responsibility, disposition, frontier-transition, explanation,
and finality unions. A newly added production tag breaks prototype typechecking
until its driver coverage is classified. The view remains throwaway; this
registry sketches the maintained test-support seam needed to prevent silent
feature drift.

The post-#133 driver uses revision-bearing fresh tasks, exact tagged admission
reservations, one-transition-at-a-time admission, and the generic
executor-invocation responsibility, transition, wait, and settlement vocabulary.
The Lab's controlled claim adapter returns an authoritative exact fake claim.
The production journaled interpreter records that claim and every controlled
graph read; the driver does not construct their journal events. After claim
selection, the driver checks that exact claim and rereads the controlled
tracker before attempt planning, then runs the real production task-attempt
and selected-executor stage builders through controlled authoritative Git,
task-work-provider, executor, evidence-store, and reviewer adapters. Every
durable event is produced by the production journaled interpreter. A
claimed task that is completed, missing, or blocked stops before planning, and
the successful reread advances the latest observed graph.

The orchestration surface shows claim, claimed-task eligibility, attempt plan,
worktree reconciliation, work-session establishment, and opaque executor outer
invocations distinguished by ordinal. The accepted path currently takes four;
review findings add handback, rework, evidence, and another review invocation.
Production activates them without requiring individual operator clicks, so the
Lab offers a coordinator command that runs the selected protocol to its outer
outcome while retaining individual step controls for inspection. The Lab does
not promote execution, evidence, review, handback, or disposition into generic
orchestrator stages.

Controlled boundary behavior can be switched before or during a branch. The
choices reach production task-work lookup/start failures, executor
request/observation failures, failed/interrupted/resource-emergency execution
outcomes, reviewer findings and handback, and reviewer/handback technical retry.
The view selects authority behavior; the production journaled interpreter
creates every resulting intent, failure, retry, outcome, and convergence event.

The controlled authorities return typed production boundary results rather
than constructing journal events. Their intent and outcome records drive the
same managed-history fold as production, so exact worktree, session, executor,
evidence, review, and convergence responsibilities remain inspectable by
operation identity. The developer can then mark the task complete in controlled
tracker authority and explicitly observe it; the production frontier reports
the task's final outcome and offers no further transition for it. There is no
fictional integration or tracker mutation operation because current production
code has none.

Every production responsibility disposition is selectable for one exact
outstanding operation, including dependency wait, final tracker outcome,
relinquishment, settlement, unreadability, and executor wait/settlement.
Frontier and admission rows retain the exact operation identity instead of
collapsing simultaneous responsibilities by task.

After a coordinator crash and restart, the Lab obtains the production recovery
frontier. **Activate recovered responsibilities to quiescence** calls
`activateRecoveredResponsibilities`; it does not invoke a recovered operation
directly or manufacture the private activation-ownership capability. The smoke
scenario interrupts after the first selected-executor outcome and proves that
production recovery reaches the same convergence disposition.

A simulated coordinator crash also discards every volatile latest normalized
observation. Durable target-closure membership remains reconstructible from the
managed journal, but the Latest graph stays unavailable after restart until the
developer explicitly asks Dalph to read the selected fake tracker again.

The architecture additionally requires an active-continuation tracker reread
before later long-running executor invocations. Current production code does
not implement that operation, so the Lab reports the production capability gap
instead of fabricating the specified behavior.

The current source boundary is not fully browser-safe: importing
`managed-history.ts` reaches a static `@effect/platform-node` import through the
all-events schema and implementation-evidence module. Vite aliases that unused
adapter import to `src/platform-node-shim.ts`; all reducers and domain schemas
remain the real Dalph source. A production browser-safe common package should
remove the need for this shim.

```sh
pnpm install --ignore-workspace
pnpm dev
```

Run the proportional semantic scenarios with:

```sh
pnpm smoke
```

## Prototype verdict

The presenter boundary materially clarifies ownership: driver types contain no
display labels, prose, groups, or CSS intent, and the presenter parity check
proves that every semantic move is represented exactly once. The presenter
also supplies the stable renderer-independent `TaskGraphProjection`; layout
and browser events stay in the throwaway view.

The opaque snapshot revision is partly redundant in this single-process
prototype because FoldKit already ignores superseded Commands. Actions remain
available while inspecting history: selecting one creates a new branch from
the exact displayed input prefix before the driver executes it. The revision
still provides a small, explicit revalidation boundary for a delayed click or
future asynchronous activation adapter. Keep it as part of this experiment;
do not promote it to production domain state. Issue #132's activation seam now
owns the real process-local selection and execution correlations; this
revision remains only a browser command revalidation token.

The parity scenarios now prove that a task observed from the graph editor can
be advanced, one real production move at a time, through the current coarse
executor boundary and its complete durable journal chain, then externally
completed and observed through the tracker boundary. They also cover the
selected executor's production failure, retry, findings, handback, and rework
branches while keeping those stages opaque to the generic orchestrator.

The prototype invokes the current authenticated whole-run and task pause/unpause
command service and shows its `ControlCommandRecorded` events. The current
reconstructed pause reducer still returns `RunUnpaused` and `NoTaskPauses`;
the Lab does not pretend that recording a request has already applied the
still-unimplemented derived pause state. Per-task request buttons may appear
before graph observation because their task identities come from the Lab's fake
tracker authority. Their group and row text state that provenance explicitly;
their presence is not a reducer selection.
