# Paperclip crash experiment specification

**Status:** design only; no experiment has run. Execution is blocked by the
preflight gate in this document.

**Product revision:** Paperclip
[`d5b9f6c8c9d9edb0c9796df86c61826b11400b5b`](https://github.com/paperclipai/paperclip/tree/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b).

**Common protocol:** `research/control-plane-crash-experiment-protocol.md`.
The architecture findings that motivate the checks are in
`research/cards/paperclip-reliability-architecture.md`.

This document changes no Dalph or Paperclip runtime behavior. It specifies a
future, isolated experiment and deliberately refuses to turn source gaps into
unreviewed shell commands.

## 1. Decision and evidence boundary

Use a disposable local Paperclip instance with:

- one coordinator at a time;
- Paperclip's embedded PostgreSQL cluster;
- the built-in `process` adapter invoking a credential-free fake-agent
  executable;
- a local bare Git remote, clone, and Paperclip worktrees;
- loopback networking only; and
- an outer supervisor that owns the temporary root, processes, checkpoints,
  evidence, limits, and teardown.

Paperclip supports an embedded PostgreSQL data directory and port in its
validated config
([config schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/shared/src/config-schema.ts#L19-L43)),
resolves `PAPERCLIP_HOME` and `PAPERCLIP_INSTANCE_ID` into an instance root
([home paths](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/shared/src/home-paths.ts#L16-L49)),
and refuses a non-loopback `local_trusted` deployment
([server startup](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L505-L530)).
The `process` adapter takes an explicit executable, arguments, cwd, environment,
timeout, and grace period; it forwards output and `onSpawn` metadata into the
heartbeat service
([adapter](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/adapters/process/execute.ts#L1-L83),
[registration](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/adapters/process/index.ts#L1-L23)).

The built-in process adapter does **not** return `sessionParams` or a
`sessionDisplayId`; its successful result contains captured stdout and stderr
only
([result path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/adapters/process/execute.ts#L64-L83)).
It can therefore test an independent process, agent-owned append log, control
log, and Git survival without credentials, but it cannot prove provider-style
conversation continuation. Any row manually placed in `agent_task_sessions`
would test Paperclip's selection logic, not a provider's ability to resume.
The session column in the result matrix must remain **unsupported/not
observed** unless a separately reviewed test adapter is added.

## 2. Isolation topology

The future supervisor must create exactly one root with `mktemp -d` and record
its canonical path before creating anything else. The proposed ownership tree
is:

```text
EXP_ROOT/
  owner.json
  paperclip-home/
    instances/crash/
      config.json
      db/
      data/
      logs/
      secrets/
  fixture/
    fake-agent
    control/
    session-state/
  git/
    remote.git/
    seed/
    checkout/
  run-logs/
  processes/
  evidence/
  retained/
```

`owner.json` contains a fresh experiment UUID, creator PID and process start
identity, creation time, canonical `EXP_ROOT`, repository pin, and scenario.
Every path written into Paperclip configuration must be a descendant of that
canonical root. Paperclip's config parser validates the server, database,
logging, storage, secrets, and telemetry sections
([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/shared/src/config-schema.ts#L19-L184));
the supervisor must parse the generated file with that schema before boot.

Use these settings:

- `server.deploymentMode = "local_trusted"`;
- `server.exposure = "private"`;
- `server.bind = "loopback"`;
- `server.host = "127.0.0.1"`;
- a pre-reserved loopback application port;
- `server.serveUi = false`;
- `database.mode = "embedded-postgres"`;
- a pre-reserved loopback PostgreSQL port;
- `database.embeddedPostgresDataDir = EXP_ROOT/.../db`;
- database backups disabled;
- file logging, local-disk storage, and local secrets paths under `EXP_ROOT`;
  and
- telemetry disabled.

The server also accepts `RUN_LOG_BASE_PATH`, so active run logs can be kept
inside the root
([run-log path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/run-log-store.ts#L237-L261)).
Leave every `RUN_LOG_S3_*` variable unset. The source only mirrors complete,
finalized logs to S3, and the experiment must not contact object storage
([store behavior](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/run-log-store.ts#L60-L78)).

### Credential and network boundary

The coordinator and fake agent must start from an allowlisted environment, not
a copy of the caller's environment with a few names removed. Allow only the
validated executable `PATH`, locale, temporary paths, the Paperclip instance
variables above, assigned ports, and scenario/checkpoint variables. In
particular, do not pass `DATABASE_URL`, GitHub/GitLab/Linear/Jira tokens,
provider API keys, AWS/cloud variables, npm credentials, SSH agent variables,
`CODEX_HOME`, or model-specific home/config variables.

Before boot, inspect the allowlisted environment and fail if any key contains
`TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`, `CREDENTIAL`, `AWS`, `GITHUB`,
`GITLAB`, `LINEAR`, `JIRA`, `ANTHROPIC`, `OPENAI`, `GEMINI`, `CURSOR`,
`CLAUDE`, or `CODEX`, except the literal local PostgreSQL password embedded by
Paperclip itself inside the isolated process. Do not include environment
values in evidence.

The supervisor must prove that both chosen ports bind only to `127.0.0.1`.
Outbound network denial is mandatory: run the process group in a network
namespace/container whose only usable interface is loopback, or use an
equivalent already-validated deny rule. If that facility is unavailable, the
experiment is blocked. Paperclip's own loopback bind protects inbound access;
it does not itself prove that a child cannot initiate outbound traffic.

### Resource caps

The outer supervisor must enforce, not merely document:

| Resource | Hard limit |
| --- | --- |
| Processes/threads in experiment cgroup or container | 64 |
| CPU | 2 logical CPUs or 200% quota |
| Memory | 2 GiB, no host swap growth |
| Writable experiment storage | 4 GiB |
| One scenario elapsed time | 20 minutes |
| Graceful teardown window | 30 seconds |
| Forced teardown window | 10 seconds |

No particular cgroup/container command is prescribed here because the pinned
Paperclip repository does not own one, and host support varies. Before any
scenario runs, the reviewer must record the exact already-tested enforcement
command and show a harmless child being stopped at each applicable limit.
A timeout wrapper alone is insufficient because it does not cap memory, PIDs,
or disk.

## 3. Product start, ready, stop, and restart operations

The following are the only product operations currently established by source.
They are command templates, not authorization to run; preflight must replace
each metavariable with a canonical, validated value and record the final
argument vector without secrets.

### Coordinator start

From the pinned Paperclip checkout, start:

```text
pnpm --filter @paperclipai/server dev
```

The server package defines `dev` as `tsx src/index.ts`
([package script](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/package.json#L27-L45)).
The outer launcher supplies the isolated environment, including
`PAPERCLIP_HOME`, `PAPERCLIP_INSTANCE_ID`, `PAPERCLIP_CONFIG`,
`PAPERCLIP_BIND=loopback`, `HOST=127.0.0.1`, `PORT`, local storage/log paths,
and migration auto-apply. It must execute a fixed resolved `pnpm` binary and
must not run package installation during an experiment.

Paperclip starts or reuses the configured persistent embedded cluster and
applies migrations before listening
([database startup](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L322-L503)).
Track the launcher, coordinator, PostgreSQL postmaster, and every descendant
with PID, parent PID, process group, executable, command hash, and OS process
start identity.

### Ready

Ready means all of the following are true:

1. `GET http://127.0.0.1:PORT/api/health` returns 200;
2. the response version matches the pinned server;
3. the listener is bound only to loopback;
4. a read-only database snapshot succeeds; and
5. startup recovery has completed, determined from the coordinator log rather
   than merely from the socket.

The repository's isolated smoke instructions use the same loopback health
check
([development guide](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/connections/SMOKE-LAB-BROWSER-RUNNER.md#L36-L60)).

### Graceful coordinator stop

Send `SIGTERM` to the validated coordinator PID and wait for exit. Paperclip's
handler stops scheduling, attempts hot-restart preparation, drains running
runs unless hot restart is active, shuts down app services and owned embedded
PostgreSQL, then exits
([handler](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L1301-L1368),
[run drain](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9818-L9913)).
This is not a crash.

### Explicit hot restart

With the same isolated `PAPERCLIP_HOME`, write the one-shot intent using:

```text
pnpm --filter @paperclipai/server exec tsx ../scripts/request-hot-restart.ts --server-pid COORDINATOR_PID
```

Then send `SIGTERM`, wait for the old coordinator to exit, and start the same
server command. This command and sequence are documented by Paperclip
([guide](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/DEVELOPING.md#L104-L120),
[request script](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/scripts/request-hot-restart.ts#L1-L74)).
Capture the intent and resulting `hot-restart-report.json`. The report's
`adopted` classification must be compared with OS liveness and output
continuation; it does not by itself establish stream reattachment
([classification path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9622-L9815)).

Do not use `systemctl` from Paperclip's deployment example. This experiment
does not target a host service.

### Hard coordinator crash

After verifying the PID and process start identity, send `SIGKILL` to the
coordinator only. Do not signal the fake agent or PostgreSQL. Restart with the
same start command and root. This bypasses Paperclip's signal handler and is
the coordinator-crash case.

The supervisor must account for the embedded PostgreSQL child explicitly.
After a parent `SIGKILL`, the postmaster may remain alive; restart logic can
reuse a matching cluster when its PID/data directory are verified
([reuse logic](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L378-L503)).
If the postmaster dies too, classify the run as a whole-control-plane crash,
not a coordinator crash.

### Whole-control-plane crash

Send `SIGKILL` to the coordinator and the validated fake-agent PID/process
group, leaving the embedded PostgreSQL postmaster and Git/filesystem storage
alive. This is the common protocol's durable-storage case. A variant that
kills PostgreSQL is out of scope: Paperclip documents embedded PostgreSQL
support, but the repository supplies no product-level storage-crash
checkpoint/recovery experiment.

### Executor crash

Read `process_pid` and `process_group_id` from the run row, verify that they
belong to the fake executable under `EXP_ROOT`, and send `SIGKILL` to the
fake-agent process group. Keep the coordinator and PostgreSQL alive.
Paperclip spawns local children detached on non-Windows systems and passes PID
and process-group metadata to `onSpawn`
([spawn path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapter-utils/src/server-utils.ts#L3150-L3233)).
The experiment is Linux-only unless an equivalent process-group proof is
reviewed for another platform.

## 4. Canonical fixture

### Paperclip task graph

Create native Paperclip issues A, B, C, and D assigned to one `process` agent.
Insert `issue_relations` edges in which A blocks C and B blocks C. Paperclip's
relation schema uses `issue_id` for the blocker and `related_issue_id` for the
blocked issue
([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/issue_relations.ts#L1-L39)).
Set A and B to equal high priority, C to medium, and D to low. Configure the
agent with:

```json
{
  "heartbeat": {
    "enabled": true,
    "wakeOnDemand": true,
    "maxConcurrentRuns": 2
  }
}
```

The scheduler reads that setting, counts running rows, and dispatches queued
runs by dependency readiness, issue status/priority, and creation time
([policy and scheduler](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L11180-L11220),
[selection](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L12459-L12549)).
Existing embedded-PostgreSQL tests establish the same dependency and capacity
seam
([tests](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/heartbeat-dependency-scheduling.test.ts#L172-L760)).

The fixture driver must use Paperclip's exported database schema and one
isolated database. It may not call a real tracker. IDs, wake-request IDs, and
run IDs must be recorded in `scenario.json`.

### Disposable Git repository

Under `EXP_ROOT/git`, create a seed repository, a bare remote, and a clone.
Configure repository-local test identity only. Record B0, then prepare but do
not expose B1 until C9. Existing Paperclip tests create local repositories and
bare remotes this way
([workspace fixture](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/workspace-runtime.test.ts#L120-L235),
[bare-remote case](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/workspace-runtime.test.ts#L2987-L3048)).
Every `git rev-parse --git-common-dir` and worktree path must resolve beneath
`EXP_ROOT`.

Paperclip's normal worktree realization resolves/refetches the base and creates
or reuses a worktree
([implementation](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/workspace-runtime.ts#L2660-L2910)).
The experiment records the database `base_ref`, the run context's first
`baseRefSnapshot`, and the actual B0 SHA separately.

### Fake agent

The fake agent is a new experiment fixture, not a production Paperclip
feature. It must be reviewed before use and must:

1. be an absolute executable below `EXP_ROOT/fixture`;
2. accept task/run identity, workspace, phase, control FIFO, and append-log
   paths;
3. make no network calls and reject a non-loopback URL in its environment;
4. record PID, PPID, PGID, invocation ID, a self-generated
   `provider_session_id`, workspace, phase transitions, and controlled exit;
5. create C1, staged, unstaged, untracked, ignored, stash, and conflict
   variants in the order required by the common protocol;
6. `fsync` its checkpoint/log file before acknowledging each phase;
7. block on the FIFO without polling external services; and
8. install signal handlers that record graceful signals, while `SIGKILL`
   remains unrecordable by design.

Configure the Paperclip agent with the built-in `process` adapter, the fake
executable as `command`, argument values as an array, the Paperclip worktree as
`cwd`, and a finite timeout/grace. Paperclip rejects config-supplied runtime
secrets and constructs the child environment itself
([adapter environment](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/adapters/process/execute.ts#L14-L54)).

The fake agent's `provider_session_id` is agent-owned comparison evidence only.
It will not appear in `agent_task_sessions` with the process adapter. Do not
report it as a Paperclip-resumed provider session.

## 5. Evidence and inspection plan

Take a before-interruption, after-interruption-before-restart, and
after-recovery snapshot. All snapshots are read-only and written below the
scenario evidence directory.

Use the common bundle and add Paperclip-specific directories:

```text
evidence/
  manifest.json
  environment-keys.txt
  product-version.txt
  scenario.json
  timeline.jsonl
  process-before.json
  process-interrupted.json
  process-after.json
  task-state-before.json
  task-state-interrupted.json
  task-state-after.json
  database-export-or-query-results/
  git-before/
  git-interrupted/
  git-after/
  run-logs/
  hot-restart/
  agent-log.jsonl
  control-plane.log
  teardown-proof.json
  result.md
```

`environment-keys.txt` contains names and redacted classifications, never
values. `timeline.jsonl` is written by the outer supervisor and records
monotonic and wall-clock times for checkpoints, signals, process observations,
database snapshots, restarts, and recovery completion. `manifest.json` hashes
every completed evidence file and records any expected file that is missing.

### Database

The database dumper must use Paperclip's `createDb`/schema exports or a
preflight-validated local PostgreSQL client against the recorded loopback
connection. Capture these rows in one consistent read transaction:

- `issues`: identity, status, priority, assignee, `checkout_run_id`,
  `execution_run_id`, lock time, workspace ID, execution policy/state, and
  timestamps
  ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/issues.ts#L23-L77));
- `issue_relations`;
- `agent_wakeup_requests`: status, run ID, claim/finish times, and errors
  ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/agent_wakeup_requests.ts#L5-L39));
- `heartbeat_runs`: lifecycle, retry lineage, session-before/after, log
  locator/hash/length, PID/PGID, output sequence/time, liveness, context, and
  result
  ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/heartbeat_runs.ts#L6-L60));
- `heartbeat_run_events` ordered by run and sequence
  ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/heartbeat_run_events.ts#L6-L27));
- `agent_task_sessions`, which should remain empty for the process adapter
  unless a test explicitly seeded it
  ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/agent_task_sessions.ts#L6-L38));
- `agent_runtime_state`;
- `execution_workspaces`: status, cwd, base, branch, provider ref, metadata,
  and cleanup fields
  ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/execution_workspaces.ts#L15-L67));
- workspace operations, recovery actions, issue comments, and activity rows;
  and
- the agent's complete `runtime_config`, especially
  `heartbeat.maxConcurrentRuns`.

Hash the normalized JSON export. Preserve current rows and events separately:
Paperclip mutates the former directly and does not reconstruct them by event
replay.

### PID, PGID, and adoption

For every tracked process capture PID, PPID, PGID, session ID, state, start
identity, executable link, cwd link, argument vector, and open descriptors that
resolve under `EXP_ROOT`. Use `kill(pid, 0)` only as a liveness probe. Never
signal a PID whose start identity or executable no longer matches the process
manifest.

Compare:

- fake-agent PID/PGID in its append log;
- `heartbeat_runs.process_pid` and `process_group_id`;
- the supervisor's process snapshot;
- the in-root hot-restart intent and report; and
- post-restart events/result JSON.

Paperclip persists `onSpawn` metadata into the run row
([implementation](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9038-L9064)).
Its orphan reaper distinguishes a live detached child from a dead/lost one
([reaper](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L12125-L12316)).
Report OS survival, Paperclip classification, output continuation, and
eventual completion observation independently.

### Session and logs

Capture:

- fake-agent invocation and provider-style IDs;
- received continuation arguments/messages;
- Paperclip run `session_id_before`/`session_id_after`;
- any `agent_task_sessions` row;
- `log_store`, `log_ref`, `log_bytes`, `log_sha256`, excerpts, and output
  sequence;
- the exact run-log file and its hash; and
- the fake agent's independently fsynced append log and hash.

The local run log is appended during execution and finalized with length/hash
metadata
([store](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/run-log-store.ts#L159-L233)).
Classify:

- agent append-log continuation;
- Paperclip run-log continuation;
- same Paperclip attempt;
- same fake invocation;
- same fake provider-style ID; and
- Paperclip provider session.

The last item is unsupported with the selected adapter and must not be inferred
from the others.

### Complete Git layers

For every base repository and worktree capture, in stable files:

- `HEAD` commit and symbolic branch;
- recorded B0/B1 and remote refs;
- `git status --porcelain=v2 --branch --untracked-files=all`;
- binary patches for cached and uncached changes;
- `git ls-files --stage` and `git ls-files -u`;
- non-ignored untracked paths;
- ignored untracked paths;
- content hashes for every tracked, untracked, and required ignored file;
- `git stash list` and a patch/tree representation of each fixture stash;
- in-progress merge/rebase/cherry-pick/revert/bisect markers;
- `git worktree list --porcelain`;
- Git common directory, worktree Git directory, branch ref, and relevant
  repository config; and
- the Paperclip workspace row and operation records.

Hash the Git evidence directory before interruption and compare it
field-by-field after recovery. Paperclip quarantine uses `git add -A` and a
rescue commit, then clears in-progress operation metadata
([quarantine](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/workspace-runtime.ts#L1318-L1507)).
If quarantine occurs, report content preservation separately from loss of
staged/unstaged or conflict-stage distinctions.

### Capacity

At each checkpoint record:

- configured `maxConcurrentRuns = 2`;
- all queued, scheduled-retry, running, and terminal run rows by agent;
- wake-request statuses;
- tasks A-D and dependency readiness;
- live fake-agent PIDs;
- newly started fake invocation IDs; and
- whether D started while an old A/B process still existed.

Paperclip's start lock is process-local
([lock](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/agent-start-lock.ts#L3-L48)),
but this protocol deliberately runs one coordinator. The experiment checks
restart accounting, not multi-replica capacity.

### Integration boundary

Capture the bare remote's target and task refs before and after every scenario.
The fake agent must not push. Paperclip adapter rules prohibit adapter-owned
push by default, and core workspace synchronization is not target integration
([adapter rules](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapters/AUTHORING.md#L8-L55)).
The expected core handoff is preserved work in a workspace/branch. There is no
target-update lease, merge queue, or accepted-head record to inspect.

## 6. C0-C9 mapping

“Supported” below means the pinned seams can represent the case once the
supervisor/fake fixture passes preflight. “Blocked” means the current source
has no deterministic checkpoint or owns no such operation. A polling race is
not an acceptable substitute.

| Case | Paperclip seam and future procedure | Status and reason |
| --- | --- | --- |
| C0 — stop before claim | Boot to ready, pause the coordinator, insert A-D and queued wakes through the isolated DB fixture driver, snapshot, kill the paused coordinator, then restart. Startup reaps/resumes/reconciles before periodic scheduling ([startup](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L942-L1037)). | **Supported after supervisor validation.** Pausing before fixture insertion makes “before claim” deterministic. Confirm no run became `running` before the crash. |
| C1 — claim applied, response lost | The meaningful boundary is after the conditional `heartbeat_runs queued -> running` update but before wake/issue pointer updates complete ([claim path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L11420-L11569)). | **Blocked.** There is no fault checkpoint at this boundary. Polling for `running` can observe the row only after the statement completes and can race past later effects. A reviewed test-only checkpoint is required. |
| C2 — worktree created, control record missing | Boundary lies after `realizeExecutionWorkspace` creates/registers the Git worktree and before `execution_workspaces`/issue persistence completes ([realization](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/workspace-runtime.ts#L2660-L2910), [persistence](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L13437-L13535)). | **Blocked.** No deterministic post-create/pre-record hook exists. Existing tests call realization directly, which qualifies the mechanism but is not a server-crash experiment. |
| C3 — agent started, start response lost | The process adapter spawns detached, invokes `onSpawn`, and Paperclip persists PID/PGID. A nearest supported variant waits for both the fake's started marker and the DB PID, then hard-crashes the coordinator while the fake blocks ([spawn](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapter-utils/src/server-utils.ts#L3150-L3233), [persistence](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9038-L9064)). | **Exact C3 blocked; nearest variant supported.** Once the PID row is visible, Paperclip has recorded start metadata. Killing between OS spawn and that write needs a test-only checkpoint. Report the nearest variant as “start recorded, adapter completion outstanding,” not “start response lost.” |
| C4 — full uncommitted worktree | Let A's fake reach the full-WIP checkpoint; hash all Git layers; hard-crash only the coordinator; restart. Repeat by killing both coordinator and fake. Compare worktree, Paperclip workspace row, logs, PID classification, retries, and capacity. | **Supported after fake/supervisor validation.** Run stash and unresolved-conflict variants separately. Do not permit quarantine or cleanup to run before the first after-crash snapshot. |
| C5 — agent finishes, result not recorded | Desired checkpoint is after the fake child exits zero but before `executeRun` persists adapter completion/session/log/task transitions. | **Blocked.** The process adapter returns promptly after `runChildProcess`; there is no post-exit/pre-result checkpoint. A test-only adapter or explicit heartbeat checkpoint must acknowledge this boundary before the coordinator is killed. |
| C6 — push applied, response lost | None in the core workflow. The process fake is prohibited from pushing; a supervisor-created remote ref would be external to Paperclip ([adapter rules](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapters/AUTHORING.md#L8-L55)). | **Unsupported by Paperclip core.** Record the workspace/branch handoff and unchanged remote. Do not score an artificial supervisor push as product recovery. |
| C7 — target update applied, response lost | None. Paperclip's documented runtime boundary restores work to the execution workspace and does not push or integrate the accepted target ([workspace guide](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/docs/guides/board-operator/execution-workspaces-and-runtime-services.md#L57-L76)). | **Unsupported by Paperclip core.** Record “no integration protocol” and the unchanged target ref. |
| C8 — immediate close and reopen | At full WIP, run three separately labeled variants: graceful `SIGTERM`; explicit hot-restart intent plus `SIGTERM`; hard `SIGKILL`. Restart immediately with the same DB/root and compare all layers. | **Supported after fake/supervisor validation.** Never combine the three results. Graceful drain interrupts/retries; explicit hot restart may classify a live local child adopted; hard crash uses orphan reconciliation ([shutdown](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L1301-L1368), [hot adoption](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9554-L9815)). |
| C9 — reopen after a week with drift | Stop after full WIP. In the isolated DB, move only fixture timestamps through a reviewed driver; advance the bare target B0→B1; change one issue/dependency; retain the worktree in one variant and remove only its registered worktree directory in another. A seeded task-session row may be deleted in a **control-logic-only** variant. Restart and inspect. | **Partially supported.** Paperclip has no first-class clock injection seam, so direct timestamp fixtures must be enumerated and diffed. The process adapter cannot test genuine provider-session expiry. Moving base/workspace recovery is testable; provider continuation remains unsupported. |

### Required test-only checkpoints before blocked cases may run

If a later change chooses to unblock C1, C2, exact C3, or C5, add a
test-only, default-off checkpoint protocol that:

- is enabled only by an experiment-specific environment variable;
- writes a checkpoint record under `EXP_ROOT`;
- blocks on a local FIFO;
- includes run/issue/workspace/PID identities;
- has no network code;
- cannot compile or activate in a normal production start by accident; and
- is reviewed against the exact source boundary.

This specification does not name a runnable command or file for such a harness
because none exists at the pin. The new command must be documented and
validated in a separate change before preflight can pass.

## 7. C9 drift details

Do not wait a real week. The reviewed DB driver must list every changed table,
row, column, old value, and new value before committing. At minimum consider
run/wake/session/workspace update times, scheduled retry time, and execution
lock time; do not blindly subtract seven days from every timestamp.

Run these independent variants:

1. target advances B0→B1, task/dependencies unchanged, worktree retained;
2. target advances and C's dependency/lifecycle changes;
3. retained branch/commit but removed worktree registration/directory;
4. seeded Paperclip task-session handle removed, explicitly labeled
   control-logic-only; and
5. clean unstarted workspace versus workspace with C1/WIP, to expose whether
   Paperclip silently refreshes a moving base.

Paperclip can hard-reset a clean unstarted workspace to a newer remote base
([refresh](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/workspace-runtime.ts#L2008-L2067)).
Record whether the original B0 appears in the run context, workspace metadata,
Git ancestry, and operator output after recovery.

## 8. Result classification

Each scenario must answer the common protocol's thirteen questions and report
these Paperclip-specific distinctions:

- same issue versus same wake request versus same heartbeat run;
- `checkoutRunId` ownership versus `executionRunId` live path
  ([semantics](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/execution-semantics.md#L121-L145));
- current row recovery versus supporting run-event/activity evidence;
- live PID versus live PGID versus Paperclip `adopted` classification;
- agent append-log continuation versus Paperclip run-log continuation;
- fake provider-style ID versus Paperclip provider session;
- exact Git state versus rescue-commit/content-only preservation;
- original B0 versus a refreshed workspace base;
- configured capacity versus DB-counted running capacity versus real live
  executors; and
- preserved worktree/branch handoff versus target integration.

Never use “resumed” without naming the layer. Never score C6 or C7 as passing
or failing; they are unsupported core responsibilities at this revision.

## 9. Preflight checklist — execution blocker

Every box must be checked by a reviewer in a future execution record. Any
unchecked item blocks **all destructive fault cases**.

### Source and commands

- [ ] Paperclip checkout `HEAD` equals
  `d5b9f6c8c9d9edb0c9796df86c61826b11400b5b`.
- [ ] The checkout is a disposable reference checkout, not the Dalph
  worktree, and no experiment writes into its Git common directory.
- [ ] `node`, `pnpm`, Git, the process inspector, hash tool, HTTP client, and
  selected resource/network isolation tools resolve to recorded absolute
  executables.
- [ ] Dependencies are already present and match the lockfile; no install,
  download, `npx`, package publish, or registry access occurs during a run.
- [ ] `pnpm --filter @paperclipai/server dev` was harmlessly validated against
  a throwaway empty instance and its exact argv recorded.
- [ ] The health request and startup-complete log predicate were validated.
- [ ] Graceful `SIGTERM`, explicit hot-restart request, hard coordinator
  `SIGKILL`, whole-control-plane kill, and fake-executor kill each have distinct
  reviewed supervisor actions.
- [ ] No command is defined for C1, C2, exact C3, or C5 unless the required
  checkpoint implementation has been separately reviewed and pinned.

### Root, configuration, and credentials

- [ ] `EXP_ROOT` was created with `mktemp -d`, canonicalized, is nonempty, and
  is not `/`, `$HOME`, the workspace root, the Paperclip checkout, or any
  ancestor of them.
- [ ] `owner.json` exists, matches the current supervisor PID/start identity,
  and names the scenario.
- [ ] Every configured DB, log, storage, secret, workspace, fixture, Git, and
  evidence path resolves below `EXP_ROOT`.
- [ ] The generated Paperclip config passes the pinned
  `paperclipConfigSchema`.
- [ ] The launch environment is built from an allowlist and passes the
  credential-name audit.
- [ ] The fake-agent executable and fixture inputs are reviewed, immutable for
  the run, and hashed.
- [ ] The built-in process adapter is configured with an absolute command
  beneath `EXP_ROOT`; no shell command string is used.
- [ ] The result template states that Paperclip provider-session continuity is
  unsupported with this adapter.

### Network and resources

- [ ] Outbound network denial was demonstrated with a harmless probe.
- [ ] Application and PostgreSQL ports are unique, recorded, and bound only to
  `127.0.0.1`.
- [ ] PID 64, CPU 2, memory 2 GiB, writable storage 4 GiB, and 20-minute limits
  are actively enforced and demonstrated.
- [ ] The supervisor itself remains outside the killable coordinator/fake
  process groups.
- [ ] The process manifest captures the PostgreSQL postmaster, coordinator,
  fake agents, and all descendants.

### Fixture and observability

- [ ] A-D and both `blocks` edges match the canonical graph.
- [ ] `maxConcurrentRuns` is exactly 2 and the fixture proves C is blocked
  while A/B are unresolved.
- [ ] B0 and B1 hashes are recorded; target starts at B0.
- [ ] All Git common directories and worktrees resolve below `EXP_ROOT`.
- [ ] Fake-agent checkpoints reproduce committed, staged, unstaged, untracked,
  and ignored evidence; stash and conflict are separate variants.
- [ ] Database snapshots, PID/PGID snapshots, hot-restart files, run logs,
  fake-agent log, Git-layer snapshots, remote refs, coordinator log, and
  operator-visible API state are captured and hashable.
- [ ] The DB dumper performs one consistent read and redacts no fields needed
  for lifecycle analysis while excluding secrets.
- [ ] Before each kill, the target PID/start identity/executable/cwd matches the
  process manifest.
- [ ] A dry, non-destructive traversal through every supervisor checkpoint
  completes without sending a signal.

### Teardown rehearsal

- [ ] Teardown was rehearsed on an empty fixture and produced the proof in the
  next section.
- [ ] The supervisor retains evidence instead of deleting when ownership,
  process identity, path containment, or listener closure is uncertain.

## 10. Teardown and proof

Teardown is a supervised state transition:

1. stop dispatch and close all fixture FIFOs;
2. send `SIGTERM` only to manifest processes whose PID/start identity still
   matches;
3. wait at most 30 seconds;
4. send `SIGKILL` only to still-matching experiment processes;
5. wait at most 10 seconds and fail closed if any remain;
6. stop the embedded postmaster last, again verifying its data directory and
   process start identity;
7. prove that neither assigned port has a listener;
8. prove no process has cwd, executable, or open file below `EXP_ROOT`;
9. capture `git worktree list --porcelain`, every Git common directory, and
   remote refs into the evidence bundle;
10. finalize and hash the evidence manifest;
11. reread and validate `owner.json`, canonicalize the deletion target, and
    require an exact equality match with the originally recorded root; and
12. remove only that root, then prove the path no longer exists.

Never recursively delete an unresolved variable, symlink target, parent
directory, Git common directory outside the root, `$HOME`, `~`, `/`, the Dalph
workspace, or the Paperclip source checkout. If any process, listener, Git
common directory, or path is not attributable to the experiment, move the
evidence manifest to `retained/`, leave the root in place, and report manual
cleanup required.

The teardown proof must contain:

- the original and final canonical root;
- `owner.json` hash;
- process manifest before and after;
- signal outcomes;
- postmaster identity and stop result;
- listener scan before and after;
- open-file/cwd scan before and after;
- Git common-directory/worktree inventory;
- evidence-manifest hash;
- deletion decision and reason; and
- final path-existence result.

## 11. Current execution readiness

At the pinned revision, C0, C4, the nearest recorded-start C3 variant, C8, and
the Git/control portions of C9 have suitable product seams, but the repository
does not contain the required outer supervisor, fake-agent fixture, evidence
dumper, resource/network sandbox, or deterministic fault checkpoints. C1, C2,
exact C3, and C5 are additionally blocked on checkpoint hooks; C6 and C7 are
unsupported core operations; provider-session continuation is unsupported by
the selected credential-free built-in adapter.

Therefore **no command in this specification may be executed yet**. The next
authorized step, if requested, is to implement and review the isolated
experiment harness as a separate change, then complete the preflight checklist
before running any fault scenario.
