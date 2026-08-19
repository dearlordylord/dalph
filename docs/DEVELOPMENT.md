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
- `pnpm typecheck:effect` runs the dedicated Effect diagnostics pass with
  `--strict --severity error,warning --format json`; this is the warning-fatal
  owner because `tsc` intentionally leaves warnings visible without using them
  as its exit status.
- `pnpm lint:code` discovers authored `.js`, `.mjs`, `.ts`, `.tsx`, and root
  `*.config.*` files, runs type-aware Oxlint with `--deny-warnings`, runs the
  narrow type-aware ESLint compatibility rules with `--max-warnings 0`, and
  checks dprint formatting. The same runner receives the staged file list from
  lint-staged; a staged run also checks the full compatibility file set so an
  unused-export or functional-policy violation cannot be hidden by staging only
  one consumer.
- `pnpm check:circular` rejects runtime dependency cycles.
- `pnpm check:complexity` rejects an increase in the number of production
  functions above cyclomatic complexity eight in each file.
- `pnpm check:duplicates` enforces the configured TypeScript duplication budget.
- `pnpm test` runs the deterministic Vitest suite.
- `pnpm test:coverage` independently enforces 99% production coverage and 75%
  maintained-evaluation coverage for statements, branches, functions, and
  lines. It applies the same brackets to changed executable lines from
  `coverage/coverage-final.json`, so surplus in one bracket cannot hide debt in
  the other. Maintained cassettes and deterministic test-only completion
  boundaries use the evaluation bracket; application runtime and adapters stay
  in the production bracket.
- `pnpm test:mbt` runs the Quint-connected executable conformance suites.
- `pnpm check:lab` runs the Reducer Lab maintained evaluation: the Lab package's
  typecheck, maintained-cassette smoke, and production build. It does not run
  `browser-smoke`, which needs a hosted Lab and Chromium.
- `pnpm check:quint` runs deterministic, sampled, and exhaustive formal model
  checks. Run it once after the final relevant changes and before integration;
  during development, use it when changing a Quint model, its conformance
  adapter, or behavior governed by that model.
- `pnpm check:secrets` scans Git history with gitleaks.
- `pnpm check:ci` runs the hosted CI gate. During the single-executor v1
  proof-of-concept phase it excludes Quint-connected MBT.
- `pnpm check:all` runs the bounded local implementation gate, including
  Quint-connected MBT and the Reducer Lab maintained evaluation, but not
  exhaustive formal model checking.

The quality gate runs the Reducer Lab check with a bounded timeout in both
`check:all` and `check:ci`; `check:ci` still omits only the Quint-connected MBT
stage. The Lab package's `check` script intentionally orders its existing
typecheck, maintained-cassette smoke, and build. The browser smoke remains a
separate hosted check because it requires an HTTP host and Chromium.

Maintained cassettes and the shared integration-finality fixture are evaluation
evidence, not production implementation. Keep their maintained evaluation at
75% or better as a separate ledger from the production 99% statements,
branches, functions, and lines enforced by `test:coverage`. The Lab check
exercises the maintained cassette assertions through typecheck, smoke, and
build; it does not enter the production line coverage ledger until those
assertions are instrumented. Disposable research prototypes remain excluded
from the production quality gate; the Reducer Lab is the explicit
maintained-evaluation exception.

The 99% production goals deliberately exceed the recorded prototype baseline
and make its remaining production coverage debt visible in the repository
gate. Before the maintained-evaluation ledger was separated, the full suite
measured
16,261/16,575 statements (98.10%),
9,128/9,472 branches (96.36%), 5,247/5,375 functions (97.61%), and
15,076/15,300 lines (98.53%). The 344 uncovered branches are concentrated in
platform/process ownership and invariant-heavy recovery code: 69 in the
Codex app-server boundary, 42 in the planned-attempt executor, 40 in journal
reconstruction history, 27 in the attempt store, and 26 in run recovery
activation. The independent changed-executable-line check compares every new
eligible line with the explicit base commit and applies its path's bracket, so
neither production nor maintained-evaluation surplus can hide debt in the
other bracket.

