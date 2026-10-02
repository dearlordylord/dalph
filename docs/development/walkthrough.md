# Disposable production walkthrough

[Development entry](../DEVELOPMENT.md) · [Navigation](../NAVIGATION.md)

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

The [direct remote publication specification for acceptance](../scenarios/direct-remote-publication.md)
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
- `HistoryAdvanced`, containing the exact Journal cursor after this invocation's
  bounded snapshot output budget is spent; the complete history remains in the
  Journal and is available through the read-only trace reader;
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

### Resume a retained remote publication

The Operator first reads the exact retained subject without starting delivery:

```bash
dalph publication-subjects github:OWNER/REPOSITORY#ISSUE --config /absolute/production.json > /absolute/subjects.json
```

For a resumable retained cause, form one durable request with a stable request
ID. Keep the same request file for redelivery:

```bash
jq --arg requestId 'operator-resume-1' \
  '{requestId:$requestId, responsibility:.subjects[0].responsibility, runId, schemaVersion:1}' \
  /absolute/subjects.json > /absolute/resume-request.json
dalph publication-resume github:OWNER/REPOSITORY#ISSUE \
  --config /absolute/production.json --request /absolute/resume-request.json
```

An exhausted publication instead needs an exact grant request with
`exhaustionAt` from `.subjects[0].retainedAt`, submitted through
`publication-grant` using the same flags. `PublicationResumeResult` or
`PublicationGrantResult` reports a durable control result. Only a later
`RunDisposition` and independent Git/tracker observations prove delivery.
Reusing the same request ID and body after response loss replays the same
receipt; a changed body is rejected. The command continues the selected Run
after a receipt and accepts the ordinary graceful Exit signals.

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
