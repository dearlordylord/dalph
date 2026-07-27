# Dalph reducer lab prototype

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

Tracker edits change the controlled external authority immediately. The
reconstructed Dalph state changes only after **Observe tracker target closure**,
making stale observations and re-observation visible. Capacity is an input in
the branch history, so undo, redo, and forks restore it consistently.

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

The post-#133 refresh uses revision-bearing fresh tasks, exact tagged admission
reservations, one-transition-at-a-time admission, and the generic
executor-invocation responsibility, transition, wait, and settlement vocabulary.
It does not add an executor driver or new Lab behavior.

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

The presenter boundary materially clarifies ownership: driver types no longer
contain display labels, prose, groups, or CSS intent, and the presenter parity
check can prove that every semantic move is represented exactly once.

The opaque snapshot revision is partly redundant in this single-process
prototype because FoldKit already ignores superseded Commands and disables
actions away from a branch tip. It still provides a small, explicit
revalidation boundary for a delayed click or future asynchronous activation
adapter. Keep it as part of this experiment; do not promote it to production
domain state. Issue #132's activation seam now owns the real process-local
selection and execution correlations; this revision remains only a browser
command revalidation token.

The prototype intentionally keeps whole-run and task pause controls disabled:
the current reconstructed pause reducer always returns `RunUnpaused` and
`NoTaskPauses`. Issues #62, #134, and #135 own that missing command and reducer
behavior.
