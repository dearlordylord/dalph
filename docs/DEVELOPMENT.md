# Development harness

Use pnpm and Node 24.20.0. [package.json](../package.json)
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
- Before a focused authored-cassette diagnostic, trace each requested fact to
  the adapter actually selected by that story (including conditional interpreter
  routes). Name the observation point and prove it executes *before* the first
  possible mismatch or assertion failure. A hook reached only after the failed
  boundary, or an assertion skipped by an earlier failure, cannot distinguish
  the alternatives. Record the required fields and a missing-field outcome
  before one bounded run. If a required field is absent, stop and repair the
  observation route; do not edit a cursor position or append a story response
  based on a partial trace. Prefer event identity and correlation over numeric
  cursor positions when carrying evidence across fixture revisions. For an
  attempt-choice story, distinguish the immutable planned task revision from
  the current tracker revision observed to authorize Continue; check the
  accepted finality rule before expecting that attempt to complete. This is
  diagnostic procedure for test adapters and changes no Dalph runtime behavior.
- Apply the [#307 churn controls](postmortems/issue-307-qualification-churn.md#prevention-plan-and-validation)
  after two non-advancing attempts or 30 minutes of active repair without a new
  distinguishing result. Within the next 10 minutes of active work, record the
  changed experiment and a costly test's unique acceptance value in the existing
  task. Before another broad/hosted submission, record the focused reproduction
  and passing repair, or the concrete reason it cannot run locally. Subtasks do
  not reset the parent outcome's budget.
- Keep outcomes, test mappings, revision, obstruction, and next experiment in
  the existing issue/specification/scenario. Link it from parent issues. Record
  deadlines with units and timezone; dependencies, reviews, and renamed
  checkpoints do not reset the parent budget or its accepted stop rule.
- Use [choosing checks](#choosing-checks). Repair failures and check affected
  behavior before rerunning. Reconcile scenario-to-test mappings and close
  [scoped reviews](CODE_REVIEW.md#review-closure) before handoff; intermediate
  commits need no handoff ceremony.
- Bounded commands use detached process groups so timeout cleanup can reach
  descendants. A timeout settles only after the direct child closes and the
  Unix process group is absent, or after a bounded explicit failure to prove
  absence. A nested detached command must opt into parent-signal relay; the
  delivery repeatability runner does so for every child and Git lookup. Do not add an
  outer GNU `timeout` around `check:all`.
- Admitted gates have one absolute `DALPH_GATE_DEADLINE` (ISO UTC, for example
  `2026-09-22T06:00:00.000Z`), defaulting to one hour from invocation. Record the
  expected duration and choose the deadline before starting. Worktree-lock and
  clone-slot waiting consume this same budget. The run persists it; nested
  commands may shorten but cannot extend it. Deadline expiry stops new work and
  invokes bounded descendant cleanup. Missing stopped-writer proof retains the
  fence for explicit reconciliation; a timeout never qualifies the candidate.
  This tooling policy does not change Dalph runtime behavior or accepted task
  execution deadlines.
- Diagnose a failed `check:all` from retained gate evidence at the failed
  boundary. When a launched child stage exits nonzero, the top-level failure
  message and retained child-stage log identify that stage. Dependency
  preparation or input-guard failures can happen before a child stage launches,
  leaving no stage result or child-stage log. Run a focused reproducer or
  diagnostic for the failed boundary; run a test directly only when the failed
  child was a test. Repair its cause and observe the focused check passing before
  another full qualification. The ordinary candidate runner does not consult
  historical recovery records for admission. Incomplete writers retain custody
  fences until stopped-process proof. This tooling policy does not change Dalph
  runtime behavior.
- Hosted preflight repeats each failed stage's name and error in its final
  summary after independent checks finish. The CI failure step uploads its
  retained child logs for a bounded follow-up; inspect the named stage before
  another hosted submission. This reporting change cannot alter Dalph runtime
  behavior.
- For the workflow pilot, use the next existing milestone to record broad review rounds, reopened findings
  with new evidence, full-gate restarts, and closure time. Verify that required
  scenario evidence survives and reproduced accepted-path defects still block
  closure. Fewer rounds alone do not demonstrate improvement. Use the existing
  task record, not another ledger.

## Choosing checks

Choose checks by affected behavior, not by commit or handoff alone:

- **Documentation/history cleanup:** check formatting, links, and remaining
  references. Explain why runtime behavior is unchanged; no local full gate.
- **Tooling-only changes:** run affected tool tests, consumer/path checks, and
  relevant lint/typechecks. Moving a script alone does not require the full gate.
- **Runtime/model behavior changes:** use focused tests mapped to every changed
  accepted scenario and `pnpm check:fast` before integration. A full local
  `check:all` is an explicit maintainer/release diagnostic, not a prerequisite
  for each implementation attempt. Hosted CI retains its selected quality and
  formal cells. Model or conformance changes also require adequacy review and
  a negative control. A required fresh live-provider scenario remains separate
  from both local and hosted broad gates.
- **Before hosted submission:** run `pnpm check:submit` once on the coherent
  candidate when source or test code changed. It prepares production artifacts
  before the hosted full lint census, then runs the in-memory cassette suite.
  The lint and cassette checks address
  failures first discovered in hosted #309 runs; prior local measurements were
  about 33 seconds for `check:fast` plus the lint census and 45 seconds for the
  cassette suite. It does not run the full local qualification or repeat after
  documentation-only edits. The artifact preparation matches hosted preflight:
  workspace package exports resolve through `dist`, so a fresh worktree's
  type-aware lint must not depend on build output left by earlier work.
- **Baseline:** no separate baseline is mandatory. The final preflight owns
  its lint pass; run the maintained Lab only when its boundary is affected.
  `check:baseline` remains an explicit diagnostic convenience, not a prerequisite.
- **Shared qualification changes:** run affected tool tests and inspect the
  generated local and hosted plans before integration. Run the full local gate
  only when its end-to-end custody or evidence validity is the changed boundary;
  selection-only changes receive hosted CI validation after integration.
  Uncertain impact requires investigation, not exemption.

Gate infrastructure controls run for tooling and shared configuration changes;
ordinary product edits omit them. Missing change evidence retains the controls.
Recorded-catalog checks run for cassette, schema, projection, Lab, and shared
configuration changes. The Reducer Lab check runs automatically only for
changes under `prototypes/reducer-lab` or when changed-path evidence is
unavailable; an authored cassette or shared configuration change does not
also require its UI/trace projection in the blocking preflight. Run
`pnpm check:lab` explicitly when changing that projection or investigating
it. For causal cassette authoring and matcher changes, run the focused
`pnpm check:lab:browser:causal` browser replay. For the seven-task capstone's
Lab presentation, run `pnpm check:lab:browser:capstone` explicitly. The
comprehensive `pnpm check:lab:browser` checks shared Lab navigation and all
maintained catalog entries; it is a manual diagnostic for shared Lab or browser
harness changes, not a prerequisite for each cassette edit. Selection retains
deleted and renamed source paths.
The seven-task `deliveryInvariantStoryCapstone` is excluded from routine cassette
execution and the recorded-catalog round trip. Run `pnpm test:integration:capstone`
explicitly for its separate delivery-capstone proof. A passing routine gate
does not prove that accepted story.
During focused capstone fixture repair, use each observed mismatch to name the
competing causes and inspect the exact boundary evidence before editing. A
fixture-only correction supported by that evidence may be followed by another
bounded capstone run without repeating typecheck and lint after every numeric
correlation edit. Re-run the affected negative controls when causal matching or
runtime behavior changes, then run `check:fast` on the coherent candidate before
integration. A failed full qualification still follows its separate recovery
rule; focused capstone attempts do not consume a full-gate admission.
When diagnosing a capstone that must be terminated at its wall-clock stop,
append progress captures to a temporary sidecar and restore the diagnostic
hook afterward. Vitest may hold intercepted console output until test exit, so
console logging alone does not retain the last observed boundary on timeout.
The S1–S8 publication mapping uses the focused checks named in the accepted
direct-publication scenario. This selection changes test policy only; Dalph
production runtime and its accepted behavior do not change.
Complexity, duplication, and unused-export checks are optional trend diagnostics,
not delivery blockers; `lint` owns formatter and code-lint correctness only.
This reduces heuristic and sampling assurance without changing application tests.
Ordinary local and hosted candidates use three fresh delivery samples; coordination, workflow,
execution, cassette, and tooling changes retain twenty. Hosted plans select the same
catalog boundary and retain all declared Node versions only for broad sampling changes. Fewer samples reduce the chance of detecting rare races; the
complete checkpoint order is still asserted in every sample.

The local `check:all` runner requires a clean frozen checkout and an exact Base
SHA. It writes its chosen command manifest before execution, reads each actual
child exit, and writes results alongside that same manifest in
`candidate-checks.json`. A failed stage stops its suffix. The surrounding bounded
supervisor retains worktree locking, clone capacity, logs, source-change checks,
and stopped-process fences. There is no second checkout's profile reader, repair
permit, stage resume, or cross-worktree formal reuse on this ordinary path.
Interruption costs a rerun after reconciliation; this is an explicit simplicity
tradeoff. Formal relevance is recorded, while proof runs by explicit local
request or in CI.

After structural preflight, the local gate runs its delivery,
recorded-catalog, and coverage suffix. Its recorded manifest contains no Quint
stage and its report says `formalDisposition: not-requested`. A maintainer can
run `pnpm check:quint` separately; hosted formal and quality cells remain
independent. This qualification-tooling selection changes no Dalph runtime
behavior or assertions inside the formal command.

Accepted task requirements still apply. Handoffs name the affected scenarios,
checks run or unrun, and why broader checks add no relevant coverage. Unused-code
removal needs consumer evidence and affected type/build checks; changed behavior
follows the runtime rule.

For a hosted comprehensive qualification handoff, the Integrator first runs the
focused checks that own the repaired boundary before final qualification. A
separate lint/Lab baseline is not required. Hosted CI runs its
generated structural preflight before the generated delivery-repeatability,
recorded-catalog, and coverage suffix cells. Each clean suffix runner installs
the frozen dependency graph and then runs the bounded `pnpm check:artifacts`
preparation declared by the shared stage algebra, so package `dist` trees exist
before coverage or another suffix stage consumes them. This preparation does not
rerun the structural preflight. Those cells use bounded fail-slow concurrency,
so one ordinary failure does not cancel independent cells. The quality aggregate
reports every expected cell, including rows that are missing or unproven, and
the separate formal aggregate remains independent of the quality suffix.
On a failed suffix cell, CI also uploads its complete retained child logs as a
one-day diagnostic artifact. The portable stage envelope still owns the verdict;
the extra logs supply test assertions and stack traces that its short stage log
and failed-file inventory cannot show. This changes CI evidence retention only,
not Dalph runtime behavior or quality outcomes.

When the hosted quality aggregate reports more than one independent defect,
repair every reported defect before submitting the repaired candidate C2. The
earlier C evidence remains diagnostic evidence for C and cannot qualify C2.

The aggregate reports setup-inclusive time to first actionable failure and
total makespan. Historical [same-candidate serial observations](https://github.com/dearlordylord/dalph/issues/396#issuecomment-5750976052)
were 117.940 seconds for delivery repeatability and 72.991 seconds for the
recorded catalog; [coverage was 198.112 seconds](https://github.com/dearlordylord/dalph/issues/396#issuecomment-5750857362).
Their 389.043-second sum is a reference for independent work, not a current
hosted baseline or a promised parallel saving; compare complete hosted attempts
with their queue, install, and upload costs.

Hosted CI keeps its documentation-only quality classification. Its separate
formal classification compares the exact event base-to-head paths with the
generated hosted-formal input projection. That projection follows executable
model-conformance adapters through their TypeScript-resolved repository import
closure; the non-model workspace source-resolution control remains outside it. Unaffected changes retain the
required formal check as a lightweight successful not-applicable result.
The classifier reads exact committed root `package.json` contents at Base and
HEAD. A change solely to `scripts.test:formal:controls` adds or changes a
structural control without changing Quint inputs, so that package path alone
does not start model proof. Dependency, Quint command, other package, or
unreadable comparison changes still require formal proof. The classifier itself
remains a governed formal input.

When required, freeze the candidate and run
`pnpm check:all --candidate=<base-sha>`. No prior stages are credited. The runner
records formal relevance from the candidate's formal-input projection but does
not execute Quint. Missing Git or projection evidence still fails before
application qualification. Explicit standalone `pnpm check:quint` runs the
local formal profile when requested; CI keeps its own formal proof.

The optional unused-file/export graph and the project-wide Effect pass build the
entire program; use repository commands, not per-file substitutes.

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
| `bootstrap:worktree` | Initialize repository submodules, install the frozen dependency graph, clean-build and validate production artifacts, then relink and verify generated workspace bins. |
| `check:artifacts` | Clean-build production packages in dependency order, then validate normal exports, declarations, bins, package boundaries, and packed contents. |
| `vitest run <test-file>` | Focused development check. `test` runs the covered core suite. |
| `typecheck` | Strict TypeScript-Go plus Effect errors/warnings; suggestions remain nonfatal. Each invocation uses disposable build-info so ignored incremental state cannot change the verdict for the same source candidate. |
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
| `check:submit` | One local readiness pass before hosted submission: `check:fast`, production artifact preparation, the hosted full lint census, and the in-memory cassette suite. It does not run a full gate or require Linux inotify. |
| `check:baseline` | Early task-attempt baseline: run the clone-wide lint census, then the maintained Reducer Lab evaluation. Optional diagnostic only; never a prerequisite to final qualification. |
| `check:circular` | Reject runtime dependency cycles. |
| `check:complexity` | Reject increased per-file counts of production functions above complexity eight. |
| `check:duplicates` | Enforce the configured duplication budget. |
| `coverage:body` | Coverage suites and their verifiers, without taking an admission slot. |
| `test` | Run tests and report advisory production/evaluation and changed-line coverage; takes an admission slot. |
| `test:cassettes:memory` | Run the in-memory cassette test directory without coverage or built CLI startup. The seven-task delivery capstone is manual through `test:integration:capstone`; dedicated recorded-catalog and delivery-repeatability tests retain their own commands. |
| `test:recorded-catalog` | Run the routine in-memory recorded-cassette catalog without starting the built production CLI. The seven-task capstone is manual through `test:integration:capstone`. |
| `test:integration:capstone` | Explicitly run the seven-task delivery capstone, its status/cleanup assertions, and its recorded-catalog round trip with one Vitest worker. This is separate manual evidence for the accepted delivery-capstone story; its chronology remains under repair. |
| `test:integration:publication` | Build the Dalph CLI and run the process-based direct-publication integration scenario explicitly, with one Vitest worker. Required before handoff when direct-publication or its composed completion/dependant behavior changes. |
| `test:mbt` | Explicit manual Quint-connected conformance run; temporarily excluded from automatic verification pending [#363](https://github.com/dearlordylord/dalph/issues/363), which restores replay from pre-generated traces. |
| `test:delivery-repeatability` | Run the accepted DS01–DS13 delivery checkpoint table and strict occurrence order in twenty consecutive fresh processes; stop at the first incomplete or divergent run. This is the dedicated delivery-repeatability qualification command. |
| `test:delivery-repeatability:warm` | Reuse one persistent Vitest worker for twenty target executions, then run a three-process fresh sample for process-isolation evidence. Warm success is a performance/cache signal and does not replace the fresh acceptance path. |
| `test:ci-change-classification` | Prove the docs-only CI allowlist and fail-closed classification. |

| `check:lab` | Reducer Lab typecheck, maintained-cassette smoke, build; no browser. Baseline and full preflight bound the command to seven minutes: a timed successful smoke took 330.592 seconds under shared-host contention, including 165.727 seconds in two capstone DOM scenarios. The command remains mandatory when selected. |
| `check:lab:browser` | Host an ephemeral Lab, run Chromium against every maintained cassette, stop the host. |
| `check:lab:browser:causal` | Host an ephemeral Lab and replay the causal cassette with exact occurrence identity in Chromium. Use for causal matcher and authoring changes. |
| `check:lab:browser:capstone` | Host an ephemeral Lab and run the seven-task capstone presentation in Chromium. Use for capstone Lab behavior; it remains separate from the routine browser catalog. |
| `qualify:codex` | Opt-in real app-server contract; prerequisites below. |
| `check:quint` | Obtains the complete required formal profile through guarded local execution or applicable recorded success. It reports which occurred and names the original evidence. `--force` requests fresh execution under the same guards. |
| `check:secrets` | Scan Git history with gitleaks. |
| `gate:status <run-id>` | Read durable command results, unresolved custody and per-run logs/report paths without the previous terminal. Missing or malformed receipts cannot prove success. |
| `gate:reconcile <run-id> [--previous-boot=<recorded boot UUID>]` | Ordinary form closes registration and proves every recorded writer group absent before clearing exact worktree/slot fences. The explicit previous-boot form accepts only a structurally complete no-child/observed inventory from the supplied recorded boot, durably records `UNPROVEN` stopped custody, and clears exact fences without probing or signalling old process groups. |
| `gate:recovery`, `gate:diagnose`, `gate:verify-repair` | Historical recovery commands; ordinary candidate-runner admission does not consult their records. |
| `check:all --candidate=<base sha>` | Invoke `scripts/run-candidate-checks.mjs` on the clean, frozen checkout using its exact Base. It records the selected preflight/application manifest and successful stage results. A launched child stage that exits nonzero is identified by the top-level failure message and retained stage log; dependency preparation or input-guard failures may have no stage result or child-stage log. Formal relevance is `not-requested`; run `pnpm check:quint` explicitly for local proof, and retain CI's separate formal verification. Revision-10 selects Reducer Lab only for a `prototypes/reducer-lab` path or missing/unknown changed-path evidence; a selected Lab failure blocks qualification. Interrupted attempts restart after stopped-writer reconciliation. |
| `check:ci` | Hosted gate; MBT remains excluded pending #363. |

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
quality retains its current Quint-connected MBT exclusion. A local success
record is not hosted formal evidence. If no hosted-formal input changed, neither
shard starts; the required aggregate check reports the exact base, head, and
classification evidence as not applicable.

### Heavy-gate admission

`check:all`, `check:ci:quality`, `test`, `check:quint`, `check:baseline`, and
standalone `check:preflight` take the exact worktree lock before one of two
clone-wide slots.
A second writer in that worktree waits without consuming a spare slot; another
worktree can use it. Nested admitted commands validate the active run and register
beneath it rather than acquiring again. `DALPH_GATE_SLOT` alone grants no admission.
Set `DALPH_GATE_SLOTS` for another machine size. Development tiers remain unadmitted.

#### Parallel work during a full gate

Freeze the full gate's exact candidate worktree. Independent work may continue
in other worktrees, but a declared blocking edge still forbids implementation;
read-only planning may continue. Do not change tools, dependencies, Git
configuration, or packed refs shared with the candidate. Run candidate Git
reads with `GIT_OPTIONAL_LOCKS=0`, and defer a write when its shared scope is
unknown. The input observer and final comparison decide whether the candidate's
qualification evidence remains valid.

This is a cooperative operating rule. It adds no dispatcher, scheduler state,
active-gate file, new command, or automatic prompt injection.

The runner prints its run ID and `.scratch/quality-gates/<run-id>` report directory.
Each bounded child records spawn intent before launch, its observed process group,
logs, and genuine terminal result. Coverage writes below that run's `coverage/`
directory; both verifiers consume `DALPH_COVERAGE_DIRECTORY`. Shared package builds
remain protected by exclusive worktree ownership. Safety records and unresolved-run
fences live in the Git common directory, outside artifact/report cleanup. Do not
unlink lock files or manually remove fences.

If a runner dies or cannot prove a writer group absent, the incomplete-run fence
refuses another writer even after the kernel lock closes. Run `gate:status <run-id>`
to inspect evidence, then ordinary `gate:reconcile <run-id>` after writers stop.
Reconciliation takes worktree, exact slot, then registration locks; closes
registration; checks the complete spawn inventory; and clears fences only after
every observed group is positively absent. Old nested launches are refused after
closure. An unobserved spawn intent, corrupt inventory, or live/unprovable group
stays fenced. Group absence never supplies a missing exit code. There is no age/PID
shortcut or force-clear.

After a host reboot, a maintainer may use
`gate:reconcile <run-id> --previous-boot=<recorded boot UUID>` only when the
recorded run names the exact current worktree/common directory, custody root,
report directory, slot, locks and fences, and its hostname matches while its
recorded boot differs from the current boot. This separate path accepts open or
closed registration, closes an open registration, and requires an exact canonical
obligations directory containing only structurally valid `no-child` or `observed`
records. It never probes or signals old process groups and never invents absence,
receipt, terminal, or qualification evidence. It captures raw fence and inventory
digests, atomically publishes `previous-boot-ended.json` with `stopped`/`UNPROVEN`
custody, then clears the exact slot fence before the worktree fence. A retry
validates the complete durable proof and clears only matching fences; the proof
writer must retain the recorded hostname and use a boot distinct from the old
boot, while a later retry may use any newer boot on that hostname. Its
`recordedAt` value is checked for canonical timestamp shape only, so clock
rollback does not invalidate durable custody. A corrupt, foreign, newer, or
incomplete proof remains fenced. Historical status remains ordinary current-boot
status and has no previous-boot mode.

This cooperative boundary protects admitted heavy commands and shared build/report
writers on local Linux with Git, bash, flock, and atomic local-filesystem publication.
It does not coordinate other clones/users, distributed filesystems, direct build/tool
commands, or arbitrary escaped descendants. Audited synthetic Codex process fixtures
write only disposable fixture storage or stdio and retain their scoped cleanup;
production process semantics are unchanged. An ambient
`DALPH_RUN_REAL_CODEX_QUALIFICATION=1` or `DALPH_QUALIFICATION_ENV_CAPTURE` is rejected
at fresh and inherited admission before launch. Run opt-in real qualification
separately; tests can still set their own disposable capture paths internally.

A command exit, stopped custody, and final qualification are distinct evidence.
A failed child receipt retains its historical absence observation. If its enclosing
test later stops the group, a separate exact group-absence record can prove stopped
custody without rewriting that child result. Missing terminal receipts remain
`UNPROVEN`; successful earlier stages are not a
final green gate. Interrupted ordinary candidate checks restart from the
beginning after stopped-writer reconciliation. The runner does not credit a
stage resume or cross-worktree formal proof. Standalone `check:quint` remains
available for formal diagnostics. Automatic MBT is temporarily excluded pending
#363; `test:mbt` remains an explicit manual command.

A synthetic detached writer can create its fixture readiness file after launch
while its parent is still publishing the post-spawn process-group observation.
The custody test therefore waits, for at most its existing ten-second fixture
deadline, until the writer's exact obligation is `observed` before corrupting
that variant. If the observer dies, the still-live writer keeps both fences; an
`observed` record rewritten as `no-child` while retaining its process group must
be rejected, and reconciliation must not clear either fence. No retry applies:
the fixture releases the original writer and reconciles that run. This is
qualification-tool behavior only; it changes no Dalph runtime command, provider
boundary, journal fact, retry, or cleanup behavior.

| Qualification scenario | Acceptance test |
| --- | --- |
| A detached writer reports fixture readiness before its parent can publish the post-spawn observation; the test waits for the exact observed variant, kills the enclosing observer, and proves corrupting that variant cannot clear either fence | `scripts/gate-custody.test.mjs`: `formal-copy observer death preserves registered detached writer custody before any next launch` |

Bootstrap prepares dependencies before freezing the candidate. Ordinary candidate
checks retain a live Linux inotify observer and require Python 3. The observer
watches source, resolved tool and configuration inputs, detects edit-and-restore
and replacement, and fails on queue overflow, watch loss, or observer failure.
It drains before the final input comparison and remains in the registered gate
process group. No observer receipt grants resume or cross-worktree reuse credit.
Transient memory-mapped mutation is outside the cooperative filesystem guarantee.
Metadata-only events on a path that is only a strict ancestor of an input do not
invalidate the run by themselves. Membership, rename, and replacement events on
the same path still invalidate except for the local candidate index policy
below, and the final comparison rejects any lasting change that alters resolved
identity.

Guarded full-gate children use `GIT_OPTIONAL_LOCKS=0`, so read-only status checks
leave index stat-cache metadata untouched. The ordinary local `check:all`
candidate additionally observes staged index entries at each stage boundary
instead of watching raw index-file replacement: an outside `git status` that
refreshes only stat metadata does not invalidate a long run. A persistent
staged-entry change fails the next boundary comparison, and the final complete
snapshot also checks staged entries. Source bytes, HEAD, selected refs, and
other Git authority remain observed. A staged-only change followed by a reset
between two stage boundaries can escape this semantic index check; local
qualification is tied to the frozen HEAD and watched source bytes rather than
transient index metadata. Standalone `check:quint` guards formal source and tool
inputs; it does not bind Git HEAD or the index. Only explicitly constructed
internal Git coordination lock paths—the candidate's `index.lock`,
the shared `packed-refs.lock`, and the lock paths for its exact symbolic
selected-ref chain—may be treated as transient coordination when their
create/remove pair is observed. No `HEAD.lock` or arbitrary `*.lock` path is
exempt. A real same-batch ref event remains dirty even when a lock is created
and removed; strict guards also invalidate raw index events. A persistent
internal lock fails the final authoritative snapshot.
User-configured authority files named `*.lock` remain observed, so editing and
restoring one rejects reuse. External Git observation during a run must use the
same optional-lock setting.

The shared common Git config is not part of the live filesystem observer: linked
worktrees can replace that file while adding only another branch's settings.
The guard instead compares the effective local configuration at each validation
boundary; foreign `branch.*` sections do not invalidate qualification, while a
candidate-branch or repository-wide setting change does. A setting changed and
restored before a boundary is intentionally ignored because the candidate's
effective Git authority is unchanged. Worktree-local `config.worktree`, refs,
and other Git authority files remain observed. The local candidate compares
semantic index entries; the CI quality shared-input guard retains raw index-file
observation.
This is qualification-tool behavior only and changes no Dalph runtime command,
provider boundary, journal fact, retry, or cleanup behavior.

| Qualification scenario | Acceptance test |
| --- | --- |
| Another maintainer adds an unrelated branch section while the shared common config is replaced; boundary comparison retains the candidate identity | `scripts/gate-resume-inputs.test.mjs`: `an unrelated branch section can be added while the candidate config watch remains live` |
| Another maintainer adds branch metadata whose branch name merely extends the candidate's branch name; exact Git section/subsection parsing keeps it unrelated | `scripts/gate-resume-inputs.test.mjs`: `a branch whose name extends the current branch remains unrelated configuration` |
| The exact current branch's Git configuration changes; the observer refuses the candidate even though similarly prefixed foreign branch sections are ignored | `scripts/gate-resume-inputs.test.mjs`: `the exact current branch section remains candidate-relevant configuration` |
| A repository-wide setting in the subsection-less `[branch]` section changes; the observer refuses both the next stage and final qualification | `scripts/gate-resume-inputs.test.mjs`: `a subsection-less branch setting remains repository-wide candidate configuration` |
| A persistent repository setting retargets an external ignore file | `scripts/gate-resume-inputs.test.mjs`: `candidate history rejects a persistent configuration retargeting of external ignores` |
| A repository-wide Git setting changes after an unrelated replacement; the re-armed observer refuses both the next stage and final qualification | `scripts/gate-resume-inputs.test.mjs`: `a candidate-relevant config replacement fails after an unrelated replacement re-arms the watch` |
| The parent-directory replacement event arrives in one observer drain and the obsolete file-watch removal arrives in the next; the observer watches the new generation immediately and treats only the later old-generation removal as obsolete | `scripts/gate-resume-inputs.test.mjs`: `split parent replacement and obsolete file removal events re-arm before the later removal` |
| A shared Git setting changes and is restored before validation | `scripts/gate-resume-inputs.test.mjs`: `a shared config edit restored before validation is ignored` |
| Git creates and removes one explicitly constructed coordination lock (`index.lock`, shared `packed-refs.lock`, or a lock for the exact symbolic selected-ref chain) without changing the authority bytes; the selected-ref/index controls prove the scoped allowance | `scripts/gate-resume-inputs.test.mjs`: `bound candidate history allows transient selected ref lock coordination`; `bound candidate history allows transient index lock coordination`; `bound candidate history allows transient packed-refs lock coordination` |
| A selected-ref write remains dirty, and strict raw-index guards reject a raw index write even when it is restored or accompanied by a transient index lock; local semantic-index checks instead compare staged entries at boundaries, tolerate a status-only stat refresh, and may miss a staged-only change that is reset entirely between boundaries | `scripts/gate-resume-inputs.test.mjs`: `bound candidate history observes selected ref ancestor replacement and restore`; `a transient index lock cannot hide a real candidate index mutation`; `semantic candidate identity tolerates a normal status stat refresh`; `semantic candidate identity rejects a persistent staged entry change at the boundary`; `semantic candidate identity rejects a persistent staged entry change at finish without a boundary check` |
| Ordinary `git status` refreshes only index stat metadata during local semantic observation | `scripts/gate-resume-inputs.test.mjs`: `semantic candidate identity tolerates a normal status stat refresh` |
| A persistent staged-entry change is rejected at the next local semantic stage boundary | `scripts/gate-resume-inputs.test.mjs`: `semantic candidate identity rejects a persistent staged entry change at the boundary` |
| A persistent staged-entry change is rejected by the local semantic final snapshot even without an earlier boundary assertion | `scripts/gate-resume-inputs.test.mjs`: `semantic candidate identity rejects a persistent staged entry change at finish without a boundary check` |
| Persistent skip-worktree and assume-unchanged flags are rejected by local semantic observation | `scripts/gate-resume-inputs.test.mjs`: `semantic candidate identity rejects persistent skip-worktree and assume-unchanged flags` |
| An internally constructed `index.lock` persists through the final authoritative snapshot | `scripts/gate-resume-inputs.test.mjs`: `a persistent index lock fails the final authoritative snapshot` |
| A user-configured external authority file named `*.lock` is edited and restored | `scripts/gate-resume-inputs.test.mjs`: `candidate history observes external excludes ending in .lock edit and restore` |

Reuse requires identical HEAD, conflict-free semantic index, working/untracked
bytes and modes, ignored configuration, actual installed dependency and resolved
tool bytes/link targets, effective environment and normalized logical invocation.
Only per-run transport and pnpm invocation bookkeeping are excluded from environment
identity; behavioral settings such as `DALPH_DIAGNOSTICS_BASE` remain inputs.
There is no metadata hash cache. Missing stronger identity or observer proof,
unknown inputs, another worktree/base/mode, or unresolved custody refuses reuse.

Stages have exact bounded command contracts. A completed stage's generated
artifact roots become protected inputs for later stages. Ordinary checks grant
no reuse credit. Vite/Vitest caches are disposable outputs, not proof of a
previous stage. Admitted lint passes dprint `--incremental=false`; formatter
plugin code and metadata remain inputs.
Normal edit-loop formatting keeps its incremental behavior. Other tool cache state
is included unless explicitly generated.
Local full qualification scans the complete ancestry of the exact candidate HEAD
for secrets, including removed ancestor content; it binds that SHA in the actual
scanner command and input identity. Standalone, preflight and hosted secret scans
retain the default all-ref history. Unrelated loose branch updates do not change
the locally selected candidate; selected refs and history controls remain observed.
Original and new output counts remain exact evidence, without a success ceiling.
An admitted child forwards at most 550 lines or 64 KiB to the console, then prints
its complete log path. Its receipt and log retain all output; truncation never
changes its exit verdict. A failed truncated child also shows its last 8 KiB.
Commands without retained logs remain untruncated. Presentation is per child,
not a shared qualification budget, so a verbose prefix cannot exhaust a suffix's
allowance. Quiet-command progress reporting is separate from child output.

The guarded formal profile opts into a dedicated fd3 NDJSON channel from its
bounded checker children through `run-formal-profile.mjs` to
`run-formal-workflow.mjs`. Lifecycle lines identify the semantic command,
elapsed time, absolute deadline, and retained log; a quiet command receives one
heartbeat after at most 15 seconds. The heartbeat says that backend progress is
unknown. Last-observed stdout/stderr bytes are activity evidence only, never
backend progress, and are not echoed one line per chunk. Compact mode retains
these lifecycle lines while suppressing successful raw checker output and
timing detail. The channel is live-only and non-evidentiary: reuse starts no
transport, a lost parent leaves any already-emitted start/heartbeat without a
synthetic terminal, and receipts, custody, formal reports, and evidence remain
authoritative.

This is repository-tooling behavior only; no Dalph command, provider boundary,
journal fact, retry or runtime cleanup changes. Output-policy tests prove bounded
presentation and malformed-count rejection; the resume integration test proves
that a reused prefix plus a noisy suffix qualifies with exact original counts.

The executable Quint command manifest and hosted model-family ranges generate
`packages/dalph/src/qualification/formal-command-inventory.generated.ts`.
The production provenance schema and positive live-qualification fixtures read
its command count and shard assignment. After changing either input, run
`node scripts/generate-formal-command-inventory.mjs --write`. The early
`test:formal:controls` check rejects a stale generated inventory or a missing
or overlapping shard position before coverage. The existing negative fixture
with a truncated profile remains independent. This is qualification tooling
only; it changes no Dalph workflow decision or external request.

A composite receipt links original prefix stages and newly executed suffix stages;
it never invents execution receipts for skipped commands. Verified reused coverage
is copied to the new report directory with original provenance. Newly executed
coverage also writes there. Missing/corrupt child logs, stage records, input guard,
artifact copies or composite inventory cannot establish final qualification.

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
That workflow starts automatically for Codex integration source and scenario
changes. A shared `package.json` or qualification-workflow edit alone uses
`workflow_dispatch` when its Codex qualification contract needs checking; it
does not start real Codex processes for unrelated script changes. This narrows
gate selection and cannot alter Dalph runtime behavior.

For shared-host gate failures, dispatch [Candidate qualification](../.github/workflows/quint-qualification.yml)
once with the frozen `candidate_sha`. Choose `quint` (default, ARM) or `all`
(x64, full history, gitleaks); `all` also requires the reviewed
`coverage_base_sha`. It runs the same gate on a fresh worker. Diagnose stage
failures before retrying; different hardware is not a calibrated baseline.

### Protected disposable live qualification

Alice dispatches [Production live qualification](../.github/workflows/production-live-qualification.yml)
only for one accepted candidate and one dedicated disposable repository. The
dispatch supplies `candidate_sha`, `reviewed_base_sha`, and `repository`; the
first two values must each be exactly 40 lowercase hexadecimal characters.
The workflow checks out that candidate, verifies the reviewed Base exists,
and first asks GitHub Actions whether the exact candidate already has one
completed successful workflow named `CI`. A failed, running, cancelled,
wrong-SHA, or differently named workflow stops the dispatch before any formal
worker or protected-environment approval starts. It does not poll. After that
preflight succeeds, the workflow installs with pnpm 10.29.3 on Node 24.20.0
and runs `pnpm build` before any controlled-provider credential is generated.

The workflow has one constant concurrency group,
`production-live-qualification`, with `cancel-in-progress: false`, regardless
of dispatch ref or SHA. The `qualify` job requires approval from the protected
GitHub environment named `production-live-qualification`. Its one protected
secret, `DALPH_LIVE_GITHUB_TOKEN`, is mapped only into the single live-command
step and is scoped to issue and label mutation in the configured repository.
Ordinary CI never invokes this command.

Four matrix jobs after that preflight capture shards 0 and 1 for both the dedicated ARM
profile and the two-CPU stressed profile with `pnpm check:ci:formal:shard`.
Their reports and provenance files are downloaded by the approved job. Each
formal job records its setup/install duration and binds the SHA-256 digest of
its relative `report.json` to its profile, shard, and measured execution
condition; it never publishes the worker's absolute report or home path.
Before the live command, the approved job uses the current repository's
automatic Actions token (`GITHUB_TOKEN`, with only `actions: read`) to resolve
exactly one successful numeric Actions job ID for each of the four formal jobs in this run
attempt. It derives each complete-job duration from that successful Actions
job's `started_at` and `completed_at`; unlike a timestamp written by the formal
job itself, this interval covers provenance generation and the final formal
artifact upload. The literal 16-minute job timeout and this resolved duration
prove the complete-job limit. That token is used only for this read; it is not
the disposable repository credential.

The checked-in controller receives the downloaded evidence locators, the
candidate-bound source SHA, branded workflow/run/job/protected-environment
provenance, and these strict formal/output locators:

```text
DALPH_LIVE_QUALIFICATION_SOURCE_SHA
DALPH_LIVE_QUALIFICATION_SOURCE_REPOSITORY
DALPH_LIVE_QUALIFICATION_SOURCE_BASE_SHA
DALPH_LIVE_QUALIFICATION_BUILT_ENTRY
DALPH_LIVE_QUALIFICATION_SHIPPED_ENTRY
DALPH_LIVE_QUALIFICATION_LOCKFILE
DALPH_LIVE_QUALIFICATION_CODEX_EXECUTABLE
DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER
DALPH_LIVE_QUALIFICATION_WORKFLOW
DALPH_LIVE_QUALIFICATION_RUN_ID
DALPH_LIVE_QUALIFICATION_JOB_ID
DALPH_LIVE_QUALIFICATION_MANIFEST
DALPH_LIVE_QUALIFICATION_ARTIFACT
DALPH_LIVE_QUALIFICATION_RETAINED_LOCATORS (under DALPH_LIVE_QUALIFICATION_PUBLICATION_CONTAINER)
DALPH_LIVE_QUALIFICATION_FORMAL_ROOT
```

The root command is:

```bash
pnpm qualify:production-live
```

Before that one launch, the wrapper creates the absolute manifest file with a
fresh invocation and issue-operation identity, the exact candidate/Base and
hosted provenance, the shipped `packages/dalph/dist/bin/dalph.js` entry, the
lockfile/Codex locators, the outside-Q artifact and retained-report locators,
and the two exact two-shard formal profiles processed by the built provenance validator. The
controller locator (`packages/dalph/dist/bin/production-live-qualification.js`)
is intentionally separate from the shipped Dalph entry. The retained report is
under the pre-created publication container and remains distinct from the
qualification artifact.

It validates `DALPH_RUN_PRODUCTION_LIVE_QUALIFICATION=1`, the exact checked-out
candidate, the reviewed Base, the protected environment, the provenance shape,
the formal evidence files, and the built entry
`packages/dalph/dist/bin/production-live-qualification.js`. It then starts that
controller once with one absolute `--manifest` locator. The controller owns
fixture creation, the one shipped production Run, build/hash/provenance
evidence, exact cleanup, and the redacted artifact; this wrapper has no retry
or resume path. As soon as Q's GitHub issue exists, the controller writes its
exact redacted remote locator to `retained-locators.json`; after local setup it
atomically replaces that checkpoint with the complete remote/local retained
set before starting the shipped child. Outer cancellation can therefore upload
the last completed disposition checkpoint even when the controller never
returns. A successful final publication removes the stale checkpoint. The
controller generates a fresh random throwaway credential
for the loopback Responses provider per invocation, binds it only to the
isolated `CODEX_HOME` config under
`DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL`, and passes that value only to the
controlled shipped child. The outer runner resolves the locked Codex JavaScript
entry once and carries that exact locator in the safe manifest. Its Bash observation wrapper starts the locked Codex
JavaScript entry with the wrapper locator retained as `argv[0]`; the ownership
census can therefore still identify and signal the exact detached app-server
after pnpm's ordinary shim would have replaced that identity with `node`. The
outer validator requires that derived locked JavaScript entry to be a readable
nonempty file before it launches the controller, and the generated wrapper
rereads it immediately before `exec`.
A failed or ambiguous provider boundary therefore leaves the
Run and exact retained locators for manual inspection rather than launching a
second command.

After the live command settles or the hosted job cancels it, an `if: always()`
step reads the latest retention checkpoint. It writes `diagnostics.json` with
only the checkpoint phase and disposition counts, durable journal event-kind
chronology, app-server start count, and hosted run identity. It never copies
journal payloads, GitHub node IDs, prompts, responses, credentials, private
Codex state, or runner-local locators. The final step uploads
`qualification.json`, `retained-locators.json`, and `diagnostics.json` with
`if: always()`, so a successful result and a failed live attempt use the same
explicit redacted artifact boundary. A successful final qualification omits
the not-qualified diagnostics file. It does not upload the controller
manifest or a pre-cleanup snapshot: those contain private absolute workspace or
temporary locators and are local controller inputs, not publication artifacts.
The uploaded artifact must contain no credential, raw environment,
provider-private session, prompt, response, raw Actions API payload, or private
absolute workspace/home locator. The disposable-repository secret remains named
`DALPH_LIVE_GITHUB_TOKEN` until the runtime maps it to the shipped child’s
`GITHUB_TOKEN` boundary. `CODEX_HOME` contains the controlled fixture config;
`codexExecutorPrivateStateDirectory` contains only Dalph-owned attempt and
app-server ownership state. The generated provider value is never serialized or
logged.

The focused contract mapping is:

| Scenario | Acceptance test |
| --- | --- |
| Alice dispatches a candidate whose exact `CI` workflow is failed, running, cancelled, absent, or successful only for another SHA; the preflight fails before formal work or environment approval. An exact completed successful `CI` permits the formal dependency. | `scripts/run-production-live-qualification.test.mjs`: `blocks formal qualification unless exact candidate CI is completed and successful`, `permits formal qualification after exact candidate CI completed successfully`; `scripts/production-live-qualification-workflow.test.mjs`: dependency-order assertions in the four-shard case |
| Alice's approved workflow is manually dispatched with exact candidate/Base inputs, one serialized lane, Node 24.20.0, build, and dedicated/stressed evidence; each shard records Node's unprefixed runtime version while the resolver rejects the `v24.20.0` spelling that caused run 34837785947 to fail; GitHub's successful whole-job timestamps prove each job finishes below its 16-minute cutoff after its final upload | `scripts/production-live-qualification-workflow.test.mjs` exact worker toolchain case; `scripts/run-production-live-qualification.test.mjs` v-prefixed hosted-metadata negative control, successful timestamp derivation, and 16-minute rejection cases |
| The command rejects missing opt-in, malformed inputs, or a changed candidate before any provider child starts | `scripts/run-production-live-qualification.test.mjs` validation cases |
| The built controller receives one manifest locator and secrets only through one child launch | `scripts/run-production-live-qualification.test.mjs` exact launch case |
| Uploaded formal provenance and live failure evidence disclose no private absolute worker/controller locator | `scripts/run-production-live-qualification.test.mjs` absolute formal-log rejection case; `scripts/production-live-qualification-workflow.test.mjs` manifest/pre-cleanup exclusion case |
| A child/provider failure is reported without a retry and without secret bytes in the wrapper error | `scripts/run-production-live-qualification.test.mjs` single-launch failure case and workflow artifact `if: always()` contract |
| The disposable issue exists but later local setup or the shipped command never returns; the always-upload step receives Q's latest exact retained-resource checkpoint rather than no artifact. An interruption during checkpoint replacement leaves the prior complete checkpoint intact. | `packages/dalph/test-support/production-live-qualification-runtime.test.ts`: `persists the exact remote fixture before local setup or the shipped child can stall`, `an unfinished recoverable Run retains every exact local locator for manual cleanup`, `preserves the prior valid checkpoint if replacement is interrupted` |
| The hosted job cancels the live command after its Execution checkpoint. Before the runner disappears, the always-run diagnostic step reads that checkpoint and the retained SQLite/app-server observation files. The uploaded diagnostic identifies the checkpoint phase, ordered journal event kinds, and number of app-server starts without copying runner paths, journal payloads, prompts, responses, resource IDs, or credentials. If no checkpoint exists, it reports that fact; after a final qualified artifact, it publishes no contradictory not-qualified diagnostic. | `scripts/run-production-live-qualification.test.mjs`: `hosted cancellation diagnostics retain progress without locators, payloads, prompts, or credentials`, `hosted diagnostics distinguish a missing checkpoint and do not misreport successful qualification`; `scripts/production-live-qualification-workflow.test.mjs`: always-run capture and uploaded diagnostics assertions |
| The generated Codex wrapper starts the exact locked JavaScript entry and remains signalable as the recorded wrapper process; a missing entry fails before any process observation. | `packages/dalph/test-support/production-live-qualification-runtime.test.ts`: `production live qualification fixture separates Codex home from executor private state`, `the generated wrapper fails before process observation when its locked entry is missing` |

### Disposable production repository walkthrough

This walkthrough lets Alice run the shipped production command against one
dedicated disposable GitHub repository and one unblocked issue. Production can
create and delete repository labels, close the issue, start Codex sessions,
write local Git refs and worktrees, and retain durable local state. Do not point
it at an existing project, a shared clone, or an issue with sub-issues or
blocking relationships.

This is an operator walkthrough of already implemented behavior. It is not the
repeatable live-provider qualification owned by GitHub issue #261 and supplies
no #261 closure evidence.

Run every shell block in this walkthrough with Bash; the credential prompts
and guarded marker reads intentionally use Bash built-ins.

#### 1. Create the isolated GitHub and credential boundary

In GitHub, create a private repository named
`dalph-production-walkthrough`, initialize its `main` branch with a README, and
do not add collaborators, rules, Actions, sub-issues, or dependencies. Create a
fine-grained personal access token restricted to that repository with:

- repository metadata: read (GitHub always includes this permission);
- repository contents: read, for the local clone; and
- issues: read and write, for graph reads, Dalph claim/completion labels, and
  issue completion.

The token does not need Actions, Administration, Pull requests, or organization
permissions. Use a separately authorized browser session if you later delete
the repository. Complete the ordinary Codex CLI login separately; Dalph uses
that ambient Codex authentication and does not request an OpenAI API key. Read
the GitHub token without echoing it and keep it in the environment only:

```bash
read -r -s -p "Disposable-repository GitHub token: " GITHUB_TOKEN
printf '\n'
export GITHUB_TOKEN
```

Do not put the token in shell history, a Git remote URL, the JSON document, the
repository, SQLite, or an evidence directory. Dalph reads exactly
`GITHUB_TOKEN` and redacts it from known
configuration failures.

Set the repository identity, create an exact disposable local root, clone the
initialized repository, and create its only issue. Replace `YOUR_LOGIN`; keep
the repository name dedicated to this exercise.

```bash
export DALPH_DEMO_OWNER=YOUR_LOGIN
export DALPH_DEMO_REPOSITORY=dalph-production-walkthrough
export DALPH_DEMO_TEMP_PARENT
DALPH_DEMO_TEMP_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
export DALPH_DEMO_ROOT
DALPH_DEMO_ROOT="$(mktemp -d "${DALPH_DEMO_TEMP_PARENT}/dalph-production-walkthrough.XXXXXX")"
printf '%s\n' "${DALPH_DEMO_OWNER}/${DALPH_DEMO_REPOSITORY}" \
  > "${DALPH_DEMO_ROOT}/.dalph-walkthrough-repository"

export DALPH_DEMO_LOCAL_REPOSITORY="${DALPH_DEMO_ROOT}/repository"
GH_TOKEN="${GITHUB_TOKEN}" gh repo clone \
  "${DALPH_DEMO_OWNER}/${DALPH_DEMO_REPOSITORY}" \
  "${DALPH_DEMO_LOCAL_REPOSITORY}"
git -C "${DALPH_DEMO_LOCAL_REPOSITORY}" switch main
git -C "${DALPH_DEMO_LOCAL_REPOSITORY}" config user.name "Dalph Walkthrough"
git -C "${DALPH_DEMO_LOCAL_REPOSITORY}" config user.email "dalph-walkthrough@example.invalid"

export DALPH_DEMO_ISSUE_URL
DALPH_DEMO_ISSUE_URL="$(GH_TOKEN="${GITHUB_TOKEN}" gh issue create \
  --repo "${DALPH_DEMO_OWNER}/${DALPH_DEMO_REPOSITORY}" \
  --title "Create the disposable walkthrough note" \
  --body "Create WALKTHROUGH.md containing one sentence that identifies this disposable Dalph production walkthrough. Commit the change. This issue has no dependencies.")"
export DALPH_DEMO_ISSUE_NUMBER="${DALPH_DEMO_ISSUE_URL##*/}"
```

Confirm that the URL ends in the numeric issue number and that the GitHub issue
shows no blocked-by or sub-issue relationship. That makes the sole task
immediately eligible; an ordinary label is not a dependency.

#### 2. Build Dalph and pin the local Git facts

Run these commands from the Dalph source checkout. The disposable target clone
is separate from this source checkout.

```bash
export DALPH_SOURCE="$(pwd -P)"
pnpm install --frozen-lockfile
pnpm build

export DALPH_EXECUTABLE="${DALPH_SOURCE}/packages/dalph/dist/bin/dalph.js"
export DALPH_CODEX_EXECUTABLE="${DALPH_SOURCE}/node_modules/.bin/codex"
test -f "${DALPH_EXECUTABLE}"
test -x "${DALPH_CODEX_EXECUTABLE}"

export DALPH_DEMO_INTEGRATION_REF
DALPH_DEMO_INTEGRATION_REF="$(git -C "${DALPH_DEMO_LOCAL_REPOSITORY}" symbolic-ref HEAD)"
test "${DALPH_DEMO_INTEGRATION_REF}" = refs/heads/main
export DALPH_DEMO_BASE_SHA
DALPH_DEMO_BASE_SHA="$(git -C "${DALPH_DEMO_LOCAL_REPOSITORY}" rev-parse "${DALPH_DEMO_INTEGRATION_REF}^{commit}")"
git -C "${DALPH_DEMO_LOCAL_REPOSITORY}" cat-file -e "${DALPH_DEMO_BASE_SHA}^{commit}"
export DALPH_DEMO_COMMON_DIRECTORY
DALPH_DEMO_COMMON_DIRECTORY="$(git -C "${DALPH_DEMO_LOCAL_REPOSITORY}" \
  rev-parse --path-format=absolute --git-common-dir)"
test "${DALPH_DEMO_COMMON_DIRECTORY}" = "${DALPH_DEMO_LOCAL_REPOSITORY}/.git"
export DALPH_DEMO_PUBLICATION_REPOSITORY="${DALPH_DEMO_ROOT}/publication.git"
git clone --bare "${DALPH_DEMO_LOCAL_REPOSITORY}" "${DALPH_DEMO_PUBLICATION_REPOSITORY}"
test "$(git --git-dir "${DALPH_DEMO_PUBLICATION_REPOSITORY}" rev-parse "${DALPH_DEMO_INTEGRATION_REF}")" = "${DALPH_DEMO_BASE_SHA}"
```

`DALPH_DEMO_BASE_SHA` is the exact planned Base SHA, not a branch name. The
configured `integrationRef` is the local `refs/heads/main`; Dalph updates that
local ref and publishes the integrated commit to the distinct bare repository
at `DALPH_DEMO_PUBLICATION_REPOSITORY`. The common directory is also the exact
OS-backed coordinator-lock target. The Codex executable is the built workspace
dependency, not an inferred executable from a target repository.

#### 3. Write the complete non-secret configuration

The [direct remote publication specification for acceptance](scenarios/direct-remote-publication.md)
adds an explicit remote/ref and publication proof before task completion. The
normal path uses Git's exact push acknowledgement; interrupted or ambiguous
paths reconcile as specified. This walkthrough uses a disposable bare
repository as that publication target and independently reads its head after
the shipped process exits.

Create disjoint sibling locations under the disposable root. The two worktree
roots must not contain each other or the repository/private state. The Journal
database, evidence root, Codex executor-private state directory, and Integrator private-store
file must also be pairwise disjoint. Every path below is normalized and
absolute because it is derived from the absolute `mktemp` root.

```bash
export DALPH_DEMO_JOURNAL="${DALPH_DEMO_ROOT}/journal.sqlite"
export DALPH_DEMO_EVIDENCE="${DALPH_DEMO_ROOT}/evidence"
export DALPH_DEMO_CODEX_EXECUTOR_PRIVATE_STATE="${DALPH_DEMO_ROOT}/codex-executor-private"
export DALPH_DEMO_INTEGRATOR_STORE="${DALPH_DEMO_ROOT}/integrator-private.json"
export DALPH_DEMO_TASK_WORKTREES="${DALPH_DEMO_ROOT}/task-worktrees"
export DALPH_DEMO_INTEGRATOR_WORKTREES="${DALPH_DEMO_ROOT}/integrator-worktrees"
export DALPH_DEMO_CONFIG="${DALPH_DEMO_ROOT}/production.json"
mkdir -p \
  "${DALPH_DEMO_EVIDENCE}" \
  "${DALPH_DEMO_CODEX_EXECUTOR_PRIVATE_STATE}" \
  "${DALPH_DEMO_TASK_WORKTREES}" \
  "${DALPH_DEMO_INTEGRATOR_WORKTREES}"
chmod 700 \
  "${DALPH_DEMO_ROOT}" \
  "${DALPH_DEMO_EVIDENCE}" \
  "${DALPH_DEMO_CODEX_EXECUTOR_PRIVATE_STATE}" \
  "${DALPH_DEMO_TASK_WORKTREES}" \
  "${DALPH_DEMO_INTEGRATOR_WORKTREES}"

node --input-type=module <<'NODE'
import { writeFileSync } from "node:fs"

const requiredEnvironment = [
  "DALPH_CODEX_EXECUTABLE",
  "DALPH_DEMO_BASE_SHA",
  "DALPH_DEMO_CODEX_EXECUTOR_PRIVATE_STATE",
  "DALPH_DEMO_COMMON_DIRECTORY",
  "DALPH_DEMO_CONFIG",
  "DALPH_DEMO_EVIDENCE",
  "DALPH_DEMO_INTEGRATION_REF",
  "DALPH_DEMO_INTEGRATOR_STORE",
  "DALPH_DEMO_INTEGRATOR_WORKTREES",
  "DALPH_DEMO_JOURNAL",
  "DALPH_DEMO_LOCAL_REPOSITORY",
  "DALPH_DEMO_PUBLICATION_REPOSITORY",
  "DALPH_DEMO_TASK_WORKTREES"
]

for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`missing walkthrough environment: ${name}`)
}

const configuration = {
  repository: process.env.DALPH_DEMO_LOCAL_REPOSITORY,
  remotePublicationTarget: {
    endpoint: process.env.DALPH_DEMO_PUBLICATION_REPOSITORY,
    branch: process.env.DALPH_DEMO_INTEGRATION_REF
  },
  commonDirectory: process.env.DALPH_DEMO_COMMON_DIRECTORY,
  integrationRef: process.env.DALPH_DEMO_INTEGRATION_REF,
  plannedAttemptBaseSha: process.env.DALPH_DEMO_BASE_SHA,
  plannedAttemptExecutor: "codex:production",
  claimOwner: "dalph:production-walkthrough",
  taskWorkCapacity: 1,
  journalDatabase: process.env.DALPH_DEMO_JOURNAL,
  evidenceStoreRoot: process.env.DALPH_DEMO_EVIDENCE,
  plannedAttemptWorktreeRoot: process.env.DALPH_DEMO_TASK_WORKTREES,
  codexExecutorPrivateStateDirectory: process.env.DALPH_DEMO_CODEX_EXECUTOR_PRIVATE_STATE,
  integratorCandidateWorktreeRoot: process.env.DALPH_DEMO_INTEGRATOR_WORKTREES,
  integratorPrivateStore: process.env.DALPH_DEMO_INTEGRATOR_STORE,
  activationInterval: "1 minute",
  failureCooldown: "5 seconds",
  codexExecutable: process.env.DALPH_CODEX_EXECUTABLE,
  codexClientName: "dalph-production-walkthrough",
  codexClientVersion: "1.0.0"
}

writeFileSync(process.env.DALPH_DEMO_CONFIG, `${JSON.stringify(configuration, null, 2)}\n`, {
  mode: 0o600
})
NODE
```

The JSON contains only non-secret `ProductionRepositoryHostConfiguration` fields.
The CLI injects the GitHub target parsed from the command and the redacted
`GITHUB_TOKEN` credential; adding `target` or `githubToken` to the JSON is
rejected as an excess property. Codex authentication remains in the invoking
CLI environment and is not copied into this document.

#### 4. Run and read the public output

Run exactly this public command from any directory:

```bash
node "${DALPH_EXECUTABLE}" \
  run "github:${DALPH_DEMO_OWNER}/${DALPH_DEMO_REPOSITORY}#${DALPH_DEMO_ISSUE_NUMBER}" \
  --production \
  --config "${DALPH_DEMO_CONFIG}"
```

For the independent publication check, read the bare repository directly and
compare the result with the candidate commit reported by the completed Run:

```bash
git --git-dir "${DALPH_DEMO_PUBLICATION_REPOSITORY}" \
  rev-parse "${DALPH_DEMO_INTEGRATION_REF}"
```

Each stdout line is one version-1 JSON record. The first successful selection
has `_tag: "RunSelected"`, `selection: "Allocated"`, an exact `runId`, and
`version: 1`. Later records can be:

- `CurrentStatus`, whose `status._tag` is `DeliveryStatusNotReady`,
  `DeliveryStatusAvailable`, or `DeliveryStatusClosed` for the selected Run;
  available entries are separately classified as `Waiting`, `Progressing`,
  `Blocked`, `Settled`, or `Relinquished`;
- `HistoricalSnapshot`, containing one whole immutable `snapshot` and its exact
  Journal cursor;
- `RunDisposition`, with `Completed`, `Blocked`, or `Cancelled`, after the host
  independently proves Run termination;
- `ApplicationExitDisposition`, with `Succeeded` and status 0 or `Failed` /
  `TimedOut` and status 1, after a signal-requested application Exit; or
- `Failure`, with a stable redacted `code`, `detail`, and safe `subject`, after a
  known usage, configuration, startup/ownership, Journal, delivery-throttle,
  status/projection, output-write, or lifecycle failure. A typed stdout-write
  failure has code `output.write_failed`, status 1, and fixed redacted detail;
  Dalph does not recursively attempt another stdout `Failure` record.

This output mapping belongs only to the production command. The controlled
`--dry` interpreter retains its existing `TraceOutputError`. If stdout fails
while the production CLI is best-effort reporting another known failure, the
typed output failure becomes the terminal boundary result. The selected-Run
delivery-throttle path is the explicit exception: losing its `Failure` line
retains the original `delivery.provider_throttled` failure so the owning
provider protocol, not presentation, controls reconciliation. Either result
has process status 1 and neither path attempts a second stdout write.

An unexpected defect is reported through stderr and a nonzero process result;
it does not invent an `internal.unexpected` NDJSON record. Historical snapshots,
current status, Run disposition, and application Exit are distinct facts. An
empty or closed status stream alone is never terminal success.

The run can change each owning system:

- GitHub is read for the issue closure, may gain exact `dalph-claim-*` and
  `dalph-completion-*` repository labels, and may have the issue closed. Dalph
  re-reads GitHub before retrying an ambiguous label or completion effect.
- Local Git can gain deterministic task branches/worktrees, executor commits,
  an Integrator candidate worktree/commit, an atomic update of the configured
  local `refs/heads/main`, and a publication push to the distinct bare
  repository. The walkthrough independently checks that bare repository's ref
  after the process exits; it does not treat GitHub as Git lineage authority.
- SQLite at `journalDatabase` records the Run beginning and workflow history.
  The coordinator holds an OS lock on the exact Git common directory while the
  host scope is live; it does not persist a second ownership database.
- The evidence directory receives accepted evidence artifacts. The task and
  Integrator roots receive only their derived worktrees. Cleanup removes only
  exact resources whose disposition is proven; unreadable, foreign, or
  ambiguous resources are preserved and block unsafe successor work.
- The Codex executable starts app-server processes and provider threads using
  the ambient Codex CLI authentication. Executor state stays under
  `codexExecutorPrivateStateDirectory`;
  Integrator thread/candidate facts stay in `integratorPrivateStore` and the
  candidate-worktree root. Public output omits provider-private transcripts and
  session data.

#### 5. Observe graceful Exit and demonstrate unfinished-Run recovery

To observe graceful Exit, press Ctrl-C after the first `RunSelected` record.
`SIGINT` and `SIGTERM` both submit the same graceful application Exit request.
Repeated signals join the first request and do not restart the fixed
five-second drain. A final `ApplicationExitDisposition` with
`disposition._tag: "Succeeded"` means the process returned 0 after the bounded
shutdown protocol; it does not by itself prove whether the Run had already
durably terminated.

On an identical next invocation, selection is `Recovered` with the same
`runId` only when SQLite still contains that exact unfinished Run. If the Run
was already durably terminated, ordinary discovery applies instead and may
allocate or select work according to the current GitHub, Git, and Journal
authorities. This sequence is therefore possible, not promised merely because
Ctrl-C followed `RunSelected`:

```text
{"_tag":"RunSelected","runId":"...","selection":"Allocated","version":1}
...
{"_tag":"ApplicationExitDisposition","disposition":{"_tag":"Succeeded","requestedStatus":0},"runId":"...","version":1}

{"_tag":"RunSelected","runId":"...","selection":"Recovered","version":1}
```

Recovery rebuilds a new process-local current-status source, validates the
SQLite prefix, and checks the authority that owns any acknowledged ambiguous
effect before another mutation. It neither appends another Run beginning nor
recovers stdout, an old status subscription, or an Exit timer.

For a deterministic Allocated-to-Recovered demonstration, use the controlled
unfinished target in the shipped abrupt-stop process test. It kills the first
process without termination evidence, preserves the exact SQLite/Git facts,
then invokes the same public command and asserts that the same Run is
recovered:

```bash
pnpm exec vitest run \
  packages/dalph/src/application/production-public-recovery.integration.test.ts \
  -t "unfinished SQLite public restart reports the same recovered Run and no second beginning"
```

That controlled fixture proves the recovery sequence; it is not #261 live
qualification evidence or a per-merge admission gate. It remains an explicit
diagnostic because its process-containment observation is not reliable on the
hosted runner, and its child-process execution cannot contribute parent-worker
V8 coverage. In the disposable live repository, report
`Recovered` only after the next command actually emits it.

Graceful Exit is different from abrupt death. After `Succeeded`, admitted work
has reached the accepted bounded shutdown result and the host releases its
scoped resources and coordinator lock; the Run may still be unfinished. A
crash, an abrupt `SIGKILL` at a controlled unfinished cut, machine loss, or
process disappearance emits no
`ApplicationExitDisposition` and proves no graceful result. Preserve every
local and GitHub fact after abrupt death, then use the identical step-4 command
to reconcile and recover the same unfinished Run. Never interpret a missing
stdout line as permission to retry a provider mutation.

#### 6. Dispose exactly, or preserve everything

Let the command return before cleanup. If it is still running, its final output
is missing, a GitHub/Git fact is unreadable, or any resource identity is
uncertain, stop here: preserve the complete GitHub repository and
`DALPH_DEMO_ROOT` together. Do not manually delete individual Dalph labels,
branches, worktrees, SQLite rows, evidence files, Codex state, or Integrator
records; partial deletion destroys the facts needed for fail-closed recovery.

When the command has returned and you intentionally abandon the entire
disposable exercise, first verify both exact identities:

```bash
test "$(<"${DALPH_DEMO_ROOT}/.dalph-walkthrough-repository")" = \
  "${DALPH_DEMO_OWNER}/${DALPH_DEMO_REPOSITORY}"
test "$(GH_TOKEN="${GITHUB_TOKEN}" gh repo view \
  "${DALPH_DEMO_OWNER}/${DALPH_DEMO_REPOSITORY}" \
  --json nameWithOwner --jq .nameWithOwner)" = \
  "${DALPH_DEMO_OWNER}/${DALPH_DEMO_REPOSITORY}"
git -C "${DALPH_DEMO_COMMON_DIRECTORY}" worktree list --porcelain
```

Delete exactly `YOUR_LOGIN/dalph-production-walkthrough` in GitHub's Danger
Zone using the repository name confirmation. The deliberately restricted token
above cannot delete it. Only after GitHub confirms that exact deletion, retire
the local root with this guarded command. It moves the complete root into a
fresh sibling retention directory, so the local files remain recoverable:

```bash
unset GITHUB_TOKEN
(
case "${DALPH_DEMO_ROOT##*/}" in
  dalph-production-walkthrough.?*) ;;
  *) printf '%s\n' "refusing unexpected cleanup root: ${DALPH_DEMO_ROOT}" >&2; exit 1 ;;
esac
if test -n "${DALPH_DEMO_OWNER}" &&
  test "${DALPH_DEMO_REPOSITORY}" = dalph-production-walkthrough &&
  test "${DALPH_DEMO_ROOT%/*}" = "${DALPH_DEMO_TEMP_PARENT}" &&
  test ! -L "${DALPH_DEMO_ROOT}" &&
  test "$(cd "${DALPH_DEMO_ROOT}" && pwd -P)" = "${DALPH_DEMO_ROOT}" &&
  test ! -L "${DALPH_DEMO_ROOT}/.dalph-walkthrough-repository" &&
  test -f "${DALPH_DEMO_ROOT}/.dalph-walkthrough-repository" &&
  DALPH_DEMO_MARKER="$(<"${DALPH_DEMO_ROOT}/.dalph-walkthrough-repository")" &&
  test "${DALPH_DEMO_MARKER}" = "${DALPH_DEMO_OWNER}/${DALPH_DEMO_REPOSITORY}"
then
  DALPH_DEMO_RETAINED="$(mktemp -d "${DALPH_DEMO_TEMP_PARENT}/dalph-retained.XXXXXX")" || exit 1
  mv -- "${DALPH_DEMO_ROOT}" "${DALPH_DEMO_RETAINED}/workspace" || exit 1
  printf 'Local files retained at: %s/workspace\n' "${DALPH_DEMO_RETAINED}"
else
  printf '%s\n' "refusing cleanup: root or repository marker did not verify" >&2
  exit 1
fi
)
```

The block returns status 1 on a failed guard or move even when Bash `errexit`
is off. Credentials are cleared first so that cleanup cannot mask this status.
The path and marker checks guard one exact disposable root. A failed guard,
failed GitHub deletion, live process, or unsettled ambiguity means preserve
rather than broaden or repeat cleanup. If moving fails, inspect both exact
locations before doing anything else. Retained files are not an active
workspace: Git worktree pointers and configuration still name the original
paths. To inspect them at their original paths, restore the complete retained
`workspace` directory to the now-absent exact `DALPH_DEMO_ROOT`; the deleted
GitHub repository is not restored by this local recovery. Permanent deletion
of retained files is a separate, deliberate operator action.

### Coverage and output budgets

Coverage scheduling is repository tooling only: it does not change a Dalph
command, workflow decision, provider boundary, journal fact, retry, cleanup
action, or runtime-visible result. Resource-sensitive simulations that spawn a
built CLI do not add child-process V8 coverage to the parent report; their
inclusion must rest on required acceptance proof. When focused boundary tests
plus the actual protected qualification already own their acceptance facts,
remove a redundant built-child simulation instead of moving it into another
automatic lane. The focused tests remain boundary evidence, not a substitute
for composed runtime proof; the actual protected #307 run owns the final
shipped-entry composition.

The direct-publication S1 test is a production integration scenario under
`packages/dalph/test/integration/`: it starts the built CLI with real local
Git and SQLite and controlled external providers. The maintained recorded
catalog remains under `packages/dalph/test/cassettes/` and has its own command.
Run `pnpm test:integration:publication` before handoff when direct publication
or its composed completion/dependant behavior changes; record its result in the
scenario-to-test mapping. Ordinary `test`, `coverage:body`, and `check:all`
exclude this process-backed scenario. It contributes no child-process V8
coverage, and its real Git/SQLite startup can fail for reasons unrelated to
the coverage measurements. The named integration command retains the full
scenario assertions and bounded completion timeout. Its old 130-call ceiling
was a heuristic rather than an accepted scenario outcome; provider operation
counts remain in the failure diagnostic for investigating loops. Neither this
change nor a passing coverage run claims S1 acceptance until that named
integration command passes. These changes affect test policy, not a Dalph
command or runtime behavior.

Before submitting another hosted candidate after a failure, reproduce the
failure with the smallest named check that owns that boundary. Run cheap
structural diagnostics before resource-sensitive acceptance checks; the gate
manifest enforces its complete preflight prefix before qualification and
coverage. `scripts/recorded-catalog-gate.test.ts` proves that ordering and the
two-worker V8 policy. Coverage runs ordinary files with two workers, then the
cleanup recovery file, then the distinct-finality and formal-command contract
files one at a time. All three
projects use the same 30-second per-test budget and current-source aliases.
`scripts/coverage-scheduling.test.ts` checks that the split keeps the ordinary
file selection and exclusions and runs each of the three resource-sensitive
files once. This scheduling policy changes no Dalph runtime behavior.

- Report 95% production and 75% maintained-evaluation goals independently
  for statements, branches, functions, lines, and changed executable lines.
  These goals are advisory and never determine the command exit status.
  Require explicit tests for changed accepted behavior and review uncovered
  changed branches, including negative, crash, and replay outcomes. Test failures
  and unreadable coverage artifacts still fail. This deliberately removes the
  blanket percentage assurance; no tests are deleted. Maintained cassettes and
  deterministic test-only completion boundaries use evaluation; runtime and
  adapters use production. Mixed production/fixture files remain production
  until split behind a dedicated evaluation seam.
- Lab assertions run through its maintained check and enter line coverage only
  when instrumented. Tooling scripts have focused tests and gate execution,
  not executable-source coverage. Model checks remain separately required.
- Changed-line coverage uses `DALPH_COVERAGE_BASE_SHA` (CI: PR target or previous
  push SHA), falling back on missing/all-zero input to the merge base with
  `origin/master`, then `HEAD^`. It includes staged/unstaged tracked changes and
  untracked production source; non-executable/test/docs/tooling paths are
  excluded. Istanbul statement spans determine changed executable lines.
- Successful stages retain exact per-stage stdout/stderr counts in evidence; they
  do not share a qualification success ceiling. Each admitted child forwards at
  most 550 lines or 64 KiB to the console when its complete log is retained;
  failed stages retain complete diagnostics and their exit status. Reduce
  reporter noise before changing the per-child presentation bound.

For a branch review, set the coverage base explicitly:

```sh
DALPH_COVERAGE_BASE_SHA="$(git merge-base origin/master HEAD)" pnpm test
```

### Coverage explanation

A maintainer can inspect existing coverage without starting Vitest again:
`pnpm coverage:explain --candidate=<exact base sha> --run=<gate run id>`.
The command reads the run's captured `coverage-final.json` and prints JSON with
independent production/evaluation counts, uncovered statement/function ranges,
branch-arm locations, changed executable lines, missing source entries and the
existing threshold failures. An implicit branch arm without an Istanbul source
range is explicitly unavailable; the containing branch range is separate.

Freshness requires the exact worktree, coverage base and source-input digest,
matching captured artifact bytes/hash, a completed coverage-stage receipt and a
closed, stopped run whose source was unchanged. A failed coverage stage may
supply fresh diagnostic evidence while gate qualification remains `UNPROVEN`.
Missing, malformed, partial or incompatible receipts cannot establish freshness;
source/base/path/hash mismatches are stale. Incomplete reports remain unproven.

`--coverage=<final JSON>` can inspect a raw report; without matching run evidence
its freshness is unproven. `--baseline-coverage=<final JSON>` compares actual
report denominators only; baseline source/base provenance remains unproven.
Without that explicit artifact the prior denominator is unavailable. No prior
counts, unreachable branches or threshold exemption are inferred.

Status 0 means complete analysis of an artifact with matching freshness evidence.
Status 1 means analysis is unproven, stale, incomplete or unavailable. Neither
status certifies coverage compliance or replaces `test`/`check:all`;
the production 95% and maintained-evaluation 75% goals are advisory.

### Formal reuse and handoff

The explicit standalone `pnpm check:quint` command uses one complete profile and
one guarded applicability boundary. Ordinary local `check:all` records the
candidate's formal relevance and `not-requested` disposition without starting
Quint proof. A maintainer runs `pnpm check:quint` manually when formal proof is
wanted; CI retains its independent formal job. A passing local `check:all` is
not evidence of formal proof. It does not consume the standalone reuse contract.
The formal command runs missing or stale work, or reuses
an applicable local success record while naming that record. A complete changed
path inventory includes committed, staged, unstaged, deleted, rename-source,
and untracked paths; coverage explanation and raw debugging retain that complete
inventory, while formal applicability comes from the guarded input, toolchain
and profile identity plus full observation. It is never inferred from the
narrower development-loop classifier. A final applicability check still runs
after the external tool observation reaches the end of the application stage,
so a final input change fails the handoff. A final check failure does not
silently start a second formal profile.

Local reuse requires supported cooperative Linux, exact current-worktree
admission, shared Git-repository custody, prepared coherent
pnpm/Quint/Apalache/Java roots, and the conservative environment and input
boundary enforced by the formal policy. Equivalent governed inputs may reuse a
complete success from another worktree of the same clone and host boot.
Repository-local source and tool paths, checkout PATH entries, and a
checkout-local pnpm launcher are compared by role plus checkout-relative
location and content rather than raw worktree path. A recognized pnpm launcher
retains a digest of its complete generated script with only checkout-local
components of the generated `NODE_PATH` assignments represented symbolically;
added commands or changed targets remain input changes. Absolute original
worktree/run/report paths remain provenance and must still resolve through the
same Git common directory; every original checker/server process group must be
proven stopped. Unresolved custody, missing origin provenance, reconciliation
or observer evidence fails closed. The local boundary
does not coordinate arbitrary external processes, other clones, distributed
filesystems, non-Linux hosts, or tool roots outside the identified installation.

The supported runtime policy currently identifies Debian 12 on x64 or arm64,
with finite dedicated Node and Java installation roots and a checkout-local
pinned pnpm/Quint installation. The affected-input rule in the
[formal affected-input reuse scenario](scenarios/formal-affected-input-reuse.md)
supersedes the former whole-`specs/`, whole-`scripts/`, and raw-configuration
fingerprint. The policy parses the actual admitted/formal process entries and
recursively follows their repository JavaScript dependencies. It selects Quint
roots from the effective profile command arguments and follows imports with the
pinned Quint resolver. Unselected scripts, experimental models, documentation,
raw package/lock/workspace/npm/patch metadata, and the hosted CI workflow do not
change local formal identity merely because their bytes changed.

Hosted admission has a different boundary because every shard starts from a
fresh checkout and installation. The checked-in
`scripts/hosted-formal-input-manifest.json` is generated from the same parsed
JavaScript and selected-Quint closure, using the hosted shard, aggregate,
admission, generator, and classifier entries. It also includes the workflow and
the exact package, lock, workspace, npm, and selected Quint patch inputs that
determine the hosted command and installed tools. The classifier reads the
union of the exact base and head manifests so a removed input remains governed.
Missing, malformed, or stale projection evidence fails closed to formal
execution; `formal-input-policy.test.mjs` refuses a checked-in projection that
does not exactly regenerate from the authoritative closure.

The identity retains the consumed profile/toolchain projections and resolved
Node, pnpm, Quint, parser, Rust evaluator, Apalache, Java, observer Python, and
declared system library, locale, certificate, and runtime configuration roots.
Unknown or non-literal dynamic source imports, external or cyclic links,
unsupported native repository inputs, unsupported runtime configuration, and
unreadable inputs fail instead of permitting reuse. Implicit Apalache
configuration locations are observed even when absent; present unsupported
configurations are refused. Git HEAD/index/base changes alone do not change
formal identity. Independent candidate verification still applies. Automatic
MBT is temporarily excluded pending #363; formal reuse does not prove
application conformance.

Current allowances in [formal-gate-policy.mjs](../scripts/formal-gate-policy.mjs)
are 2,100 seconds for
formal acquisition and 30 seconds for final handoff validation. Acquisition
charges tool identification, observer setup, hashing, execution, evidence and
qualification to one decreasing allowance; phase caps do not restart it. The
local execution allowance is 1,800 seconds with a 1,850-second regression
ceiling, following the maintainer-authorized extension after the original
720-second attempt timed out. Hosted execution and regression remain 720/750
seconds. Both retain 5-second termination plus 2-second absence proof. See the
[local qualification scenario](scenarios/formal-reuse-local-qualification-budget.md)
for the observed cost and bounded allowance rationale. The 30-second final allowance follows a 7.333-second complete
snapshot probe and reserves the remainder for evidence reads and observer
drains; it is not the withdrawn 60-second final estimate. Final qualification measured
560.085 seconds fresh, a 4.329-second median across ten warm commands, and
2.629 seconds for final no-checker validation.

The optional standalone local formal command retains its 35-minute acquisition
and 0.5-minute final-validation bounds. Those bounds are outside the ordinary
local `check:all` budget. Choose a separate absolute deadline when invoking
`pnpm check:quint` manually. These are ceilings, not measured duration or
claimed savings from the opt-in policy.
Hosted formal verification has a 16-minute job deadline and reserves
210 seconds for checkout, setup, network, and final reporting.

The former `check:quint:changed` and `check:quint:final` aliases are retired.
Select local checks through [choosing checks](#choosing-checks).

## Safety and supply chain

CI installs with `--frozen-lockfile`; pnpm enforces strict peers, allowlisted
lifecycle scripts (`onlyBuiltDependencies`), and a 24-hour release delay unless
explicitly excepted. Install gitleaks before committing. The pre-commit hook
formats and lints staged code and scans staged secrets. `pnpm check:fast`
includes the workspace typecheck; repository verification runs the cycle check
for the frozen candidate. Unused-export analysis is an optional diagnostic.

Only exact diffs containing allowlisted documentation paths use the single
Ubuntu docs gate: whitespace, classifier controls, changed-commit secrets.
Everything else—including unreadable/empty diffs and manual/initial events—uses
the selected Node quality matrix, conservatively retaining all versions when change
evidence is unavailable. Independently, hosted formal shards run
only when the exact base-to-head paths intersect the generated hosted-formal
input projection. Unavailable base, head, diff, or projection evidence runs the
shards; a proved unaffected change skips them while the required aggregate job
reports a lightweight successful not-applicable result. The classifiers and
controls live in
[scripts/classify-docs-only-change.mjs](../scripts/classify-docs-only-change.mjs)
and its test; the generated projection is checked by
`formal-input-policy.test.mjs`.

## Changing the harness

Root manifests, compiler/lint/format/test/coverage configs, and CI/hooks define
quality policy. Explain threshold reductions and exclusions; generated-code
exclusions must not hide authored logic.

- TypeScript-Go (`@typescript/native`) is patched by `@effect/tsgo` during
  install. Oxlint owns source lint rules. Knip owns the repository value-export
  graph check.
- `scripts/unused-export-exceptions.json` names exact file and symbol pairs;
  `scripts/unused-file-exceptions.json` names exact files. New graph findings
  and stale exceptions fail. Public package entry points use Knip's entry-point
  semantics and do not need blanket exceptions. Review the policy and run its
  focused tests before changing either exception set.
- `oxlint-complexity-suppressions.json` counts violations per file, not per
  function/value. A new or increased entry records a concrete `justification`
  for keeping the function cohesive after independent decisions have been
  extracted. The optional complexity diagnostic can use the same base as changed-line
  coverage through `--candidate=<base sha>`;
  the base must be an ancestor strictly earlier than candidate `HEAD`. A
  self-resolving fallback tries the verified parent instead; the gate fails if
  no such commit is available. A direct check without
  `--candidate=<base sha>` treats existing entries as legacy while still
  rejecting count mismatches and malformed entries. Run
  `pnpm check:complexity:prune` after reductions; pruning preserves reviewed
  justifications for every retained entry.
  The resolved canonical SHA is also exported to changed-line coverage as
  `DALPH_COVERAGE_BASE_SHA`; an explicit all-zero candidate is invalid rather
  than a request to use fallback discovery.
- Production `floatingEffect` is an error. Test `multipleEffectProvide` and
  `unnecessaryEffectGen` stay off for deliberate Layer/generator composition;
  `lazyEffect` stays off for intentional lazy interfaces. New severity overrides
  require a concrete fixture/source shape and regression test, never broad
  warning suppression.
- `dalph/effect-class-inheritance-only` permits inheritance only for
  `Context.Service` tags and `Schema.TaggedError`; no per-class escapes.
- Duplication excludes tests and disposable prototypes; tooling/configuration
  remain scanned.


### Affected formal checks

Local candidate checks select complete Quint model families for model-source changes,
following imports through the existing parser. Each family retains its deep proof,
negative controls, witness checks and evaluator provenance. Unknown or unregistered
inputs and runtime changes without a model ownership mapping retain the full
portfolio. Hosted shard producers and their aggregate derive that same selection independently
from the exact bound Base/candidate range. Empty shards retain explicit reports;
missing commands, wrong families and missing negative verdicts cannot receive credit.
Both jobs install the pinned dependencies needed for import discovery. Explicit
`check:ci:formal` and `test:delivery-repeatability` retain the full diagnostics.
