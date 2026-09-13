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
- Keep outcomes, test mappings, revision, obstruction, and next experiment in
  the existing issue/specification/scenario. Link it from parent issues. Record
  deadlines with units and timezone; dependencies, reviews, and renamed
  checkpoints do not reset the parent budget or its accepted stop rule.
- Develop with `pnpm check:fast` and focused tests. Repair a failed stage and
  check affected behavior before rerunning the full gate. Reconcile the accepted scenario-to-test mapping
  and close [scoped reviews](CODE_REVIEW.md#review-closure) before the final gate.
  Freeze that candidate, then run `pnpm check:all` and applicable
  `pnpm check:quint`. Intermediate commits need no handoff ceremony; earlier
  passing stages are not a final green gate.
- Bounded commands use detached process groups so timeout cleanup can reach
  descendants. A timeout settles only after the direct child closes and the
  Unix process group is absent, or after a bounded explicit failure to prove
  absence. A nested detached command must opt into parent-signal relay; the
  issue-268 C4 runner does so for every child and Git lookup. Do not add an
  outer GNU `timeout` around `check:all`.
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
| `bootstrap:worktree` | Initialize repository submodules, install the frozen dependency graph, clean-build and validate production artifacts, then relink and verify generated workspace bins. |
| `check:artifacts` | Clean-build production packages in dependency order, then validate normal exports, declarations, bins, package boundaries, and packed contents. |
| `vitest run <test-file>` | Focused development check; `test` runs deterministic Vitest. |
| `typecheck` | Strict TypeScript-Go with Effect errors; suggestions remain nonfatal. |
| `typecheck:effect` | Dedicated strict Effect pass over the whole project; errors and warnings fail, JSON output. |
| `typecheck:effect:changed` | Effect pass over files changed against `origin/master`; falls back to the project pass above twelve changed files. |
| `lint:code` | Type-aware Oxlint, compatibility ESLint, dprint; warnings fail. File-scoped runs check the compatibility graph only with `--compatibility`. |
| `lint:changed` | Oxlint and dprint over files changed against `origin/master`; the compatibility pass belongs to repository runs. |
| `check:preflight --candidate=<base sha>` | Pre-freeze structural census: report all independent typecheck, Effect, lint/format, cycle, complexity, duplication, CI classifier, secrets and artifact failures. Runs no coverage, catalog, Lab or MBT suites. |
| `check:fast` | Development-loop tier: `typecheck`, `lint:changed`, `typecheck:effect:changed`. |
| `check:circular` | Reject runtime dependency cycles. |
| `check:complexity` | Reject increased per-file counts of production functions above complexity eight. |
| `check:duplicates` | Enforce the configured duplication budget. |
| `coverage:body` | Coverage suites and their verifiers, without taking an admission slot. |
| `test:coverage` | Enforce separate production/evaluation coverage and changed-line floors below; takes an admission slot. |
| `test:mbt` | Explicit manual Quint-connected conformance run; temporarily excluded from automatic verification pending [#363](https://github.com/dearlordylord/dalph/issues/363), which restores replay from pre-generated traces. |
| `test:issue-268-c4` | Run the accepted DS01–DS13 table and strict occurrence order in twenty consecutive fresh processes; stop at the first incomplete or divergent run. |
| `test:ci-change-classification` | Prove the docs-only CI allowlist and fail-closed classification. |
| `check:lab` | Reducer Lab typecheck, maintained-cassette smoke, build; no browser. |
| `check:lab:browser` | Host an ephemeral Lab, run Chromium against every maintained cassette, stop the host. |
| `qualify:codex` | Opt-in real app-server contract; prerequisites below. |
| `check:quint` | Deterministic, sampled, exhaustive model checks. Run after final relevant changes and before integration; during development only for model, conformance-adapter, or governed-behavior changes. |
| `check:quint:changed` | Report model-governed changes against `origin/master` and run `check:quint` for them; report and stop when there are none. |
| `check:secrets` | Scan Git history with gitleaks. |
| `gate:status <run-id>` | Read durable command results, unresolved custody and per-run logs/report paths without the previous terminal. Missing or malformed receipts cannot prove success. |
| `gate:reconcile <run-id>` | Close registration and prove every recorded writer group absent before clearing exact worktree/slot fences. Missing exits stay unproven. |
| `check:all --candidate=<base sha> --resume=<run-id>` | Reuse a contiguous proven full-gate prefix in the same worktree on identical monitored inputs; failed/unproven stage and remaining suffix execute normally. |
| `check:all` | Bounded handoff gate for a frozen candidate, including non-browser Lab; excludes MBT and exhaustive model checks. Local runs state the candidate with `--candidate=<base sha>` or `DALPH_FULL_GATE=1`; hosted runs need neither. |
| `check:ci` | Hosted gate; MBT remains excluded pending #363. |

### Heavy-gate admission

`check:all`, `check:ci:quality`, `test:coverage`, `check:quint`, and standalone
`check:preflight` take the exact worktree lock before one of two clone-wide slots.
A second writer in that worktree waits without consuming a spare slot; another
worktree can use it. Nested admitted commands validate the active run and register
beneath it rather than acquiring again. `DALPH_GATE_SLOT` alone grants no admission.
Set `DALPH_GATE_SLOTS` for another machine size. Development tiers remain unadmitted.

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
final green gate. Only `check:all --candidate=<base sha> --resume=<run-id>` enables
explicit prefix reuse; other commands retain normal execution.

Fresh full gates prepare the Effect diagnostics platform binary executable bit
before observing inputs; resume retains changed installation modes and refuses
reuse. Already prepared diagnostics binaries are left untouched. Fresh full gates also
ask pnpm to validate workspace dependencies before observation, failing on an
outdated installation rather than installing. Its consumed workspace-state file
remains hashed and watched; resume never refreshes it before checking identity.
Fresh and resumed full gates require Python 3 with Linux inotify. Before taking
the complete input snapshot, a per-run observer watches file inodes and directory
membership. It detects ordinary edit-and-restore and replacement, fails closed on
queue overflow, watch loss, setup/observer failure, and drains before final hashing.
It remains in the registered gate process group and exits on control-pipe EOF.
Transient memory-mapped mutation is outside the cooperative filesystem guarantee.

Guarded full-gate children use `GIT_OPTIONAL_LOCKS=0`, so read-only status checks
leave index stat-cache metadata untouched. Required Git writes still acquire
their locks, and actual index changes invalidate the observer. External Git
observation during a run must use the same optional-lock setting.

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
Original output counts consume the same 550-line budget as new stages.

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
malformed, or unpackaged artifacts fail the command. The preflight census checks
source structure before this operation; artifact validation stops at failed
prerequisites rather than interpreting absent build output. `check:all` runs
the same census once and starts qualification suites only when it passes.
Standalone preflight is evidence for repairs before freezing; the final full
gate repeats the census on its frozen candidate. Use `check:fast` during edits.

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
the repository. The Codex credential below is an OpenAI API project key allowed
to run the installed Codex CLI. Read both values without echoing them and keep
them in environment variables only:

```bash
read -r -s -p "Disposable-repository GitHub token: " GITHUB_TOKEN
printf '\n'
export GITHUB_TOKEN
read -r -s -p "Disposable Codex provider credential: " DALPH_CODEX_PROVIDER_CREDENTIAL
printf '\n'
export DALPH_CODEX_PROVIDER_CREDENTIAL
```

Do not put either value in shell history, a Git remote URL, the JSON document,
the repository, SQLite, or an evidence directory. Dalph reads exactly
`GITHUB_TOKEN` and `DALPH_CODEX_PROVIDER_CREDENTIAL` and redacts known
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

Create disjoint sibling locations under the disposable root. The two worktree
roots must not contain each other or the repository/private state. The Journal
database, evidence root, Codex state directory, and Integrator private-store
file must also be pairwise disjoint. Every path below is normalized and
absolute because it is derived from the absolute `mktemp` root.

```bash
export DALPH_DEMO_JOURNAL="${DALPH_DEMO_ROOT}/journal.sqlite"
export DALPH_DEMO_EVIDENCE="${DALPH_DEMO_ROOT}/evidence"
export DALPH_DEMO_CODEX_STATE="${DALPH_DEMO_ROOT}/codex-state"
export DALPH_DEMO_INTEGRATOR_STORE="${DALPH_DEMO_ROOT}/integrator-private.json"
export DALPH_DEMO_TASK_WORKTREES="${DALPH_DEMO_ROOT}/task-worktrees"
export DALPH_DEMO_INTEGRATOR_WORKTREES="${DALPH_DEMO_ROOT}/integrator-worktrees"
export DALPH_DEMO_CONFIG="${DALPH_DEMO_ROOT}/production.json"
mkdir -p \
  "${DALPH_DEMO_EVIDENCE}" \
  "${DALPH_DEMO_CODEX_STATE}" \
  "${DALPH_DEMO_TASK_WORKTREES}" \
  "${DALPH_DEMO_INTEGRATOR_WORKTREES}"
chmod 700 \
  "${DALPH_DEMO_ROOT}" \
  "${DALPH_DEMO_EVIDENCE}" \
  "${DALPH_DEMO_CODEX_STATE}" \
  "${DALPH_DEMO_TASK_WORKTREES}" \
  "${DALPH_DEMO_INTEGRATOR_WORKTREES}"

node --input-type=module <<'NODE'
import { writeFileSync } from "node:fs"

const requiredEnvironment = [
  "DALPH_CODEX_EXECUTABLE",
  "DALPH_DEMO_BASE_SHA",
  "DALPH_DEMO_CODEX_STATE",
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
  codexStateDirectory: process.env.DALPH_DEMO_CODEX_STATE,
  integratorCandidateWorktreeRoot: process.env.DALPH_DEMO_INTEGRATOR_WORKTREES,
  integratorPrivateStore: process.env.DALPH_DEMO_INTEGRATOR_STORE,
  activationInterval: "1 minute",
  failureCooldown: "5 seconds",
  codexExecutable: process.env.DALPH_CODEX_EXECUTABLE,
  codexClientName: "dalph-production-walkthrough",
  codexClientVersion: "1.0.0",
  codexProvider: "openai"
}

writeFileSync(process.env.DALPH_DEMO_CONFIG, `${JSON.stringify(configuration, null, 2)}\n`, {
  mode: 0o600
})
NODE
```

Those are all 19 non-secret
`ProductionRepositoryHostConfiguration` document fields. The CLI injects the
GitHub target parsed from the command and the two redacted credentials parsed
from the environment; adding `target`, `githubToken`, or
`codexProviderCredential` to the JSON is rejected as an excess property.

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
  the environment credential. Executor state stays under `codexStateDirectory`;
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
unset GITHUB_TOKEN DALPH_CODEX_PROVIDER_CREDENTIAL
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
- Successful stages share the stdout/stderr budget in `run-quality-gate.mjs`.
  Failed stages retain complete diagnostics and their exit status. Reduce
  reporter noise before raising the budget.

For a branch review, set the coverage base explicitly:

```sh
DALPH_COVERAGE_BASE_SHA="$(git merge-base origin/master HEAD)" pnpm test:coverage
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
status certifies coverage compliance or replaces `test:coverage`/`check:all`;
the production 99% and maintained-evaluation 75% floors remain unchanged.

### Final formal selection

A maintainer with a frozen candidate may run
`pnpm check:quint:final --candidate=<exact base sha>`. It prints the exact base,
HEAD and complete changed-path inventory, including committed, staged,
unstaged, renamed, deleted and untracked files. Only the explicit development
and presentation documentation and exact console-output helper allowlist in
[scripts/final-quint-selection.mjs](../scripts/final-quint-selection.mjs) can
skip exhaustive models, with a visible reason. Governing scenarios, invariants,
formal documentation, runtime, models, adapters, other tooling, dependencies,
configuration, mixed or unknown paths run the unchanged `check:quint` command.
An empty diff or unreadable/inexact comparison also runs the full command.
Only `scripts/quality-output-budget.mjs` and its exact test path are tooling
exemptions: they count quality/preflight console lines against a supplied limit,
and neither participates in `check:quint` or hosted formal dispatch. Their
callers, all runners, CI classifiers and output-limit policy remain governed;
a mixed helper/formal change runs the full command. Existing development selection and hosted
full verification remain unchanged; this final policy does not use the narrow
development classifier as evidence that runtime changes are unrelated.

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
