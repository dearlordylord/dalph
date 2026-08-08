# HerdOS crash experiment specification

**Status:** design only; no experiment has run. Every destructive fault case is
blocked by the preflight and harness gates in this document.

**Product revision:** HerdOS
[`afb8e527fee2f9081963310bad1645bdc2806d68`](https://github.com/herd-os/herd/tree/afb8e527fee2f9081963310bad1645bdc2806d68).

**Common protocol:** `research/control-plane-crash-experiment-protocol.md`.
The source findings that motivate these checks are in
`research/cards/herdos-reliability-architecture.md`.

This document changes no Dalph or HerdOS runtime behavior. It specifies a
future isolated experiment. It does not authorize a real GitHub repository,
Actions runner, provider account, or model invocation.

## 1. Execution decision and evidence boundary

Do **not** run the production `herd dispatch`, `herd worker`, `herd integrator`,
or `herd monitor` commands for this experiment at the pinned revision.
Production constructs a GitHub client that requires `GITHUB_TOKEN`, `GH_TOKEN`,
or the logged-in `gh` CLI and creates the standard GitHub API client without a
configurable API base URL
([client construction](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/github/client.go#L31-L65)).
The worker command is also explicitly intended for GitHub Actions and creates
that real client before invoking the worker slice
([worker command](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/worker.go#L25-L70)).
Supplying a real token or relying on a user's `gh auth` state would violate the
common protocol.

The repository has good seams for a safe source-level qualification:

- `worker`, `integrator`, and `monitor` accept a `platform.Platform`;
- worker and review paths accept an `agent.Agent`;
- local Git is exercised through disposable repositories in tests; and
- provider adapters already use fake executable scripts in tests
  ([platform boundary](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/platform.go#L21-L105),
  [worker boundary](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L149-L188),
  [fake Codex executable](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/codex/codex_test.go#L14-L79)).

Those fakes are test-local and in-memory. No shipped, persistent fake GitHub
service or crash supervisor can restart a process against the same fake
issues, workflow runs, comments, PRs, and refs. Tests can redirect an internal
GitHub client to `httptest.Server`, but the helper is test-private and the
production constructor does not expose that seam
([test client](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/github/testhelper_test.go#L11-L28)).

Therefore:

1. The existing unit suite and individual local Git/provider tests can run at
   this pin after ordinary dependency and credential preflight. They are
   qualification evidence, not C0-C9 crash results.
2. Source-level C0-C9 runs require a reviewed, default-off experiment harness
   in a disposable copy of the pinned source. The harness must persist a fake
   platform under the experiment root and expose deterministic fault barriers.
3. A deployed GitHub Actions result remains unsupported unless a later
   protocol provides a fully isolated GitHub-compatible service and runner.
   This experiment must not create a temporary repository in a real account.

All future results must be labeled **source-level harness**, never “GitHub
Actions proven.”

## 2. Safe harness required before any fault run

Because Go's `internal` import rule prevents an external program from importing
HerdOS's internal packages, the harness must be a test-only command or test
package placed in a **disposable copy** of the pinned repository under
`EXP_ROOT`. It must not modify `.references/herd` or Dalph's Git common
directory.

CLI dispatch helpers are unexported. A dispatch fault harness must therefore be
a build-tagged helper in `internal/cli` (or a package-local helper test
subprocess), while worker, integrator, and monitor operations can call their
exported slice entry points. It must not add a production export merely for the
experiment.

The harness is not present at this pin. A future reviewed implementation must:

- use a build tag such as `herd_crash_experiment` and refuse to start unless an
  experiment UUID, canonical root, and owner manifest agree;
- implement every `platform.Platform` service with durable fixture state under
  `EXP_ROOT/platform-state`;
- persist each mutation by writing and syncing a new file, renaming it into
  place, syncing its directory, and appending a sequence-numbered operation
  record;
- model GitHub-shaped issues, labels, milestones, workflow runs and inputs,
  comments, pull requests, checks, runners, and repository refs, without
  opening a network socket;
- invoke the real pinned `worker.Exec`, `integrator.Consolidate`,
  `integrator.Advance`, `integrator.MergeApproved`, `integrator.CleanupClosed`,
  and `monitor.Patrol` functions for the path under test;
- allow an operation to persist its effect, acknowledge a named barrier to the
  supervisor, and then block before returning, so applied-response-lost cases
  are deterministic;
- implement a fake `agent.Agent` whose `Execute` starts the external fake-agent
  process in its own recorded process group;
- expose no general shell-evaluation field and accept only enumerated scenario
  names and canonical in-root paths; and
- write all fault-barrier acknowledgements to an append-only, synced file under
  the root before waiting on a local FIFO.

The harness's persistent platform is a model of the `platform.Platform`
contract, not a GitHub emulator. It can establish how HerdOS reacts to the
service results and durable facts represented by that interface. It cannot
establish GitHub delivery timing, Actions checkout retention, job cancellation,
API consistency, or log retention.

No fault case may run until the harness has its own tests for:

- restart with identical state and monotonically increasing operation
  sequence;
- apply-then-block and apply-then-error behavior for every injected API call;
- crash during platform-state persistence;
- duplicate dispatch/run-input representation;
- bare-remote ref updates and Git fault shims;
- PID reuse protection;
- FIFO timeout and supervisor death; and
- teardown that refuses any path outside the owner root.

## 3. Isolation topology

The outer supervisor creates exactly one root with `mktemp -d`, resolves it to
a canonical path, and writes `owner.json` before any child starts:

```text
EXP_ROOT/
  owner.json
  source/
    herd/                       # disposable copy at the pinned SHA
  fixture/
    fake-agent
    git-shim/
    control/
    session-state/
  platform-state/
    current/
    operations.jsonl
    barriers.jsonl
  git/
    remote.git/
    seed/
    runner-A/
    runner-B/
    integrator/
  processes/
    manifest.json
    logs/
  evidence/
  retained/
```

`owner.json` records the experiment UUID, canonical root, creator PID and
process-start identity, source commit, scenario, creation time, and every
allowed child path. Every repository, checkout, fake platform record, process
log, output file, FIFO, temporary directory, and evidence file must resolve
beneath that root.

The disposable source copy must be created without sharing an object database,
alternates file, worktree registration, or Git common directory with
`.references/herd`. Before starting, verify:

```text
source/herd HEAD == afb8e527fee2f9081963310bad1645bdc2806d68
source/herd git-common-dir is below EXP_ROOT
every fixture repository git-common-dir is below EXP_ROOT
```

Set `HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `TMPDIR`, `GIT_CONFIG_GLOBAL`,
and provider-specific homes to isolated directories below `EXP_ROOT`. Disable
system and global Git configuration. Use repository-local test identity only.

### Credential and network barrier

Launch every process from an allowlisted environment rather than inheriting
the caller's environment. Permit only fixed absolute tool paths, locale,
in-root homes, scenario/fixture paths, and resource-control metadata.

Fail preflight if any environment key or file exposes:

- GitHub/GitLab/Bitbucket credentials;
- `GH_TOKEN`, `GITHUB_TOKEN`, SSH agent sockets, credential helpers, or netrc;
- OpenAI, Anthropic, Google, OpenCode, Codex, Claude, or model-provider
  credentials and subscription state;
- cloud, package registry, signing, or publishing credentials; or
- a remote URL using `http`, `https`, `ssh`, or a non-local host.

Network isolation is mandatory. Put the process tree in a namespace/container
with no usable outbound interface, or an already validated equivalent deny
rule. The fixture does not need networking; its platform is in-process and its
Git remote is a local filesystem path. If outbound denial cannot be proved,
all fault cases remain blocked.

### Resource limits

The supervisor must enforce:

| Resource | Hard limit |
| --- | --- |
| Processes/threads | 48 |
| CPU | 2 logical CPUs or 200% quota |
| Memory | 1.5 GiB |
| Writable root | 3 GiB |
| One scenario | 15 minutes |
| Barrier wait | 60 seconds |
| Teardown grace/force | 20 seconds / 10 seconds |

Record the exact reviewed enforcement mechanism. A timeout alone is not a
memory, PID, disk, or network limit.

## 4. Canonical HerdOS fixture

### Task graph and control state

Create one fake milestone and four native HerdOS issues:

```text
A ──► C
B ──► C
D
```

Use stable issue numbers, for example A=101, B=102, C=103, D=104. Render issue
bodies with HerdOS YAML front matter. C's `herd.depends_on` contains A and B;
A, B, and D begin with `herd/status:ready`, while C begins blocked. HerdOS's
front matter and status labels are source-defined
([front matter](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/issues/template.go#L8-L65),
[labels](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/issues/labels.go#L3-L22)).

Set `workers.max_concurrent = 2`. The strongest production slice counts queued
and in-progress `herd-worker.yml` runs and correlates their `issue_number`
inputs before dispatch
([admission](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L484-L579)).
At every checkpoint record both that calculation and the weaker CLI/monitor
views; CLI dispatch counts all in-progress runs and omits queued runs
([CLI count](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L141-L179),
[count function](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L277-L285)).

The fake platform must give every workflow dispatch a stable run ID, inputs,
head branch/SHA, status, conclusion, URL-like local identifier, and creation
time matching HerdOS's `platform.Run`
([run shape](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/types.go#L48-L60)).
It must never invent an attempt or lease that HerdOS itself does not own.

### Disposable Git repository

Create a local seed repository and bare remote. The default branch starts at
recorded commit B0. Create the deterministic batch branch
`herd/batch/1-crash-fixture` at B0. Prepare B1 as a separate commit/ref that is
not moved onto the target until C9.

Create independent runner and integrator clones beneath `EXP_ROOT/git`. Do not
use a user's clone. HerdOS derives deterministic worker branches and either
checks out an existing remote branch or creates one from the batch branch
([worker setup](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L184-L250)).

HerdOS does not create or durably register a separate Git worktree. Production
receives a checkout from `actions/checkout@v4`
([workflow checkout](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/herd-worker.yml#L36-L56)).
The harness therefore uses the term **runner checkout**, not HerdOS worktree.
`git worktree list --porcelain` must still be captured so the common protocol
can report the repository's main-worktree registration accurately.

### Fake agent and session evidence

The fake agent is an experiment fixture, not a provider. It must:

1. be an absolute executable below `EXP_ROOT/fixture`;
2. accept issue, harness-run, invocation, checkout, FIFO, append-log, and phase;
3. write and sync PID, PPID, PGID, invocation ID, a self-generated
   provider-style session ID, start time, checkout, and phase transitions;
4. create C1, staged, unstaged, untracked, and required ignored evidence in
   the common protocol's order;
5. create stash and conflict variants only in separate scenarios;
6. write a valid long-enough final response into the adapter-provided
   `--output-last-message` file when told to finish;
7. make no network calls; and
8. block only on its in-root FIFO.

The harness may instantiate the real Codex adapter with `BinaryPath` set to
this fake. That adapter runs the process in its own process group and uses the
runner checkout as cwd
([Codex execute](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/codex/execute.go#L28-L66)).
Set `TMPDIR` below `EXP_ROOT` because the adapter creates its final-message file
through `os.CreateTemp`.

HerdOS does **not** own a resumable Codex session here. `ExecOptions` has no
session or transcript field, and the real Codex adapter uses `--ephemeral`
([agent options](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/agent.go#L44-L56),
[ephemeral arguments](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/codex/codex.go#L85-L106)).
The fake's session ID and log prove only fake-process continuity. They must
never be reported as a HerdOS-restored provider conversation.

## 5. Product operations in the harness

There is no long-lived HerdOS daemon to start and stop. A production
coordinator is a short-lived CLI or Actions job. The harness must preserve that
shape: each operation is a separately spawned process with one requested
slice, the shared platform-state directory, and one checkout.

### Start

The future harness command shape is:

```text
herd-crash-harness OPERATION --root EXP_ROOT --scenario Cn --operation-id ID
```

`OPERATION` is one enumerated value: `dispatch`, `worker`, `consolidate`,
`advance`, `patrol`, `merge-approved`, or `cleanup-closed`. This is a required
future command, not a command available at the pin.

### Ready

Ready means:

1. the harness has verified owner/root/source identities;
2. the platform snapshot and operation log hashes agree;
3. the requested issue/run/PR and Git refs match `scenario.json`;
4. the process has appended `operation-ready` and synced it; and
5. any requested fault barrier is armed before the source slice crosses it.

A listening socket is not a readiness signal because the safe harness has no
network service.

### Graceful stop

HerdOS worker/integrator commands have no general SIGTERM shutdown handler.
The main command calls `cli.Execute`, and process-tree termination is used only
when an agent context is cancelled
([main](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/cmd/herd/main.go#L1-L12),
[agent process cancellation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/process/process_unix.go#L18-L61)).
Consequently this specification has no source-backed graceful coordinator-stop
command. Sending SIGTERM to a worker process is an OS termination variant, not
graceful HerdOS shutdown.

The harness may expose its own cooperative `finish-current-call` command for
fixture teardown, but that is not a product recovery result.

### Coordinator crash

After matching PID, process-start identity, executable, operation ID, and root,
send SIGKILL only to the harness coordinator. Leave the fake agent and platform
files alive. Record descendants before and immediately after the signal.

### Whole control-plane crash

Send SIGKILL to the harness coordinator and the validated fake-agent process
group. Leave platform state and Git intact. There is no database or storage
server to kill.

### Executor crash

Send SIGKILL only to the validated fake-agent process group while its worker
harness remains alive. A provider context cancellation normally sends SIGTERM
to the group and later SIGKILL; the abrupt executor case intentionally bypasses
that normal path
([process runner](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/agent/process/process.go#L28-L56)).

### Restart

Start a new harness process with a new operation ID, the same platform-state
root, and the scenario's selected checkout:

- **retained-checkout variant:** reuse the exact runner directory, which tests
  the pinned worker function but not normal new-job checkout behavior;
- **fresh-checkout variant:** clone/fetch only the bare remote's durable refs,
  which is the safe approximation of a later Actions job; and
- **integrator variant:** use its independent clone and call consolidation,
  advance, patrol, or cleanup as the source recovery path requires.

Never silently combine these variants.

## 6. Evidence and inspection

Take snapshots before interruption, after interruption but before recovery,
and after recovery. Use the common evidence bundle plus:

```text
evidence/
  manifest.json
  environment-keys.txt
  product-version.txt
  harness-version.txt
  scenario.json
  timeline.jsonl
  platform-before/
  platform-interrupted/
  platform-after/
  processes-before.json
  processes-interrupted.json
  processes-after.json
  git-before/
  git-interrupted/
  git-after/
  fake-agent-log.jsonl
  coordinator.log
  teardown-proof.json
  result.md
```

The manifest hashes every file and lists expected missing evidence. Environment
evidence contains key names and redacted classifications, never values.

### Control-plane state

Snapshot:

- issues, bodies, labels, state, milestone, update time, and comments;
- dependency front matter and the recomputed tier/frontier;
- workflow runs with ID, workflow, inputs, status, conclusion, head branch,
  head SHA, and creation time;
- dispatch calls and responses;
- PR state, head/base/SHA, reviews, checks, and cleanup facts;
- runner records and capacity calculations;
- repository refs exposed through the fake platform; and
- every ordered platform operation, fault, and barrier.

There is no HerdOS attempt row or journal. Do not manufacture one from the
harness operation ID. Report issue identity, workflow run identity, harness
operation identity, and agent invocation identity separately.

### Codex session, context, and logs

Capture:

- fake invocation/session ID and append-log hash;
- PID/PPID/PGID and process-start identity;
- complete argv passed by the Codex adapter;
- final-message file existence/hash;
- coordinator stdout/stderr;
- fake continuation messages; and
- the platform workflow run/log placeholder.

Classify independently:

1. same fake process and log continued;
2. fresh fake process read pushed progress;
3. old coordinator log remained available;
4. workflow-run identity remained visible; and
5. provider session/context.

Item 5 is always **unsupported** in this harness. HerdOS starts a fresh
ephemeral Codex process on each worker invocation.

### Every Git layer

For seed, bare remote, every runner checkout, and integrator clone capture:

- `HEAD`, symbolic branch, B0, B1, worker tip, batch tip, and remote refs;
- `git status --porcelain=v2 --branch --untracked-files=all`;
- binary cached and uncached diffs;
- `git ls-files --stage` and `git ls-files -u`;
- tracked, untracked, and required ignored path hashes;
- `git stash list`, stash refs, and a tree/patch representation of each
  fixture stash;
- merge/rebase/cherry-pick/revert/bisect markers;
- `git worktree list --porcelain`;
- Git common directory and worktree Git directory;
- reflogs when enabled in the fixture; and
- local and remote branch configuration.

Compare committed, staged, unstaged, untracked, ignored, conflict-index, stash,
branch, base, and registration state independently. A timeout checkpoint is
not exact worktree restoration: it stages `.` into one commit and pushes,
which changes index/unstaged distinctions and omits ignored files
([checkpoint](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L566-L618),
[Git dirty/add behavior](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/git/git.go#L155-L171)).

### Live process and capacity

For every process capture PID, PPID, PGID, session ID, state, executable,
arguments, cwd, process-start identity, and in-root file descriptors. Never
signal a PID whose identity differs from the process manifest.

At each checkpoint record:

- configured capacity two;
- queued and in-progress worker runs;
- runs correlated by issue input;
- issues labeled ready, blocked, in-progress, failed, and done;
- surviving fake-agent PIDs;
- new fake invocation IDs; and
- whether D starts while A's old fake agent remains alive.

The harness must report both platform-counted capacity and actual live
processes. It must not infer one from the other.

### Integration

Capture exact worker, batch, and default-target ref values and the candidate
commit. HerdOS worker publication uses `push --force-with-lease`
([Git wrapper](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/git/git.go#L84-L90)),
while worker-to-batch consolidation uses a normal push after a containment
check
([consolidation fence](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L240-L352)).
Record remote update, immediate visible error, label compensation, later
containment check, branch cleanup, and final PR cleanup separately.

## 7. C0-C9 mapping

“Harness-supported” means the source-level case can run only after the required
harness passes preflight. “Source-only” means the boundary is visible in source
but the pin has no deterministic runnable checkpoint. “Unsupported” means the
product does not own the literal protocol layer.

| Case | Exact HerdOS boundary and future procedure | Status at this pin |
| --- | --- | --- |
| C0 — stop before claim | Arm a barrier before the first status mutation. A and B remain ready, C blocked, D ready; no run exists. Kill the dispatch operation, then run `Advance`/dispatch again and compare the frontier and capacity. The first current mutation is removal of the ready label ([dispatch sequence](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L200-L241)). | **Source-only; harness-supported after review.** There is no shipped persistent fake platform or coordinator checkpoint. |
| C1 — claim applied, response lost | Treat `herd/status:in-progress` as the soft claim. Fake `AddLabels` durably applies it, acknowledges `C1-in-progress-applied`, then blocks before returning. Kill the coordinator. Restart with patrol and then advance/dispatch. Patrol should observe an in-progress issue with no active run and mark it failed; record the earlier remove-ready half-transition separately ([orphan repair](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L44-L102)). | **Source-only; harness-supported after review.** This is not an atomic claim or lease. A second variant after workflow dispatch is an ambiguous dispatch case, not C1. |
| C2 — checkout/branch created, no control record | The runner checkout is created outside HerdOS. Inside HerdOS, place a Git shim barrier after `checkout -b herd/worker/...` succeeds and before `Agent.Execute` begins ([branch creation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L187-L250)). Kill the worker and compare retained-checkout versus fresh-checkout restart. | **Literal distinct-worktree case unsupported; native checkout/branch analogue source-only.** HerdOS has no workspace control record to lose or adopt. The fresh run discovers only remote refs, so an unpushed local branch is not durable product state. |
| C3 — agent started, start response lost | Fake agent writes and syncs PID/session/start, then blocks before returning from `Agent.Execute`. Kill only the worker harness, leaving the fake process alive. Start a new worker operation and record whether the old process is identified, stopped, ignored, or duplicated. The source call has no start receipt or PID field ([agent call](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L288-L317)). | **Source-only; harness-supported after review.** This proves HerdOS-visible process ownership is absent in the source-level path, not GitHub runner behavior. |
| C4 — full uncommitted checkout | Let A create C1 plus staged, unstaged, untracked, and ignored state and block. Snapshot all layers. Crash only the worker, then repeat by killing worker and fake. Run retained- and fresh-checkout restarts; stash and unresolved-conflict variants are separate. | **Source-only; harness-supported after review.** Retained checkout tests local function behavior. Fresh checkout tests recovery from remote Git only. Neither proves Actions runner-directory retention. |
| C5 — agent finished, result not recorded | The fake child exits zero and syncs its completion record, while a test-only `agent.Agent` wrapper blocks before returning `ExecResult` to `worker.Exec`. Kill the worker, then retry from a fresh checkout. No final validation/push/report/done transition should have executed yet ([post-agent sequence](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L313-L350)). | **Blocked even in the proposed base harness until the wrapper checkpoint exists.** The existing Codex adapter has no deterministic post-exit/pre-return barrier. |
| C6 — worker push applied, response lost | At the final `ForcePush`, an in-root Git shim invokes the recorded real Git binary against the local bare remote, verifies the remote worker ref advanced, appends the applied barrier, then exits nonzero. HerdOS follows its error/deferred-failure path. Restart from a fresh checkout and record remote-branch discovery, progress/validation marker behavior, second agent invocation, and lease result ([publication order](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L489-L517)). | **Source-only; harness-supported after a dedicated Git-shim safety review.** The result qualifies applied-effect/error handling, not a real network transport. |
| C7 — batch target update applied, response lost | Consolidate A into the batch branch. At normal `git push origin BATCH`, the Git shim applies the update to the bare remote then reports failure. Snapshot failed label and retained worker ref. Start a new consolidation; it should fetch, find worker tip contained in batch, skip remerge, and delete the worker branch ([containment recovery](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L247-L269), [push error path](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L326-L352)). | **Source-only; harness-supported after Git-shim review.** This is HerdOS's native worker-to-batch integration boundary. A final PR merge variant needs fake-platform `Merge` apply-then-error plus a later `CleanupClosed`; it remains platform-model evidence only ([merge/cleanup](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/merge.go#L24-L96)). |
| C8 — immediate close/reopen | There is no supported graceful HerdOS coordinator shutdown. Run and label two nearest variants only: SIGTERM to the worker process and SIGKILL to the worker process, both at C4, followed by immediate restart. Do not call the SIGTERM result graceful. A normal agent timeout is a third, separate case that invokes checkpointing rather than coordinator shutdown. | **Graceful C8 unsupported. Nearest OS-termination variants source-only; harness-supported after review.** Never merge them with C4 crash results. |
| C9 — week-later restart with drift | Stop at full WIP. In fake platform state, age only issue/run/PR timestamps used by patrol; move batch/target B0→B1; mutate C's dependency or status; retain the runner checkout in one variant and remove it in another; retain/delete the remote worker branch independently. Restart patrol and worker. Existing remote worker branches merge the current batch; conflicts cause old branch deletion and a fresh branch ([drift path](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L193-L230)). | **Partially source-only; harness-supported for control/Git drift.** There is no injected clock, but fake records can carry old timestamps because patrol uses `time.Since` ([time rules](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L71-L147)). Provider-session expiry is unsupported because Codex is ephemeral. |

### Ambiguous workflow-dispatch qualification

Although it is not a separate common-protocol number, run one qualification
between C1 and C2. The fake workflow service durably creates a queued worker run
with issue input, then reports an error. HerdOS compensates by labeling the
issue failed
([dispatch compensation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L235-L247)).
Then call the integrator advance path, which correlates queued and in-progress
run inputs before dispatching
([correlation](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/integrator.go#L487-L532)).
Also call the CLI and patrol views separately; their capacity snapshots are
weaker. This case is necessary to explain duplicate/capacity observations but
must not be mislabeled as an atomic claim test.

## 8. C9 drift matrix

Do not wait a week. The fixture state editor must emit a proposed diff, list
every changed record/field and old/new value, then require an experiment UUID
confirmation before atomically applying it.

Run independent variants:

1. retained checkout, retained remote worker branch, batch B0→B1, no conflict;
2. retained checkout and remote branch, B1 produces a merge conflict;
3. removed runner checkout, retained remote worker branch;
4. removed checkout and remote worker branch, leaving only C1 if C1 was pushed;
5. dependency/lifecycle change for C while A/B are recovering;
6. failed workflow history retained versus deliberately removed; and
7. open batch PR aged beyond the configured monitor threshold.

Record whether the retry:

- continues the same workflow run or creates a new one;
- starts a fresh fake-agent invocation;
- reads committed progress and validation marker;
- merges B1 into the worker branch;
- deletes the conflicting recovery branch;
- preserves each local Git layer;
- dispatches D while an old A process exists; and
- asks for operator action or silently restarts.

HerdOS retry counts derive from completed workflow history, not an independent
ledger
([failure count](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L394-L418)).
Removing old fake runs is a retention-loss variant, not normal elapsed time.

## 9. Result classification

Every result answers the common protocol's thirteen questions and reports these
HerdOS-specific identities separately:

- issue number and milestone;
- status label set;
- workflow run ID and inputs;
- harness operation ID;
- fake-agent invocation/session ID;
- runner checkout and deterministic worker branch;
- worker candidate commit, batch head, and default-target head;
- review-lock owner/run/batch SHA when applicable; and
- retained platform operation sequence.

Classify the four restoration layers as follows:

| Layer | Complete | Partial | Lost or unknown |
| --- | --- | --- | --- |
| Control-plane attempt | Same issue and workflow run are reconstructed with all represented effects | Issue is retryable and prior run remains visible, but a new run is used or effect history is incomplete | Labels/runs/refs cannot be related, or a duplicate run is created without explanation |
| Agent session | Not attainable for Codex at this pin | Fresh ephemeral agent reads pushed commits/progress/log-derived handoff | Old context is absent, or fake-process identity is misreported as provider continuation |
| Git checkout | Every common-protocol layer and registration survives in the same checkout | Pushed commits/content survive in a fresh clone or timeout checkpoint, but index/WIP distinctions do not | Unpushed valuable state disappears or ownership is unknown |
| Live execution | HerdOS identifies and deliberately manages the surviving fake process | Supervisor observes it but HerdOS requires outside repair | It is ignored or duplicated, or capacity excludes/includes it without evidence |

Never use “resume” without naming the layer. HerdOS's source uses resume for a
remote worker branch and progress file; it does not mean provider conversation
or live-process adoption.

For C7 report two separate outcomes:

1. worker-to-batch ref update and containment reconciliation; and
2. final PR merge plus cleanup, if the fake-platform variant runs.

Do not treat the fake platform's PR merge as proof of GitHub merge semantics.

## 10. Preflight checklist — execution blocker

Every box must be checked in a future execution record. Any unchecked item
blocks all fault injection.

### Source and harness

- [ ] Disposable source `HEAD` equals
  `afb8e527fee2f9081963310bad1645bdc2806d68`.
- [ ] Its Git common directory and object store are below `EXP_ROOT` and do not
  use alternates.
- [ ] The harness patch/build tag has an independent review and recorded hash.
- [ ] Default `go test ./...` passes in the disposable source before adding the
  experiment tag.
- [ ] Harness persistence, barriers, restart, and teardown tests pass.
- [ ] The experiment binary refuses to start without matching owner UUID/root.
- [ ] No production HerdOS command or real GitHub client is reachable from the
  harness.

### Credentials and network

- [ ] Environment is allowlisted from empty.
- [ ] GitHub, `gh`, SSH, provider, cloud, signing, and publishing credentials
  and config files are absent.
- [ ] `HOME`, XDG paths, `TMPDIR`, provider homes, and Git config paths resolve
  below `EXP_ROOT`.
- [ ] Every Git remote is a canonical local path below `EXP_ROOT`.
- [ ] Outbound network denial was proved with the exact execution boundary.
- [ ] No package install, download, update check, container pull, or registry
  access occurs during a scenario.

### Repository and process ownership

- [ ] Every Git common directory, worktree Git directory, and checkout resolves
  below `EXP_ROOT`.
- [ ] B0, B1, batch, worker, and target refs are recorded before mutation.
- [ ] Real Git absolute path and Git-shim hash are recorded; shim recursion is
  impossible.
- [ ] The fake executable, coordinator, PGIDs, and process-start identities are
  in the process manifest.
- [ ] Signal code refuses PID reuse or an executable/cwd outside the root.
- [ ] Resource and elapsed-time limits were demonstrated with harmless probes.

### Scenario and evidence

- [ ] A-D graph, capacity two, expected frontier, issue/run IDs, and fault
  barrier are written to `scenario.json`.
- [ ] Retained versus fresh checkout and coordinator versus whole-plane crash
  variants are explicit.
- [ ] Stash and conflict are separate cases.
- [ ] Before/interrupted/after snapshots cover platform, processes, every Git
  layer, capacity, and integration.
- [ ] Provider session is preclassified unsupported.
- [ ] No expected result is encoded as a harness behavior; faults only control
  timing and returned errors.

## 11. Fault barriers

The supervisor may release or interrupt only a named, synced barrier. Required
names are:

```text
C0-before-ready-remove
C1-in-progress-applied-before-return
dispatch-run-applied-before-return
C2-worker-branch-created
C3-fake-agent-started
C4-full-wip
C4-stash
C4-conflict
C5-agent-exited-before-result
C6-worker-push-applied-before-error
C7-batch-push-applied-before-error
C7-pr-merge-applied-before-error
C9-drift-applied
```

If a barrier is not reached within 60 seconds, stop the scenario without
injecting a signal, snapshot what exists, and retain the bundle. Do not replace
a missing deterministic barrier with polling or a sleep.

The Git shim may alter behavior only for the exact configured repository,
argument vector, operation ID, and one-shot marker. All other invocations
delegate unchanged to the recorded real Git binary. After applying its one
fault it must refuse reuse.

## 12. Teardown and retention

Teardown order:

1. stop dispatching new harness operations;
2. snapshot final platform, Git, and process state;
3. close all fixture FIFOs;
4. signal only manifest-matched fake-agent groups and coordinator processes;
5. wait, then force-stop only still-matching processes;
6. verify no process has cwd, executable, or open descriptor below the root;
7. verify every Git remote/common directory is below the root;
8. hash and finalize the evidence manifest;
9. remove only scenario scratch paths whose canonical parent and owner UUID
   match; and
10. retain the whole root if any ownership proof fails.

Never recursively delete `$HOME`, `~`, `/`, the workspace root,
`.references/herd`, Dalph's Git common directory, or any path reached through
an unresolved symlink. Bare-remote refs and interrupted checkouts are evidence;
do not delete them before the final hashes.

`teardown-proof.json` records every process considered, identity comparison,
signal, exit observation, path considered for removal, canonical ownership
check, retained item, and failure. A cleanup failure changes the result to
“evidence retained; teardown incomplete.”

## 13. What is runnable now

At the pinned revision, without contacting an account:

- the ordinary Go unit suite can qualify the in-memory platform, worker,
  monitor, integrator, Git, and fake-provider seams;
- focused Git tests can run against temporary local repositories; and
- provider-adapter tests can invoke local fake executables.

These are already represented by the repository's default and race-tested CI
suite
([Makefile](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/Makefile#L1-L19),
[CI](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/.github/workflows/ci.yml#L1-L66)).
They do not restart a coordinator against durable fake GitHub state.

At this pin:

- **C0-C4 and C6-C7:** source-visible and suitable for the proposed harness,
  but not runnable until that harness and its safety barriers exist;
- **C5:** additionally blocked on a deterministic post-agent-exit,
  pre-result checkpoint;
- **C8:** literal graceful shutdown unsupported; only separately labeled
  SIGTERM/SIGKILL approximations can be harnessed;
- **C9:** control/Git drift can be harnessed with old fixture timestamps;
  provider-session expiry remains unsupported;
- **same Codex session/context restoration:** unsupported by design because
  Codex invocation is ephemeral;
- **distinct HerdOS worktree adoption:** unsupported because HerdOS receives a
  runner checkout and records no workspace identity; and
- **real GitHub/Actions crash recovery:** not tested by this safe local design.

No C0-C9 result exists until a reviewed execution record names the harness
commit/hash, fixture manifest, exact fault barrier, interruption type, evidence
bundle hash, and all unsupported layers.
