# Dalph reducer lab prototype

A browser-only FoldKit prototype for manually exploring current Dalph reducer
behavior. It imports the real journal fold, reconstructed-run reducers, runnable
frontier selector, finality decision, and admission controller directly from
`packages/orchestrator/src`.

No backend or persistence is used. Input history, branches, and projections live
only in the browser tab.

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

The prototype intentionally keeps whole-run and task pause controls disabled:
the current reconstructed pause reducer always returns `RunUnpaused` and
`NoTaskPauses`. Issues #62, #134, and #135 own that missing command and reducer
behavior.
