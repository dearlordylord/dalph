# Browser and real-host setup

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

### Browser and real-host setup

Before the first Lab browser check on Debian/Ubuntu, run:

```sh
pnpm --dir prototypes/reducer-lab browser:install
```

The system-library installation needs root or passwordless sudo; provision it
in development images before unprivileged CI. Try this setup before reporting
Playwright blocked; report the exact unrun command and missing dependency.
The browser runner owns its host; no manual Vite or `REDUCER_LAB_URL` is needed.

`qualify:codex` requires a built CLI (`codex` or `CODEX_BIN`). It isolates
`CODEX_HOME`, serves a deterministic local Responses endpoint, and uses temporary
Git repositories/worktrees. It is outside `check:all`; the same contract runs
on Ubuntu/macOS in the [qualification workflow](../../.github/workflows/codex-app-server-qualification.yml).
After building, the command first starts one app-server with the selected
executable through Dalph's production Effect process owner, then requires an
exact owned close before Vitest starts. This preflight uses a separate isolated
`CODEX_HOME` and durable process-state directory. A failed or timed-out
preflight retains that directory and prints its locator; do not rerun the
qualification until its recorded child is reconciled. The preflight does not
start a task or contact a model. The shared macOS process adapter now gives
Darwin's complete `ps eww -axo` census a 64 MiB output cap; the Node default
cap rejected a 1.1 MiB census during the first preflight. This restores the
already accepted exact process observation and cleanup path in
[Codex app-server qualification](../scenarios/codex-app-server-qualification.md),
while a census above the new cap still fails closed.
That workflow starts automatically for Codex integration source and scenario
changes. A shared `package.json` or qualification-workflow edit alone uses
`workflow_dispatch` when its Codex qualification contract needs checking; it
does not start real Codex processes for unrelated script changes. This narrows
gate selection and cannot alter Dalph runtime behavior.

For shared-host gate failures, dispatch [Candidate qualification](../../.github/workflows/quint-qualification.yml)
once with the frozen `candidate_sha`. Choose `quint` (default, ARM) or `all`
(x64, full history, gitleaks); `all` also requires the reviewed
`coverage_base_sha`. It runs the same gate on a fresh worker. Diagnose stage
failures before retrying; different hardware is not a calibrated baseline.

### Running-host graph page

The package build invokes [build-running-host-page.mjs](../../scripts/build-running-host-page.mjs), which uses the repository’s pinned native TypeScript compiler for the browser
configuration and the Lab’s [Vite configuration](../../prototypes/reducer-lab/vite.live-host.config.ts).
It emits only `packages/dalph/dist/browser/index.html`, `graph.js`, and
`graph.css`; the host serves a fixed allowlist, independent of its working
directory. The shared graph renderer has no cassette playback input in this page.

After building artifacts, run `pnpm --dir prototypes/reducer-lab check:browser:live-host`
for the real HTTP host, two Chromium pages, common renderer, passive Run graph updates, restart clearing and
origin refusal. Its controlled tracker inputs do not claim live GitHub timing.
Use the browser setup above first. Pure projection and refresh tests own
additional graph, cadence, coalescing and failure cases. These checks are mapped
in [the accepted graph-page scenarios](../scenarios/live-task-graph-page.md).
