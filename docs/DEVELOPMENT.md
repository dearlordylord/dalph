# Development harness

Dalph requires Node 22.22.2 or newer and uses a single pnpm quality harness at the repository root. Package-local
commands may be narrower during development, but `pnpm check:all` is the
acceptance gate for repository changes.

## Workspace shape

Production packages belong under `packages/*`. Each package owns its runtime
dependencies, build entry points, and focused tests. Root tooling owns shared
compiler, lint, formatting, dependency-cycle, duplication, coverage, and
secret-scanning policy.

Do not create a second package manager lockfile or a package-local copy of a
root quality configuration. Extend the root configuration only when a package
has a real boundary-specific need.

## Commands

- `pnpm typecheck` runs the strict shared TypeScript program.
- `pnpm lint:code` runs type-aware ESLint and Effect dprint rules.
- `pnpm check:circular` rejects runtime dependency cycles.
- `pnpm check:duplicates` enforces the configured TypeScript duplication budget.
- `pnpm test` runs the deterministic Vitest suite.
- `pnpm test:coverage` enforces the configured line, function, branch, and statement coverage bar.
- `pnpm check:secrets` scans Git history with gitleaks.
- `pnpm check:all` runs the complete bounded gate used by CI.

Duplication is a production-code gate. Tests are excluded because scenario and
adapter contract setup intentionally repeats shapes across independent cases;
the current `prototypes/` tree is excluded because it is disposable research
evidence, not production architecture. Tooling scripts and configuration stay
inside the duplication scan.

Use a focused test file while developing, for example:

```sh
pnpm vitest run packages/orchestrator/test/task-dag.test.ts
```

Property-based tests must use `*.property.test.ts`. Effect tests should use
`it.effect`, test Layers, `TestClock`, and deterministic synchronization rather
than module mocks, ambient time, or sleeps.

## Safety and supply chain

The committed lockfile is authoritative. CI installs it with
`--frozen-lockfile`, strict peer dependency checks are enabled, lifecycle
scripts are limited through pnpm's `onlyBuiltDependencies`, and newly released
dependencies are held back for 24 hours unless explicitly excepted.

The pre-commit hook formats and lints staged TypeScript, typechecks the whole
workspace, checks dependency cycles, and scans staged content for secrets.
Install `gitleaks` locally before committing.

## Changing the harness

Treat `package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`,
`eslint.config.mjs`, `vitest.config.ts`, `.jscpd.json`, `.madgerc`, and CI or
hook files as one policy surface. Explain threshold reductions or exclusions
in the change that introduces them; generated-code exclusions must be narrow
and must not hide authored logic.

The empty `.eslintrc` file is a compatibility sentinel consumed by
`import-x/no-unused-modules` while ESLint itself uses the flat
`eslint.config.mjs` configuration. Keep the sentinel until the pinned plugin no
longer requires it for flat-config file discovery.
