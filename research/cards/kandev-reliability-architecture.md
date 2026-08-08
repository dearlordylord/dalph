# Kandev reliability architecture

**Audit date:** 2026-07-30

## 1. Scope, pin, and evidence boundary

This card audits Kandev at commit
[`21742aa3ef85c2ed1bfc8e2714d14799599cecac`](https://github.com/kdlbs/kandev/tree/21742aa3ef85c2ed1bfc8e2714d14799599cecac).
The evidence boundary is that commit's Go backend, database migrations, runtime
implementations, tests, manifests, GitHub Actions, and documentation. No crash
experiment was run.

Kandev is much broader than a headless dispatcher: it owns a task database,
workflow boards, conversations, worktree records, executor records, an
agent-lifecycle layer, an `agentctl` process beside each workspace, and
GitHub/GitLab review surfaces. Its README describes parallel tasks, isolated
worktrees, local/Docker/SSH/Sprites executors, and resumable conversations
([features](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/README.md#L32-L49);
[executors](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/README.md#L109-L118)).

This card assumes one active Kandev coordinator for one installation, as
requested. Process-local locks are evaluated on that basis. Their lack of an
active-active fence remains a deployment boundary, not a first-version Dalph
defect.

Documentation is supporting evidence, not the final authority. One important
drift was found: the resume document says Docker startup scans managed
containers
([resume document](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/task_session_resume.md#L246-L259)),
but the pinned Docker implementation returns no recovered instances and says
containers are detected lazily when a user revisits a session
([Docker recovery](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/executor_docker.go#L708-L713)).
This card follows the implementation.

## 2. Plain-language architecture

A person creates or imports a task into a workflow step. Kandev stores that
task in SQLite, creates a persistent task session, materializes one Git
worktree per attached repository, creates an executor instance, and starts an
agent through `agentctl`. The UI talks to the Go backend over HTTP/WebSocket;
the backend separates workflow orchestration from runtime lifecycle and
workspace operations. The repository itself summarizes the deployment as one
backend orchestrator controlling local processes, containers, SSH hosts, and
Sprites workspaces
([architecture diagram](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/README.md#L165-L192)).

The important nesting is:

1. A **task** is the durable unit on a workflow board.
2. A **task session** is the durable conversation/execution lineage for that
   task.
3. An **executor-running row** is the durable mirror of the currently selected
   runtime handle and the holder of the resume token.
4. An in-memory **agent execution** owns the live `agentctl` client, process or
   container connection, streams, and prompt completion channel.
5. A **task-session worktree** connects the session to a durable worktree
   record and on-disk path.

The model explicitly says `TaskSession` survives backend restarts
([task-session model](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/models/models.go#L914-L956)).
The executor row is unique by session and records runtime, status, resume
token, execution/container IDs, local or remote PIDs, worktree locator, and
last observation
([schema](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/repository/sqlite/base_schema.go#L196-L220)).

After restart, Kandev does not eagerly restart every agent. It repairs active
session rows into a waiting state, preserves resume and worktree information,
and lets opening the session or sending the next prompt trigger a launch
([startup reconciliation](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/service.go#L1490-L1535)).
That is durable, lazy restoration—not process supervision in the OTP sense.

## 3. State-owner table

| Fact | Owner at the pinned commit | Restart consequence |
|---|---|---|
| Task identity, title, description, workflow/step, state, priority, position, queue marker, parent, repository attachments | Kandev task tables | Durable. A task row distinguishes admitted WIP from a visible queued task ([task model](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/models/models.go#L462-L503)). |
| Dependency and grouping facts | Kandev task/workflow/Office tables, plus provider records where imported | Durable, but not one graph-native tracker boundary. Different product modes add different policy. |
| Session identity and selected agent/executor/environment snapshots | `task_sessions` | Durable. A session records its base branch and a later-captured base commit, but the commit is for cumulative diff rather than an immutable planned attempt ([session fields](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/models/models.go#L914-L956)). |
| Live runtime identity and resume token | In-memory lifecycle execution is runtime authority; `executors_running` is its durable mirror | Partial. The source explicitly permits launch to continue when mirroring fails, which can leave no durable row or token until another launch ([persistence contract](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/persistence.go#L222-L239)). |
| Agent-native conversation | Agent provider, addressed by `resume_token`/ACP session ID | Durable only if that provider still accepts the token. Kandev carries a token forward only for the same execution profile ([resume-token application](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/executor/executor_resume.go#L859-L916)). |
| Kandev conversation and turns | SQLite `task_session_turns` and `task_session_messages` | Durable and cascade-scoped to the session ([message/turn schema](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/repository/sqlite/base_schema.go#L541-L584)). |
| Fallback context for a non-native agent | Local JSONL under the data directory's `sessions` folder | Durable only with the same data filesystem. It is a second representation, not generated from the authoritative message tables at resume time ([history storage](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/session_history.go#L26-L75)). |
| Agent log and streamed tool output | Message rows, live streams, and debug logs, depending on event type | Useful evidence, but not the same thing as provider context and not a process checkpoint. Fallback history truncates messages and omits tool-result content in its append helper ([history entries and rendering](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/session_history.go#L115-L151); [context rendering](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/session_history.go#L201-L254)). |
| Worktree identity, path, branch, and base-branch name | Kandev worktree table plus Git common directory | Durable while DB and Git filesystem survive. The record stores a branch name, not the full index/worktree image ([worktree model](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/worktree.go#L24-L72)). |
| Committed, staged, unstaged, untracked, conflict, stash, and ignored state | Git common directory, index, and worktree filesystem | Preserved when the exact worktree remains. It is not reconstructible from Kandev rows if that directory is lost. |
| Workflow WIP occupancy and queue order | Task rows: `wip_admitted`, `queued_for_step_id`, `queued_at` | Durable. Startup explicitly reconciles persisted queued tasks ([queue reconciliation](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/workflow_store.go#L238-L261)). |
| Queued prompts and deferred workflow moves | SQLite message-queue tables | Durable. Head reservation and acknowledgement distinguish ordinary prompts from server-owned lifecycle entries ([queue interface](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/messagequeue/repository.go#L8-L74)). |
| PR/MR state, checks, and accepted target head | GitHub or GitLab | The forge is authoritative. Kandev links, watches, approves, and invokes merge APIs; it does not own an accepted-head integration journal. |

The strongest lesson is that “session” has three separate meanings: the
durable Kandev session row, the agent provider's resumable conversation, and
the current live execution. The workspace is a fourth thing. Treating any one
as proof that the others survived would be incorrect.

## 4. Scheduling and capacity

Workflow steps can set `WIPLimit`. A task admitted to that step counts only
when it is non-archived, non-ephemeral, and has `wip_admitted = 1`. A full step
can still display another task there with a durable queue marker; the queued
task does not consume capacity
([transactional creation and placement](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/repository/sqlite/task.go#L156-L212);
[creation test](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/service/service_tasks_wip_test.go#L24-L61)).

Moving into a limited step checks occupancy and updates the task in one
database transaction. Promoting a queued task additionally includes the
original step and queue marker in the update predicate, preventing two
reconcilers from promoting the same row
([transactional move](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/repository/sqlite/task.go#L590-L638);
[atomic promotion](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/repository/sqlite/task.go#L641-L704)).
PostgreSQL locks the workflow-step row. SQLite uses its single writer
connection rather than an explicit row lock
([capacity lock](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/task/repository/sqlite/task.go#L367-L373);
[SQLite configuration](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/db/sqlite.go#L22-L52)).

When a task vacates a pull-enabled step, the workflow store repeatedly chooses
the next queued or feeder task, skips blocked candidates, atomically promotes
one, and publishes the move
([vacancy fill](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/workflow_store.go#L215-L235);
[selection and promotion](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/workflow_store.go#L319-L411)).

This is strong board/workflow WIP enforcement. It is **not** a general runtime
resource budget:

- a WIP occupant need not have a live process;
- one task can have multiple sessions and repositories;
- there is no equivalent global CPU, memory, host, provider-account, or agent
  quota in this core path;
- there is no distinct accepted-head integration slot.

The persistent per-session prompt queue has its own maximum and FIFO ordering,
but that limits pending interaction, not active agent count. Under the
one-coordinator assumption, SQLite's serialized writes and conditional updates
make the workflow WIP mechanism credible. They do not turn a board column into
a coarse task-attempt responsibility budget.

## 5. Restoration layers

### Control-plane task, session, and queued work

Tasks, workflow position, admitted/queued state, session state, turns,
messages, executor mirror, worktree associations, queued prompts, and pending
moves are in SQLite. The writer uses foreign keys, WAL, a five-second busy
timeout, synchronous `NORMAL`, and one writer connection
([SQLite DSN](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/db/sqlite.go#L32-L52)).
That is a sensible single-coordinator persistence substrate, although
`NORMAL` is a durability/performance choice rather than a promise that the
last acknowledged filesystem write survives every power-loss mode.

At startup the orchestrator reads executor rows. Active sessions become
`WAITING_FOR_INPUT`, open turns are abandoned, in-progress board tasks may
move to review, dead local liveness handles are repaired, and executor rows
retain their token/worktree data
([active repair](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/service.go#L1597-L1652)).
Created and terminal sessions have separate cleanup rules, and a row with a
resume token is repaired rather than casually deleted
([terminal handling](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/service.go#L1697-L1727);
[resume-safety invariant](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/persistence.go#L310-L353)).

### Agent process and executor

The lifecycle registry asks every runtime to recover instances at startup, but
all pinned production implementations examined return none:

- standalone processes are explicitly transient
  ([standalone](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/executor_standalone.go#L195-L199));
- Docker defers detection until session navigation
  ([Docker](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/executor_docker.go#L708-L713));
- SSH says startup metadata plumbing is future work, although resume can later
  reopen a tunnel to persisted remote agentctl metadata
  ([SSH](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/executor_ssh.go#L525-L542));
- Sprites also returns none at startup
  ([Sprites](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/executor_sprites.go#L530-L540));
- remote Docker is not implemented
  ([remote Docker](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/executor_remote_docker.go#L45-L63)).

Lazy resume first acquires a per-session in-memory mutex, rereads session state
inside the lock, and rejects uncertain or already-live executions
([resume lock and reread](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/executor/executor_resume.go#L632-L712)).
It writes `STARTING` before asking the lifecycle manager to launch, probes
liveness if launch reports “already running,” cleans confirmed stale state,
and retries once
([resume launch](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/executor/executor_resume.go#L475-L537)).

That protects concurrent resume requests in one coordinator and closes several
common duplicate-launch races. It does not provide a durable launch intent plus
authoritative process census. A process may survive an abrupt backend death,
especially remotely, while the next coordinator has only a row and a
runtime-specific probe.

### Agent session, context, and Agent Log

Native restoration passes the stored ACP session ID to `session/load` and
suppresses automatic replay of the task description
([resume strategy](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/executor/executor_resume.go#L895-L914)).
If native restoration is unavailable but history injection is enabled,
Kandev launches a fresh session and prepends a bounded text rendering of local
JSONL history to the next user prompt. User and assistant messages are
truncated to 2,000 characters and tool results to 500
([history injection](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/session_history.go#L201-L254)).
With neither capability the agent boots idle without restored context.

The SQLite conversation, JSONL injection history, runtime stream, and debug
log are therefore different artifacts. “Agent Log Agent Session” should be
modeled as agent-session identity plus recorded interaction evidence, not
collapsed into the worktree:

- the same worktree can be opened by a fresh provider session;
- the same durable task session can lose its native token;
- the SQLite transcript can survive when JSONL history is absent;
- logs can show a tool call without proving its side effect completed;
- no conversation artifact proves the index or untracked files survived.

### Complete Git worktree and file state

When the recorded path is still a valid worktree, Kandev returns it without a
reset, checkout, clean, stash operation, or base refresh
([reuse](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/manager_lifecycle.go#L78-L129)).
Therefore the exact local filesystem naturally preserves:

| Layer | Valid exact-worktree reuse | Missing/invalid worktree recreation |
|---|---|---|
| Current branch and committed `HEAD` | Preserved | Restored from the recorded local branch, or fetched remote branch tip |
| Staged index | Preserved | Lost |
| Unstaged tracked edits | Preserved | Lost |
| Untracked files | Preserved | Lost |
| Merge/rebase conflict state | Preserved as raw Git state | Lost; recreation checks out a branch |
| Stashes | Usually preserved in the shared Git common directory | May survive if the common repository survives, but Kandev does not associate or restore them |
| Ignored build/dependency/scratch files | Preserved | Lost unless separately regenerated or copied |

Recreation deletes the invalid target path, prunes Git worktrees, finds the
recorded branch locally or fetches it, and adds a new worktree at the same
path. A branch absent both locally and remotely is declared unrecoverable
([recreation](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/manager_lifecycle.go#L1017-L1089);
[recovery tests](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/manager_recreate_recovery_test.go#L28-L99)).
Thus committed-and-pushed work is the portable recovery floor. Committed but
unpublished work survives only while the local common Git directory and branch
survive. All uncommitted layers require the exact worktree.

## 6. Immediate recovery analysis

Consider a backend crash followed by a prompt within minutes:

1. SQLite reopens with task/session/message/queue rows.
2. Startup marks formerly active sessions waiting, abandons incomplete turns,
   repairs a dead local PID, and keeps resume/worktree metadata.
3. Workflow startup scans persisted queue markers and fills any newly
   available WIP slots.
4. Opening the session or prompting triggers lazy resume.
5. The worktree manager reuses the exact valid directory, so all committed and
   uncommitted Git layers are still present.
6. The resume lock rereads current session state. Kandev writes `STARTING`,
   launches or reconnects runtime-specific infrastructure, and only then starts
   the agent process asynchronously.
7. The agent loads native provider context, receives local history on its next
   prompt, or starts without context according to capability.

This is substantially better than “poll the task and start over.” The visible
task, session, conversation, queues, worktree, and usually agent context can all
return. The remaining hazards are boundary windows:

- the lifecycle execution can be live when its durable mirror write failed;
- a local or remote process can outlive the backend while startup recovers no
  instances;
- `STARTING` can be durable before the external launch result is known;
- asynchronous process start can fail after the resume call returned;
- a valid directory is trusted as-is rather than reconciled against a planned
  worktree identity and base SHA.

The liveness check is deliberately conservative during a 75-second startup
grace and otherwise asks PTY or agentctl state
([liveness probe](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agent/runtime/lifecycle/manager_interaction.go#L966-L1025)).
It reduces duplicates but cannot make an unreachable remote endpoint prove the
process dead.

## 7. One-week drift analysis

After a week, durable identifiers still select the task and session, but every
external boundary may have drifted:

- the provider's session token may have expired or become incompatible with a
  changed agent profile;
- Kandev-managed npm agent runtimes are not pinned, so a future fresh process
  may run different upstream code
  ([runtime policy](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/README.md#L98-L103));
- a remote SSH process, Docker container, or Sprite can disappear or retain
  stale state;
- credentials, executor profiles, setup scripts, repository provider paths,
  and default branches can change;
- the recorded worktree can remain exact, but if it is missing, recreation
  uses the surviving local or remote feature branch tip—not a serialized copy
  of its former index and files;
- the base branch can advance. `BaseBranch` is a name, and
  `BaseCommitSHA` is captured asynchronously from Git status for cumulative
  diff, not used as an immutable creation request
  ([base capture](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/executor/executor_execute.go#L1534-L1588));
- a PR may be merged, closed, retargeted, or updated outside Kandev.

The right week-later behavior is therefore reconciliation, not replay. Kandev
does some of this—session reread, liveness probes, path validation, branch
fetch, provider watch polling—but does not materialize one durable restoration
plan saying which facts are unchanged, which changed, and which require human
disposition.

## 8. Git and integration protocol

### Worktree creation and base

Worktree creation takes a per-repository in-memory lock, optionally fetches or
pulls a base branch, resolves a fallback branch, creates a feature branch and
worktree, and then stores the worktree record
([creation sequence](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/manager_lifecycle.go#L20-L75);
[base resolution](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/manager_lifecycle.go#L148-L202);
[persist boundary](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/manager_lifecycle.go#L205-L290)).
If record persistence fails, it tries to remove the Git worktree
([rollback](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/manager_state.go#L54-L69)).

The lock protects local worktree mutation in one backend process. It is not a
durable repository lease, and the persisted plan contains a base-branch name
rather than an exact planned Base SHA.

### Workspace Git operations

Each live `GitOperator` rejects a second Git operation while one is in progress
using an in-memory flag
([operator state](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agentctl/server/process/git.go#L38-L61);
[lock](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agentctl/server/process/git.go#L967-L989)).
Push targets the current feature branch and uses `--force-with-lease` when
force is requested
([push](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agentctl/server/process/git.go#L342-L385)).
Rebase fetches the base and auto-aborts conflicts; merge fetches the base and
leaves conflicts for the person or agent to resolve
([rebase and merge](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/agentctl/server/process/git.go#L388-L473)).

This is **workspace-operation serialization**, not **accepted-head
integration serialization**. The mutex belongs to one `agentctl` operator and
does not span worktrees, processes, or sessions.

### Accepted-head boundary

Kandev can ask GitHub/GitLab to merge a PR/MR. The forge performs its own
mergeability and target-branch checks. Kandev does not expose a protocol that:

1. records the target head it evaluated;
2. reserves a single integration slot;
3. persists intent before calling the forge;
4. observes the resulting accepted head;
5. reconciles an ambiguous response before retry; and
6. ties cleanup to that exact accepted result.

The GitHub service sends only the selected merge method to the merge endpoint;
it does not send GitHub's optional expected head SHA
([GitHub service](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/github/service_pr.go#L160-L183);
[PAT request](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/github/pat_client.go#L645-L655)).

Therefore broad claims that “Git operations are serialized” must not be read as
“Kandev has a serialized accepted-head integrator.” Human/forge review is the
integration boundary. That can be a valid product choice, but it is different
from Dalph's planned Base SHA and accepted-head protocol.

## 9. Layers, slices, and dependency direction

The production path is split into recognizable layers:

- task and workflow models/repositories own durable board and session facts;
- orchestrator services own workflow triggers, startup reconciliation,
  prompting, and session state transitions;
- executor orchestration translates a task session into a launch request;
- lifecycle owns live agent execution and runtime adapters;
- worktree owns local Git workspace creation and cleanup;
- `agentctl` owns process, stream, shell, file, and workspace Git operations;
- GitHub/GitLab services own provider API adaptation;
- `backendapp` is the large composition root.

This is a mostly vertical product architecture rather than one small
workflow-algebra interpreter. Interfaces at boundaries make units replaceable:
the executor depends on an `AgentManagerClient` and repository contracts
([executor ports](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/executor/executor.go#L26-L55);
[agent-manager port](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/executor/executor.go#L137-L178)).

The main reliability cost is split ownership across adjacent layers. For
example, lifecycle owns execution ID/status, orchestrator owns session state
and narrow token updates, Git owns worktree contents, and provider APIs own
accepted merge state. Comments document those boundaries well, but no single
durable attempt aggregate commits them together. Compensation and
reconciliation code consequently spans many services.

## 10. Production, test, fake, and dry-run paths

Production uses real SQLite/PostgreSQL repositories, Git commands, runtime
backends, `agentctl`, and provider clients. Tests replace those seams with:

- in-memory task/message-queue repositories;
- mock lifecycle managers and executor stores;
- fake Git executables for timeout and rollback paths;
- real temporary Git repositories for worktree recreation;
- mock GitHub/GitLab/provider clients;
- Docker/SSH/browser end-to-end shards where available.

The persistent message queue and its in-memory implementation share an
interface
([queue repository](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/orchestrator/messagequeue/repository.go#L5-L31)).
Worktree recovery tests use actual local repositories and remotes, which is
more convincing for Git semantics than a command-only mock
([worktree recovery test](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/apps/backend/internal/worktree/manager_recreate_recovery_test.go#L28-L99)).

There is no source-visible “dry run this whole orchestration workflow through
the production interpreter” mode. The `dry_run` found in the audited scope is
for rendering a share snapshot without uploading it, not for task execution.
Likewise, mocks and memory repositories are test doubles rather than a
production-shaped fake executor milestone. Kandev has excellent seams for
building such a mode, but the modes do not presently share one explicit
workflow algebra.

## 11. Verification strategy

The repository has extensive example-based Go tests across orchestrator,
runtime, worktree, database, provider, and race-sensitive paths. CI runs the Go
suite with `-race` and atomic coverage, separately exercises PostgreSQL
packages, and has focused `agentctl` race jobs
([backend CI](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/.github/workflows/backend-tests.yml#L138-L150);
[PostgreSQL and agentctl jobs](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/.github/workflows/backend-tests.yml#L211-L273)).
Playwright CI separately shards ordinary, container, and desktop end-to-end
tests
([E2E jobs](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/.github/workflows/e2e-tests.yml#L113-L123);
[container E2E](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/.github/workflows/e2e-tests.yml#L230-L241)).

Strong targeted examples include:

- concurrent resume rereads and stale/live execution cleanup;
- startup repair of executor rows and session/task states;
- transactional WIP admission and durable queue reconciliation;
- failed worktree-add rollback;
- missing-worktree branch recovery;
- quarantine cleanup and exact-path locks;
- stale execution IDs prevented from overwriting newer resume state.

Negative source and manifest searches found:

- no Go fuzz target (`func Fuzz...`);
- no property-testing dependency such as Rapid or Gopter;
- no TLA+, Quint, Alloy, PlusCal, or other model-checker artifact;
- no state-machine/model-based test harness for the end-to-end task/session/
  executor/worktree lifecycle;
- no crash-injection suite that kills the coordinator at every external
  boundary and restarts after immediate and week-long drift.

Race detection is valuable, but it cannot prove crash ordering, external-call
ambiguity, accepted-head safety, or complete Git restoration. Kandev's many
handwritten concurrency regressions are exactly the sort of behavior that
could be compressed into a smaller model and then generated as state-machine
tests.

## 12. Chronological failure walkthrough

The following follows one task from admission to merge and names the observable
crash windows.

### C0 — task creation and WIP admission

Kandev writes the task with either `wip_admitted = 1` or a durable destination
queue marker. A transaction prevents overfilling a limited step. Crash after
commit is recoverable; crash before commit leaves no task. This is one of the
stronger boundaries.

### C1 — session and workspace plan

Kandev creates a task session and derives worktree configuration from current
repository, branch, profile, and environment facts. The base is primarily a
branch name. If a week passes before materialization, that name can resolve to
a different commit. There is no required exact planned Base SHA at this
boundary.

### C2 — `git worktree add`

Git creates a branch/worktree before Kandev stores the worktree row. If storing
the row fails, Kandev compensates by removing the worktree. A hard crash between
Git success and DB persistence can still leave an orphaned branch/directory
because compensation did not run. Maintenance can later inventory or
quarantine files, but no intent row identifies this exact in-flight creation.

### C3 — execution registration

The lifecycle manager adds an in-memory execution and then best-effort upserts
`executors_running`. The source deliberately continues on persistence failure.
A crash here can leave a process/runtime with no durable mirror. This violates
intent-before-effect even though it favors user-visible launch availability.

### C4 — agent process start

On resume, session `STARTING` is durable before `LaunchAgent`, which is the
right direction for credential issuance. But launch has no durable operation
ID understood by every runtime. If the backend loses the response, it must
infer liveness from local PID, `agentctl`, container, or remote metadata. An
unreachable probe can be ambiguous rather than dead.

### C5 — agent turn and side effects

Turns and messages are durable, and startup abandons open turns. Tool calls can
cross Git, filesystem, shell, or provider boundaries before their final event
is stored. The Agent Log can then end before the effect even though the effect
occurred. A fresh provider context or history injection must inspect the
workspace and authorities rather than replay the last logged command.

### C6 — commit and push

A commit changes the local branch; a push changes the remote feature branch.
The per-operator mutex prevents overlapping UI Git commands only while that
`agentctl` lives. A lost push response has no Kandev intent/observation record.
Git can be reread manually or by the UI, but retry policy is not a
reconcile-before-retry state machine.

### C7 — PR/MR merge

Kandev calls the forge. The forge may accept the merge while the response is
lost. Provider polling can later observe merged state, but Kandev has not
reserved an accepted-head integration slot or recorded the evaluated target
SHA. Concurrent PRs are governed by forge branch protection and mergeability,
not a Kandev integration protocol.

### C8 — cleanup

Archive/cleanup can stop runtime, remove worktree, delete a local branch, or
quarantine uncertain filesystem material. Recreating after archive can restore
only a local or remote branch. If uncommitted state existed, deletion crossed
an unrecoverable boundary. Cleanup therefore needs an explicit “all relevant
work is committed/pushed or intentionally discarded” disposition, not merely a
terminal session state.

## 13. Reliability risks and gaps

1. **Execution intent is not durable before every launch effect.** The live
   in-memory execution is treated as truth and mirror failure is non-fatal.
2. **Runtime startup recovery is mostly empty.** Lazy resume is real, but it
   is not a complete census of surviving local/container/remote processes.
3. **A valid worktree is trusted, not reconciled.** This preserves valuable
   changes but cannot prove it is the exact planned attempt workspace.
4. **Missing-worktree recovery has a committed-branch floor.** Index,
   unstaged, untracked, conflict, and ignored state are unrecoverable.
5. **Base SHA is observational and late.** It supports diff display, not
   immutable attempt planning or recreate-at-the-same-base.
6. **Board WIP is not execution capacity.** Resource use, ambiguous attempts,
   provider quotas, and integration have no separate durable budgets.
7. **Agent context has split representations.** Provider token, SQLite
   transcript, JSONL history, logs, and worktree can drift independently.
8. **Fallback history is lossy and locally scoped.** A moved database does not
   necessarily move JSONL context.
9. **Git locks are local and per operator/repository operation.** They do not
   serialize target-branch acceptance.
10. **External effects lack a uniform intent/observation/reconcile protocol.**
    Git push, forge merge, runtime create, and cleanup each handle ambiguity
    differently.
11. **Documentation drift exists in a critical recovery claim.** Operators may
    overestimate automatic Docker recovery.
12. **Verification is example-heavy.** There is no formal model or systematic
    crash-point matrix spanning the composed lifecycle.

## 14. Ideas Dalph should borrow

1. **Separate task, session, and live execution.** Kandev's vocabulary prevents
   a conversation lineage from being mistaken for one OS process.
2. **Persist resume data independently from terminal cleanup.** Repairing a
   token-bearing executor row instead of deleting it is a valuable fail-safe.
3. **Reread session state inside the resume lock.** The fresh read directly
   prevents a stale terminal snapshot from killing or duplicating a new agent.
4. **Probe before cleaning “already running” state.** A conflict should trigger
   observation, not immediate destructive cleanup.
5. **Make WIP queue membership explicit.** `wip_admitted` plus destination and
   queue time is clearer than deriving queued status from position alone.
6. **Atomically count and promote.** Conditional queue predicates and a single
   write transaction are good patterns for durable admission.
7. **Persist prompts and deferred moves.** Durable per-session FIFO work makes
   restart behavior inspectable.
8. **Preserve exact worktrees by default.** Reuse without reset protects every
   Git layer when the directory is valid.
9. **Classify branch recreation failures.** Distinguishing confirmed missing
   remote state from transient fetch/auth errors avoids destructive fallback.
10. **Use narrow compare-and-swap writes for execution-scoped observations.**
    A stale process must not overwrite the current execution's token or state.
11. **Test with real temporary Git repositories.** Git semantics deserve more
    than mocked command output.
12. **Run race-enabled CI and provider-shaped E2E tests.** These complement,
    but do not replace, model checking and crash tests.

For Dalph, these should sit beneath the stronger invariant Kandev lacks: one
durable task attempt owns an exact worktree and planned Base SHA, and each
ambiguity-crossing effect records intent, observes the authority afterward,
and reconciles before retry.

## 15. Unknowns and negative searches

Unresolved from reachable pinned evidence:

- whether every native agent provider gives durable, week-long semantics to
  its ACP resume token;
- whether Docker's lazy `EnsureWorkspaceExecutionForSession` path can
  distinguish every surviving container/process shape after an unclean host
  restart;
- how often real installations separate the SQLite data directory, worktree
  root, JSONL history, Docker volumes, and Git common directories across
  different backup/retention policies;
- which GitHub/GitLab branch-protection and merge-queue settings operators
  normally use;
- whether every cleanup path checks unpublished/uncommitted work before branch
  deletion;
- whether PostgreSQL deployments are intended to support multiple concurrent
  backend coordinators;
- how migrations are validated against the full population of old production
  database shapes rather than selected fixtures.

Negative searches covered source, tests, manifests, and CI for property-test
libraries, fuzz targets, model checkers, formal specifications, durable
accepted-head locks, exact planned Base SHA enforcement, a production workflow
dry-run, and systematic coordinator-kill tests. None was found. “None found”
means no reachable implementation at this pin, not proof that an external
deployment cannot add one.

## 16. Consequences for the synthesis

Kandev demonstrates the strongest local persistence and restoration story in
this comparison set so far. A task, workflow queue, conversation, executor
metadata, and exact surviving worktree can all outlive the coordinator. Its
best patterns are concrete: durable WIP admission, lazy session recovery,
fresh-state rereads under lock, resume-token preservation, real Git worktree
reuse, and branch-aware recreation.

It also shows why “persistent session management” is not the same as a
crash-safe orchestrator:

- the live runtime can cross a boundary before its mirror is durable;
- process recovery depends on runtime-specific lazy probes;
- agent context, transcript, logs, and workspace are independent;
- complete Git restoration ends when the exact worktree is lost;
- board WIP does not bound execution responsibility;
- workspace Git serialization is not accepted-head integration; and
- no single attempt journal orders all external effects.

The synthesis should therefore borrow Kandev's restoration mechanisms without
borrowing its authority split wholesale. Dalph should keep the tracker
authoritative for task lifecycle, Git authoritative for lineage and accepted
refs, the executor authoritative for live observations, and its own journal
limited to workflow history. Around those authorities it should add what
Kandev's product architecture does not: exact attempt identity and Base SHA,
durable intent/observation pairs, reconcile-before-retry, explicit
responsibility capacity, disposition-typed cleanup, serialized accepted-head
integration, and one production-shaped workflow algebra shared by live fake,
dry-run, tests, and production.
