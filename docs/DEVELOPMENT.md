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
- **Runtime/model behavior changes:** use focused acceptance tests and `pnpm check:fast`
  during development; run the full gate before integration. Model or conformance
  changes also require adequacy review and a negative control.
- **Early task-attempt baseline:** after focused checks settle for an attempt, run
  `pnpm check:baseline` before expensive formal or delivery-repeatability work. It
  runs the clone-wide lint census followed by the maintained Reducer Lab evaluation;
  the complete command takes exact-worktree admission, and it does not expand
  `check:fast` or replace the frozen-candidate gate. This is qualification tooling
  only and changes no Dalph runtime behavior.
- **Shared qualification changes:** run the full gate before integration when
  changing shared build/dependency configuration, gate orchestration, or validity of
  qualification evidence. Uncertain impact requires investigation, not exemption.

Accepted task requirements still apply. Handoffs name the affected scenarios,
checks run or unrun, and why broader checks add no relevant coverage. Unused-code
removal needs consumer evidence and affected type/build checks; changed behavior
follows the runtime rule.
Hosted CI keeps its documentation-only quality classification. Its separate
formal classification compares the exact event base-to-head paths with the
generated hosted-formal input projection. That projection follows executable
model-conformance adapters through their TypeScript-resolved repository import
closure; the non-model workspace source-resolution control remains outside it. Unaffected changes retain the
required formal check as a lightweight successful not-applicable result.

When required, freeze the candidate and run
`pnpm check:all --candidate=<base-sha>` with the existing exact-base,
acknowledgement, admission, and resume rules. Never manually skip stages or
claim incomplete evidence as qualification. The local runner compares that Base
with the exact candidate HEAD using the checked-in formal-input projection. An
affected candidate obtains complete formal verification through fresh execution
or guarded reuse; an unaffected candidate records an explicit not-applicable
disposition and starts zero Quint checkers or servers. Missing or ambiguous Git
or projection evidence fails before qualification. A separate repeated
`check:quint` is unnecessary. Use focused model/adapter checks during development;
reserve `pnpm check:quint --force` for fresh reproduction or timing.