Repository quality tooling under `scripts/` remains outside executable-source
coverage. Its importable logic has focused tests, and `check:all` exercises the
command wrappers as the gate that they implement. Quint specifications and
their executable conformance adapters remain governed by `test:mbt` and
`check:quint`; line coverage is not a substitute for those state-space checks.
Pure fixtures or controlled adapters that still share a source file with
production implementation remain in the 99% production bracket until their
implementation has enough locality to move behind a dedicated evaluation
seam.

The quality harness counts stdout and stderr lines from successful stages and
fails after a stage if their cumulative output exceeds 400 lines. A failed
stage still reports its complete diagnostics and fails for its own exit status;
the noise budget governs successful output only. Prefer compacting a reporter
or removing repetitive diagnostics before increasing the checked-in budget.

The changed-line coverage verifier compares the working tree with an explicit
base commit. CI sets `DALPH_COVERAGE_BASE_SHA` to the pull request target SHA or
the push event's previous SHA. For a local run, set that variable explicitly
when reviewing a branch, for example:

```sh
DALPH_COVERAGE_BASE_SHA="$(git merge-base origin/master HEAD)" pnpm test:coverage
```

When it is absent (or a push event provides GitHub's all-zero initial SHA), the
verifier tries `git merge-base origin/master HEAD` and then `git rev-parse
HEAD^`. The diff is taken against that base without restricting paths, so
staged and unstaged tracked worktree changes are included; untracked
production source files are also included. Test, documentation, script,
declaration, and other non-production changes do not enter the changed
executable-line denominator. The verifier uses statement spans in
`coverage-final.json` to derive Istanbul line coverage and reports every
uncovered changed line when the 99% floor is missed.

The native TypeScript 7 compiler is installed as `@typescript/native` and
patched by `@effect/tsgo` during `pnpm install`. Oxlint's TypeScript-Go plugin
performs type-aware linting without a legacy TypeScript JavaScript compiler
API. Effect errors fail `pnpm typecheck`, while existing suggestion-level
diagnostics remain visible without failing that command. The separate
`typecheck:effect` command makes selected Effect warnings fatal and emits
machine-readable JSON, so a warning cannot be mistaken for a clean quality
gate.

The Oxlint migration deliberately keeps one compatibility owner for policies
that have no native type-aware Oxlint equivalent. `eslint.compat.config.mjs`
contains only those functional and whole-project unused-export rules; native
Oxlint owns overlapping syntax, import, and warning policies. The checked-in
`eslint-functional-suppressions.json` is a finite baseline of findings already
present at the migration boundary, keyed by exact file, rule, and count. It is
not a blanket disable: an unlisted finding fails `pnpm lint:code`, and an
obsolete suppression is reported by ESLint's suppression accounting. Update
the baseline only after reviewing the affected policy and running the focused
fixture tests. Test files retain the pre-migration throw restriction; the
finite baseline entries for existing throws do not permit a new test throw.
The same baseline records the finite set of exported
declarations that existed without a source consumer at this migration
boundary. They remain exported because package/test contracts and deep module
consumers are not all represented by the source-only graph; the public package
entry points are still the only blanket exceptions. A newly exported
declaration, including one in a file with an existing baseline count, exceeds
the recorded count and fails.

Effect diagnostic severities are intentional. Production `floatingEffect` is
an error. The test-only `multipleEffectProvide` and `unnecessaryEffectGen`
overrides remain off because the current test suite deliberately composes
layers and generator adapters in those forms; the dedicated command still
fails every error or warning it actually reports. `lazyEffect` stays off
because it is a suggestion about deferred service members, not a safety
property, and the repository intentionally exposes lazy members in its Effect
interfaces. Any new severity override must name the concrete fixture or source
shape that requires it and add a regression test; broad warning suppression is
not an acceptable migration shortcut.

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
`Schema.TaggedError` failures. Other inheritance remains forbidden; do not
replace this policy with per-class suppressions.

The compatibility lint baseline has the same review discipline as complexity
suppression: use ESLint's `--prune-suppressions` against the explicit discovered
file list after removing a violation, then inspect the diff before committing.
The baseline is not a reason to add a new exception for a changed source file.
