# Development harness

Use pnpm and Node 24.15.0 (recommended). [package.json](../package.json)
`engines.node` defines supported versions; CI tests each declared minimum.
Before adding a Node major, prove a frozen install and the production exclusive
coordinator lock in [ARCHITECTURE.md](ARCHITECTURE.md). Require a matching native
binary or an explicitly supported source-build toolchain.

## Operational scenario gate

Before behavior-changing work, follow [OPERATIONAL-SCENARIOS.md](OPERATIONAL-SCENARIOS.md):
accepted chronological scenarios precede implementation; plans and handoffs map
each scenario to tests. Documentation/tooling exemptions must explain why no
Dalph runtime behavior changes. Aggregate gate totals cannot replace this proof.

## Keeping implementation work finite

- Attempt a minimally instrumented complete-story diagnostic before polishing
  prefixes. Check accepted outcomes, causal requirements, and forbidden effects;
  predicted internal call order is a hypothesis. Record the first obstruction
  and unexecuted suffix. Reuse applicable evidence; workflow adoption does not
  restart completed characterization.
- After two attempts fail to advance the same outcome, name competing causes
  and run a distinguishing experiment. More reviewers, time, or gate reruns alone
  are not new evidence. Continue independent authorized work; ask only about
  unresolved choices that materially change accepted outcomes.
- Keep outcomes, test mappings, revision, obstruction, and next experiment in
  the existing issue/specification/scenario. Link it from parent issues. Record
  deadlines with units and timezone; dependencies, reviews, and renamed
  checkpoints do not reset the parent budget or its accepted stop rule.
- Develop with focused checks. Repair a failed gate stage and check affected
  behavior before rerunning the full gate. Intermediate commits need no handoff
  ceremony; the final candidate still requires `pnpm check:all` and applicable
  `pnpm check:quint`. Earlier passing stages are not a final green gate.
- For the workflow pilot, use the next existing milestone to record broad review rounds, reopened findings
  with new evidence, full-gate restarts, and closure time. Verify that required
  scenario evidence survives and reproduced accepted-path defects still block
  closure. Fewer rounds alone do not demonstrate improvement. Use the existing
  task record, not another ledger.

## Domain language

Read [CONTEXT.md](CONTEXT.md) and [ARCHITECTURE.md](ARCHITECTURE.md) before changing
domain language. Apply the literal reading test to names and explanations:
name the actor, action, changed state, and exact boundary read for evidence.
Replace ambiguous modifiers with concrete facts; reject a name that describes
several distinct phenomena. Prefer “check GitHub again” to “authoritative
reread.” Record canonical terms in CONTEXT; document branded types and
non-obvious events at their declarations. Effect `Context.Service` describes
injection, not a deployment unit or a reason to name a domain role “service.”

## Workspace shape

Production packages live in `packages/*` and own their runtime dependencies,
build entry points, and focused tests. Keep one pnpm lockfile and shared root
quality configuration; add package-specific settings only when sharing is
incorrect.

## Commands

All commands below use `pnpm`. Script definitions live in
[package.json](../package.json); gate stages and bounds live in
[scripts/run-quality-gate.mjs](../scripts/run-quality-gate.mjs).

| Command | Use |
| --- | --- |
| `vitest run <test-file>` | Focused development check; `test` runs deterministic Vitest. |
| `typecheck` | Strict TypeScript-Go with Effect errors; suggestions remain nonfatal. |
| `typecheck:effect` | Dedicated strict Effect pass; errors and warnings fail, JSON output. |
| `lint:code` | Type-aware Oxlint, compatibility ESLint, dprint; warnings fail. Staged runs also check the full compatibility graph. |
| `check:circular` | Reject runtime dependency cycles. |
| `check:complexity` | Reject increased per-file counts of production functions above complexity eight. |
| `check:duplicates` | Enforce the configured duplication budget. |
| `test:coverage` | Enforce separate production/evaluation coverage and changed-line floors below. |
| `test:mbt` | Quint-connected executable conformance suites. |
| `test:ci-change-classification` | Prove the docs-only CI allowlist and fail-closed classification. |
| `check:lab` | Reducer Lab typecheck, maintained-cassette smoke, build; no browser. |
| `check:lab:browser` | Host an ephemeral Lab, run Chromium against every maintained cassette, stop the host. |
| `qualify:codex` | Opt-in real app-server contract; prerequisites below. |
| `check:quint` | Deterministic, sampled, exhaustive model checks. Run after final relevant changes and before integration; during development only for model, conformance-adapter, or governed-behavior changes. |
| `check:secrets` | Scan Git history with gitleaks. |
| `check:all` | Bounded local handoff gate, including MBT and non-browser Lab; excludes exhaustive model checks. |
| `check:ci` | Hosted gate; currently omits only Quint-connected MBT. |

