# Any Managed Agents reliability architecture card

## 1. Scope, pin, and evidence boundary

This card audits Any Managed Agents (AMA) at commit
[`e0c95a21fc05f410330c59512e995778f0dbd706`](https://github.com/saltbo/any-managed-agents/tree/e0c95a21fc05f410330c59512e995778f0dbd706),
specifically as the execution plane beneath Agent Kanban. The evidence is the
pinned TypeScript Worker, Go runner, migrations, configuration, tests, generated
SDKs, and design documents. No Cloudflare resources were changed, and no real
cloud or destructive crash experiment ran.

AMA has two materially different execution paths:

- a `cloud` session whose control loop, transcript, and browser sockets run
  through a per-session Durable Object while tools run in a Cloudflare Sandbox;
  and
- a `self_hosted` session whose durable work/lease rows are in D1, while the
  runtime process, Git worktree, provider log, canonical event log, and live
  relay are on a registered runner
  ([composition routing](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/composition.ts#L36-L53),
  [product ownership decision](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/docs/product/spec.md#L49-L49)).

Those paths must not be blended into one durability claim. D1 and repository
code establish what AMA asks Cloudflare to store. The source does not itself
prove Cloudflare's Durable Object serialization, D1 durability, Sandbox
container survival, R2 durability, queue delivery, or container-limit
semantics. Those are external platform guarantees. Similarly, an SDK provider's
resume token is evidence that AMA requests resume, not proof that every provider
reconstructs an identical hidden conversation.

The comparison assumes one Dalph coordinator. AMA may still receive overlapping
HTTP, cron, queue, and runner requests, so the card checks whether AMA itself
coordinates those calls. It does not demand an active-active Dalph coordinator.

Implementation status labels used below are:

- **implemented**: reachable production source enforces or records the fact;
- **scaffolded**: a write path, migration, document, or utility exists without
  the full production read/recovery path;
- **external guarantee**: AMA delegates the behavior to Cloudflare or a provider;
- **unknown**: neither reachable source nor a pinned external contract proves it.

## 2. Plain-language architecture

For a self-hosted session, the ordinary path is:

```text
Agent Kanban or another client
  -> POSTs an AMA session
  -> AMA writes a pending D1 session
  -> AMA writes a D1 work item
  -> a RunnerPool Durable Object asks an eligible connected runner to claim it
  -> D1 reserves runner load, marks work leased, and writes a lease
  -> the runner prepares a session directory and detached Git worktree
  -> the runner starts a Node runtime bridge and provider SDK/CLI
  -> the runner renews the lease and persists a provider resume token
  -> events append to runner-local JSONL and stream through AMA to the browser
  -> completion updates D1 and releases runner load
```

For a cloud session, the ordinary path is:

```text
client
  -> POSTs an AMA session
  -> AMA writes a pending D1 session
  -> a queue consumer obtains the deterministic per-session Sandbox
  -> AMA clones declared repositories and compare-and-sets the session idle
  -> prompts are serialized by a D1 turn lease
  -> the per-session Durable Object stores canonical events in embedded SQLite
  -> model turns reconstruct context from that transcript
  -> tools execute in the Cloudflare Sandbox
  -> close stops the Sandbox and best-effort exports transcript JSONL to R2
```

The configured deployment makes those authorities visible: D1, an R2 session
event bucket, per-session and runner-pool Durable Objects, queues with five
retries plus a dead-letter queue, and a Sandbox container deployment capped at
20 instances
([bindings and queues](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/wrangler.toml#L26-L85),
[container configuration](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/wrangler.toml#L118-L122)).

This is a durable control-record system with two transcript implementations. It
is not a workflow reconstructed from one journal. D1 rows hold current
session/work/lease/runner state; a Session Durable Object holds cloud events;
runner files hold self-hosted events and Git state.

## 3. State-owner table

| Fact | Authority at this pin | Copies or observations | Reliability consequence |
|---|---|---|---|
| Session identity and current lifecycle | D1 `sessions` | audit rows, Durable Object name, Sandbox ID, active turn lease | Survives a stateless Worker restart, but create has no caller idempotency key ([session schema](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/db/schema.ts#L388-L434)). |
| Frozen agent/environment request | JSON snapshots in D1 session/work payload | runner receives a copy | Provider/model, prompt, tools, mounts, and requested refs are retained; resolved Git SHA and exact executable/image versions are not ([agent snapshot](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/domain/runtime/session-snapshot.ts#L28-L45), [environment snapshot](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/domain/runtime/session-snapshot.ts#L120-L156)). |
| Self-hosted runnable work | D1 `session_work_items` | RunnerPool pending request | Attempts and result survive restart; initial session-row/work-row creation is not one transaction. |
| Self-hosted admission | D1 runner `currentLoad < maxConcurrent` conditional update | RunnerPool and Go daemon also keep in-memory counts | D1 is the real cross-request capacity guard; multi-statement lease construction has crash gaps. |
| Assignment ownership | D1 active lease | runner's in-memory `activeLeases`; RunnerPool routing maps | Lease ID, runner ID, expiry, and resume token survive control-plane restart. No fencing token reaches arbitrary Git/provider effects. |
| Runner identity and health | D1 runner row | saved runner/machine ID on runner disk; live RunnerPool socket | Registration can reuse a machine-bound row. Heartbeats are recorded, but no reachable stale-heartbeat reaper was found. |
| Cloud transcript | per-session Session Durable Object SQLite | WebSocket backfill/live fan; best-effort R2 export | Hot history has unique `(session, sequence)` ordering. R2 is a write-only cold copy in reachable runtime code. |
| Self-hosted transcript | runner-local canonical JSONL | live and backfill relay; no cloud copy | Survives Worker restart but depends on the same runner disk and the 24-hour workspace retention policy. |
| Provider-native context | provider store plus persisted resume token for external runtimes | D1 session/lease/work payload; runner provider-event JSONL | AMA can request same-session resume, but does not adopt a pre-crash provider process. |
| Cloud workspace/process | Cloudflare Sandbox addressed by session ID | D1 `sandboxId`; AMA calls `getSandbox` | Same logical locator is reused. Filesystem and process survival are external Cloudflare behavior, not inventoried by AMA. |
| Self-hosted workspace | runner session directory and Git worktrees | requested mount metadata in D1 and local workspace state | All filesystem/Git layers survive while that directory survives. AMA stores neither resolved base SHA nor a full Git-state manifest. |
| Cleanup | D1 state plus platform/runner filesystem | cron metadata stamps, R2 archive | Cleanup is best effort and not disposition-typed; one watchdog path records destruction even after stop failure. |

## 4. Scheduling, admission, leases, and capacity

### Session creation is not idempotent

Every create request generates a fresh `crypto.randomUUID()` and inserts a new
pending session. `requestId` is used for audit/correlation, not uniqueness. The
schema has no idempotency-key column or unique client operation key
([ID and snapshots](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runtime/session-create.ts#L652-L693),
[insert and dispatch](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runtime/session-create.ts#L730-L855)).
A client such as Agent Kanban that loses a successful create response cannot
search by its operation key; retry can create a second session.

For initial self-hosted creation, AMA inserts the session first and then inserts
work. These are separate calls. A process death between them leaves a pending
`waiting-for-runner` session with no work item
([initial enqueue](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runtime/session-create.ts#L303-L333),
[post-insert launch](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runtime/session-create.ts#L789-L875)).
Ordinary thrown errors are converted to session error state, but hard process
death bypasses the catch. Later prompt/reopen work is stronger: it uses a D1
batch that conditionally changes the session state and inserts work
([conditional requeue](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/adapters/repos/runtime-orchestration.ts#L192-L245)).

### Self-hosted capacity is real but lease construction is not atomic

The RunnerPool Durable Object chooses only connected runners and uses an
in-memory assigned count for routing. The runner daemon separately refuses work
above its local active-lease limit. Neither is the ultimate distributed guard.
The D1 lease repository first conditionally increments `currentLoad` only when
it is below `maxConcurrent`, then conditionally changes the work item from
available to leased, inserts a lease, and finally changes the session to
running
([RunnerPool selection](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/worker/runner-pool-object.ts#L188-L228),
[D1 claim sequence](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/adapters/repos/leases.ts#L471-L541)).

This prevents two successful claims from exceeding a runner's D1 capacity in
the normal race. It is stronger than Agent Kanban's stale precheck. It is not
one transaction:

- death after load increment leaks one unit of D1 load;
- death after the work update but before lease insert leaves a leased work item
  with no lease;
- death after lease insert but before session update leaves a recoverable lease
  whose session row may still look pending.

The ordinary losing-work race compensates the load increment, but hard death
cannot execute that compensation. Expiry scans active leases, so a work item
whose lease row was never inserted is not repaired.

### Renewal and reassignment

The runner renews its lease on a timer and sends the latest resume token. On
startup it lists active leases for its persisted runner ID and starts them
again
([startup recovery](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/daemon/daemon.go#L73-L175),
[lease recovery](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/daemon/daemon.go#L278-L310),
[renew and token persistence](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/daemon/lease_worker.go#L523-L568)).

Expired leases can decrement load and requeue bounded work; started work is
marked for resume and carries the stored token
([expiry](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/adapters/repos/leases.ts#L446-L469),
[bounded recovery](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/adapters/repos/leases.ts#L270-L359)).
However, no cron caller of `expireStale` was found. It is invoked while listing,
getting, or claiming leases and preparing a runner channel, so recovery depends
on later lease-plane traffic rather than the minute watchdog
([lease HTTP calls](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/http/leases.ts#L195-L291),
[claim use case](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/leases.ts#L19-L66)).

### Runner registration and liveness

Registration reuses a D1 row when project, auth subject, environment, and
machine ID match. The daemon persists both machine and runner IDs locally,
heartbeats runtime inventory/build/usage, and clears a rejected runner ID before
registering anew
([server registration](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runners.ts#L35-L105),
[daemon identity](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/daemon/daemon.go#L375-L450),
[heartbeat metadata](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/daemon/daemon.go#L453-L484)).

The server records `lastHeartbeatAt`, but the pinned source has no reachable
timer that marks a runner stale from that timestamp. A hard-dead runner can
remain `active` in D1. RunnerPool will not dispatch to it without a socket, but
environment selection can observe stale active rows. This is an implemented
heartbeat write with an incomplete liveness protocol.

Cloud sessions have a per-session D1 turn lease and queue batch size one, but no
AMA-level global admission counter. The configured 20 Sandbox instances are a
deployment cap whose queue/failure behavior belongs to Cloudflare
([turn lease](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runtime/cloud-turn.ts#L412-L510),
[queue retries](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/wrangler.toml#L40-L53),
[container limit](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/wrangler.toml#L118-L122)).

## 5. Restoration layers

### 5.1 Control state

D1 preserves the session, frozen snapshots, work item, lease, attempts, runner
assignment, expiry, state reason, active cloud-turn lease, result/error, and
resume token. A Worker or RunnerPool instance can disappear without losing
those rows. RunnerPool's socket maps and `assigned` counters are in memory and
reset, but reconnect reconstructs session routing from D1 leased work
([in-memory pool state](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/worker/runner-pool-object.ts#L35-L45),
[reconnect restoration](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/worker/runner-pool-object.ts#L70-L100),
[routing rebuild](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/worker/runner-pool-object.ts#L170-L186)).

That is state restoration, not replay of an intent log. Initial session create,
lease construction, cloud Sandbox start, close, and cleanup cross authorities
without one atomic record describing the whole ambiguous operation.

### 5.2 Agent session, context, and logs

For external self-hosted runtimes, the bridge emits a resume token as soon as it
learns one; AMA writes it into the lease/session/work recovery path. Codex calls
`resumeThread(token)` and records the returned thread ID
([bridge request and callbacks](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/daemon/lease_worker.go#L294-L395),
[Codex resume](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/packages/runtime-bridge/src/providers/codex.ts#L606-L680)).
AMA therefore implements same-provider-session *request plumbing*. A runner
restart launches a new bridge process with that token; it does not adopt the old
process or prove provider-side identity beyond the token contract.

The self-hosted runner also writes raw provider events and canonical events to
separate JSONL files. Canonical append takes path/process locks and assigns a
monotonic sequence, but uses ordinary append without record framing or
file/directory `fsync`; a torn last line makes the whole scanner fail
([canonical log append](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/session/event_log.go#L20-L141),
[log read](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/session/event_log.go#L148-L213),
[provider log](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/session/provider_event_log.go#L17-L75)).
The raw log has a manual rebuild utility, including a dry-run, but the runtime
does not invoke it automatically after corruption. This is a useful repair
scaffold, not crash-safe journaling.

Cloud `ama` turns instead read canonical messages from the Session Durable
Object and reconstruct model input. They do not resume an opaque provider
process
([cloud context load and turn](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runtime/cloud-turn.ts#L239-L369)).

### 5.3 Complete Git state

The self-hosted runner creates one session directory and detached worktrees for
Git mounts. A cache fetches/prunes the origin, resolves the requested ref, and
runs `git worktree add --detach`. If a mount directory already exists,
preparation returns it rather than recloning
([resource materialization](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/workspace/resources.go#L46-L85),
[ref resolution](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/workspace/resources.go#L237-L266)).

While that directory survives, Git's own files preserve HEAD, branch/detached
state, commits, index/staged changes, unstaged changes, untracked and ignored
files, conflicts, and repository-local metadata. AMA does not inventory those
layers, persist their hashes/locators in D1, or validate them before resume.
The local workspace state records the requested ref and path, not the resolved
base commit. Stashes and commits may live in the shared cache repository, but
AMA records no per-attempt ownership of them.

Cloud workspace preparation clones each declared repository and optionally
checks out its requested ref. It likewise records neither the resolved commit
nor a complete Git-state manifest
([cloud workspace preparation](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/adapters/runtime/sandbox-runtime-host.ts#L197-L303)).
Filesystem survival, including every Git layer, is therefore an external
Sandbox property between calls.

### 5.4 Live process or container

The Go daemon takes a local state-directory process lock, but it stores no child
PID/PTY/container adoption record. A recovered lease starts a new Node bridge.
On cancellation, the process-tree wrapper stops the old bridge and children
when the daemon is still alive
([runtime bridge process](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/runtime/bridge.go#L26-L125)).
A hard-killed runner does not adopt an old child process; whether the operating
system kills all descendants is outside this protocol.

Cloud start calls `getSandbox` with the session ID, `keepAlive`, and normalized
ID, which gives AMA a deterministic locator
([Sandbox adapter](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/adapters/runtime/sandbox-runtime-host.ts#L305-L339)).
The code does not persist or reconcile process IDs inside it. Reconnection to
the same filesystem/container and the semantics of an already-running command
are external Cloudflare guarantees or unknowns.

## 6. Immediate restart and ambiguous outcomes

### Stateless Worker or Durable Object restart

D1 control rows survive. A restarted Session Durable Object reopens its SQLite
event table; browser sockets use hibernation attachments and reconnect/backfill
by cursor
([Session Object](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/worker/session-object.ts#L35-L184),
[event paging](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/worker/session-event-store-sql.ts#L118-L152)).
That behavior relies on Cloudflare's single-object serialization and durable
storage contract.

RunnerPool uses ordinary accepted WebSockets and in-memory maps. Runner
reconnect supersedes its previous socket and rebuilds leased-session routing.
D1 capacity prevents a simple post-reset overclaim, although leaked load from a
partial lease claim can under-admit indefinitely.

### Runner restart

The daemon cleans stale workspaces, restores its saved runner identity,
heartbeats, reconnects, lists active leases, opens the same session logs and
workspace, and starts a new bridge with the resume token. This is implemented
restart-by-reexecution, not process adoption. It is strong when the same disk,
runner ID, unexpired lease, and uncorrupted local files remain.

If a lease expired and another runner claims the work, D1 can carry the resume
token but not the old workspace or local transcript to that runner. Provider
resume may still work if its token is portable, but exact filesystem and
runner-local context restoration do not.

### Cloud start ambiguity

Cloud launch obtains/prepares the Sandbox before compare-and-setting the
session from pending to idle. A CAS loser stops its Sandbox
([cloud start ordering](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runtime/cloud-turn.ts#L85-L230)).
A hard death after Sandbox creation but before the CAS leaves a pending row and
possibly live Sandbox. Queue retry addresses the same Sandbox ID, but repository
preparation clones into fixed destinations without an explicit idempotent
existing-clone protocol. The later watchdog may mark the session errored and
stop the Sandbox; it does not adopt or verify partially completed preparation.

### Event replay and duplicates

Cloud event append chooses `max(sequence)+1` inside the per-session object and
enforces unique `(session, sequence)`
([SQLite event store](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/worker/session-event-store-sql.ts#L40-L115)).
This orders stored events but supplies no semantic input-event idempotency key.
A queue retry after a model/tool effect and before acknowledgement can append a
new event ID/sequence for the same logical effect. The turn lease serializes
normal overlapping turns; it is not exactly-once execution.

Self-hosted events retain runner-assigned IDs and sequences during relay.
Reconnect backfills the local log, while live relay is deliberately not copied
into cloud storage
([relay reconnect/backfill](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/session/relay.go#L76-L110),
[live relay](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/session/relay.go#L326-L423),
[server live-only path](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/worker/session-object.ts#L90-L109)).
The client must deduplicate replay/live overlap; the server is not a durable
deduplication authority for runner events.

## 7. A week later: retention and drift

Self-hosted runner workspace retention is hard-coded to 24 hours. Daemon startup
performs stale cleanup **before** recovering active leases, using session
directory modification time without consulting D1 lease state
([retention and cleanup](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/workspace/workspace.go#L18-L22),
[stale deletion](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/workspace/workspace.go#L396-L441),
[startup order](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/daemon/daemon.go#L73-L124)).
After a week-offline restart, the runner can delete the exact Git worktree,
canonical transcript, and provider log before it asks D1 which leases still
matter. That makes week-later same-workspace recovery actively unsafe, not
merely unspecified.

Workspace cleanup force-removes the Git worktree and session root
([cleanup implementation](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/workspace/workspace.go#L358-L394)).
There is no recoverability classification for committed-but-unpushed, staged,
unstaged, untracked, ignored, conflicted, or stashed work.

Cloud Session Object rows have no source-defined hot retention deletion.
Close best-effort exports JSONL to R2, but no production R2 restore/read path or
R2 lifecycle policy was found
([R2 write](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/worker/session-object.ts#L88-L100),
[best-effort close archive](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runtime/session-lifecycle.ts#L163-L176)).
R2 archive is therefore scaffolded cold storage, not demonstrated restoration.

Requested repository refs are frozen in the session snapshot, but mutable refs
can resolve differently on a newly created/recreated workspace. No exact Base
SHA, target observation, or drift decision is stored. Provider/model names are
frozen, while the exact runner binary, provider package, toolchain, and cloud
image version are not bound to the attempt. Runner heartbeat reports build and
runtime inventory, but no lease row captures that observation.

## 8. Git starting point and integration

AMA is a workspace/session service, not an integration coordinator. It accepts
a repository URL and optional ref, clones or fetches it, and gives the agent a
shell. It does not:

- resolve and persist an exact planned Base SHA before work;
- allocate a branded attempt branch or record its current HEAD;
- inventory all Git state layers before retry or cleanup;
- record push intent/result;
- open, merge, or reconcile a pull request as a control-plane operation;
- serialize target-ref integration; or
- compare an observed target SHA with a planned integration base.

An agent can run `git`, `gh`, or provider tools itself, but those side effects
are opaque to AMA's session/work/lease state. Agent Kanban owns the higher-level
PR workflow; AMA does not close the gap between a completed provider turn and a
durably observed Git delivery result.

The positive mechanism is local reuse: a same-runner, same-session retry opens
the same worktree directory and therefore normally sees its current Git state.
That is practical continuity, but it is path-based and retention-limited rather
than a verified attempt/worktree protocol.

## 9. Layers and slices

The TypeScript server is organized around a single composition root. Use cases
depend on narrow ports; adapters implement D1 repositories, queues, Durable
Objects, secrets, event storage, runner channels, and runtime execution
([composition root](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/composition.ts#L1-L86)).
The major slices are agents/environments/providers, sessions, work items,
leases/runners, event transport/storage, runtime execution, triggers, policy,
audit, and secrets.

The Go runner has similarly recognizable adapters: API client, daemon, relay,
lease worker, workspace/resource materializer, sandbox adapter, runtime bridge,
process-tree wrapper, and local event stores. This is a good testability shape.

The architecture is less clean at ambiguous lifecycle seams:

- session creation owns both row creation and post-insert launch;
- lease claim spans multiple repository statements without one transaction;
- transcript authority switches by runtime/hosting mode;
- cloud cleanup combines state mutation, archive, and Sandbox effects;
- self-hosted recovery depends on local files whose retention is not joined to
  D1 lease ownership.

These are distinct domain phenomena—session intent, work admission, execution
ownership, provider conversation, workspace custody, transcript custody, and
cleanup disposition—but several share a mutable session state instead of
separate durable intent/observation records.

## 10. Production, test, fake, and dry-run paths

The use-case ports and dependency-first functions permit focused fakes. Tests
replace repositories, runtime execution, queues, audit, policy, and clocks with
plain objects. Go components inject clients, adapters, bridges, and filesystem
roots. This supports deterministic unit and local integration tests.

Production cloud execution is not faithfully exercised by the common test
runtime. `AMA_RUNTIME_MODE=test` changes composition behavior and skips the
actual Cloudflare Sandbox start path
([test composition flag](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/composition.ts#L80-L86),
[runtime-mode branch](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/adapters/runtime/sandbox-runtime-host.ts#L305-L339)).
Miniflare/D1 tests can validate SQL transitions, but not real Durable Object
eviction, Sandbox adoption, queue duplication, container saturation, or R2
failure semantics.

There is no shared workflow algebra interpreted by production, fake, and
dry-run modes. The repository's `--dry-run` belongs to the manual provider-log
event rebuild utility; it does not preview session create, lease, Git,
provider, cleanup, or integration effects. Smoke scripts have mocked and real
variants, not a production-shaped no-effect interpreter.

## 11. Verification evidence

The repository has substantial conventional verification:

- TypeScript typechecking, Vitest unit/integration tests, coverage thresholds,
  formatting/linting, dependency-cruiser checks, OpenAPI/SDK generation checks,
  Playwright tests, and smoke scripts
  ([verification scripts](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/package.json#L17-L36));
- D1/Miniflare tests for session creation and lifecycle, conditional work
  queueing, lease capacity/expiry/resume, runner reconnect, cloud turn leases,
  events, watchdog behavior, and migrations;
- Go tests for daemon registration/recovery, relay/backfill, event logs,
  workspaces and Git resources, runtime bridge/process-tree behavior, and a
  local HTTP/WebSocket daemon integration
  ([daemon integration fixture](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/cmd/ama-runner/internal/daemon/daemon_integration_test.go#L25-L54)); and
- executable-ish product specifications and architecture documents.

Those tests provide strong examples and regression coverage. They do not prove
the cross-authority crash protocol. Searches of manifests, source, tests,
scripts, CI, and docs found no Quint/TLA+/Alloy model, model checker,
property-based testing library/suite, systematic fault-injection harness, or
separate-process kill-and-restart suite for the current server-plus-runner
path. Process tests exercise signals and cleanup; the smoke script can kill a
child; neither enumerates the ambiguous D1/DO/Sandbox/filesystem cut points
audited here.

The event-storage design says cloud writes should be idempotent on
`(sessionId, sequence)` and explicitly leaves runner retention/eviction as
future work
([design expectation](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/docs/designs/session-event-storage-and-self-hosted-relay.md#L182-L206),
[open retention item](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/docs/designs/session-event-storage-and-self-hosted-relay.md#L405-L409)).
The implementation orders cloud writes, but does not accept a caller event key;
and the runner implements an age policy that can delete active recovery state.
Tests and documents should not be promoted beyond those reachable facts.

## 12. Chronological failure scenarios

| Cut point | Durable facts immediately after failure | Recovery path | User-visible or technical result |
|---|---|---|---|
| 1. Before D1 session insert | No session exists | Client retries | Safe unless another create already succeeded ambiguously. |
| 2. Session inserted, self-hosted work not inserted | Pending session exists; no work/lease | No focused reconciler found | Session can wait forever despite runner capacity. |
| 3. Client loses successful create response | A new random session may be running; client lacks its ID | No idempotency-key lookup | Agent Kanban can create an invisible orphan and then a duplicate. |
| 4. Runner load reserved, work not leased | `currentLoad` is too high | No lease exists for expiry scan | Capacity leaks and work remains available. |
| 5. Work leased, lease row not inserted | Work names a nonexistent lease | Expiry scans leases, not this gap | Work can strand while capacity is leaked. |
| 6. Lease inserted, runner never receives assignment | Active lease and work are durable | Same runner startup lists active leases; later expiry can requeue when lease traffic invokes cleanup | Usually recoverable, but not driven by the minute cron. |
| 7. Workspace exists, runtime not started | Same-runner files exist; D1 lease active | Runner reruns preparation and bridge | Existing mount is reused; no inventory proves its exact Git state. |
| 8. Provider starts, resume-token response lost | Provider may have a conversation; D1 lacks token | Reexecution starts without authoritative token | Duplicate provider conversation/work is possible. |
| 9. Token stored, runner dies | D1 token/lease and runner-local files exist | Same runner relaunches bridge with token | Provider and Git continuity are plausible; old process is not adopted. |
| 10. Lease expires and another runner wins | Token travels; old filesystem/log do not | New runner recreates workspace and requests provider resume | Conversation may resume while repository WIP is absent or based on a mutable ref. |
| 11. Local event append tears | Partial JSONL is on runner disk | Open scans full file; manual rebuild exists for provider log | Backfill/runtime recovery can fail until manual repair. |
| 12. Cloud Sandbox starts, pre-idle CAS dies | Pending row, deterministic Sandbox may be live | Queue retry or 20-minute watchdog | Partial clone/process is not authoritatively adopted or inventoried. |
| 13. Cloud model/tool effect succeeds, queue ack is lost | External effect and some events may exist | Queue retries under an expired/new turn lease | Semantic duplicate effects/events remain possible. |
| 14. Cloud close marks closed, Sandbox stop fails | Closed/error row, Sandbox may remain | Leak watchdog attempts stop | Control state and resource state temporarily diverge. |
| 15. Watchdog stop fails | Failure is reported | Code still stamps `sandboxDestroyedAt` after the catch ([watchdog](https://github.com/saltbo/any-managed-agents/blob/e0c95a21fc05f410330c59512e995778f0dbd706/server/usecases/runtime/watchdog.ts#L22-L58)) | Later scans can believe cleanup completed and stop retrying a leaked Sandbox. |
| 16. Runner returns after a week | D1 lease/session may exist; session directory is older than 24h | Startup cleanup runs before lease recovery | Exact workspace and both local logs can be deleted before the runner learns they are still needed. |

## 13. Principal risks and challenged claims

1. **“Durable session” is mode-specific.** Cloud event history is in Durable
   Object SQLite; self-hosted history and Git are runner-local JSONL/filesystem.
   A single broad durability statement hides different failure and retention
   domains.
2. **Create is not idempotent.** Random IDs and post-insert dispatch leave both
   client ambiguity and an internal session/work gap.
3. **Admission is bounded but partially applied.** The conditional D1 load
   increment is valuable, yet its following work/lease/session writes are not
   atomic or reconciled from an intent.
4. **Heartbeat is observation without authoritative expiry.** A dead runner can
   remain active in D1 even though RunnerPool correctly requires a live socket.
5. **Resume is reexecution, not adoption.** The runner reopens local state and
   passes a token to a new process. No PID, PTY, child-process, or container
   execution is adopted.
6. **Exact Git restoration is accidental and time-bounded.** Same-path reuse
   preserves layers while disk survives; D1 has no Base SHA, worktree identity,
   state inventory, or cleanup disposition.
7. **The 24-hour cleanup order can destroy active recovery state.** It runs
   before lease recovery and consults only directory age.
8. **R2 archive is not a recovery path.** Export is best effort and no runtime
   read/restore path was found.
9. **Event sequence is not semantic exactly-once.** Unique sequences order
   stored cloud rows; they do not deduplicate a repeated provider/tool effect.
10. **Cloud authority is partly unknowable from source.** `getSandbox`,
    Durable Object SQLite, queue retry, and container caps express an intended
    platform protocol, not a locally verified guarantee.
11. **Cleanup can be falsely acknowledged.** The watchdog stamps destruction
    even when stopping the Sandbox throws.
12. **No integration protocol exists.** AMA cannot prove that successful agent
    work became a pushed commit or safely integrated target update.

## 14. Ideas Dalph should adopt or deliberately improve

- Keep the good split between durable work/lease facts and ephemeral socket
  routing, plus a D1-style conditional capacity reservation.
- Persist a client operation/idempotency key and return the existing attempt
  after an ambiguous create.
- Construct admission as one transactional state transition, or write intent
  first and reconcile every intermediate state.
- Give every attempt one exact executor, worktree locator, planned Base SHA,
  provider-session locator, and runtime/toolchain snapshot.
- Distinguish “restart a provider session with a token” from “adopt the same
  live process” in types, events, and UI.
- Inventory all Git layers before retry, handoff, cleanup, or retention expiry;
  make cleanup disposition-typed, exact, recoverable, and fail-closed.
- Tie retention to authoritative attempt/lease disposition, never directory
  modification time alone, and recover active attempts before pruning.
- Treat event ID/dedup key and sequence/order as separate facts. Persist intent
  before provider/tool effects and observation afterward.
- Retain one canonical, queryable execution transcript or make the two custody
  models explicit in the product contract and repair tooling.
- Make archive readable and test restoration, not just export.
- Record liveness policy and expire stale runner observations on a scheduled,
  testable boundary.
- Preserve AMA's ports/composition-root discipline, but run the same workflow
  algebra through production, fake, and dry-run interpreters.
- Add crash-point, property-based, and formal transition checks around create,
  claim, renew, finish, requeue, cleanup, and integration.

## 15. Confirmed unknowns and negative-claim search record

### External or unresolved unknowns

- What exact durability, eviction, and hibernation behavior does the deployed
  Cloudflare plan provide for Session and RunnerPool Durable Objects?
- Does `getSandbox(sessionId)` after Worker/DO failure guarantee the same
  container and filesystem, and what happens to already-running commands?
- How does the platform enforce `max_instances=20`: queue, cold wait, rejection,
  or another behavior?
- What duplicate-delivery windows exist in the deployed queue/D1/DO combination
  beyond AMA's source-visible turn lease?
- Are provider resume tokens portable across machines and credential contexts
  for every supported runtime, and do they restore identical hidden context?
- What operational R2 lifecycle policy exists outside the repository?
- How are existing production rows from older session-channel/event-storage
  migrations handled across every deployed version?

### Negative-claim searches

The audit traced all reachable callers and implementations for session create,
conditional work enqueue, lease claim/renew/finish/expiry, runner
registration/heartbeat/reconnect, cloud turns, event append/backfill/archive,
workspace/Git materialization, process launch/stop, watchdog cleanup, and the
Cloudflare composition root. It searched source, tests, manifests, scripts, CI,
and documents for idempotency keys, Base SHA, worktree identity, Git status,
stash/conflict/untracked state, process adoption, heartbeat reaping, R2 reads,
dry-run workflow interpreters, property testing, formal models, fault
injection, and crash/restart tests.

No session-create idempotency key/search, atomic initial session-plus-work
insert, atomic full lease claim, scheduled stale-runner reaper, exact Base SHA,
durable complete-Git inventory, cross-runner workspace transfer, PID/PTY
adoption, production R2 restore, shared dry-run interpreter, formal model,
property suite, or systematic current-path crash matrix was found. These are
bounded negative findings at the pinned commit, not claims about private
operations or undocumented Cloudflare behavior.

## 16. Consequences for Agent Kanban and Dalph

The AMA audit resolves several unknowns in the Agent Kanban card:

| Agent Kanban unknown | Resolution from pinned AMA source |
|---|---|
| Does AMA enforce `maxConcurrent`? | **Partly resolved, positive:** D1 conditionally increments `currentLoad` below `maxConcurrent`, so normal competing claims are bounded. **Qualification:** the multi-step lease claim has crash gaps that can leak load or strand work. |
| Can a runner restart recover assigned work? | **Resolved:** the same persisted runner ID lists active leases and reexecutes them, reopening local session files and passing the saved resume token. It does not adopt the old process. |
| Does the same session retain provider context? | **Partly resolved:** AMA durably propagates resume tokens and Codex explicitly resumes a thread; cloud AMA reconstructs context from canonical events. Exact provider-side equivalence remains provider-dependent. |
| Does the same session retain its repository filesystem? | **Resolved for the normal same-runner path:** preparation reuses an existing session mount. **Negative at longer horizons/cross-runner:** no transfer exists, and startup deletes directories older than 24 hours before active-lease recovery. |
| What is event-history retention? | **Resolved by mode:** cloud hot DO history has no source-defined deletion and best-effort R2 export; self-hosted history is runner-local and shares 24-hour workspace cleanup. |
| Can AMA recover an ambiguous create by idempotency key? | **Resolved negatively:** no client key is stored or searched; every create generates a random session ID. |
| What Git ref/commit is used? | **Partly resolved:** optional requested ref is resolved at preparation and mounted detached; AMA does not persist the resolved commit. Mutable-ref drift remains. |
| Does AMA terminate an orphan after Agent Kanban loses the create response? | **Resolved negatively for correlation:** AMA cannot associate that invisible session with Agent Kanban's lost operation because no idempotency/caller key exists. Ordinary cloud watchdog cleanup only acts on the session record AMA already knows, not the client's missing binding. |

Important Agent Kanban unknowns remain:

- Agent Kanban still cannot identify or close a successful AMA create whose
  response it lost.
- It cannot tell whether a provider resumed identical hidden context, whether a
  Cloudflare Sandbox retained the same live process/filesystem, or whether an
  old runner child survived outside the replacement daemon.
- It cannot observe AMA's full Git state, resolved Base SHA, local transcript
  custody, cleanup disposition, or the 24-hour deletion hazard through its
  current task/session binding.
- A rejection sent a week later can target an AMA session whose self-hosted
  workspace and history have already been deleted, while cloud archival/read
  behavior remains partly external.
- Neither product provides a durable link from AMA completion to exact pushed
  commit and serialized integration result.

For users, AMA is meaningfully more than a thin runner launcher. It supplies
durable session/work/lease rows, real capacity exclusion, reconnectable runner
identity, bounded retry, provider resume-token plumbing, per-session cloud
event ordering, and practical same-disk worktree continuity. Those mechanisms
materially strengthen Agent Kanban's execution plane.

They do not establish the stronger Dalph restoration target: one exact attempt
whose coordinator state, agent context and tool log, every committed and
uncommitted Git layer, executor observation, cleanup disposition, and
integration intent remain correlated after ambiguous failure and week-later
drift. Dalph's differentiator should be that joined recovery protocol—not merely
a different scheduler or Effect implementation.
