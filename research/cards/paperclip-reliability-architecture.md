# Paperclip reliability architecture

## 1. Scope, pin, and evidence boundary

This card audits Paperclip at commit
[`d5b9f6c8c9d9edb0c9796df86c61826b11400b5b`](https://github.com/paperclipai/paperclip/tree/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b).
It is a source audit of the checked-out repository, not a live deployment
experiment. Claims below are limited to behavior visible at that revision. In
particular, no server was killed against a persistent production-shaped
database, and no claims are made about provider retention guarantees that are
not encoded in Paperclip.

The evidence boundary includes the database schemas, server services, adapter
interfaces, documentation, migrations, and tests. The principal orchestration
path is the approximately 17,958-line
[`heartbeat.ts`](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L1-L286),
whose ending at this pin confirms the file's scale
([source](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L17770-L17958)).
Negative findings mean that repository-wide searches at this pin found no
implementation, test, dependency, or documentation establishing the claimed
capability. They are not claims about unpublished deployments or later
versions.

## 2. Plain-language architecture

Paperclip is a database-centered organization and task control plane. The
database holds mutable rows for issues, agent wake requests, heartbeat runs,
task sessions, runtime state, and execution workspaces. A coordinator takes
queued wakeups, creates or claims runs, chooses a workspace and provider
session, starts an adapter, records process and output observations, and then
updates the task and run. Periodic and startup reconcilers inspect current rows
for work stranded by a crash and either resume, retry, clear a stale lock, or
escalate it
([execution semantics](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/execution-semantics.md#L500-L571),
[`index.ts`](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L942-L1037)).

This is not an event-sourced control plane. The issue, run, workspace, wake,
and session tables are the current authoritative Paperclip records, and
services update them directly. `heartbeat_run_events` and `activity_log`
provide ordered run evidence and user-facing audit history, while recovery
actions record repair work
([run schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/heartbeat_runs.ts#L6-L60),
[run-event schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/heartbeat_run_events.ts#L6-L27),
[activity schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/activity_log.ts#L6-L36),
[recovery-action schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/issue_recovery_actions.ts#L16-L67)).
No replay path reconstructs the mutable current rows from those events at this
pin. The events are therefore diagnostic and audit records, not the sole
source of truth.

Paperclip carefully distinguishes two task-level run identities.
`checkoutRunId` says which run owns the right to work on an issue;
`executionRunId` says which run currently represents the live execution path.
Stale-owner adoption and compare-and-clear operations preserve a live actor
while replacing or releasing stale ownership
([semantics](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/execution-semantics.md#L121-L145),
[issue schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/issues.ts#L23-L77)).

## 3. State-owner table

| State or fact | Owner in Paperclip | Persistence and authority consequence |
| --- | --- | --- |
| Task identity, status, assignee, parentage, and Paperclip execution pointers | `issues` | Mutable database current state, including `checkoutRunId`, `executionRunId`, and policy/state JSON ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/issues.ts#L23-L77)). This is product-owned task authority, not merely a projection of an external tracker. |
| Requested agent work | `agent_wakeup_requests` | Durable queue/current state with timestamps and a linked run ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/agent_wakeup_requests.ts#L5-L39)). |
| One execution attempt | `heartbeat_runs` | Mutable current lifecycle plus responsible user, retry lineage, process identifiers, liveness, session-before/after, log reference/hash, and a context snapshot ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/heartbeat_runs.ts#L6-L60)). |
| Ordered observations about a run | `heartbeat_run_events` | Diagnostic/audit sequence; it supplements rather than reconstructs the run row ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/heartbeat_run_events.ts#L6-L27)). |
| Durable provider continuation handle for a task | `agent_task_sessions` | One adapter/task-key session mapping per company and agent, including opaque params, display ID, last run, and last error ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/agent_task_sessions.ts#L6-L38)). |
| Latest agent runtime/session totals | `agent_runtime_state` | Durable latest aggregate/runtime pointer, not a transcript ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/agent_runtime_state.ts#L5-L27)). |
| Reusable execution directory and branch | `execution_workspaces` plus Git/filesystem | Database records mode, status, cwd, repository, base ref, branch, provider ref, and cleanup state; Git and the filesystem still own actual commits, index, worktree, and refs ([schema](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/execution_workspaces.ts#L15-L67)). |
| Live local child | In-memory process registry plus persisted PID/PGID observations | The process registry and exit/output callbacks are process-local. The run row's PID/PGID/start/output data let another coordinator classify liveness, but do not themselves recreate a `ChildProcess` handle ([orphan reaper](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L12125-L12316)). |
| Accepted target-head integration | External Git hosting/user/agent workflow | Paperclip adapters receive a workspace and are prohibited from pushing by default; core sync restores execution output into the workspace, but no general merge queue or accepted-head integration protocol exists ([adapter rules](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapters/AUTHORING.md#L8-L55), [workspace guide](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/docs/guides/board-operator/execution-workspaces-and-runtime-services.md#L57-L76)). |

## 4. Scheduling and capacity

Queued runs are durable. Under an agent-scoped start lock, the service recounts
running work, calculates `maxConcurrentRuns - running`, loads queued runs,
filters them by dependency readiness, prioritizes in-progress and higher
priority work, then attempts to claim enough runs to fill the snapshot of
available slots
([scheduler](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L12459-L12549)).

The start lock is a module-local map of promises. A 30-second stale timeout
warns and proceeds, so it is both process-local and deliberately fail-open
([`agent-start-lock.ts`](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/agent-start-lock.ts#L3-L48)).
The run claim itself is stronger: a conditional database update changes one
run from `queued` to `running`, which prevents two processes from claiming the
same run
([claim path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L11420-L11569)).
Issue checkout adoption and stale-pointer clearing also use database
transactions, row locks, and compare-and-set conditions
([adoption](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/issues.ts#L4509-L4607),
[clearing](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/issues.ts#L4657-L4761)).

The per-agent capacity invariant is not cross-process. Two coordinators can
independently observe the same free slot and conditionally claim two different
queued runs. The database protects each individual run and helps serialize
issue ownership, but there is no database semaphore covering the recount and
all claims. Paperclip is therefore reliable here under its intended
single-coordinator operating assumption, but `maxConcurrentRuns` should not be
treated as a distributed capacity bound.

## 5. Restoration layers

### Control task and run

Issue, wake-request, run, retry-lineage, liveness, and recovery-action rows
survive a server restart when the database survives. Startup and periodic
passes reap orphaned runs, promote retries, resume queued work, reconcile
stranded assigned issues, sweep stale locks, and run watchdogs
([startup sequence](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L942-L1037)).
This is level-triggered repair from current state, not journal replay.

### Agent session, context, and log

The adapter result can return a legacy session ID, opaque session params, a
display ID, and a task key. A session codec lets an adapter validate and render
its provider-specific continuation state
([adapter types](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapter-utils/src/types.ts#L17-L25),
[result and codec](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapter-utils/src/types.ts#L76-L122)).
Paperclip resolves the durable task session and validates an explicitly
selected prior run against company, agent, adapter, and task key before resume
([resume resolution](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L7860-L7974),
[explicit override](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L3380-L3449)).
When compacting, it can rotate to a new session with a small handoff containing
the prior session, issue, reason, summaries, and an instruction to rebuild
minimum context
([compaction handoff](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L7736-L7857)).

Those records are resume handles and execution context, not a full model
conversation stored by Paperclip. Whether they restore provider context
depends on the adapter and provider accepting the opaque session. The run's
`contextSnapshot` is task/wakeup execution context, not demonstrated full
transcript rehydration.

The run log store writes locally as output arrives and can mirror a finalized,
complete log to S3. The implementation explicitly notes that local historical
logs can be lost across pod replacement; the remote upload is best-effort and
occurs at finalization
([log-store design](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/run-log-store.ts#L60-L78),
[write/finalize/read path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/run-log-store.ts#L159-L233)).
Thus a persistent filesystem can preserve an active log, and object storage can
preserve a finalized log, but an unfinalized local-only log is not
cross-machine durable.

### Committed, staged, unstaged, untracked, conflicted, and stashed Git state

On an unchanged filesystem, Git naturally retains the worktree's commits,
HEAD, index, working tree, untracked files, conflict metadata, and repository
stashes until some cleanup or normalization changes them. Paperclip records
the workspace path and branch, validates recorded versus live Git state, and
can reuse the directory across runs
([workspace inspection](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/execution-workspaces.ts#L267-L335),
[workspace creation/reuse](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/workspace-runtime.ts#L2660-L2910)).
The database does not inventory every Git layer, however.

Quarantine is recovery by normalization, not a byte-for-byte workspace image.
It creates a rescue branch, runs `git add -A`, commits the accumulated visible
change, quits lingering merge/rebase/cherry-pick/revert/bisect operations, and
returns to the expected branch
([quarantine](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/workspace-runtime.ts#L1318-L1507)).
That preserves prior commits and usually the content of tracked and
non-ignored untracked changes in a rescue commit, but collapses the distinction
between staged and unstaged content. `git add -A` does not capture ignored
untracked files by default. Existing stashes are not associated with an
attempt. An unresolved conflict can prevent creation of the rescue commit, and
the procedure does not promise to preserve conflict-stage entries as such.

Remote execution sync is also content-oriented. It snapshots commits and an
overlay of changed/deleted/untracked paths, performs compare-and-set style
integration when histories race, and resets the local index to `HEAD` before
applying the returned content
([snapshot](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapter-utils/src/git-workspace-sync.ts#L56-L107),
[restore and concurrent-history handling](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapter-utils/src/git-workspace-sync.ts#L246-L375)).
It can preserve useful work while losing the original staging distinction. A
local same-directory continuation is therefore stronger than a remote
round-trip for exact Git state.

### Live process

A live process is the least portable layer. Within the same server process,
Paperclip holds adapter and child handles and receives output and completion
callbacks. Across a normal shutdown it terminates tracked work, marks the run
interrupted, and may queue a process-loss retry
([shutdown](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9818-L9913)).
Across a hard crash, only persisted PID/PGID and liveness observations remain.
The reaper leaves a still-live local PID classified as detached, or marks a
dead tracked child `process_lost` and can queue one bounded retry
([reaper](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L12125-L12316)).

## 6. Immediate restart

Paperclip has an explicit development hot-restart handshake. The old server
atomically writes an intent and a snapshot of eligible live local runs and
leaves those detached children running. The new server only honors the intent
when it targets the old PID, then classifies each candidate as adopted,
finalized while down, lost, or skipped
([intent/report types and atomic write](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/hot-restart.ts#L5-L75),
[intent validation](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/hot-restart.ts#L153-L210),
[old-server snapshot](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9554-L9620),
[new-server classification](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9622-L9815)).

At this pin, “adopted” proves that the row is eligible and its recorded
PID/PGID is alive, and it prevents the orphan reaper from prematurely failing
the run. A repository-wide search found no path that recreates the old
`ChildProcess` object, reattaches stdout/stderr streams, or installs an
equivalent exit callback in the new server. The source therefore establishes
liveness adoption, not full stream and completion-monitor adoption. This
distinction matters: the process can keep doing work while Paperclip's exact
observation path is degraded.

Without the explicit handshake, a hard restart uses ordinary liveness
reconciliation. A live local child is left detached; a dead child is failed and
may be retried. A normal graceful restart intentionally interrupts work
instead. These are three different restart semantics, not one universal
“resume.”

## 7. A week later and under drift

A week later, durable database rows can still identify the task, old run,
retry, workspace, and last task session. Execution workspaces are designed to
remain until a human closes them, and the local cwd is intentionally the
cross-run persistence mechanism
([workspace lifetime](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/docs/guides/board-operator/execution-workspaces-and-runtime-services.md#L45-L76)).
Paperclip does not restart workspace runtime services on server startup
([guide](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/docs/guides/board-operator/execution-workspaces-and-runtime-services.md#L78-L85)).

The old live process should not be assumed to exist. The provider session may
have expired or become invalid according to provider-specific policy, which
Paperclip cannot guarantee. Local logs may have disappeared if the filesystem
was replaced before finalization. The target branch and remote base can move.
Paperclip detects branch/base divergence and can require reconciliation or
quarantine, but the workspace is not a frozen complete attempt image.
Recovery therefore means “classify surviving layers and continue safely,” not
“restore the exact machine and conversation.”

## 8. Git starting point and integration

When creating a worktree, Paperclip resolves a configured branch/base ref,
refreshes remote tracking information, and creates or reuses a deterministic
path and branch. It stores a first `baseRefSnapshot` when one is absent
([worktree path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/workspace-runtime.ts#L2660-L2910),
[snapshot persistence](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L1169-L1195)).
However, a clean “unstarted” branch with no commits beyond the current remote
base can be hard-reset to that newer base
([refresh](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/workspace-runtime.ts#L2008-L2067)).
The base is therefore a reusable workspace starting point that may move before
work begins, not an immutable planned Base SHA for every attempt.

Paperclip has robust machinery for bringing remote adapter output back into
the same execution workspace, including concurrent-history detection. That is
workspace restoration, not acceptance into a shared target branch. Adapter
authoring rules say adapters must not push by default; a GitHub PR may be
created by a selected agent workflow or a provider-specific feature
([adapter rules](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapters/AUTHORING.md#L8-L55),
[PR-skill preflight](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L1722-L1746)).
The pinned source has no general integration resource, merge queue,
accepted-target-head compare-and-set, or reconcile-after-ambiguous-merge
protocol. Integration remains an external Git-hosting, human, or agent
responsibility.

## 9. Code organization, layers, and end-to-end slices

The repository has recognizable layers: database schemas and migrations;
shared contracts; adapter utilities and adapters; server adapter registry;
server services and routes; and the web UI. Focused policy and mechanism
modules exist for run liveness, issue execution policy, recovery, task
watchdogs, workspaces, Git synchronization, hot restart, and log storage.

The primary execution slice nevertheless converges in `heartbeat.ts`: enqueue
or wake, capacity calculation, run claim, issue ownership, workspace
resolution, session selection, adapter invocation, spawn observation, output
streaming, log finalization, task/run completion, retry, and resource release.
Its imports include database tables, adapters, filesystem/process primitives,
logging, live events, workspace services, environment services, and recovery
policies
([imports](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L1-L286)).
Consequently, adding a lifecycle state or changing one boundary often requires
coordinated changes across schema/migration, heartbeat orchestration, recovery,
shared/UI contracts, and tests.

The large slice is “hot” connascence: the meaning of issue pointers, run
statuses, retry lineage, workspace status, provider session, process liveness,
and log completion must agree across many distant branches. Extracted
classifiers reduce some local complexity, but a coordinator crash can occur
between database, filesystem, Git, process, and provider effects that do not
share a transaction.

## 10. Production, test, fake, and dry-run seams

The strongest production seam is the adapter interface. An
`AdapterExecutionContext` supplies cwd, environment, payload, abort signal,
spawn observation, output callbacks, and structured-event callbacks; adapters
return normalized completion and continuation information
([interface](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapter-utils/src/types.ts#L76-L122),
[execution context](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapter-utils/src/types.ts#L156-L177)).
Database services accept a database handle, and plugin-worker and environment
runtime components have explicit seams.

The whole heartbeat workflow is less substitutable. It uses global adapter and
process registries, direct filesystem/process/Git calls, the global run-log
store and live-event publication, and wall-clock reads. Tests compensate with
embedded PostgreSQL, temporary Git repositories, real subprocesses, mocks, and
module stubs. No first-class workflow algebra has production, fake, dry-run,
and test interpreters with the same semantics at this pin. “Dry run” is
therefore not an end-to-end reliability proof, and fake behavior can diverge
at exactly the process/Git/database ambiguity boundaries.

## 11. Verification inventory

Paperclip has substantial example-based Vitest coverage:

- dependency scheduling and the one-process `maxConcurrentRuns` behavior
  ([tests](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/heartbeat-dependency-scheduling.test.ts#L172-L590));
- stale local start-lock release
  ([test](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/heartbeat-start-lock.test.ts#L1-L60));
- live/dead PID recovery, bounded retry, hot-restart snapshots and adoption,
  graceful interruption, retry exhaustion, and simulated startup recovery
  ([process-recovery tests](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/heartbeat-process-recovery.test.ts#L1188-L1725),
  [later recovery cases](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/heartbeat-process-recovery.test.ts#L1895-L1915),
  [simulated restart](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/heartbeat-process-recovery.test.ts#L4728-L5095));
- workspace reconciliation, quarantine/rescue, active-service guards, dirty and
  diverged branches, and race cases
  ([workspace tests](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/execution-workspaces-service.test.ts#L501-L850),
  [race/divergence tests](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/execution-workspaces-service.test.ts#L1439-L1990));
- task-session resume codecs and workspace/branch preflight
  ([tests](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/heartbeat-workspace-session.test.ts#L2189-L2350));
- remote Git restoration under concurrent updates
  ([SSH fixture tests](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapter-utils/src/ssh-fixture.test.ts#L503-L760));
- finalized-log remote fallback and loss of an unfinalized local log
  ([log tests](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/run-log-store.test.ts#L95-L160)); and
- stale issue-lock clearing guarded against live execution
  ([sweep tests](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/__tests__/recovery-stale-issue-lock-sweep.test.ts#L103-L225)).

The suite includes meaningful concurrency/race examples and real Git/process
fixtures. The repository search found no property-based testing dependency, no
Quint/TLA+/Alloy model, and no model-based state-machine suite. It also found
no end-to-end test that kills the whole Paperclip server at each ambiguity
boundary and restarts a new server against the same durable database and
workspace; the “simulated restart” tests call recovery services in-process.
These absences leave cross-process capacity and long crash-sequence
compositions less strongly verified than local mechanisms.

## 12. Chronological failure table

| Failure boundary | Surviving evidence and observed recovery | Residual ambiguity or forbidden assumption |
| --- | --- | --- |
| Stop before claim | A queued wake/run remains in the database and startup resumes queued work. A stranded assigned actionable issue can also be rediscovered by reconciliation ([startup](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L942-L1037)). | Do not infer that capacity was reserved merely because a row was visible; capacity is recalculated. |
| Claim succeeds, then stop before workspace setup | The run is `running` but lacks a live process observation. The orphan path can classify it lost, release task pointers, and queue the bounded retry ([claim](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L11420-L11569), [reaper](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L12125-L12316)). | Current rows and events describe observed stages, but there is no universal effect journal proving that no filesystem operation began. |
| Worktree created, then stop before all workspace records settle | The deterministic worktree/path may remain and later resolution validates or reuses it; setup error handling attempts to clean newly created artifacts ([creation/reuse](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/workspace-runtime.ts#L2660-L2910), [persistence path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L13437-L13535)). | Git/filesystem creation and database recording are not atomic. Recovery is operation-specific inspection, not replay of a common intent/observation protocol. |
| Agent starts, but the control response/observation is lost | If `onSpawn` persisted PID/PGID, restart can inspect OS liveness. Hot restart can classify it adopted; hard restart calls it detached while alive or lost when dead ([hot adoption](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9622-L9815), [reaper](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L12125-L12316)). | A provider session returned only later may not yet be durable. PID liveness is not proof that output streams and the exit callback were reattached. |
| Agent finishes, then control dies before result persistence | Filesystem work may remain and a remote adapter may already have restored content, while the run row still looks live. A dead PID is eventually classified lost and may cause a fresh continuation/retry. | Do not assume `process_lost` means “agent produced no work,” or assume filesystem work means the provider returned a valid completed result. No common atomic boundary joins those facts. |
| Branch push succeeds, but response is lost | Core Paperclip has no general push operation; an agent-specific workflow must reread the hosting provider and reconcile its own ambiguous push ([adapter no-push rule](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/adapters/AUTHORING.md#L8-L55)). | It is invalid to credit the core run state or audit events with authoritative knowledge of the remote ref. |
| Integration succeeds, but response is lost | Not applicable to the core control protocol at this pin. The external integrator must reread the accepted target ref/PR state. | Paperclip workspace sync is not target integration, and `executionRunId` is not an integration lease. |
| Close and reopen immediately | Graceful close interrupts tracked work and may retry; explicit hot restart leaves eligible local children alive and classifies them; hard crash uses detached/lost reconciliation ([graceful path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9818-L9913), [hot path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9554-L9815)). | “Restart” must name which path occurred. Only the explicit hot path attempts live-process adoption, and even that does not prove stream reattachment. |
| Reopen a week later after provider, branch, or filesystem drift | Durable rows, retries, last session handle, and an unclosed workspace can be reclassified. Branch-coherence checks, stale-lock sweeps, and quarantine offer conservative recovery ([workspace checks](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/execution-workspaces.ts#L267-L423), [recovery intent](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/execution-semantics.md#L725-L795)). | Provider context, active local logs, ignored files, exact index/conflict state after normalization, and the old process are not guaranteed. A moving base and external integration state require fresh reads. |

## 13. Maintenance risks

1. **Lifecycle connascence is concentrated.** The large heartbeat slice must
   keep issue ownership, run status, retries, sessions, workspace status,
   process liveness, and logs mutually consistent across many branches.

2. **Lock scopes differ.** Database row locks and conditional updates are
   cross-process, while start/capacity serialization and live-child registries
   are local. A maintainer can easily mistake “the run claim is safe” for “the
   per-agent cap is distributed.”

3. **Current state and audit evidence can diverge.** Because events do not
   generate current state, every path that changes a run may need both current
   row and event/activity updates. A crash between them can produce an
   incomplete narrative even when recovery from current state succeeds.

4. **Git, filesystem, database, process, and provider effects are not one
   transaction.** Quarantine, for example, performs Git rescue before its
   database transaction
   ([service path](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/execution-workspaces.ts#L1608-L1913)).
   Each new boundary needs its own ambiguity analysis and reconciler.

5. **Recovery policies can interact.** Orphan reaping, retry promotion,
   stranded-task reconciliation, stale-lock sweeping, workspace quarantine,
   task watchdogs, and productivity recovery all inspect overlapping state.
   Fingerprints, unique active-action constraints, bounded retries, and row
   locks help, but future states can create repair loops if all passes do not
   share the same live/stale definitions.

6. **“Adopted,” “session restored,” and “workspace preserved” are easy to
   overread.** At this pin they respectively mean live PID classification,
   reusable provider-specific handle, and surviving/recoverable workspace
   content—not necessarily reattached output, full conversation, or exact
   index/conflict/stash image.

7. **JSON and string lifecycle fields permit combinations that types do not
   rule out.** Recovery services detect and repair many inconsistent
   combinations after the fact. Schema migrations and UI/shared contracts
   must evolve in step.

8. **Workspace identity is coarser than attempt identity.** A workspace and
   branch can serve multiple runs and its clean unstarted base can advance.
   This is useful continuity but unsuitable as proof of one exact worktree and
   planned Base SHA per attempt.

9. **Reliable production does not imply reliable acceptance.** Paperclip can
   preserve and retry work yet still leave PR creation, review, serialization,
   and accepted-head reconciliation to agents or humans.

## 14. Ideas Dalph can borrow

Borrow these mechanisms while keeping Dalph's tracker, Git, executor, and
journal authority boundaries:

- Distinguish the run that owns permission to work from the run currently
  executing, as Paperclip does with `checkoutRunId` and `executionRunId`.
  Dalph should brand both identities and tie them to one exact task attempt,
  while leaving task lifecycle and claims in the tracker.

- Use restart classifications rather than a single “resume” flag: reattach to
  an executor-observed live session, resume a provider context in a preserved
  worktree, start a fresh context in preserved work, or start clean. Paperclip
  demonstrates why process, provider session, log, and Git state must be
  reported separately.

- Store adapter-owned opaque session parameters together with a validated
  task key and human-readable display ID. Do not pretend this is the
  transcript, and record provider expiry/invalid-session failures explicitly.

- Adopt branch-coherence inspection, workspace fingerprints, rescue refs, and
  explicit recovery actions. Improve on quarantine by preserving or
  explicitly accounting for committed, staged, unstaged, untracked, ignored,
  conflicted, and stashed layers instead of silently collapsing them.

- Run level-triggered startup reconcilers and make retries bounded, linked to
  the source attempt, and escalated when exhausted. Pair every
  ambiguity-crossing effect with intent before, observation after, and an
  authoritative reread before retry.

- Store log integrity metadata and support durable incremental log upload, not
  only best-effort upload after finalization.

- Keep database compare-and-set and row-lock patterns for Dalph-owned journal
  records, but do not use a process-local mutex as the capacity invariant.
  Dalph's stated one-coordinator scope makes the local serialization useful,
  yet the assumption should be explicit and monitored.

- Reuse Paperclip's migration-safety, real-Git, subprocess, and race-test
  instincts. Add crash injection at every scenario boundary, model/property
  tests for the attempt state machine, and the required scenario-to-test map.

Do not borrow Paperclip's product-owned issue database as a duplicate tracker,
its workspace row as a substitute for Git facts, its PID row as executor
authority, or its activity/run events as a workflow journal reconstructed by
replay. Also do not generalize an optional agent PR skill into a target
integration protocol. Dalph needs its own serialized integration resource,
planned Base SHA, accepted-head reread, and reconcile-before-retry semantics.

## 15. Unknowns and negative search

- No source at this pin demonstrates reconstruction of mutable issue/run state
  by replaying `heartbeat_run_events` or `activity_log`; direct row mutation is
  the visible control mechanism.
- No source demonstrates recreation of a `ChildProcess` handle, stdout/stderr
  subscription, or equivalent completion watcher after hot-restart adoption.
  The confirmed behavior is PID/PGID liveness classification and reaper
  exemption.
- No schema or service establishes a cross-process semaphore for
  `maxConcurrentRuns`. The run's queued-to-running compare-and-set is
  cross-process; the capacity snapshot and start lock are not.
- No general merge queue, accepted-target-head resource, or ambiguous
  integration reconciler was found. Git workspace sync is local workspace
  restoration, not integration into the target.
- No guarantee was found that a provider will retain an opaque session for a
  week, or that all adapters can resume equivalently.
- No full-fidelity capture of ignored files, stashes, conflict-stage entries,
  and staged-versus-unstaged distinctions was found. Local filesystem survival
  may retain them, but quarantine and remote restore do not promise to.
- No repository-level property-based framework, formal specification/model
  checker, or model-based state-machine suite was found.
- No end-to-end server-crash matrix was found that kills and restarts the whole
  coordinator at each database/Git/process/provider boundary. Existing
  recovery tests provide strong examples but mostly invoke services inside the
  test process.

These are the main candidates for destructive or multi-process experiments if
Paperclip itself were being qualified. They are intentionally left as
unknowns here because this assignment is source-only.

## 16. Technical and user consequences

Technically, Paperclip has useful durable current-state records and extensive
reconcilers. It is strongest when one coordinator owns scheduling, the
database and workspace filesystem persist, adapter/session semantics are
known, and Git integration is handled separately. Its database compare-and-set
operations, workspace validation, rescue branches, bounded process-loss
retry, and explicit hot-restart classification materially reduce accidental
duplicate or lost work. They do not create a single atomic transaction across
the database, provider, child process, logs, filesystem, Git remote, and
accepted target branch.

For a user, reopening Paperclip immediately can often show the task and run,
reuse the workspace and provider session, and either keep, retry, or explicitly
recover work. It should not promise that the same terminal stream is still
attached, that every unfinalized log survived, or that “adopted” means full
control of a detached child. Reopening a week later can still present durable
task/session/workspace evidence and recovery choices, but must surface provider
expiry, branch drift, missing logs, and normalized Git state honestly.

For Dalph, the most important lesson is to present restoration as a layered
report: tracker task/claim, Dalph journal attempt, executor session/process,
agent context, log, exact Git layers, workspace disposition, and integration
state. Each layer should say “confirmed live,” “durably resumable,” “preserved
but needs reconciliation,” “normalized into rescue form,” “missing,” or
“unknown.” That is more accurate and more actionable than a single recovered
or failed status, while preserving the rule that the tracker owns tasks, Git
owns lineage and refs, the executor owns sessions/process observations, and
Dalph owns only workflow-journal history.