Effect tests use `it.effect`, test Layers, `TestClock`, and deterministic
synchronization instead of module mocks, ambient time, or sleeps. Name property tests
`*.property.test.ts`.

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
on Ubuntu/macOS in the [qualification workflow](../.github/workflows/codex-app-server-qualification.yml).

### Coverage and output budgets

- Enforce 99% production and 75% maintained-evaluation coverage independently
  for statements, branches, functions, lines, and changed executable lines.
  Surplus in one bracket cannot cover the other. Maintained cassettes and
  deterministic test-only completion boundaries use evaluation; runtime and
  adapters use production. Mixed production/fixture files remain production
  until split behind a dedicated evaluation seam.
- Lab assertions run through its maintained check and enter line coverage only
  when instrumented. Other disposable research prototypes are excluded from
  the production gate. Tooling scripts have focused tests and gate execution,
  not executable-source coverage. Model checks remain separately required.
- Changed-line coverage uses `DALPH_COVERAGE_BASE_SHA` (CI: PR target or previous
  push SHA), falling back on missing/all-zero input to the merge base with
  `origin/master`, then `HEAD^`. It includes staged/unstaged tracked changes and
  untracked production source; non-executable/test/docs/tooling paths are
  excluded. Istanbul statement spans determine changed executable lines.
- Successful stages have a cumulative 400-line stdout/stderr budget. Failed
  stages retain complete diagnostics and their exit status. Reduce reporter
  noise before raising the budget.

For a branch review, set the coverage base explicitly:

```sh
DALPH_COVERAGE_BASE_SHA="$(git merge-base origin/master HEAD)" pnpm test:coverage
```

## Safety and supply chain

CI installs with `--frozen-lockfile`; pnpm enforces strict peers, allowlisted
lifecycle scripts (`onlyBuiltDependencies`), and a 24-hour release delay unless
explicitly excepted. Install gitleaks before committing. Pre-commit formats and
lints staged code, checks the full compatibility graph, typechecks the workspace,
checks cycles, and scans staged secrets.

Only exact diffs containing allowlisted documentation paths use the single
Ubuntu docs gate: whitespace, classifier controls, changed-commit secrets.
Everything else—including unreadable/empty diffs and manual/initial events—uses
the comprehensive Node matrix. The allowlist and controls live in
[scripts/classify-docs-only-change.mjs](../scripts/classify-docs-only-change.mjs)
and its test.

## Changing the harness

Root manifests, compiler/lint/format/test/coverage configs, and CI/hooks define
quality policy. Explain threshold reductions and exclusions; generated-code
exclusions must not hide authored logic.

- TypeScript-Go (`@typescript/native`) is patched by `@effect/tsgo` during
  install. Oxlint owns overlapping lint rules; `eslint.compat.config.mjs` owns
  the remaining functional and whole-project unused-export rules.
- `eslint-functional-suppressions.json` is a finite file/rule/count baseline,
  not permission for new findings, test throws, or unused exports. Public
  package entry points are the blanket export exceptions. Review policy and
  run focused fixture tests before changing it. After removals, use ESLint
  `--prune-suppressions` with the explicit discovered file list and inspect the
  diff; changed files do not automatically deserve new exceptions.
- `oxlint-complexity-suppressions.json` counts violations per file, not per
  function/value. Run `pnpm check:complexity:prune` after reductions.
- Production `floatingEffect` is an error. Test `multipleEffectProvide` and
  `unnecessaryEffectGen` stay off for deliberate Layer/generator composition;
  `lazyEffect` stays off for intentional lazy interfaces. New severity overrides
  require a concrete fixture/source shape and regression test, never broad
  warning suppression.
- `dalph/effect-class-inheritance-only` permits inheritance only for
  `Context.Service` tags and `Schema.TaggedError`; no per-class escapes.
- Duplication excludes tests and disposable prototypes; tooling/configuration
  remain scanned.
