# Development harness

Dalph supports Node 22 from 22.22.2 and Node 24 from 24.15.0; odd-numbered Node
25 is unsupported. Node 24.15.0 is recommended. The repository uses a single
pnpm quality harness at the root. Package-local commands may be narrower during
development, but `pnpm check:all` is the acceptance gate for repository
changes.

The root `package.json` `engines.node` field is the canonical declaration of the
supported Node range; CI derives its minimum-version matrix from that range and
runs the hosted gate on each entry. Before adding a supported Node major,
verify a frozen install and the production exclusive-coordinator-lock behavior
described in `ARCHITECTURE.md`. The native lock dependency must either ship a matching prebuilt binary
or the repository must explicitly accept and provide its source-build toolchain;
an accidental local compilation is not upgrade evidence.

## Operational scenario gate

Before planning or implementing a behavior change, read
[OPERATIONAL-SCENARIOS.md](OPERATIONAL-SCENARIOS.md) and write the required
chronological scenarios in the accepted issue, specification, or
`docs/scenarios/`. Start with the affected person when one exists, relevant
GitHub/Git/executor state, concrete trigger, external result, applicable crash
point and retry, and visible outcome. State why a person, boundary, or failure
does not apply rather than filling every field with an invented event. Only
then introduce the domain model and implementation mechanisms.

The implementation plan maps every scenario to a test seam. The handoff maps
every scenario to a passing acceptance test or model check and names anything
deferred. Aggregate test counts, typechecking, and coverage are additional
evidence; they do not prove that the user's story was implemented.

A tooling-only or documentation-only change may omit runtime scenarios only
when its plan and handoff state the concrete reason it cannot change Dalph
runtime behavior. Reviewers reject an exemption that hides a changed command,
workflow decision, external request, durable fact, retry, recovery rule,
concurrency rule, cleanup action, or visible result.

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

Explanations and reviews apply the same test before compressing behavior into
canonical shorthand. First name the actor, action, and boundary in concrete
language: prefer “try to create the claim up to three times” over “bounded
acquisition,” “check GitHub again” over “perform an authoritative reread,” and
“repository label used as the task claim record” over “label-backed lock.” The
canonical term may follow once the concrete behavior is clear.

The deliberately absurd reading is useful evidence: if “managed task” sounds
like an unnamed manager managing a task, the name has hidden a domain actor.
Humor exposes the ambiguity; the replacement must state the real actor and
event in plain language.

Effect's `Context.Service` is an implementation mechanism for an injected
interface. It does not imply a separately deployed service or microservice and
does not justify putting “service” in the domain name. Domain prose names the
role—such as task tracker or executor—while TypeScript may implement that
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

- `pnpm typecheck` runs the strict shared TypeScript program through Effect's
  TypeScript-Go compiler, including Effect language-service diagnostics.
- `pnpm lint:code` runs type-aware Oxlint rules and dprint formatting checks.
- `pnpm check:circular` rejects runtime dependency cycles.
- `pnpm check:complexity` rejects an increase in the number of production
  functions above cyclomatic complexity eight in each file.
- `pnpm check:duplicates` enforces the configured TypeScript duplication budget.
- `pnpm test` runs the deterministic Vitest suite.
- `pnpm test:coverage` enforces the configured line, function, branch, and statement coverage bar.
- `pnpm test:mbt` runs the Quint-connected executable conformance suites.
- `pnpm check:quint` runs deterministic, sampled, and exhaustive formal model
  checks. Run it once after the final relevant changes and before integration;
  during development, use it when changing a Quint model, its conformance
  adapter, or behavior governed by that model.
- `pnpm check:secrets` scans Git history with gitleaks.
- `pnpm check:ci` runs the hosted CI gate. During the single-executor v1
  proof-of-concept phase it excludes Quint-connected MBT.
- `pnpm check:all` runs the bounded local implementation gate, including
  Quint-connected MBT but not exhaustive formal model checking.

The native TypeScript 7 compiler is installed as `@typescript/native` and
patched by `@effect/tsgo` during `pnpm install`. Oxlint's TypeScript-Go plugin
performs type-aware linting without a legacy TypeScript JavaScript compiler
API. Effect errors fail `pnpm typecheck`, while existing warning- and
suggestion-level diagnostics remain visible without failing the command.

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
`.oxlintrc.json`, `dprint.json`, `oxlint.complexity.json`, `vitest.config.ts`,
`.jscpd.json`, and CI or
hook files collectively define repository quality policy. Explain threshold
reductions or exclusions in the change that introduces them; generated-code
exclusions must be narrow and must not hide authored logic.

The separate `oxlint.complexity.json` applies the production-code complexity
gate. `oxlint-complexity-suppressions.json` records the number of
existing violations per file; it does not bind a suppression to one function or
complexity value. After reducing complexity, run `pnpm check:complexity:prune`
to remove obsolete suppressions.

The repository-wide `dalph/effect-class-inheritance-only` Oxlint rule permits class
inheritance only for Effect `Context.Service` tags and
`Schema.TaggedErrorClass` failures. Other inheritance remains forbidden; do not
replace this policy with per-class suppressions.
