# Source and built artifacts

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

### Current source and built artifacts

Root development checks resolve `@dalph/contracts`, `@dalph/orchestrator`, and
`@dalph/dalph` directly to the current source entry points. Package emit
configurations do not inherit those mappings. This keeps typecheck, Effect
diagnostics, lint, and focused tests independent of ignored or stale `dist/`
directories without changing emitted runtime imports. TypeScript documents that
[`paths` changes compiler resolution but does not rewrite emitted imports](https://www.typescriptlang.org/tsconfig/paths.html).

Anything that consumes distributable output uses `pnpm check:artifacts`. The
command first rejects a production package without a build script, then runs the
existing clean workspace build. pnpm's recursive execution is
[dependency-ordered by default](https://pnpm.io/10.x/cli/recursive#--no-sort).
Afterward, the command resolves declarations without the development mappings,
imports each package in a fresh Node process through its normal
[`exports` entry point](https://nodejs.org/api/packages.html#package-entry-points),
validates every declared bin, and checks the
[`pnpm pack --dry-run`](https://pnpm.io/10.x/cli/pack) inventory. Missing,
malformed, or unpackaged artifacts fail the command. The preflight census prepares
production artifacts before source checks so a fresh checkout does not lint
unresolved distributable declarations. Artifact validation stops at failed
prerequisites rather than interpreting absent build output. Preflight control
tests cover this ordering; it changes no Dalph runtime behavior. `check:all` runs
the same census once. After successful preflight, it runs selected application
qualification and records formal proof as not requested. Standalone
`pnpm check:quint` owns the local guarded formal profile; hosted CI owns its
separate formal proof.
Standalone preflight is evidence for repairs before freezing; the final full
gate repeats the census on its frozen candidate. Revision-10 change selection
includes the maintained Reducer Lab only for a Lab-owned
`prototypes/reducer-lab` path or missing/unknown changed-path evidence; if
selected, a Lab failure prevents local application qualification. Known non-Lab
product, script, cassette, and configuration changes omit Lab while applicable
recorded-catalog and infrastructure controls remain. Use `check:fast` during
edits, then `check:baseline` for an early task-attempt baseline before freezing.

In a fresh worktree run:

```sh
pnpm bootstrap:worktree
```

The bootstrap first initializes the repository's declared Git submodules, then
runs [`pnpm install --frozen-lockfile`](https://pnpm.io/10.x/cli/install#--frozen-lockfile)
before `check:artifacts`. Because pnpm cannot create a workspace bin launcher
whose generated target is absent during that first install, the bootstrap then
runs a second frozen install with lifecycle scripts disabled and verifies every
declared launcher under `node_modules/.bin`. It stops at the first failure.
After launcher validation, it runs the bounded `prewarm:vitest` command. That
command transforms and parses the ordinary Vitest module graph without
executing tests, and writes only the disposable
`node_modules/.experimental-vitest-cache` cache. A prewarm failure or timeout
fails bootstrap; it is not a successful-but-cold setup. Install lifecycle
scripts are not the artifact correctness boundary: pnpm can deliberately
[disable them](https://pnpm.io/10.x/cli/install#--ignore-scripts).

Run the real bootstrap integration as
`pnpm test scripts/bootstrap-worktree.test.ts`. That package-script boundary
provides the same pnpm entry point used by `bootstrap:worktree`; `pnpm exec
vitest` does not provide it and is intentionally rejected by this test.

These are repository-tooling rules only. They do not change a Dalph command,
workflow decision, external request, journal fact, retry, concurrency rule,
cleanup action, or user-visible delivery outcome.

Codex adds a per-shell argv-zero shim directory under
`$HOME/.codex/tmp/arg0/codex-arg0XXXXXX` to `PATH`. Before the admission wrapper
launches the full quality gate or standalone formal verification, the harness
removes that component only after proving that every declared tool in the whole
child tree resolves to the same executable without it. The full-quality
inventory includes its nested formal Java resolution. A shim that supplies a
declared tool refuses the gate before launch. The entry points recheck the same
rule before observation and guarded children. All guarded children and recorded
input identity use the resulting `PATH`; ordinary `PATH` candidates and their
strict ancestors remain observed for resolution-changing events. Metadata-only
churn on an ancestor is ignored when that ancestor is not itself a declared
input.

Effect tests use `it.effect`, test Layers, `TestClock`, and deterministic
synchronization instead of module mocks, ambient time, or sleeps. Name property tests
`*.property.test.ts`.
