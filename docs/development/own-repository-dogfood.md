# First own-repository Dogfood run

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

The Operator runs the shipped production CLI locally against
`dearlordylord/dalph` and supervises one delivery to its `master` branch.
This guide applies the [#308 readiness ledger](https://github.com/dearlordylord/dalph/issues/308)
through the ordinary production path. It does not prove a successful Dogfood
run. Keep the [disposable walkthrough](walkthrough.md#disposable-production-repository-walkthrough)
for disposable exercises; its repository deletion procedure does not apply here.

## Preconditions

Before invoking Dalph, the Operator confirms:

- One newly selected independent, low-risk leaf has no blockers or subissues,
  foreign claim, known implementation, prior task worktree, retained candidate,
  or mixed historical branch. Read the actual GitHub graph and claims, not just
  labels or an old issue description.
- The issue has accepted chronological scenarios and test mappings, or explicitly
  changes no runtime behavior. Its change is small, reviewable, and recoverable.
- The source SHA and target Base SHA are exact commits; the source and target
  `master` worktrees are clean. The target Base matches the hosted `master`
  head immediately before launch. Source and target may have different SHAs;
  record both and build only the pinned source.
- Capacity is one and no other coordinator owns the target Git common directory.
  Use a dedicated clone, not a worktree of a concurrently coordinated clone.
  The production lock remains authoritative; do not bypass an ownership failure.
- Dedicated Journal, evidence, executor-private, Integrator-private, and both
  worktree paths are absolute, writable, and disjoint as required by the
  [host configuration contract](../scenarios/production-host-configuration.md).
- The Operator is present, has ordinary Codex login, authorized GitHub issue
  read/write access, and Git authentication with permission to publish to
  `dearlordylord/dalph` `master`. Branch rules and normal checks still apply.

## Pin source, target, and non-secret configuration

Use Bash and stop on a failed command. Replace the three input values below
with an approved clean source checkout, its exact source SHA, and the fresh
issue number. The temporary root must remain available throughout recovery;
choose a durable absolute parent instead of `/tmp` if the host purges it.
Git SSH authentication is separate from `GITHUB_TOKEN`; neither credential
belongs in the configuration, remote URL, logs, or evidence.

```bash
set -euo pipefail
export DALPH_SOURCE=/absolute/path/to/pinned/dalph
export DALPH_SOURCE_SHA=REPLACE_WITH_40_HEX_SOURCE_SHA
export DALPH_ISSUE=REPLACE_WITH_FRESH_ISSUE_NUMBER
read -r -s -p "Dalph GitHub issue token: " GITHUB_TOKEN
printf '\n'
export GITHUB_TOKEN

export DALPH_DOGFOOD_ROOT
DALPH_DOGFOOD_ROOT="$(mktemp -d /tmp/dalph-ownrepo.XXXXXX)"
chmod 700 "${DALPH_DOGFOOD_ROOT}"
export DALPH_TARGET="${DALPH_DOGFOOD_ROOT}/repository"
git clone --branch master git@github.com:dearlordylord/dalph.git "${DALPH_TARGET}"
test "$(git -C "${DALPH_TARGET}" symbolic-ref HEAD)" = refs/heads/master
test -z "$(git -C "${DALPH_TARGET}" status --porcelain)"
export DALPH_BASE_SHA DALPH_COMMON_DIRECTORY
DALPH_BASE_SHA="$(git -C "${DALPH_TARGET}" rev-parse 'refs/heads/master^{commit}')"
DALPH_COMMON_DIRECTORY="$(git -C "${DALPH_TARGET}" rev-parse --path-format=absolute --git-common-dir)"
test "${DALPH_COMMON_DIRECTORY}" = "${DALPH_TARGET}/.git"

cd "${DALPH_SOURCE}"
test "$(git rev-parse HEAD)" = "${DALPH_SOURCE_SHA}"
test -z "$(git status --porcelain)"
pnpm install --frozen-lockfile
pnpm build
test -z "$(git status --porcelain)"
export DALPH_EXECUTABLE="${DALPH_SOURCE}/packages/dalph/dist/bin/dalph.js"
export DALPH_CODEX_EXECUTABLE="${DALPH_SOURCE}/node_modules/.bin/codex"
test -f "${DALPH_EXECUTABLE}"
test -x "${DALPH_CODEX_EXECUTABLE}"
```

Configure Git commit identity in the dedicated target clone if it is not
already available. Keep the built source unchanged while the Run uses it;
Dalph creates task and Integrator worktrees from the target clone.
Record expected build/run duration and a wall-clock stop time before a step
expected to exceed one minute; at the run stop time request graceful Exit,
retain evidence, and identify the next diagnostic before another invocation.

The following outline uses the shipped
[production-host schema](../../packages/dalph/src/application/production-configuration.ts)
and [CLI configuration loader](../../packages/dalph/src/application/production-cli.ts).
It preserves the ordinary executor selection and supplies no model override.

```bash
export DALPH_CONFIG="${DALPH_DOGFOOD_ROOT}/production.json"
mkdir -p "${DALPH_DOGFOOD_ROOT}"/{evidence,codex-private,task-worktrees,integrator-worktrees}
node --input-type=module <<'NODE'
import { writeFileSync } from "node:fs"
const env = process.env
const root = env.DALPH_DOGFOOD_ROOT
const configuration = {
  repository: env.DALPH_TARGET,
  commonDirectory: env.DALPH_COMMON_DIRECTORY,
  integrationRef: "refs/heads/master",
  remotePublicationTarget: {
    endpoint: "git@github.com:dearlordylord/dalph.git",
    branch: "refs/heads/master"
  },
  plannedAttemptBaseSha: env.DALPH_BASE_SHA,
  plannedAttemptExecutor: "codex:production",
  claimOwner: "dalph:own-repository-dogfood",
  taskWorkCapacity: 1,
  journalDatabase: `${root}/journal.sqlite`,
  evidenceStoreRoot: `${root}/evidence`,
  plannedAttemptWorktreeRoot: `${root}/task-worktrees`,
  codexExecutorPrivateStateDirectory: `${root}/codex-private`,
  integratorCandidateWorktreeRoot: `${root}/integrator-worktrees`,
  integratorPrivateStore: `${root}/integrator-private.json`,
  activationInterval: "1 minute",
  failureCooldown: "5 seconds",
  codexExecutable: env.DALPH_CODEX_EXECUTABLE,
  codexClientName: "dalph-own-repository-dogfood",
  codexClientVersion: "1.0.0"
}
writeFileSync(env.DALPH_CONFIG, `${JSON.stringify(configuration, null, 2)}\n`, { mode: 0o600 })
writeFileSync(`${root}/pins.json`, `${JSON.stringify({
  sourceSha: env.DALPH_SOURCE_SHA, executable: env.DALPH_EXECUTABLE,
  targetBaseSha: env.DALPH_BASE_SHA, issue: env.DALPH_ISSUE,
  configuration: env.DALPH_CONFIG, evidence: configuration.evidenceStoreRoot
}, null, 2)}\n`, { mode: 0o600 })
NODE
```

The CLI injects the target and environment-only `GITHUB_TOKEN`; do not add
`target` or `githubToken` to JSON. Do not copy Codex authentication into the
root. Check the selected issue and no-other-coordinator preconditions again,
and verify the hosted Base before launch:

```bash
test "$(git ls-remote git@github.com:dearlordylord/dalph.git refs/heads/master | cut -f1)" = "${DALPH_BASE_SHA}"
GH_TOKEN="${GITHUB_TOKEN}" gh issue view "${DALPH_ISSUE}" \
  --repo dearlordylord/dalph --json number,url,state,body,labels
```

If a precondition is false, preserve the observations and name the existing
owner in #308; do not bypass the boundary or add special Dogfood behavior.

## Invoke once and observe public records

Keep a second terminal available to read the output while the Operator stays
with the foreground command. This records stdout, stderr, and the actual
process exit status without a pipeline masking it:

```bash
if node "${DALPH_EXECUTABLE}" \
  run "github:dearlordylord/dalph#${DALPH_ISSUE}" \
  --production --config "${DALPH_CONFIG}" \
  > "${DALPH_DOGFOOD_ROOT}/public.ndjson" \
  2> "${DALPH_DOGFOOD_ROOT}/stderr.log"
then DALPH_PROCESS_STATUS=0
else DALPH_PROCESS_STATUS=$?
fi
printf '%s\n' "${DALPH_PROCESS_STATUS}" > "${DALPH_DOGFOOD_ROOT}/process-status.txt"
```

In the second terminal, use `tail -f /absolute/path/to/root/public.ndjson`.
The [public output and Exit reference](walkthrough.md#4-run-and-read-the-public-output)
defines version-1 records: `RunSelected` supplies the exact RunId and
`Allocated`/`Recovered` selection; `CurrentStatus` is passive current status;
`HistoricalSnapshot` carries an immutable snapshot and Journal cursor;
`RunDisposition` reports proven Run termination. Preserve all records, including
`Failure`. Empty/closed status or a process exit alone does not prove delivery.

Ctrl-C in the foreground terminal requests ordinary graceful application Exit.
`ApplicationExitDisposition` reports that shutdown's `Succeeded`, `Failed`, or
`TimedOut` result, separately from Run completion. An abrupt death or missing
Exit record proves no graceful shutdown. See the
[existing recovery procedure](walkthrough.md#5-observe-graceful-exit-and-demonstrate-unfinished-run-recovery):
only an actually unfinished Journal Run yields `Recovered` with the same RunId
on an identical invocation. Do not fabricate recovery or rerun task commands.

## Verify delivery and retain the exact evidence

After termination, independently observe Git and GitHub:

```bash
git ls-remote git@github.com:dearlordylord/dalph.git refs/heads/master \
  > "${DALPH_DOGFOOD_ROOT}/hosted-head.txt"
git -C "${DALPH_TARGET}" rev-parse refs/heads/master \
  > "${DALPH_DOGFOOD_ROOT}/local-head.txt"
GH_TOKEN="${GITHUB_TOKEN}" gh issue view "${DALPH_ISSUE}" \
  --repo dearlordylord/dalph --json number,url,state,closedAt,labels \
  > "${DALPH_DOGFOOD_ROOT}/issue-after.json"
```

Compare the observed hosted and local heads with the exact published integrated
commit in the Run evidence, which can differ from the executor's accepted
commit. If the hosted branch advanced again, fetch it and verify the published
commit's ancestry; do not declare equality or overwrite the newer head.
GitHub must independently show issue closure and removal of the exact claim;
closure alone does not prove publication, cleanup, or normal termination.
Apply the [publication contract](../scenarios/direct-remote-publication.md)
and require normal Run termination and settled responsibilities.

Preserve the complete root, Journal (including SQLite sidecars), evidence,
private stores, target clone, refs, and worktrees after failed or ambiguous
Runs. Preserve stopped-process/custody observations before recovery; do not
manually remove labels, rows, branches, or individual files, retry throttled
mutations, or start a competing coordinator. An unreadable authority, stale
head, foreign claim, failed check, or unavailable executor is a retained failure,
not permission to bypass the ordinary reconciliation path.

Link a redacted evidence index back to
[#308](https://github.com/dearlordylord/dalph/issues/308): observation date/time,
source/binary SHA and locator, target Base, non-secret configuration, exact
RunId/TaskId/AttemptId, accepted and integrated/published commits, publication
and promotion receipts, GitHub completion/claim observations, cleanup and
termination evidence, public records, process/Exit result, and scenario-to-check
handoff. Keep raw private stores, transcripts, credentials, and sensitive local
paths private; link access-controlled retained artifacts where needed. Name any
missing proof and the next discriminating action. This guide's existence and
its docs check are not successful own-repository delivery evidence.

## Documentation acceptance mapping

The Operator can find a pinned, isolated, supervised own-repository procedure
from development navigation. This documentation-only scenario maps to
`pnpm check:docs` for maintained links and documentation structure; manual
review checks CLI/schema consistency and the #308 preconditions. The focused
check cannot validate provider behavior or prove a real Run. Only Markdown
changes: no runtime, commands, model selection, gate requirements, or recovery
semantics change, so broader runtime/model gates add no relevant coverage.
