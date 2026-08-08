# Agent Kanban reliability architecture card

## 1. Scope, pin, and evidence boundary

This card audits Agent Kanban at commit
[`a26bef6e4f657ed8217eca79b0b90a3a1a8ac198`](https://github.com/saltbo/agent-kanban/tree/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198).
The evidence is the pinned source, migrations, manifests, tests, CI, and design
documents. No service was installed and no crash experiment ran.

The most important scope boundary is that the current production path delegates
agent execution to **Any Managed Agents (AMA)**. Agent Kanban creates and
observes AMA sessions through `@any-managed-agents/sdk`, while `ak start`
downloads a separately released `ama-runner` binary. Neither the AMA server nor
the runner implementation is present at this pin
([SDK boundary](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/amaRuntime.ts#L1-L17),
[runner download and pin](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/amaRunner.ts#L8-L20)).
This card can establish which request Agent Kanban sends and what it records,
but cannot prove AMA's internal lease, runner admission, process adoption,
workspace persistence, or provider-session restoration.

The repository still contains a substantial legacy local-daemon implementation
with worktrees, provider adapters, local session files, and recovery code. The
repository instructions explicitly say AMA is the current runtime source of
truth and the old daemon scheduler is deprecated
([project instruction](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/AGENTS.md#L38-L46)).
Legacy code is useful maintenance and test evidence, but it is not evidence for
the reachable AMA production path unless a current caller reaches it.

The comparison uses Dalph's one-coordinator assumption. Agent Kanban's
Cloudflare Worker may receive overlapping requests and cron invocations, but
this card does not require active-active Dalph-style coordinators. Where Agent
Kanban claims cross-machine behavior, the audit asks whether its own pinned
source actually enforces that behavior.

## 2. Plain-language architecture

Agent Kanban is a product-owned task board backed by Cloudflare D1. Tasks,
dependencies, assignments, lifecycle state, task actions, machine records, and
Agent Kanban session identities are durable rows. A Hono API validates
identities and transitions. A scheduled Cloudflare Worker periodically:

1. marks stale machines offline;
2. stops and releases stale tasks;
3. reconciles task rows with AMA sessions;
4. releases stale dispatch claims;
5. selects a runtime source; and
6. dispatches runnable assigned tasks
([scheduled order](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/worker/index.ts#L19-L42)).

In ordinary language, the current delivery path is:

```text
leader or human
  -> creates/assigns a D1 task
  -> Agent Kanban marks the task "dispatching"
  -> Agent Kanban asks AMA to create a session
  -> AMA runner or cloud sandbox runs the coding agent
  -> the agent claims the already-assigned task in D1
  -> the agent creates a branch and pull request
  -> the agent submits the task for review
  -> a human/leader/GitHub merges or completes it
  -> Agent Kanban records Done and asks AMA to close the session
```

Dispatch and task claim are separate. Assignment chooses a persistent Agent
Kanban worker identity. Dispatch creates an AMA execution session while the
task is still `todo`. The agent later changes the task to `in_progress` through
the claim endpoint
([dispatch preconditions and session setup](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L71-L125),
[claim route](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/routes.ts#L1792-L1804)).

This is a database-backed state machine plus external session control, not an
event-sourced workflow. `tasks` holds current state. `task_actions` is a
timeline and lookup aid; current task state is not rebuilt by replaying it
([task schema](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/migrations/0001_initial.sql#L245-L278),
[task action schema](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/migrations/0024_task_actions_dispatch.sql#L4-L24)).

## 3. State-owner table

| Fact | Authority at this pin | Copies or observations | Reliability consequence |
|---|---|---|---|
| Task identity and lifecycle | D1 `tasks` row | `task_actions` records transitions | Current state survives Worker restarts. The action log explains some transitions but is not a replay journal. |
| Dependency graph | D1 `task_dependencies` | `blocked` is computed on reads/dispatch | Eligibility is fresh when read, but not atomically coupled to dispatch or claim ([blocked query](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDeps.ts#L28-L46)). |
| Assignment | `tasks.assigned_to` | assignment action and temporary metadata token | Conditional update admits one assignment winner; the token associates the action with that update ([assignment transaction](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskRepo.ts#L447-L509)). |
| Worker claim | `tasks.status=in_progress`, assignee, claimed action | temporary `runtime.claimToken` exists only inside the batch | The conditional D1 batch prevents two successful transitions from `todo`, but has no lease and no ambiguous-response recovery protocol ([claim batch](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskRepo.ts#L382-L445)). |
| Dispatch-in-progress ownership | `ama.dispatch.result=dispatching` in task metadata | task `updated_at` supplies claim age | A conditional update coordinates request and cron dispatchers. It has no claimant identity or fencing token, and becomes stealable by timeout after five minutes ([dispatch claim](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L601-L655)). |
| Selected runtime source | task metadata annotation `runtime.source` | machine/AMA availability is reread | Selection uses a compare-and-set while the task is unbound ([runtime-source CAS](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/runtimeBindingRepo.ts#L60-L100)). |
| AMA execution identity | AMA owns its session; D1 stores AMA project/environment/session IDs | Agent Kanban also creates an `ama_agent_sessions` identity row | A successful final annotation relates task and session. A crash before that annotation can leave an externally created session with no task pointer. |
| Agent context and tool log | AMA session/event store | Agent Kanban exposes token-bearing WebSocket backfill and live stream | History may be viewable after task completion, but its durability and retention belong to AMA ([socket boundary](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/amaRuntime.ts#L1398-L1412)). |
| Runner capacity and live process | AMA runner/server | Agent Kanban reads `currentLoad`, `maxConcurrent`, status, and heartbeat | The pin contains an admission precheck, not the authoritative cross-machine admission transaction. |
| Repository registration | D1 repository URL and task `repository_id` | AMA receives a GitHub resource reference | Agent Kanban does not store an attempt worktree, branch, or resolved base commit. |
| Git worktree and all WIP layers | AMA runner/sandbox filesystem and Git | task stores PR URL only | Agent Kanban cannot independently prove preservation of index, unstaged, untracked, ignored, conflict, or stash state. |
| Integration result | GitHub PR and target ref | D1 `pr_url` and task status | GitHub/human performs the merge. Agent Kanban observes a signed webhook and records Done; it does not serialize or compare-and-swap target updates. |
| Retry time | task metadata `ama.dispatch.attempts` and `nextRetryAt` | cron consults it | Exponential retry survives Worker restarts but is a mutable annotation, not an attempt row ([backoff](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L815-L871)). |
| Cleanup state | AMA session state, AK session row, and task annotations | cron reconciles leftovers | Cleanup crosses external session close, credential revocation, AK session close, then metadata update; partial cleanup is repaired operation by operation. |

## 4. Scheduling, claims, and capacity

### Runnable work

Dependencies are a normalized DAG. Creation checks for a cycle with a recursive
CTE, then later inserts the task and edges in a D1 batch
([cycle query](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDeps.ts#L5-L26),
[creation batch](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskRepo.ts#L109-L172)).
A dependency is satisfied when its task is `done` **or `cancelled`**. A task is
blocked for every other dependency status
([blocked semantics](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDeps.ts#L28-L45)).

The current scheduler does not choose the highest-priority unassigned ready
task. Tasks are assigned by a leader, human, or machine first. The cron scans
`todo`, assigned, due, AMA-routed tasks whose dispatch result is null, then
recomputes `blocked` and dispatches sequentially
([pending scan](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L661-L693)).
`position` orders ordinary task lists, but this scan has no `ORDER BY`, so the
database does not promise priority order.

### What is actually atomic

The worker claim deserves a narrower and stronger description than “distributed
claim.” It performs:

1. a preliminary task read and transition validation;
2. a conditional update requiring `todo`, the expected assignee, and expected
   runtime source;
3. a claimed-action insert guarded by a unique temporary token; and
4. token removal,

inside one `db.batch`
([claim implementation](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskRepo.ts#L382-L445)).
That is source-reachable atomic exclusion for the D1 task row. The test suite
checks source mismatch and action/token consistency, but no focused concurrent
two-claim test was found
([claim tests](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/tests/task-state-machine.test.ts#L338-L404)).

It is **not** a dependency-aware claim. Neither `claimTask` nor its route checks
`computeBlocked`. Dependency eligibility is checked earlier, before the
external session is created. Dependencies can also be replaced by a separate
cycle-check-then-batch sequence with no task-status guard
([dependency update](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskRepo.ts#L313-L359)).
Thus graph mutation can race with dispatch, and a correctly authenticated
assigned worker can claim a task that has become blocked. The graph is an
eventually consulted scheduling predicate, not part of claim isolation.

The assignment operation also has a conditional winner, and a Miniflare test
starts two concurrent assignment calls and observes exactly one action
([assignment race test](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/tests/task-state-machine.test.ts#L605-L635)).
Other lifecycle transitions are weaker: they validate a pre-read state, then
perform an unconditional status update in a later batch. For example, review
and complete do not put their expected source status in the `UPDATE`
([review](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskRepo.ts#L619-L645),
[complete](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskRepo.ts#L565-L590)).
Concurrent valid-looking requests can therefore pass validation against the
same old row and later overwrite one another.

### Capacity across machines

For a self-hosted AMA environment, Agent Kanban lists candidate runners and
chooses the first whose reported `currentLoad` is less than
`maxConcurrent`, whose heartbeat/runtime is acceptable, and whose quota is not
exhausted
([runner predicate](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L461-L478),
[runtime health and quota](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/runtimeRouter.ts#L19-L47)).
`ak start --max-concurrent` passes the configured integer to the downloaded
runner
([runner arguments](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/commands/start.ts#L127-L142),
[start option](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/commands/start.ts#L388-L425)).

This repository does not atomically reserve that reported slot. It reads load,
then later calls `sessions.create`. Two Agent Kanban dispatches can both observe
the same free slot. Whether AMA rejects, queues, leases, or safely admits only
one belongs to external AMA source. There is no Agent Kanban-wide limit summed
across machines. Cloud machines skip the runner gate entirely because the code
assumes the external sandbox plane scales per session
([candidate selection](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L128-L150)).

Therefore the broad claim “max concurrency across machines” is not established
at this pin. What is established is:

- one conditional dispatch claim per task in D1;
- a per-runner configured limit passed to AMA;
- an Agent Kanban-side load precheck; and
- an external AMA admission boundary.

An `in_progress` task is not itself counted against a D1 capacity counter.
Capacity comes from AMA's live runner report. After loss of that report,
Agent Kanban cannot prove from D1 alone how many old processes still consume
slots.

## 5. Restoration layers

### 5.1 Control-plane task and run

The task row, assignment, dependency edges, action timeline, dispatch
annotations, retry timestamp, and AK/AMA session rows survive a stateless
Worker restart in D1. The schema has task and session identity but no distinct
durable task-attempt row
([AMA session table](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/migrations/0022_ama_runtime_integration.sql#L27-L46)).
A re-dispatch generates a new AK session ID and a new AMA session, while task
metadata retains the prior AMA session ID as a historical pointer
([new identity](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L774-L783),
[binding teardown](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L520-L554)).

That is task recovery with mutable attempt annotations, not reconstruction of
one exact attempt and all its boundary effects.

### 5.2 Agent session, context, and logs

When a reviewer rejects an `in_review` task, Agent Kanban sends a prompt to the
same stored AMA session, then changes the task back to `in_progress`
([same-session rejection message](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L480-L517),
[reject ordering](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/routes.ts#L1912-L1934)).
This is a real same-session command at the Agent Kanban API boundary.
Whether AMA resumes the same provider conversation, recreates a provider
process, or merely appends a new turn is not visible here.

If AMA says the session is 404 or 409, the reachable route returns the error
and leaves the task `in_review`; it does not implement the restart fallback
described in the AMA design document. A test explicitly expects this retained
state for an archived session
([archived-session test](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/tests/ama-dispatch-sweeps.test.ts#L1494-L1536)).

Session events and tool history are stored by AMA, not copied into D1. Agent
Kanban obtains a token-bearing WebSocket and requests paginated backfill; the
CLI deduplicates and orders returned events
([history reader](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/sessionWs.ts#L219-L305),
[backfill protocol](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/sessionWs.ts#L303-L359)).
If AMA history is unavailable, D1 task actions and messages remain, but they
are not the provider transcript or tool-call history.

### 5.3 Complete Git worktree

For cloud sessions, Agent Kanban asks AMA to mount a Git repository. Its prompt
then tells the agent to note the clone's current branch, create
`ak/<task-id>`, stage all changes, commit, push, and open a PR
([Git resource mount](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/amaRuntime.ts#L433-L462),
[cloud Git workflow](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L906-L955)).

Agent Kanban stores none of:

- clone/worktree locator;
- resolved base commit;
- current `HEAD`;
- index contents;
- unstaged changes;
- untracked or ignored required files;
- conflict stages;
- stash refs; or
- worktree registration.

Consequently it cannot classify complete worktree restoration. A same AMA
session may retain its sandbox, but that is an AMA property. After reconciliation
closes a dead session and dispatches a new one, Agent Kanban supplies the task
and repository again; it does not import old uncommitted WIP.

The legacy daemon has a concrete local worktree locator and provider resume
token in an atomic JSON session file
([legacy session shape](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/session/types.ts#L19-L60)).
It restores the same directory for rate-limited/rejected sessions
([legacy resumer](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/daemon/resumer.ts#L23-L91)).
But on ordinary crash cleanup it force-removes the worktree and branch, and
the repository helper can stash a dirty shared clone without recording the
stash identity
([legacy workspace cleanup](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/workspace/workspace.ts#L35-L49),
[legacy Git operations](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/workspace/repoOps.ts#L29-L63)).
Those legacy facts must not be promoted to current AMA guarantees.

### 5.4 Live process, PTY, container, or VM

The current local CLI supervises only the detached `ama-runner` PID. It writes
that PID and runner configuration locally, and `ak status` combines OS PID
liveness with server-reported heartbeat
([runner spawn and state](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/commands/start.ts#L301-L349),
[status check](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/commands/start.ts#L455-L501)).
It has no current Agent Kanban record for the coding-agent PID, process tree,
PTY, or open handles. `ak stop` signals the runner PID, waits ten seconds, then
uses SIGKILL if necessary
([stop behavior](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/commands/start.ts#L563-L587)).

AMA owns the session/process relationship. The current Agent Kanban
reconciler asks AMA for session state; it does not adopt an observed OS process.
A live process with a lost AMA session record would therefore be outside Agent
Kanban's ownership evidence.

## 6. Immediate restart

### Web/API coordinator restart

The Cloudflare Worker has no in-memory task scheduler state that must be
rehydrated. New requests read D1, and the next minute cron reruns the
reconciliation chain. A live AMA session whose task metadata is complete is
reread by ID and left alone unless its state is dead, idle-before-claim, or
stale pending
([reconcile classification](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L695-L772)).

This is robust for a stateless Worker restart, but it does not solve an
ambiguous external session creation. The sequence is:

1. create AK session identity and vault credential;
2. call AMA `sessions.create`;
3. store the returned AMA ID in the AK session row;
4. annotate the task as accepted
([dispatch boundary](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L152-L239)).

If AMA creates the session but the response is lost, Agent Kanban has no AMA
session ID to close or reread. The catch path revokes the credential, closes
the AK session, and records failure, while the later stale-claim sweep sees no
recorded runtime binding and simply clears `dispatching`. A retry can create a
second AMA session. No idempotency key is supplied by
`createAmaTaskSession`
([AMA create call](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/amaRuntime.ts#L374-L402)).

### Local runner restart

`ak restart` stops the manifest PID and starts a freshly downloaded/pinned
runner using saved onboarding and credentials
([restart command](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/commands/start.ts#L505-L557)).
The Agent Kanban source does not enumerate or adopt that runner's child
sessions. Whether existing AMA sessions resume on a replacement runner is a
confirmed external unknown, not a source-backed Agent Kanban guarantee.

### Operator-visible recovery

The operator can see:

- local runner PID, uptime, configured concurrency, API origin, and server
  heartbeat through `ak status`;
- task status, assignment, dependencies, PR, notes, and messages;
- AMA session identity/state when the binding resolves; and
- AMA event history when the session WebSocket remains available
([task-session routes](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/routes.ts#L1671-L1747)).

There is no operator command in this pin that displays all Git layers or
quarantines an uncertain AMA workspace.

## 7. Restart after a week and external drift

Time changes several independent facts:

- A task with no action for 24 hours while `in_progress` is considered stale.
  The cron first asks AMA to close its binding, then releases the task to
  `todo`
  ([stale timeout](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/shared/src/constants.ts#L33-L42),
  [stale sweep](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskStale.ts#L34-L55)).
- Dispatch claims older than five minutes are cleared. If task metadata names
  a binding, Agent Kanban tries to close it first; if the external session was
  created but its ID was never recorded, that orphan is invisible.
- A missing AMA session is tolerated for two minutes, then an `in_progress`
  task is released. A `pending` session older than ten minutes is closed and
  retried
  ([reconcile time rules](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L695-L767)).
- `in_review` tasks are not subject to the 24-hour stale query. They can remain
  indefinitely, but a week-later rejection fails if AMA has archived or lost
  the referenced session.

Dependency drift is reread before each pending dispatch, so a formerly blocked
task can become eligible. The opposite race remains: dependency edits after
the check are not fenced with dispatch or claim.

Target-branch drift is not represented in D1. A new cloud session receives a
new clone/mount and is told to create its branch from whichever default branch
the clone currently has. It can silently start from a later commit. An old
same-session workspace may instead retain the older checkout. Agent Kanban
does not compare these cases or ask the operator to choose.

If the old workspace disappears but a pushed branch/PR survives, GitHub remains
the recovery artifact. If only staged, unstaged, untracked, ignored, conflicted,
or stashed WIP existed, Agent Kanban has no durable copy or disposition record.

## 8. Git starting point and integration behavior

### Starting point and workspace identity

The task stores a repository ID, not a fixed Base SHA. Agent Kanban gives AMA a
GitHub repository resource. The cloud prompt explicitly reads the clone's
current branch and creates a task-named branch from it
([resource lookup](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L958-L985),
[branch instructions](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L929-L940)).
This favors freshness and simplicity. It sacrifices reproducible retry from an
explicit planned commit.

Branch identity is deterministic by task ID for the cloud prompt,
`ak/<task-id>`, but it is not stored as a task field and a retry is again told
to `checkout -b` the same name. The behavior when the remote branch already
exists or a new clone sees it is left to Git/agent reasoning; Agent Kanban has
no branch adoption protocol.

### Handoff and integration boundary

The coding agent, not Agent Kanban, stages, commits, pushes, creates the draft
PR, marks it ready, and supplies its URL when moving the task to `in_review`.
The D1 review transition stores that URL and an action
([review transition](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskRepo.ts#L619-L645)).

Agent Kanban does not merge candidate commits or advance the target ref. A
human, leader agent, GitHub rule, or external merge mechanism owns that
decision. A signed GitHub `pull_request: closed` webhook:

- completes an `in_review` task if the PR was merged;
- cancels it if closed without merge; and
- refuses to mark an `in_progress` task done even if its PR already merged
  ([webhook transition](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/githubWebhook.ts#L30-L97)).

There is no accepted-head integration protocol, merge mutex, target CAS, or
separate integration capacity in this repository. That is not necessarily a
defect: the product boundary is PR handoff and review visibility. It means
Dalph's unattended serialized integration would be a materially different
responsibility.

An ambiguous branch push is left to the agent/Git client. An ambiguous merge
is reconciled by the eventual GitHub webhook rather than by Agent Kanban
rereading a target commit. Duplicate closed webhooks find no eligible `done`
row and become harmless no-ops, but cleanup happens before D1 completion; an
external cleanup success followed by a D1 error can temporarily leave
`in_review` with a closed session until webhook retry.

## 9. Code organization by layers and end-to-end slices

### Layers

The code has recognizable layers:

- shared task transition policy and types in `packages/shared`;
- thin D1 repositories for tasks, agents, machines, sessions, and boards;
- Hono routes for authorization and orchestration;
- AMA SDK adapter functions;
- Cloudflare Worker cron/fetch entry point;
- CLI commands and local runner launcher; and
- React observation/review UI.

The pure task state machine is small and readable
([transition table](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/shared/src/taskStateMachine.ts#L1-L61)).
SQL is generally kept in repo modules, and AMA wire shapes are normalized in
one large adapter. Those are useful separations.

The boundary between policy and effects is less complete. `dispatchTaskToAma`
coordinates dependency reads, D1 claim, machine selection, agent lookup,
vaults, credentials, GitHub tokens, session creation, cleanup, annotations,
and timeline events in one function. `routes.ts` also contains multi-boundary
assignment compensation. Failures are mostly exceptions and HTTP status
inspection rather than a closed typed failure algebra.

### End-to-end slices

“Assign and launch one task” crosses:

```text
route
 -> runtime availability/router
 -> conditional assignment batch
 -> dispatch claim
 -> machine/runner scan
 -> AK session identity
 -> AMA vault credential
 -> GitHub installation token
 -> AMA session create
 -> session bind
 -> task metadata annotation
 -> task action
```

The order is explicit and comments document several ambiguous windows, which
helps maintenance. It is still operation-specific recovery: stale dispatch,
dead session, task timeout, assignment rollback, credential cleanup, and
webhook completion each have separate repair logic.

There is also an old local-daemon architecture still compiled and heavily
tested: provider registry, local worktree manager, runtime pool, session
reducer, resumer, orphan cleanup, rate limiter, and tunnel. Its pure reducer
owns the persisted worker-session states `active`, `rate_limited`, `in_review`,
`completing`, and `closed`; `SessionManager.applyEvent` serializes a read,
transition, and file rewrite for one session. It is not the current AMA
session state machine.

The Git history makes the migration unusually explicit. The reducer arrived
in the April daemon-stability rewrite
([introduction](https://github.com/saltbo/agent-kanban/commit/c8490f539399f44a89c6b9bf849ec6616bbaeae0)).
After `ak start` had been changed to launch AMA's runner, the project deleted
the daemon as unreachable code
([deletion](https://github.com/saltbo/agent-kanban/commit/a339584957f07642d0eebd9987a92412da2002d6)).
Eight days later it restored the source and tests to keep the AMA migration
additive and reviewable; that commit explicitly calls the restored subsystem
dead and defers final deletion
([restoration](https://github.com/saltbo/agent-kanban/commit/0043dc5f4a8dda588282710677a9d986c3647820)).
Later server work added sticky routing so old daemon clients and AMA runners
could coexist without double execution
([compatibility routing](https://github.com/saltbo/agent-kanban/commit/5de9f2b5813f84ef807cc00be0caff6612ab44b1)).
Thus the product did not reject reducer architecture; it moved execution
ownership to AMA and retained compatibility for older clients.

Maintaining both mental models raises the chance that documentation or tests
describe a path the current CLI does not run. The README still says the daemon
polls tasks and creates worktrees, while current `ak start` launches AMA runner
([README description](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/README.md#L29-L105),
[current start implementation](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/commands/start.ts#L301-L425)).

## 10. Production, test, fake, and dry-run dependency seams

| Boundary | Production seam | Test substitute | Assessment |
|---|---|---|---|
| D1 | `D1Database` passed into repo functions | Real D1 under Miniflare migrations | Strong database-level tests without production cloud state. |
| AMA API | Direct imports from `amaRuntime.ts`, backed by generated SDK | Global `fetch` stubs returning AMA-shaped responses | Good HTTP determinism, but no explicit injected AMA service interface and no external server concurrency proof. |
| Scheduler clock | Direct `Date.now()` / `new Date()` | Some tests write old timestamps; unrelated legacy tests use fake timers | Enough for examples, not a shared clock service for the current recovery model. |
| Git/workspace | External AMA volume in current path | Current tests assert request shapes, not a real all-layer workspace | No current fake executor proving WIP preservation. |
| Provider | AMA external in current path | Legacy provider registry supports injected fakes | Strong legacy tests do not automatically qualify current AMA behavior. |
| GitHub webhook | Signed HTTP payload plus D1 | Miniflare and HMAC fixtures | Good route-level state-transition coverage. |
| Runner/process | Downloaded detached `ama-runner` | Spawn and PID mocks in CLI tests | Tests launcher behavior, not runner adoption or child survival. |
| Dry-run | None found for assignment/dispatch/recovery | A `--dry-run` appears only in mock chat-page sample text | Production and fake do not interpret one common workflow algebra. |

The tests' Miniflare helper applies real migrations and uses a real D1 binding
([dependency test fixture](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/tests/task-dependencies.test.ts#L1-L78)).
AMA sweep tests stub `fetch` and exercise multiple error responses, giving
good deterministic coverage of Agent Kanban's side of the boundary
([independent dispatch isolation](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/tests/ama-dispatch-sweeps.test.ts#L619-L682)).

## 11. Verification inventory

### Present

- **Pure state-machine tests.** Both shared task transitions and the deprecated
  local session reducer have focused transition tests; the reducer is
  exhaustive and rejects illegal transitions
  ([legacy reducer](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/packages/cli/src/session/stateMachine.ts#L1-L68),
  [crash classification tests](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/tests/session-state-machine.test.ts#L263-L306)).
- **Real database integration tests.** Miniflare D1 tests cover migrations,
  dependencies, transition rows, tenant scoping, staleness, and concurrent
  assignment.
- **Current dispatch/reconcile tests.** These cover dependency deferral,
  runner-busy behavior, failure isolation, missing/dead/pending/idle sessions,
  stale dispatch claims, backoff, credential cleanup, and reject delivery
  ([reconcile missing-session cases](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/tests/ama-dispatch-sweeps.test.ts#L924-L1018)).
- **Webhook integration tests.** They validate HMAC signatures and PR-driven
  task transitions with Miniflare
  ([webhook test scope](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/tests/github-webhook.test.ts#L1-L18)).
- **Provider/stream fakes.** Legacy provider SDKs and WebSockets have detailed
  mocks; session event ordering/deduplication is directly tested.
- **Smoke scripts.** The repository contains daemon, maintainer, agent-soul,
  and dual-version scripts, including a parallel local/cloud dispatch smoke
  path.
- **CI gates.** Pull requests run lint and Vitest; Windows separately builds
  and loads the native process-tree addon and runs CLI tests
  ([CI workflow](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/.github/workflows/ci.yml#L1-L47)).

### Not found after X-ray search

Searches covered package manifests/lockfile, source, tests, scripts, CI,
designs, specs, and filenames. No property-based testing library or property
suite, model-based testing framework, Quint/TLA+/Alloy specification, model
checker, database invariant checker beyond example tests, or end-to-end
kill-and-restart test of the **current AMA path** was found. The repository has
many example-based concurrency and timestamp tests, but not randomized
schedules or formal verification.

No test was found that:

- runs two concurrent worker claims against the same task;
- mutates dependencies between eligibility check and dispatch claim;
- loses the successful AMA session-create response;
- restarts the external AMA runner with all Git layers present;
- proves global capacity across multiple machines; or
- loses a successful branch push/target merge response.

These are evidence gaps, not claims that the deployed AMA system fails them.

## 12. Chronological failure table

| Boundary | Persisted fact and restart read | Likely source-level result | User-visible consequence |
|---|---|---|---|
| 1. Stop before task claim | Task remains `todo+assigned`; AMA session may already exist because dispatch precedes claim. Cron rereads task and AMA session. | If session remains live, no new dispatch. If it becomes idle without claim, reconciliation closes it and retries with backoff. | Work has not started; retry is automatic, but it may consume a short-lived session. |
| 2. Claim applied, response lost | D1 has `in_progress`, assignee, claimed action/session ID. Retry sees invalid source state. | There is no response-verification helper. The prompt tells an agent whose claim fails to stop. An AMA session that goes idle while task is `in_progress` is not classified as `idleUnclaimed`, so it can remain until the 24-hour stale sweep. | Board says running although the agent may have stopped; eventual timeout releases it. |
| 3. Workspace created, control record missing | Workspace creation is inside external AMA session startup. AK may know no AMA ID if create response was lost. | Five-minute dispatch timeout clears the claim; invisible external session/workspace is not closed, and retry may duplicate it. | Possible orphan execution and duplicate task session; exact workspace recovery is unknown. |
| 4. Agent started, start response lost | Same ambiguous AMA `sessions.create` boundary; no client idempotency key. | Catch cleans only resources whose IDs AK knows. Later dispatch can create another session. | Potential duplicate provider work and capacity use. |
| 5. Agent finishes, result not recorded | AMA event/session may say idle/completed, but task remains `in_progress` unless agent submitted review. | Reconciler treats non-dead session states on `in_progress` as live and does not reconstruct review from Git or events. After 24 hours, stale sweep closes/releases it. | Completed code may exist only in workspace/branch; board can remain running for a day. |
| 6. Branch push succeeds, response lost | Remote branch is GitHub authority; AK has no push intent/result. | Agent must inspect/retry. AK neither rereads remote ref nor deduplicates PR creation. | Manual/agent reconciliation; task may stay `in_progress`. |
| 7. Merge succeeds, webhook response lost | GitHub target and PR are authoritative. D1 may still be `in_review` or may already be `done`. | GitHub redelivery eventually completes it. Once `done`, query filter makes another event a no-op. AK does not verify target SHA itself. | Usually converges through webhook delivery; no accepted-head explanation in AK. |
| 8. Immediate graceful close/reopen | Web/D1 state persists; local runner PID is stopped/restarted; AMA owns active sessions. | Worker restart is stateless. Runner-session restoration cannot be proven from this repo. | Board and history return; live agent/workspace continuity depends on AMA. |
| 9. Week later with task/target drift | `in_progress` task is stale after 24h; `in_review` persists; dependencies are reread; no base SHA exists. | Old active binding is closed/released when possible. Re-dispatch may start from current target. Archived review session blocks same-session reject with 404/409. | Old WIP may be inaccessible; retries can receive newer repository state; operator may need complete/cancel/manual PR recovery. |

The C1 nuance follows directly from reconcile classification: `idleUnclaimed`
is restricted to `todo`, while any non-dead status on `in_progress` is treated
as progressing
([classification](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L730-L750)).
This should be fault-tested before turning it into a deployed-behavior claim.

## 13. Maintenance risks

1. **The real executor is outside the audited tree.** Agent Kanban's central
   reliability claims now depend on AMA server/runner semantics and a separately
   downloaded binary. Version pinning helps reproducibility, but maintainers
   need a cross-repository compatibility and fault-test story.
2. **Two runtime architectures remain.** Current AMA orchestration coexists
   with the deprecated daemon's worktrees, provider processes, local state
   machine, and recovery tests. Documentation already mixes the two.
3. **Mutable JSON annotations act as an attempt record.** Read-modify-write
   `annotateTask` stores dispatch, retry, environment, agent, and session facts
   in one metadata object through generic `updateTask`
   ([annotation helper](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskDispatch.ts#L786-L813)).
   It lacks a schema, revision, and append-only boundary history.
4. **Only claim and assignment get strong conditional transitions.** Review,
   reject, release, complete, and cancel validate then unconditionally update,
   leaving lost-update races.
5. **Graph eligibility and admission are split.** This keeps SQL simple, but
   dependency changes can invalidate a dispatch after its check.
6. **Recovery is a set of timed heuristics.** Five-minute dispatch claim,
   two-minute missing session, ten-minute pending session, and 24-hour task
   stale thresholds address distinct cases. They do not prove executor
   ownership before freeing task state.
7. **Cleanup crosses authorities without an intent record.** Closing AMA,
   collecting usage, revoking session/Git credentials, closing AK session, and
   clearing metadata can fail between any two calls.
8. **Action cursor and retention are lossy for diagnosis.** Task actions have a
   500-row hard ceiling, and a timestamp-only incremental cursor can skip rows
   sharing a millisecond
   ([action read limitation](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/apps/web/server/taskRepo.ts#L734-L752)).

## 14. Ideas Dalph should consider

- **Use conditional tokens to bind row change and timeline entry.** Agent
  Kanban's temporary claim/assignment token is a compact way to ensure the
  action corresponds to the winning update. Dalph can borrow the pattern while
  retaining typed attempt identity.
- **Separate runtime-source routing from task lifecycle.** The compare-and-set
  route annotation prevents a task from silently switching execution
  substrates after it is bound. Dalph may need an analogous executor-source
  decision.
- **Reconcile external sessions before dispatch.** Agent Kanban's ordered cron
  deliberately tears down stale/dead bindings before scanning new work. The
  event order is a useful operational scenario even if Dalph implements it
  through one workflow algebra.
- **Keep failed candidates isolated.** The dispatch sweep catches each task's
  error and continues to independent tasks. That is a good availability rule
  when failures do not share a corrupted authority.
- **Preserve historical session pointers after active cleanup.** Keeping the
  AMA session ID for history while clearing active binding fields improves
  operator diagnosis.
- **Surface process heartbeat separately from PID.** `ak status` correctly
  distinguishes “local runner process exists” from “server sees fresh
  heartbeat.” Dalph should similarly avoid equating PID with healthy executor.
- **Use signed external events for lifecycle convergence.** GitHub webhook
  completion is simpler and faster than polling PR state. Dalph can borrow the
  authoritative reread/event trigger without ceding its integration protocol.
- **Cap diagnostic partitions deliberately.** A bound protects database cost,
  but Dalph should pair any bound with explicit truncation evidence and a
  stable compound cursor.

## 15. Confirmed unknowns and negative-claim search record

### Confirmed unknowns

- Does AMA atomically enforce `maxConcurrent` across competing session creates,
  or merely queue/reject after Agent Kanban's stale load read?
- Does an AMA runner restart adopt the same AMA session and exact provider
  conversation?
- Does the same AMA session retain its repository filesystem after process,
  runner, sandbox, or control-plane restart?
- What are AMA's event-history and workspace retention periods?
- Can AMA return or search an idempotency key after an ambiguous session
  create?
- Does AMA terminate an externally created session whose AK credential is
  revoked before the AMA ID is stored?
- What exact Git ref/commit does the AMA `git_repository` volume clone, and how
  does it behave when `ak/<task-id>` already exists?
- What user repair path is intended when rejection gets 404/409 from an
  archived AMA session? The reachable source leaves `in_review`.
- How does deployed D1 behave under the exact overlapping lifecycle races not
  covered by Miniflare examples?

### Negative-claim searches

The audit searched:

- every manifest and lockfile for property/model-testing and formal-method
  dependencies;
- all source, tests, scripts, CI, designs, specs, and filenames for Quint,
  TLA+, Alloy, model checking, property testing, fault injection, restart,
  crash, concurrency, fake clocks, and dry-run;
- all current server and CLI source for worktree, branch, base SHA, stash,
  conflict, reset, cleanup, process, PTY, session resume, and integration;
- all references and callers of `claimTask`, `claimTaskDispatch`,
  `maxConcurrent`, `dispatchPendingAmaTasks`, `reconcileAmaBoundTasks`, and the
  legacy daemon modules; and
- migrations and tests for unique indexes, transition guards, attempt/session
  rows, and concurrent claims.

No current production call from AMA dispatch into the legacy local worktree or
session resumer was found. No fixed base commit field, current-path worktree
locator, global Agent Kanban capacity row, task-claim lease, target-ref
integration fence, current-path dry-run interpreter, formal model, property
suite, or current AMA crash-restart test was found. These negative findings are
limited to the pinned Agent Kanban repository; they say nothing about
unexamined AMA source or deployed infrastructure.

## 16. Technical and user-visible consequences

| Finding | Technical consequence | What a user notices | Materiality |
|---|---|---|---|
| D1 conditional task claim | Two workers cannot both successfully flip the same assigned task from `todo` through this code path. | A normal simultaneous claim yields one winner. | High and positive. |
| Dependency check is outside claim/dispatch transaction | Graph changes can race with session creation and claim. | A task can start just as a new blocker is added. | High for dynamic plans. |
| Dispatch claim is durable but session create is not idempotent | An applied-but-unobserved AMA create can produce an invisible orphan and later duplicate. | Duplicate spend/work may appear after a rare network ambiguity. | High where external calls fail ambiguously. |
| Capacity enforcement belongs to AMA | Agent Kanban cannot prove from D1 that slots survive restart or are globally bounded. | Capacity usually follows runner settings, but diagnosis requires AMA. | High operationally; unknown behavior. |
| No fixed Base SHA or stored workspace identity | Retries can start from a newer target and old WIP cannot be correlated by AK. | A week-later retry may see different code; unpushed changes may disappear with the old sandbox. | High for long-running work. |
| Same AMA session receives rejection message | Review feedback can continue in the same external session when it still exists. | Agent retains more context and workspace continuity than a fresh run may provide. | Valuable, but exact provider resume is unproven. |
| Archived session blocks rejection | Source does not implement the documented fallback. | Reviewer sees an error and must complete, cancel, or repair manually. | Medium to high after retention/drift. |
| AMA owns provider logs | Rich backfilled history is available when AMA retains it; D1 keeps only task-level events. | Chat/tool history can outlive the UI process, but may become unavailable independently. | Medium. |
| PR is the integration boundary | AK does not race target updates, because it does not perform them. | Existing GitHub review/merge policy remains in control; unattended ordered integration is absent. | Appropriate boundary for teams wanting human merge; material difference from Dalph. |
| Stateless Worker plus cron reconciliation | Web process restart loses little local state and cleanup retries without an operator relaunching a daemon. | Board/API recover quickly after Worker restarts. | High and positive. |
| Timed stale release without workspace proof | Task capacity/lifecycle can be freed while old WIP ownership is unknown. | Work may be retried, but the user cannot tell from AK whether all partial files survived. | High for expensive uncommitted work. |
| Mixed current and legacy architectures | Tests and docs can support different mental models. | Operators may expect local worktree recovery that the AMA path does not expose. | High maintenance/documentation risk. |

Agent Kanban is genuinely a control plane: it owns a durable task graph,
identity and lifecycle state, dispatch claims, retry policy, external-session
binding, review messages, and GitHub-driven completion. Its strongest pinned
mechanism is conditional D1 coordination around assignment, task claim, and
dispatch. Its central limitation for this comparison is not lack of features,
but the evidence boundary: actual distributed capacity, process/session
restoration, and complete Git workspace durability moved into AMA while the
Agent Kanban task model stores only mutable references to that external
execution. Dalph can be technically distinct if it binds a fixed starting
commit, exact workspace and attempt identity, authoritative executor
observations, and integration intent into one recoverable protocol—not merely
because it uses a different language or framework.
