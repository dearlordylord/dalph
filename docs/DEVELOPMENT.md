# Development harness

Dalph supports Node 22 from 22.22.2 and Node 24 from 24.15.0; odd-numbered Node
25 is unsupported. Node 24.15.0 is recommended. The repository uses a single
pnpm quality harness at the root. Package-local commands may be narrower during
development, but `pnpm check:all` is the acceptance gate for repository
changes.

The root `package.json` `engines.node` field is the canonical declaration of the
supported Node range; CI derives its minimum-version matrix from that range and
runs the complete gate on each entry. Before adding a supported Node major,
verify a frozen install and the production exclusive-coordinator-lock behavior
described in `ARCHITECTURE.md`. The native lock dependency must either ship a matching prebuilt binary
or the repository must explicitly accept and provide its source-build toolchain;
an accidental local compilation is not upgrade evidence.

## Domain language

Canonical Dalph terms live in [CONTEXT.md](CONTEXT.md). Before adding or changing
a domain name, sentence, type, event, or adapter operation, apply the literal
reading test:

1. Read the words using their ordinary meanings, without silently supplying
   missing Dalph context.
2. Ask who performs the action, what changes, and which exact component or
   external application must be reread to learn the result.
3. Replace actorless modifiers such as “managed,” “controlled,” and “external”
   with the named actor, boundary, or constraint.
4. Reject a name whose ordinary reading describes several Dalph phenomena. For
   example, `ExecuteTask` could mean selecting work, granting a capacity slot,
   starting a process, waiting for it, or marking the task complete.
5. Put the resolved canonical term in `docs/CONTEXT.md`; document each branded
   type and non-obvious event where it is declared.

The deliberately absurd reading is useful evidence: if “managed task” sounds
like an unnamed manager managing a task, the name has hidden a domain actor.
Humor exposes the ambiguity; the replacement must state the real actor and
event in plain language.

Effect's `Context.Service` is an implementation mechanism for an injected
interface. It does not imply a separately deployed service or microservice and
does not justify putting “service” in the domain name. Domain prose names the
role—such as task tracker or task runner—while TypeScript may implement that
role with an Effect service tag and Layer.

## Workspace shape

Production packages belong under `packages/*`. Each package declares its runtime
dependencies and provides its build entry points and focused tests. Root
configuration defines shared compiler, lint, formatting, dependency-cycle,
duplication, coverage, and secret-scanning policy.

Do not create a second package manager lockfile or a package-local copy of a
root quality configuration. Extend the root configuration only when a package
requires a setting that cannot correctly be shared.

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

CI installs exactly the dependency versions recorded in the committed lockfile
using `--frozen-lockfile`. Strict peer dependency checks are enabled, lifecycle
scripts are limited through pnpm's `onlyBuiltDependencies`, and newly released
dependencies are held back for 24 hours unless explicitly excepted.

The pre-commit hook formats and lints staged TypeScript, typechecks the whole
workspace, checks dependency cycles, and scans staged content for secrets.
Install `gitleaks` locally before committing.

## Changing the harness

`package.json`, `pnpm-workspace.yaml`, `tsconfig*.json`,
`eslint.config.mjs`, `vitest.config.ts`, `.jscpd.json`, `.madgerc`, and CI or
hook files collectively define repository quality policy. Explain threshold
reductions or exclusions in the change that introduces them; generated-code
exclusions must be narrow and must not hide authored logic.

The empty `.eslintrc` file is a compatibility sentinel consumed by
`import-x/no-unused-modules` while ESLint itself uses the flat
`eslint.config.mjs` configuration. Keep the sentinel until the pinned plugin no
longer requires it for flat-config file discovery.

The repository-wide `dalph/effect-class-inheritance-only` rule permits class
inheritance only for Effect `Context.Service` tags and
`Schema.TaggedErrorClass` failures. Other inheritance remains forbidden; do not
replace this policy with per-class suppressions.