Compatibility lint and the project-wide Effect pass build the entire program;
use repository commands, not per-file substitutes.

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
| `typecheck` | Strict TypeScript-Go plus Effect errors/warnings; suggestions remain nonfatal. |
| `typecheck:effect` | Optional standalone Effect diagnostics; errors/warnings fail, JSON output. |
| `typecheck:effect:changed` | Effect pass over files changed against `DALPH_DIAGNOSTICS_BASE`, or the explicitly reported moving `origin/master` fallback; falls back to the project pass above twelve changed files. |
| `lint:code` | Type-aware Oxlint, compatibility ESLint, dprint; warnings fail. File-scoped runs check the compatibility graph only with `--compatibility`. |
| `lint:changed` | Oxlint, compatibility ESLint, and dprint over files changed against `DALPH_DIAGNOSTICS_BASE`, or the explicitly reported moving `origin/master` fallback; compatibility ESLint receives only the changed TypeScript files. |
| `check:preflight --candidate=<base sha>` | Pre-freeze census: report typecheck (including Effect), lint/format, maintained Reducer Lab, cycle, complexity, duplication, CI classifier, secrets and artifact failures. Runs no coverage, catalog or MBT suites. |
| `check:fast` | Development-loop tier: `typecheck`, `lint:changed`. A planned task attempt sets `DALPH_DIAGNOSTICS_BASE` to its exact Base SHA. |
| `check:baseline` | Early task-attempt baseline: run the clone-wide lint census, then the maintained Reducer Lab evaluation. Use after focused edits settle and before expensive formal or delivery-repeatability work; this does not change `check:fast`. |
| `check:circular` | Reject runtime dependency cycles. |
| `check:complexity` | Reject increased per-file counts of production functions above complexity eight. |
| `check:duplicates` | Enforce the configured duplication budget. |
| `coverage:body` | Coverage suites and their verifiers, without taking an admission slot. |
| `test` | Enforce separate production/evaluation coverage and changed-line floors below; takes an admission slot. |
| `test:mbt` | Explicit manual Quint-connected conformance run; temporarily excluded from automatic verification pending [#363](https://github.com/dearlordylord/dalph/issues/363), which restores replay from pre-generated traces. |
| `test:delivery-repeatability` | Run the accepted DS01–DS13 delivery checkpoint table and strict occurrence order in twenty consecutive fresh processes; stop at the first incomplete or divergent run. This is the dedicated delivery-repeatability qualification command. |
| `test:delivery-repeatability:warm` | Reuse one persistent Vitest worker for twenty target executions, then run a three-process fresh sample for process-isolation evidence. Warm success is a performance/cache signal and does not replace the fresh acceptance path. |
| `test:ci-change-classification` | Prove the docs-only CI allowlist and fail-closed classification. |

| `check:lab` | Reducer Lab typecheck, maintained-cassette smoke, build; no browser. |
| `check:lab:browser` | Host an ephemeral Lab, run Chromium against every maintained cassette, stop the host. |
| `qualify:codex` | Opt-in real app-server contract; prerequisites below. |
| `check:quint` | Obtains the complete required formal profile through guarded local execution or applicable recorded success. It reports which occurred and names the original evidence. `--force` requests fresh execution under the same guards. |
| `check:secrets` | Scan Git history with gitleaks. |
| `gate:status <run-id>` | Read durable command results, unresolved custody and per-run logs/report paths without the previous terminal. Missing or malformed receipts cannot prove success. |
| `gate:reconcile <run-id>` | Close registration and prove every recorded writer group absent before clearing exact worktree/slot fences. Missing exits stay unproven. |
| `check:all --candidate=<base sha> --resume=<run-id>` | Reuse a contiguous proven full-gate prefix in the same worktree on identical monitored inputs; failed/unproven stage and remaining suffix execute normally. |
| `check:all` | Complete qualification when required by [choosing checks](#choosing-checks), for a frozen candidate. It reports all ordinary preflight failures together, then starts no formal or application qualification when any preflight check failed. An interruption, unproven surviving process, or runner defect stops the census immediately. The command classifies formal relevance against the declared candidate Base, runs or reuses the complete formal workflow once when affected, records not applicable without formal processes when unaffected, runs the maintained non-browser Lab before application checks, and runs those application checks; automatic MBT is excluded pending #363. Local runs state the candidate with `--candidate=<base sha>` or `DALPH_FULL_GATE=1`; hosted runs need neither. |
| `check:ci` | Hosted gate; MBT remains excluded pending #363. |

When a developer changes a TypeScript or TSX file, `check:fast` passes only the
changed TypeScript/TSX files—and no unrelated source file—to compatibility
ESLint, so rules such as `functional/immutable-data` fail during the edit loop.
This is an accepted trade-off: hosted and frozen-candidate verification run
whole-project compatibility ESLint, so a whole-program or graph-only
compatibility finding can surface at candidate qualification rather than during
the edit loop. This scope applies to compatibility ESLint only;
`typecheck:effect:changed` remains an optional JSON diagnostic command and retains its
documented fallback to the whole-project pass when more than twelve files
change. When the changed set has no compatible TypeScript/TSX file, the
compatibility process is not started.

For a planned task attempt, pin the immutable Base SHA already supplied by the
attempt context:

```sh
DALPH_DIAGNOSTICS_BASE="<planned Base SHA>" pnpm check:fast
```

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
to inspect evidence, then `gate:reconcile <run-id>` after writers stop. Reconciliation
takes worktree, exact slot, then registration locks; closes registration; checks the
complete spawn inventory; and clears fences only after every observed group is
positively absent. Old nested launches are refused after closure. An unobserved
spawn intent, corrupt inventory, or live/unprovable group stays fenced. Group absence
never supplies a missing exit code. There is no age/PID shortcut or force-clear.

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
final green gate. `check:all --candidate=<base sha> --resume=<run-id>` still
resumes only a contiguous proven application-gate prefix. It recomputes formal
relevance for the same exact Base and candidate HEAD. An affected candidate's
formal profile has its own guarded local success record: a missing or stale
record executes the profile, while an applicable record can be reused and names
its original evidence. An unaffected candidate records not applicable without
reading that record or starting a checker/server. `pnpm check:quint --force` requests fresh formal reproduction or
timing. Reuse never replaces model-adequacy review. Automatic MBT is temporarily
excluded pending #363; `test:mbt` remains an explicit manual command.

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

Fresh dependency setup prepares the patched TypeScript-Go binary before full-gate
input observation; resume retains changed installation modes and refuses reuse.
Already prepared binaries are left untouched. Fresh full gates also
ask pnpm to validate workspace dependencies before observation, failing on an
outdated installation rather than installing. Its consumed workspace-state file
remains hashed and watched; resume never refreshes it before checking identity.
Fresh and resumed full gates require Python 3 with Linux inotify. Before taking
the complete input snapshot, a per-run observer watches file inodes and directory
membership. It detects ordinary edit-and-restore and replacement, fails closed on
queue overflow, watch loss, setup/observer failure, and drains before final hashing.
It remains in the registered gate process group and exits on control-pipe EOF.
Transient memory-mapped mutation is outside the cooperative filesystem guarantee.
Metadata-only events on a path that is only a strict ancestor of an input do not
invalidate the run by themselves. Membership, rename, and replacement events on
the same path still invalidate, and the final comparison rejects any lasting
change that alters resolved identity.

Guarded full-gate children use `GIT_OPTIONAL_LOCKS=0`, so read-only status checks
leave index stat-cache metadata untouched. Required Git writes still acquire
their locks, and actual index changes invalidate the observer. Only explicitly
constructed internal Git coordination lock paths—the candidate's `index.lock`,
the shared `packed-refs.lock`, and the lock paths for its exact symbolic
selected-ref chain—may be treated as transient coordination when their
create/remove pair is observed. No `HEAD.lock` or arbitrary `*.lock` path is
exempt. A real
same-batch index/ref event remains dirty even when a lock is created and
removed; a persistent internal lock fails the final authoritative snapshot.
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
the index, and other Git authority files remain observed.
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
| A real selected-ref or index mutation remains dirty, including an index mutation followed by a transient index lock | `scripts/gate-resume-inputs.test.mjs`: `bound candidate history refuses transient selected ref writes`; `bound candidate history refuses transient index writes`; `a transient index lock cannot hide a real candidate index mutation` |
| An internally constructed `index.lock` persists through the final authoritative snapshot | `scripts/gate-resume-inputs.test.mjs`: `a persistent index lock fails the final authoritative snapshot` |
| A user-configured external authority file named `*.lock` is edited and restored | `scripts/gate-resume-inputs.test.mjs`: `candidate history observes external excludes ending in .lock edit and restore` |

Reuse requires identical HEAD, conflict-free semantic index, working/untracked
bytes and modes, ignored configuration, actual installed dependency and resolved
tool bytes/link targets, effective environment and normalized logical invocation.
Only per-run transport and pnpm invocation bookkeeping are excluded from environment
identity; behavioral settings such as `DALPH_DIAGNOSTICS_BASE` remain inputs.
There is no metadata hash cache. Missing stronger identity or observer proof,
unknown inputs, another worktree/base/mode, or unresolved custody refuses reuse.

Stages have stable IDs and exact bounded contracts. Reuse stops at the first failed
or unproven stage even if later census checks passed. A passed negative test may
retain required failing children; its entire terminal subtree must remain valid.
Package/Lab `dist` trees and consumed TypeScript build information require complete
membership/mode/content proof and remain watched while credited. Missing or altered
artifacts refuse reuse. Vite/Vitest `.vite` result/transform caches and `.vite-temp` newly bundled config
modules at root and
workspace package `node_modules` are discarded before observation on both fresh
and resumed runs, then excluded as disposable outputs. They never receive stage
credit. Admitted full/preflight lint passes dprint `--incremental=false`; its
explicit invocation and environment contract permit only incremental result and
lock bookkeeping to be excluded. Formatter plugin code and metadata remain inputs.
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
the same census once. After successful preflight, an affected candidate executes
or reuses the complete formal profile before expensive qualification, keeps the
external-tool observation through the final application stage, and performs
final no-checker applicability validation before handoff success. An unaffected
candidate records its exact classification and starts no formal process. It starts application
qualification only when its prerequisites pass.
Standalone preflight is evidence for repairs before freezing; the final full
gate repeats the census on its frozen candidate. The shared census includes the
maintained Reducer Lab immediately after the clone-wide lint census, so a Lab
failure prevents formal and application qualification. Use `check:fast` during
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
Install lifecycle scripts are not the artifact correctness boundary: pnpm can
deliberately [disable them](https://pnpm.io/10.x/cli/install#--ignore-scripts).

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
```

`DALPH_DEMO_BASE_SHA` is the exact planned Base SHA, not a branch name. The
configured `integrationRef` is the local `refs/heads/main`; Dalph updates that
local ref and does not promise to push it to GitHub. The common directory is
also the exact OS-backed coordinator-lock target. The Codex executable is the
built workspace dependency, not an inferred executable from a target
repository.

#### 3. Write the complete non-secret configuration

The [direct remote publication specification for acceptance](scenarios/direct-remote-publication.md)
adds an explicit remote/ref and publication proof before task completion. The
normal path uses Git's exact push acknowledgement; interrupted or ambiguous
paths reconcile as specified. This contract is not implemented by this walkthrough.
Future dogfood qualification must capture the actual remote head containing the
integrated commit; a local head and closed GitHub issue alone cannot prove it.

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
  "DALPH_DEMO_TASK_WORKTREES"
]

for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`missing walkthrough environment: ${name}`)
}

const configuration = {
  repository: process.env.DALPH_DEMO_LOCAL_REPOSITORY,
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
  an Integrator candidate worktree/commit, and an atomic update of the configured
  local `refs/heads/main`. It does not treat GitHub as Git lineage authority and
  does not promise a remote push.
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
qualification evidence. In the disposable live repository, report
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
built CLI do not belong in automatic V8 coverage: the child process is not
attributed to the parent report. When focused boundary tests plus the actual
protected qualification already own their acceptance facts, remove a redundant
built-child simulation instead of moving it into another automatic lane. The
focused tests remain boundary evidence, not a substitute for composed runtime
proof; the actual protected #307 run owns the final shipped-entry composition.

Before submitting another hosted candidate after a failure, reproduce the
failure with the smallest named check that owns that boundary. Run cheap
structural diagnostics before resource-sensitive acceptance checks; the gate
manifest enforces its complete preflight prefix before qualification and
coverage. `scripts/recorded-catalog-gate.test.ts` proves that ordering and the
unchanged four-worker V8 policy.

- Enforce 95% production and 75% maintained-evaluation coverage independently
  for statements, branches, functions, lines, and changed executable lines.
  Surplus in one bracket cannot cover the other. Maintained cassettes and
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
the production 95% and maintained-evaluation 75% floors remain unchanged.

### Formal reuse and handoff

The local formal command uses one complete profile and one guarded applicability
boundary. The full gate obtains this result after successful preflight.
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

The local stage inventory is 30 minutes of preflight plus 51 minutes of
application qualification, now plus 35 minutes of formal acquisition and
0.5 minutes of final validation: 116.5 minutes before existing
quality setup and termination overhead. This fits the existing 24-hour admitted
command limit. These are ceilings, not measured duration or claimed savings.
Hosted formal verification has a 16-minute job deadline and reserves
210 seconds for checkout, setup, network, and final reporting.

The former `check:quint:changed` and `check:quint:final` aliases are retired.
Select local checks through [choosing checks](#choosing-checks).

## Safety and supply chain

CI installs with `--frozen-lockfile`; pnpm enforces strict peers, allowlisted
lifecycle scripts (`onlyBuiltDependencies`), and a 24-hour release delay unless
explicitly excepted. Install gitleaks before committing. The pre-commit hook
formats and lints staged code and scans staged secrets. `pnpm check:fast`
includes the workspace typecheck; repository verification runs the compatibility
graph and cycle check for the frozen candidate.

Only exact diffs containing allowlisted documentation paths use the single
Ubuntu docs gate: whitespace, classifier controls, changed-commit secrets.
Everything else—including unreadable/empty diffs and manual/initial events—uses
the comprehensive Node quality matrix. Independently, hosted formal shards run
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
  install. Oxlint owns overlapping lint rules; `eslint.compat.config.mjs` owns
  the remaining functional and whole-project unused-export rules.
- `eslint-functional-suppressions.json` is a finite file/rule/count baseline,
  not permission for new findings, test throws, or unused exports. Public
  package entry points are the blanket export exceptions. Review policy and
  run focused fixture tests before changing it. After removals, use ESLint
  `--prune-suppressions` with the explicit discovered file list and inspect the
  diff; changed files do not automatically deserve new exceptions.
- `oxlint-complexity-suppressions.json` counts violations per file, not per
  function/value. A new or increased entry records a concrete `justification`
  for keeping the function cohesive after independent decisions have been
  extracted. Every full gate resolves the same base used by changed-line
  coverage—from its explicit candidate, `DALPH_COVERAGE_BASE_SHA`, the merge
  base with `origin/master`, or `HEAD^`—and passes that exact SHA to this check;
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
