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

- reducer-selected moves, including runnable moves waiting for capacity;
- external tracker edits and fresh authority facts;
- coordinator and capacity controls; and
- planned production behavior that the driver refuses to fake.

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
`Auto` collapses equal projections. Journal-reconstructed observation coverage
is deliberately rendered as a membership-and-diagnostics panel rather than a
graph: the current reducer retains target-closure task IDs, but no task content,
lifecycle, dependency edges, or grouping edges.

Each topology-bearing projection is rendered as an actual view-only Cytoscape graph through a
FoldKit custom-element adapter. Dagre lays tasks out left-to-right; solid arrow
edges mean “blocks,” dashed diamond edges mean “contains,” and invalid missing
endpoints appear as explicit placeholder nodes. Cytoscape data, layout, and
browser events remain private to the adapter; the presenter still exposes only
the stable `TaskGraphProjection`.

Capacity, target settlement, claims, and coordinator lifetime are inputs in the
branch history, so undo, redo, and forks restore them consistently.

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
After claim selection, it replays the real production task-attempt and
selected-executor stage builders through the production dry-run interpreter.
The orchestration surface shows claim, attempt plan, worktree reconciliation,
work-session establishment, and opaque executor outer invocations. It does not
promote the selected executor's internal execution, evidence, review, handback,
or disposition operations into orchestrator stages.

Provider-authoritative Git, session, executor, evidence, and review facts are
not fabricated. The Lab labels this path as the production dry-run interpreter
and displays its normalized outer trace separately from the durable workflow
journal. It stops after the selected executor returns its completed outer
outcome because current production code has no integration or tracker-task
completion operation.

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
prototype because FoldKit already ignores superseded Commands and disables
actions away from a branch tip. It still provides a small, explicit
revalidation boundary for a delayed click or future asynchronous activation
adapter. Keep it as part of this experiment; do not promote it to production
domain state. Issue #132's activation seam now owns the real process-local
selection and execution correlations; this revision remains only a browser
command revalidation token.

The parity scenario now proves that a task observed from the graph editor can
be advanced, one real production move at a time, through the current coarse
executor boundary. Internal review strategy remains hidden; after the selected
executor returns its completed outer outcome, the Lab offers no fictional
integration or tracker-completion step.

The prototype intentionally keeps whole-run and task pause controls disabled:
the current reconstructed pause reducer always returns `RunUnpaused` and
`NoTaskPauses`. Issues #62, #134, and #135 own that missing command and reducer
behavior.
