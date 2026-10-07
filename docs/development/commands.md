# Commands and focused test setup

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

## Domain language

Read [CONTEXT.md](../CONTEXT.md) and [ARCHITECTURE.md](../ARCHITECTURE.md) before changing
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

## Focused test preparation

Choose preparation from the test's actual adapter before starting a bounded or
one-shot run. Source aliases do not create a CLI executable or package `dist`.

| Check boundary | Preparation before the attempt |
| --- | --- |
| Node tooling tests (`node --test scripts/<file>.test.mjs`) and in-memory tests with source aliases | No production build unless the fixture explicitly starts a built entry. |
| Type-aware lint or consumers of normal workspace exports/declarations in a fresh or changed checkout | Run `pnpm check:artifacts` first; ignored old `dist` can supply stale types. |
| Focused tests that spawn `packages/dalph/dist/bin/*`, including hermetic/live qualification fixtures | Run `pnpm --filter @dalph/dalph... build`, then confirm the exact referenced built entry exists before the bounded test attempt. |
| `pnpm test:integration:publication` and `pnpm test:codex-integrator-qualification` | These commands build their required package closure themselves. Keep build failure distinct from a test result. |
| New worktree | `pnpm bootstrap:worktree` prepares the frozen dependencies, production artifacts, and bins. A Codex executor profile with `worktreePreparation` runs its configured command in the exact task worktree before the first implementation turn. For manual attempts, run `node scripts/prepare-attempt-worktree.mjs` before the first source check. Use `mise exec --` for later Node and pnpm commands. |
| Lab browser checks | Follow [browser setup](browser.md#browser-and-real-host-setup) before running the selected browser command. |

Before a one-shot test, read its fixture startup to identify the selected adapter
and exact entry. A setup failure means no behavioral evidence, even when the
command launched. Do not use a broad build as a substitute for knowing the input.

## Documentation links

`pnpm check:docs` uses [Lychee](https://github.com/lycheeverse/lychee) 0.24.2,
with `--offline --include-fragments`. The first invocation downloads a release
archive, checks its pinned SHA-256, and installs it in
`$XDG_CACHE_HOME/dalph/lychee` (default `~/.cache/dalph/lychee`). Linux and macOS
x64/arm64 need Node, Git, and `tar`; neither Rust nor workspace builds are needed.
Download has a 30-second timeout and scanning has a 60-second stop.

The scan checks current root Markdown, `docs/`, `research/`, package/prototype
README and AGENTS files, and GitHub issue/PR templates. It includes non-ignored
unstaged new files and skips deleted inputs; links to deleted targets still fail.
Fixtures, dependencies, scratch output, and vendored repositories are not inputs.
There are no broad link exclusions. Source line links belong on an exact Git
commit URL; Markdown heading links use the heading slug.

CI runs this same implementation for every change, outside admitted heavy gates,
and the required quality aggregate refuses a missing or failed result. Remote
HTTP availability and literal test-name/coverage validation are outside its
contract. `pnpm test:docs` proves local links and cross-document headings pass,
missing/deleted targets and removed headings fail, and fixture selection is bounded.

## Commands

`pnpm test:cassettes:memory` reports each completed test and its duration. Retain
that output when a bounded run stops so the next diagnostic can select the
unfinished file or expensive scenario. This reporter changes verification
observability only; it does not change Dalph runtime or cassette assertions.
Budget the complete serial catalog plus setup, rather than treating a per-test
timeout as the suite deadline. Use the current terminal summary when choosing
a later operation's stop time; historical measurements are not a current budget.

All commands below use `pnpm`. Script definitions live in
[package.json](../../package.json); gate stages and bounds live in
[candidate runner](../../scripts/run-candidate-checks.mjs) and [shared stage policy](../../scripts/quality-gate-stage-policy.mjs).

| Command | Use |
| --- | --- |
| `bootstrap:worktree` | Initialize repository submodules, install the frozen dependency graph, clean-build and validate production artifacts, then relink and verify generated workspace bins. |
| `node scripts/prepare-attempt-worktree.mjs` | In the current exact Git worktree, check the repository-selected Node against package engines and run a bounded frozen pnpm install. This is task preparation, not a source qualification or production artifact build. Its `AttemptWorktreePreparationFailed` JSON result names the failing stage. When Codex invokes it as a tool command, that command runs inside Codex's owned tool containment; `mise exec --` remains necessary for later checks because login shells can reset `PATH`. |
| `check:docs` | Check maintained Markdown local targets and heading fragments offline, including unchanged docs after source renames. |
| `test:docs` | Focused checker integration fixtures; no production build. |
| `check:artifacts` | Clean-build production packages in dependency order, then validate normal exports, declarations, bins, package boundaries, and packed contents. |
| `exec vitest run <test-file>` | Focused development check; first select [source-only or built-fixture preparation](#focused-test-preparation). `test` runs the covered core suite. |
| `typecheck` | Strict TypeScript-Go plus Effect errors/warnings; suggestions remain nonfatal. Each invocation uses disposable build-info so ignored incremental state cannot change the verdict for the same source candidate. |
| `typecheck:dev` | Incremental edit-loop diagnostic with a worktree-local cache; does not qualify a candidate. See [finite implementation work](workflow.md#keeping-implementation-work-finite) for check selection. |
| `typecheck:effect` | Optional standalone Effect diagnostics; errors/warnings fail, JSON output. |
| `typecheck:effect:changed` | Effect pass over files changed against `DALPH_DIAGNOSTICS_BASE`, or the explicitly reported moving `origin/master` fallback; falls back to the project pass above twelve changed files. |
| `lint:code` | Type-aware Oxlint and dprint over repository files; warnings fail. |
| `lint:changed` | Oxlint and dprint over files changed against `DALPH_DIAGNOSTICS_BASE`, or the explicitly reported moving `origin/master` fallback. It does not run the repository graph check. |
| `check:unused-exports` | Run Knip's repository graph analysis for unused files and value exports. Exact current exceptions are finite and stale exceptions fail. |
| `check:preflight --candidate=<base sha>` | Pre-freeze census: report typecheck (including Effect), lint/format, cycle, affected infrastructure controls, secrets and artifact failures. Revision-10 change selection includes Reducer Lab only for a Lab-owned `prototypes/reducer-lab` path or missing/unknown changed-path evidence; a selected Lab failure blocks qualification. Runs no coverage, catalog or MBT suites. |
| `check:ci:quality:preflight --candidate=<base sha>` | Hosted preflight entry point. It runs the same admitted structural census for one declared Node cell before qualification; revision-10 change selection includes Reducer Lab only for a Lab-owned `prototypes/reducer-lab` path or missing/unknown changed-path evidence, and a selected Lab failure blocks hosted qualification. |
| `check:ci:quality:stage --stage <id> --base <sha> --candidate <sha> --node-version <semver> --run-id <id> --run-attempt <n> --output <dir>` | Run one generated hosted suffix cell. The stage command retains an envelope and portable evidence after an ordinary stage failure; the aggregate owns the required quality verdict. |
| `check:ci:quality:aggregate --base <sha> --candidate <sha> --run-id <id> --run-attempt <n> -- <envelope...>` | Validate every expected generated Node-by-stage result for one hosted attempt, report pass/fail/unproven rows, and fail closed on missing, malformed, mismatched, or unproven evidence. |
| `check:fast` | Development-loop tier: `typecheck`, `lint:changed`, and the Base-scoped quality-stage fixture probe. A planned task attempt sets `DALPH_DIAGNOSTICS_BASE` to its exact Base SHA. Without that Base, the fixture probe reports that it was skipped. |
| `check:submit` | One local readiness pass before hosted submission: production artifact preparation, `check:fast`, the hosted full lint census, and the in-memory cassette suite. It does not run a full gate or require Linux inotify. |
| `check:baseline` | Early task-attempt baseline: run the clone-wide lint census, then the maintained Reducer Lab evaluation. Optional diagnostic only; never a prerequisite to final qualification. |
| `check:circular` | Reject runtime dependency cycles. |
| `check:complexity` | Reject increased per-file counts of production functions above complexity eight. |
| `check:duplicates` | Enforce the configured duplication budget. |
| `coverage:body` | Coverage suites and their verifiers, without taking an admission slot. |
| `test` | Run tests and report advisory production/evaluation and changed-line coverage; takes an admission slot. |
| `test:cassettes:memory` | Run the in-memory cassette suite serially without coverage or built CLI startup. Heavy delivery fixtures do not compete with each other for their existing test deadlines; test selection and assertions are unchanged. Three historical files and sixteen exact-turn cases in `delivery-story-capstone.execution.test.ts` are held for explicit repair through `test:cassettes:historical-chronology`; the old DS14–DS17 fixture is no longer in the maintained catalog. The seven-task capstone's DS01–DS17 causal prefix runs here; its complete DS18–DS22 proof remains manual through `test:integration:capstone`. |
| `test:cassettes:historical-chronology` | Run the retained historical exact-order cassette files explicitly; failures remain visible while their activation chronology is reconciled. |
| `test:recorded-catalog` | Run the routine in-memory recorded-cassette catalog without starting the built production CLI. The seven-task capstone is manual through `test:integration:capstone`. |
| `test:integration:capstone` | Explicitly run the seven-task delivery capstone, its status/cleanup assertions, and its recorded-catalog round trip with one Vitest worker. This is separate manual evidence for the accepted delivery-capstone story. |
| `test:integration:publication` | Build the Dalph CLI and run the process-based direct-publication integration scenario explicitly, with one Vitest worker. Required before handoff when direct-publication or its composed completion/dependant behavior changes. |
| `test:mbt` | Required replay-only conformance run over all 39 validated corpus lanes and the source-resolution/reverse-evaluator controls. Missing or stale corpus fails before drivers launch; regeneration is explicit through `mbt:generate`. Local and hosted quality plans select it once as `mbt-replay`. |
| `test:delivery-repeatability` | Manually run the historical DS01–DS13 strict occurrence order in twenty consecutive fresh processes; stop at the first incomplete or divergent run. It is no longer an automatic local or hosted gate under #413's causal publication contract. |
| `test:delivery-repeatability:warm` | Reuse one persistent Vitest worker for twenty target executions, then run a three-process fresh sample for process-isolation evidence. Warm success is a performance/cache signal and does not replace the fresh acceptance path. |
| `test:ci-change-classification` | Prove CI classification, suffix plan/budget consistency, and hosted evidence/cancellation controls. |
| `check:lab` | Reducer Lab typecheck, maintained-cassette smoke, build; no browser. Baseline and full preflight bound the command to seven minutes: a timed successful smoke took 330.592 seconds under shared-host contention, including 165.727 seconds in two capstone DOM scenarios. The command remains mandatory when selected. |
| `check:lab:browser` | Host an ephemeral Lab, run Chromium against every maintained cassette, stop the host. |
| `check:lab:browser:causal` | Host an ephemeral Lab and replay the causal cassette with exact occurrence identity in Chromium. Use for causal matcher and authoring changes. |
| `check:lab:browser:capstone` | Host an ephemeral Lab and run the seven-task capstone presentation in Chromium. Use for capstone Lab behavior; it remains separate from the routine browser catalog. |
| `qualify:codex` | Opt-in real app-server contract; prerequisites below. |
| `check:quint` | Obtains the complete required formal profile through guarded local execution or applicable recorded success. It reports which occurred and names the original evidence. `--force` requests fresh execution under the same guards. |
| `check:secrets` | Scan Git history with gitleaks. |
| `gate:status <run-id>` | Read durable command results, unresolved custody and per-run logs/report paths without the previous terminal. Missing or malformed receipts cannot prove success. |
| `gate:reconcile <run-id> [--previous-boot=<recorded boot UUID>]` | Ordinary form closes registration and proves every recorded writer group absent before clearing exact worktree/slot fences. The explicit previous-boot form accepts only a structurally complete no-child/observed inventory from the supplied recorded boot, durably records `UNPROVEN` stopped custody, and clears exact fences without probing or signalling old process groups. |
| `check:all --candidate=<base sha>` | Invoke `scripts/run-candidate-checks.mjs` on the clean, frozen checkout using its exact Base. It records the selected preflight/application manifest and successful stage results. A launched child stage that exits nonzero is identified by the top-level failure message and retained stage log; dependency preparation or input-guard failures may have no stage result or child-stage log. Formal relevance is `not-requested`; run `pnpm check:quint` explicitly for local proof, and retain CI's separate formal verification. Revision-12 selects Reducer Lab only for a `prototypes/reducer-lab` path or missing/unknown changed-path evidence; a selected Lab failure blocks qualification. Interrupted attempts restart after stopped-writer reconciliation. |
| `check:ci` | Hosted quality (including required MBT corpus replay) and independent formal verification. |

The held files are `delivery-predecessor-cleanup.test.ts`,
`ds14-final-activation-chronology.test.ts`, and
`authored-runner-process-lifecycle.test.ts`; sixteen exact-turn cases in
`delivery-story-capstone.execution.test.ts` are held by test name. The three
files and most held cases reuse the historical DS14–DS17 cassette; three held
cases assert the former controlled DS01–DS13 total order. Their previous assertions do not
prove #413's accepted causal order. The ordinary suite still runs the
publication, reactivation, restart, process-death, and finality tests; the
focused seven-task DS01–DS17 check supplies the required #413 integration
edge. The manual command intentionally reports the held files' failures until
their own scenarios are re-authored.

When a developer changes a TypeScript or TSX file, `check:fast` passes only the
changed files—and no unrelated source file—to Oxlint and dprint. Oxlint rejects
parameter-property reassignment and direct `delete` or member-update syntax.
The retired compatibility ESLint rules no longer provide type-aware alias
analysis, declaration-shape preferences, or tacit-style preferences. Optional `check:unused-exports` reports graph-only findings outside delivery
qualification.
`typecheck:effect:changed` remains an optional JSON diagnostic command and retains its
documented fallback to the whole-project pass when more than twelve files change.

The compatibility-rule disposition is explicit:

- `functional/prefer-tacit`, `functional/no-mixed-types`, and
  `functional/type-declaration-immutability` are retired.
- `functional/no-throw-statements` is retired, including its test-only behavior;
  `dalph/no-throw-statement` continues to reject production throws.
- `functional/immutable-data` is replaced by `no-param-reassign` plus the bounded
  `dalph/no-member-delete-or-update` syntax rule. Type-aware alias detection is
  retired. The configured parameter mutators are `copyWithin`, `fill`, `reverse`,
  and `splice`.
- `import-x/no-unused-modules` is replaced by `check:unused-exports` outside the
  changed-file loop.

For a planned task attempt, pin the immutable Base SHA already supplied by the
attempt context:

```sh
DALPH_DIAGNOSTICS_BASE="<planned Base SHA>" pnpm check:fast
```

With an exact planned Base, `check:fast` also runs the capability-registration,
preflight, and recorded-catalog gate fixtures against that Base. These fixtures
take about two seconds in the focused observation that followed a late gate
failure caused by a stale stage list. The probe runs before full-gate admission
and checks the selected stage sequence for the actual candidate diff. It does
not replace the remaining full qualification stages or change Dalph runtime
behavior. An ad-hoc `check:fast` without `DALPH_DIAGNOSTICS_BASE` prints a skip
message; it is not evidence that the candidate's selected-stage fixtures pass.

`lint:changed` and `typecheck:effect:changed` each print one JSON selection line to stderr
containing the input reference, its resolved commit, the actual merge base,
HEAD, the sorted changed paths, and the sorted paths selected for that command.
Without `DALPH_DIAGNOSTICS_BASE`, they keep the convenient `origin/master`
development fallback and label it
`moving-default`; that output must not be reported as evidence for an immutable
planned-attempt base. An unresolved base or a base from unrelated history exits
nonzero before a lint or diagnostic child starts. Selection and routing messages
stay on stderr so Effect diagnostic JSON on stdout remains machine-readable. An
empty path list remains a successful no-op.

This is repository-tooling behavior only. It does not change a Dalph command,
workflow decision, provider boundary, journal fact, retry, cleanup action, or
runtime-visible result, so no Dalph runtime operational scenario applies.

| Changed-file tooling scenario | Acceptance test |
| --- | --- |
| A planned attempt starts from Base commit B. A prerequisite commit P lands and `origin/master` advances to P before the dependent edit. The maintainer runs changed lint with `DALPH_DIAGNOSTICS_BASE=B`; the selection names B and includes both the prerequisite file and dependent file. | `scripts/quality-lint.test.ts`: `a planned attempt checks prerequisite changes from its pinned base after origin/master advances`; `scripts/changed-files.test.mjs`: `changedRepositoryFileSelection keeps an older pinned base after the moving reference advances` |
| A developer runs changed lint without a planned Base. The tool labels `origin/master` as the moving default, resolves P, and selects only paths changed after P. | `scripts/quality-lint.test.ts`: `a planned attempt checks prerequisite changes from its pinned base after origin/master advances` |
| A maintainer runs changed lint from an unchanged worktree with an explicit Base equal to HEAD. The tool names the resolved Base and reports empty changed and selected path lists without starting a linter. | `scripts/quality-lint.test.ts`: `changed lint is a no-op when the changed selection is empty` |
| A task attempt supplies a reference that cannot resolve to a commit, or a commit from unrelated history. Changed lint and Effect diagnostics exit nonzero with the exact failed boundary and do not start their child tools; an unavailable moving fallback fails the same way. | `scripts/quality-lint.test.ts`: `changed lint fails before lint execution when its explicit base cannot resolve`; `scripts/effect-diagnostics.test.ts`: `changed Effect diagnostics fail before execution when the explicit base cannot resolve`, `changed Effect diagnostics fail before execution when the explicit base has unrelated history`, and `changed Effect diagnostics fail visibly when the moving origin/master fallback cannot resolve` |
| Effect changed diagnostics use a pinned Base and select one changed TypeScript path while leaving stdout as diagnostic JSON. | `scripts/effect-diagnostics.test.ts`: `changed Effect diagnostics use the pinned base and keep selection evidence off stdout` |
| Effect changed diagnostics find no TypeScript path, emit empty selection evidence to stderr, and do not start the diagnostic executable. | `scripts/effect-diagnostics.test.ts`: `changed Effect diagnostics report an empty pinned selection without starting diagnostics` |
| More than twelve changed TypeScript files select one project diagnostic invocation without running thirteen file diagnostics. | `scripts/effect-diagnostics.test.ts`: `more than twelve changed TypeScript files route Effect diagnostics to one project check` |

Hosted CI keeps separate quality and formal entry points: hosted formal runs the
complete profile fresh when an input that can affect it changed, while hosted
quality requires the complete corpus replay stage. A local success
record is not hosted formal evidence. If no hosted-formal input changed, neither
shard starts; the required aggregate check reports the exact base, head, and
classification evidence as not applicable.
