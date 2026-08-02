# Control-plane reliability architecture pre-study

Date: 2026-07-30

## Scope and method

This is a source-level pre-study of four open-source control-plane candidates:

- Gas Town together with its Beads state engine
- HerdOS
- OpenAI Symphony
- Paperclip

The comparison is intentionally narrower than a market survey. It asks how each
system admits work, records intent and observation, survives process loss, owns a
Git workspace, and integrates results. It also asks what a restart means to the
person waiting for the task: does the same execution continue, does a fresh
agent continue from durable artifacts, or does the task merely become eligible
again?

All claims below were checked against the pinned source trees in `.references`,
including source, manifests, tests, and design documents:

| Project | Pinned commit |
|---|---|
| Gas Town | [`649b832`](https://github.com/gastownhall/gastown/tree/649b832b7672bc7a2dbef26f5983aba6198b819b) |
| Beads | [`0e06911`](https://github.com/gastownhall/beads/tree/0e069115a231c537a83bb77a5106fe7c0efb47f2) |
| HerdOS | [`afb8e52`](https://github.com/herd-os/herd/tree/afb8e527fee2f9081963310bad1645bdc2806d68) |
| Symphony | [`f8e8b8a`](https://github.com/openai/symphony/tree/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7) |
| Paperclip | [`d5b9f6c`](https://github.com/paperclipai/paperclip/tree/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b) |

“No formal model” below means that no formal-model, property-testing framework,
or model-based test suite was present in the pinned manifests and test tree. It
does not mean the authors have never performed such work elsewhere.

## Executive comparison

| System | Core control model | Durable control state | Admission authority | Restart outcome | Git ownership | Primary reliability concern |
|---|---|---|---|---|---|---|
| Gas Town + Beads | A town of named, long-lived supervisory roles around persistent worker identities; Beads supplies the dependency graph, workflow records, and a strong claim API | Dolt databases, Beads events and work graph, Git worktrees/branches/commits, checkpoint JSON, mail/config files, tmux and provider session metadata | Gas Town dispatch uses host-local locks followed by a generic `hooked` update; it does not call Beads' transactional, leased claim API | Can resume a surviving provider session on selected paths; otherwise starts a new session from the same worktree, Bead hook, checkpoint, and handoff | Polecat and Refinery worktrees; an ordinary per-MR Refinery path with a persistent but non-CAS merge slot | Many authorities and three different locking or ownership protocols must reconcile |
| HerdOS | GitHub Actions workers and patrol jobs coordinated through issues, labels, runs, PRs, and branches | GitHub issues/labels/comments/runs/PRs plus remote branches and committed progress markers | Snapshot of active workflow runs and issue labels; review lock uses a Git ref compare-and-swap | New Actions run continues from a remote worker branch and validated progress, or discards it on conflict and restarts from batch | Branch-per-worker in ephemeral checkout; shared batch branch and integrator | No transaction across labels, workflow dispatch, branch effects, and run state; duplicate or lost intermediate actions remain possible |
| Symphony | One OTP `GenServer` scheduler supervising per-issue tasks; tracker and workspace are external facts | Tracker state and filesystem workspaces; scheduler maps, retry timers, running sessions, and completion cache are memory-only | One process serializes local decisions and enforces global/per-state caps | Scheduler forgets the live session and retry position; a fresh task may reuse the directory if the tracker issue is still eligible | Deterministic directories, usually populated and synchronized by user hooks rather than an owned Git protocol | Excellent single-process simplicity, but restart or multiple replicas expose the absence of a durable claim/reducer |
| Paperclip | Database-centered company/agent/issue control plane driven by queued heartbeat runs, recovery services, watchdogs, and adapter runtimes | PostgreSQL rows for issues, runs, locks, sessions, retries, workspaces, events, recovery actions, and activity; Git worktrees and log stores alongside DB | Database issue locks and transactions, plus a process-local per-agent start lock and `maxConcurrentRuns` | Startup adopts a deliberate hot restart when possible, otherwise reaps orphan processes and promotes/requeues durable retries; workspace and session IDs remain available | Persisted execution-workspace records with Git worktree branch/coherence checks; no single general merge-to-target protocol | Strong recovery coverage, but the scheduler is a very large service with many interacting states and the start lock is not cross-process |

The user-visible distinction is important:

- Gas Town is the closest to “the worker still has a desk, notebook, supervisor,
  and possibly the same session.” That supports long-running autonomous work,
  but the operator inherits a complicated repair surface.
- Paperclip is the closest to “the control plane remembers every run and can
  classify what happened after the server disappeared.” It has the richest
  recovery machinery, but correctness is spread across a very large
  database/application state machine.
- HerdOS is “GitHub is the control plane.” It is operationally convenient and
  externally inspectable, but the workflow crosses several GitHub resources
  without one atomic boundary.
- Symphony is “poll the tracker and run Codex in a folder.” It is the smallest
  and clearest implementation, but its process is the scheduler authority, so a
  restart is fresh execution rather than exact continuation.

## 1. Gas Town and Beads

### Mental model

Gas Town models an organization rather than a generic queue. The Mayor
coordinates across projects; the Deacon runs background monitoring; Boot
revives or diagnoses a missing Deacon; each rig has a Witness supervising
workers and a Refinery serializing integration; Polecats have persistent
identities but ephemeral execution sessions. The source architecture explicitly
lists these roles and their persistence
([Gas Town architecture, lines 62-80](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/architecture.md#L62-L80)).

Beads is the graph/state substrate beneath those actors. A task is a durable
issue connected by dependency edges. `bd ready` computes the current frontier;
`bd ready --claim` selects and claims one item atomically. Formulas compile to
reusable workflow templates, molecules are persistent workflow instances, wisps
are ephemeral instances, and gates represent external waits
([Beads core concepts, lines 5-107](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/docs/core-concepts/index.md#L5-L107)).

This is not a single reducer over one journal. It is a federation of named
supervisors and durable records. For a user, that makes the system feel like an
ongoing operation with specialist roles. For an implementer, each role boundary
and each storage boundary needs idempotency, health detection, and
reconciliation.

### Durable state

Gas Town separates town-wide Beads from per-rig Beads, both backed by a
town-level Dolt server. Agent identity, mail, convoys, work, merge requests, and
workflow molecules live in those versioned SQL databases. Polecat and Refinery
code lives in Git worktrees. Additional facts live in town configuration JSON,
session/heartbeat records, tmux processes, `.polecat-checkpoint.json`, and
checkpoint commits. The concrete layout and Dolt transaction discipline are
documented in source
([architecture, lines 5-30 and 82-171](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/architecture.md#L5-L171)).

Beads also records first-class issue history in database event tables. Its
optional `interactions.jsonl` audit sidecar is deliberately best-effort and is
not the issue-history authority
([audit implementation, lines 22-59 and 128-170](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/audit/audit.go#L22-L59)).

The user-visible benefit is that a task, its graph position, the checked-out
code, and a human-readable handoff can outlive an agent. The implementation cost
is that “current truth” is distributed: Dolt is authoritative for work and Gas
Town's `hooked` assignment, Git for code, the provider for session resumption,
tmux for live process observation, and checkpoint/mail files for recovery
context. Beads-native claims are a separate protocol from Gas Town's hooked
assignment.

### Concurrency and admission

Town capacity is configured as a maximum Polecat count plus a dispatch batch
size and spawn delay. The scheduler creates a pure `DispatchPlan` from available
capacity, batch limit, dependency-ready items, and defensive exclusions
([capacity pipeline, lines 84-178](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/scheduler/capacity/pipeline.go#L84-L178)).
The dispatch command serializes competing scheduler cycles with
`flock(scheduler-dispatch.lock)`
([scheduler design, lines 420-432](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/scheduler.md#L420-L432)).

Beads contains a stronger dequeue primitive. A claim and its issue event share
one Dolt transaction and commit. Dolt does not provide effective row locks for
this case, so the implementation uses optimistic commit conflicts, retries,
and a verify-by-re-read protocol after commit-phase ambiguity. A replay may
legitimately claim a different ready item
([Dolt claim implementation, lines 314-456](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/dolt/issues.go#L314-L456)).
Claims have five-minute renewable leases by default. The lease is node-local
and excluded from Dolt history; expiry permits a supervisor to return abandoned
work to the frontier
([lease implementation, lines 18-69 and 134-166](https://github.com/gastownhall/beads/blob/0e069115a231c537a83bb77a5106fe7c0efb47f2/internal/storage/issueops/lease.go#L18-L69)).

The deeper architecture-card audit found that Gas Town's reachable capacity
dispatch path does **not** call that primitive. It creates or reuses the
Polecat/worktree and then runs a generic `bd update` to set `hooked` and the
assignee before starting tmux
([sling sequence](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L235-L425)).
The host-local dispatch lock prevents cooperating schedulers on one filesystem
from running the cycle together, but the assignment has no Beads claim lease
and its retry path does not inherit Beads' ambiguity protocol. For a user,
Witness repair can still restart assigned work, but the source does not prove
that two failure-interleaved dispatches can never disagree about ownership.

### Restart and resumption

A checkpoint captures molecule and step identity, hooked Bead, modified files,
current branch, last commit, session ID, notes, and time
([checkpoint implementation, lines 1-53 and 118-190](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/checkpoint/checkpoint.go#L1-L53)).
The daemon and supervisory roles monitor persistent actors and the Dolt server.
Provider presets may support native session resume; if they do not, the system
starts a fresh session with worktree, hook, checkpoint, and handoff context
([provider integration, lines 19-69](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/agent-provider-integration.md#L19-L69)).

- After an immediate restart, a tmux/provider session may still be adoptable.
  If not, a new agent can continue from the same worktree and checkpoint.
- After a week, the Bead, branch, commits, molecule, and checkpoint can still
  exist, so useful work can continue. The exact model conversation is not
  guaranteed: provider retention, context limits, stale-checkpoint policy, and
  cleanup determine whether it is a resumed session or a fresh handoff.

Thus “resume” here means durable work identity and workspace continuity, with
best-effort session continuity. It is stronger than simply retrying a task, but
it is not replay of a fully journaled execution.

### Git workspaces and integration

Polecats and the Refinery are worktrees of the rig's canonical clone; human Crew
workspaces are full clones
([architecture, lines 114-146](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/architecture.md#L114-L146)).
The Refinery owns a serialized merge queue/merge slot.

The architecture document describes Bors-style batch-then-bisect as the target,
but its own phase table marks the prerequisite parallel gates “in progress” and
batch-then-bisect “blocked”
([architecture, lines 206-235](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/architecture.md#L206-L235)).
The safe conclusion at this commit is therefore: worktree isolation and
serialized Refinery integration are real design/implementation elements; the
full batch-then-bisect protocol is not demonstrated as completed.

The user gets durable, inspectable workspaces and a dedicated integrator. The
implementation does not establish Dalph's stricter invariant of one exact
worktree and one planned Base SHA per attempt; a persistent Polecat workspace
and evolving branches require explicit validation before reuse.

### Code structure and seams

Infrastructure is split into many `internal` packages: Beads access,
checkpointing, capacity scheduling, Refinery, Polecat management, sessions,
daemon, doctor, hooks, and provider integration. Pure policy appears in focused
packages such as `scheduler/capacity`, while many end-to-end operational slices
run through a large `internal/cmd` layer and role-specific daemons.

There are interfaces and fakes for session/tmux, VCS, and PR providers, and
many tests use temporary repositories or command stubs. But direct
`exec.Command`, filesystem paths, environment variables, process inspection,
and tmux/Git conventions remain pervasive. That makes the real environment easy
to understand from the code, but makes a single in-memory interpretation of the
whole workflow difficult.

Gas Town has hand-written randomized property tests for convoy graph behavior,
including cycle handling, deterministic waves, blocker ordering, termination,
and exactly-once membership
([convoy property tests](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/convoy_property_test.go#L1-L300)).
Beads has substantial storage conformance and concurrency tests across backends.
No formal specification or model checker is present at the pinned commits.

### Maintenance and reliability risks

1. **Cross-store repair is the product's hard part.** A supervisor can observe a
   Bead claim, a dead tmux session, a dirty worktree, a stale checkpoint, and a
   provider session with different answers. The user may need “doctor” tooling
   because no one append-only journal establishes the exact effect order.
2. **Leases are intentionally node-local.** That avoids unbounded Dolt history
   but makes replica provenance and reclaim rules essential. A bad new mutation
   path can bypass the shared `row_lock` cell and recreate zombie merges; the
   lease source explicitly calls out this invariant.
3. **Documentation and shipped state can diverge.** The same architecture page
   calls batch-then-bisect core while marking it blocked. Operators and agents
   must not treat design prose as observed capability.
4. **A large operational vocabulary raises change cost.** Adding a lifecycle
   state may touch role prompts, commands, Beads events, daemon patrol,
   checkpointing, tmux observation, and integration.

## 2. HerdOS

### Mental model and durable state

HerdOS treats GitHub as both tracker and control surface. Planning creates an
issue DAG and batch branch. GitHub Actions workers execute issues on worker
branches. An integrator consolidates accepted work into the batch branch and
PR. Patrol jobs detect missing or overdue workers and request retries.

The provider boundary is explicit: a `Platform` interface exposes issue, pull
request, workflow, label, milestone, runner, repository, and check services
([platform interfaces, lines 21-105](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/platform/platform.go#L21-L105)).
Durable state is therefore GitHub issues, labels, comments, workflow runs, PRs,
checks, milestones, and remote Git branches, plus committed progress and
validation markers. There is no HerdOS database or workflow event journal.

For a user, every important fact is visible in familiar GitHub surfaces. For an
implementer, no single object is the workflow record: task status may require
joining an issue label, Actions history, a remote branch, a progress file, and
a PR.

### Concurrency and admission

Dispatch reads ready/failed issues, counts currently active workflow runs,
computes `maxConcurrent - active`, and starts that many workers
([dispatch, lines 101-179](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L101-L179)).
For each worker it changes labels and then calls workflow dispatch
([dispatch effects, lines 200-249](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/cli/dispatch.go#L200-L249)).

Those are separate GitHub effects. Two dispatchers can read the same slot count
before either run appears, and a label can change while workflow dispatch
fails. The user-visible consequence is possible duplicate work or an issue that
looks active without a live run until patrol repairs it.

One concurrency mechanism is notably stronger: the integrator's review lock is
an append-only lock branch. Acquisition pushes a new commit and treats a
non-fast-forward rejection as compare-and-swap contention, retrying up to six
times; the lock expires after two hours
([review lock, lines 16-99](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/review_lock.go#L16-L99)).
That is externally durable and works across processes, but it protects review,
not worker admission as a whole.

### Restart and resumption

A worker fetches the remote worker branch. If it exists, the worker checks it
out and merges the latest batch branch. A clean merge permits progress
continuation. A conflict causes HerdOS to abort, delete the local and remote
worker branch and progress file, and begin again from the batch branch. It only
trusts progress with a validation marker, and checkpoints timed-out work
([worker lifecycle, lines 149-327](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/worker/worker.go#L149-L327)).

- After an immediate restart, a new Actions run can continue from the remote
  worker branch and validated progress. It does not restore the same model
  process/session.
- After a week, continuation still works in principle if the branch and
  progress artifacts remain. GitHub Actions history retention can reduce the
  evidence used for failure counts, and a moved batch branch may make the old
  work conflict and be deleted.

The user gets code-level continuation, not exact execution continuation. The
sharp failure mode is visible: upstream movement can turn a resumable branch
into intentionally discarded partial work.

### Git integration

Workers use branches inside ephemeral Actions checkouts rather than a managed
`git worktree` pool. A shared batch branch is the integration target. The
integrator merges an approved batch PR through the provider and then performs
cleanup
([merge, lines 24-60](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/integrator/merge.go#L24-L60)).

This matches hosted GitHub operation well, but the merge and cleanup do not
share a transaction. If GitHub accepts the merge and cleanup fails, the call can
report an error after the user-visible change already happened. A rerun can
observe that the PR is closed, but every post-merge side effect needs the same
reconciliation discipline.

### Code structure, seams, and verification

The Go code is cleanly divided by concern: `platform`, `planner`, `dag`,
`worker`, `integrator`, `monitor`, `issues`, `git`, and CLI/command packages.
End-to-end behavior crosses those layers, while a large orchestration test uses
stateful fake platform services to simulate planning through merge. That is a
useful production/test seam, and the platform interface prevents GitHub calls
from contaminating every domain function.

The patrol is a concrete reconciliation loop: it correlates active runs with
in-progress issues, cancels overdue work, marks work with no live run failed,
and adds a retry-pending label before posting a retry command to suppress
duplicate patrol actions
([patrol, lines 44-147](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L44-L147)).
Comment lookup is fail-open, however, so a read failure can produce duplicate
alerts
([patrol comments, lines 29-41](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L29-L41)).

Tests are extensive but example-based. No fuzz target, property-testing
framework, state-machine suite, or formal model is present. The repository's
own concurrency-model audit is still a planned item and names duplicate reviews
and overlapping operations as concerns
([concurrency audit spec, lines 1-35](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/specs/v1-release-09-concurrency-model-audit.md#L1-L35)).

### Maintenance and reliability risks

1. **Admission is a snapshot, not a claim.** Labels and active-run counts can be
   stale between read and dispatch.
2. **GitHub resources form a distributed state machine without a journal.**
   Repair logic must infer which side effects happened.
3. **Resume is destructive on conflict.** This keeps the batch coherent but may
   discard valuable partial work rather than quarantine it for recovery.
4. **Hosted retention is part of correctness.** Failure/backoff decisions that
   consult completed workflow history become less complete as runs age out.

## 3. OpenAI Symphony

### Mental model and durable state

Symphony is an OTP application centered on one `Orchestrator` `GenServer`. Its
state contains running tasks, completed items, claimed IDs, blocked IDs, and
retry timers. A tick reconciles running items with the tracker, fetches
candidates, and fills available slots
([orchestrator state and startup, lines 1-75](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L1-L75);
[message handling, lines 82-205](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L82-L205);
[reconciliation, lines 256-355](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/orchestrator.ex#L256-L355)).

Durable facts are deliberately external: the tracker record, files in a
deterministic per-issue workspace, Git artifacts created by hooks/agents, and
logs. The scheduler maps and timers are memory. `WorkflowStore` caches the last
valid `WORKFLOW.md` configuration and polls for changes; it is a cache over the
file, not durable execution state.

For a user, the model is easy to explain: “eligible tracker item becomes a
Codex task in its folder.” For an implementer, there is no durable distinction
between an intended dispatch, a started child, and a tracker mutation unless
the tracker or workspace happens to encode it.

### Concurrency and admission

One `GenServer` serializes all local scheduling decisions. It enforces a global
maximum and optional per-tracker-state caps before starting tasks. That is
excellent protection against races inside one BEAM node.

There is no distributed leader election, database lock, or atomic tracker
claim. The tracker abstraction is read-oriented from the scheduler, while
agents perform tracker writes through tools. Two Symphony processes pointed at
the same tracker can both consider the same issue eligible.

The user-visible result is deterministic admission for a single local service,
but unsafe horizontal duplication. The implementation consequence is that
high availability cannot be obtained by simply running two replicas.

### Restart and resumption

`AgentRuntimeSupervisor` uses `:one_for_all` for the Task Supervisor and
Orchestrator, so failure of one restarts both
([runtime supervisor, lines 1-33](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/agent_runtime_supervisor.ex#L1-L33)).
That deliberately clears the in-memory scheduler and its child tracking.
Startup cleans workspaces for tracker-terminal issues and schedules a new poll;
it does not reconstruct live tasks or retry timers.

Workspace creation uses a deterministic issue key, reuses an existing
directory, and removes conflicting non-directory entries
([workspace, lines 1-91](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/workspace.ex#L1-L91)).

- After an immediate restart, the old agent process is not resumed. If the
  tracker still makes the issue eligible, a fresh task may reuse the folder.
- After a week, the same is true: workspace files can survive indefinitely for
  a non-terminal issue, but retry attempt, backoff timer, claimed set, and model
  session are gone. A terminal tracker state causes cleanup.

“Resume” therefore means a new Codex execution can see old files. It does not
mean restored control state or a guaranteed fresh continuation prompt.

### Git and integration

Symphony owns a directory, not a Git protocol. Common workflow hooks clone the
repository on workspace creation and synchronize before each run; the agent
commits, pushes, and updates the tracker according to the workflow prompt.
There is no exact planned Base SHA, branch lease, merge queue, accepted-head
integration step, or cleanup disposition in the core.

That flexibility is useful for teams that already have a tracker/Git workflow.
It also means two installations with different hooks have materially different
recovery and integration semantics. A user cannot infer from “Symphony ran the
task” whether the branch was based on the intended revision or whether accepted
work was integrated.

### Code structure, seams, and verification

The implementation is small and separated into orchestration, workspace,
agent-runner, tracker adapters, configuration, and web dashboard concerns. A
tracker behaviour defines adapters for Asana, GitHub, GitLab, Jira, Linear, and
memory
([tracker behaviour and dispatch, lines 1-104](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/elixir/lib/symphony_elixir/tracker.ex#L1-L104)).
The in-memory adapter and injectable supervisor/name options give tests useful
seams. Configuration, tracker resolution, workspace operations, and some module
calls remain global rather than passed as capabilities.

The repository has broad ExUnit coverage, runtime-restart tests, Docker-backed
tracker end-to-end tests, and dashboard snapshots. Its coverage configuration
excludes several core runtime modules from the nominal threshold. No
StreamData/PropCheck dependency, formal model, property suite, or model-based
test is present at the pinned commit.

### Maintenance and reliability risks

1. **The scheduler is a single in-memory authority.** A clean restart loses
   claims and retry decisions just as surely as a crash.
2. **Supervision favors reset over reconstruction.** `:one_for_all` removes
   potentially healthy agent tasks when the Orchestrator fails.
3. **Workspace reuse is weaker than attempt identity.** A directory can contain
   useful WIP, stale files, or the wrong Git base; reuse alone does not
   distinguish them.
4. **Hooks carry control-plane meaning.** Git checkout, sync, and integration
   correctness live in operator-authored shell behavior rather than typed core
   events.

## 4. Paperclip

### Mental model and durable state

Paperclip is a database-centered organizational control plane. Companies own
agents, projects, goals, issues, dependencies, workspaces, budgets, approvals,
and activity. An agent wake creates or coalesces a durable queued heartbeat run.
The heartbeat service checks agent policy and dependency readiness, fills
`maxConcurrentRuns`, launches an adapter runtime, streams events/logs, and
finalizes the run. Recovery services, issue monitors, and task watchdogs repair
or escalate missing progress.

This is closer to a persisted state machine than the other candidates, but it
is not one reducer over one event log. Current state lives in normalized and
JSONB columns; run events and activity logs provide history/observability.
The `heartbeat_runs` table records lifecycle, process identity, session IDs,
log references, liveness, retry lineage, scheduled retry, and context snapshot
([run schema, lines 6-60](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/heartbeat_runs.ts#L6-L60)).
Issues persist separate checkout and execution run locks plus execution policy,
state, workspace binding, and monitor facts
([issue schema, lines 23-77](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/issues.ts#L23-L77)).

For a user, a task has a rich audit and recovery story: the UI can explain
which run held it, whether output went silent, what retry was scheduled, and
which workspace it used. For an implementer, every new lifecycle path must
preserve invariants across issue state, run state, wake requests, sessions,
workspace rows, recovery actions, events, and external processes.

### Concurrency and admission

The issue has two deliberate identities: `checkoutRunId` reserves the right to
prepare/claim the task, while `executionRunId` points to the live execution.
The documented semantics require compare-and-clear release and stale-lock
recovery
([execution semantics, lines 121-186](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/execution-semantics.md#L121-L186)).
Retry scheduling uses PostgreSQL transactions and `SELECT ... FOR UPDATE` on
the issue or source run before checking for an existing continuation and
inserting/reusing one
([heartbeat retry transaction, lines 10490-10583](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L10490-L10583)).

Queued-run admission also has a process-local per-agent promise lock. It waits
at most 30 seconds, then deliberately continues
([agent start lock, lines 1-48](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/agent-start-lock.ts#L1-L48)).
Inside that lock, the service recounts running runs, subtracts them from
`maxConcurrentRuns`, selects queued runs FIFO, and checks dependency readiness
([queued-run admission, lines 12459-12495](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L12459-L12495)).

The user-visible behavior is much safer than snapshot-only dispatch: a task has
a durable execution lock and retry identity. The implementation caveat is that
the per-agent capacity lock is not distributed and intentionally fails open
after 30 seconds. Cross-process safety therefore depends on the later database
claim/transition code, not on the start lock itself.

### Restart and resumption

Graceful shutdown terminates tracked processes, marks their runs interrupted,
records events, and queues process-loss retries
([shutdown drain, lines 9834-9902](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L9834-L9902)).
A deliberate hot restart writes an atomic intent/snapshot file and the new
server classifies runs as adopted, finalized while down, lost, or skipped
([hot-restart record](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/hot-restart.ts#L1-L67)).

On ordinary startup, Paperclip tries hot-restart adoption, reaps orphaned runs,
promotes scheduled retries, resumes queued runs, reconciles stranded assigned
issues and dependency wakes, runs watchdogs, scans silent processes, and clears
stale issue locks
([startup recovery, lines 942-1037](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/index.ts#L942-L1037)).

- After an immediate deliberate hot restart, an operating child can sometimes
  be adopted. After a crash, the durable run is classified and a new queued
  retry/continuation is created rather than pretending the old process lives.
- After a week, queued retries, issue state, workspace binding, run history,
  and provider session IDs remain in PostgreSQL unless retention or explicit
  cleanup has removed them. A new adapter run can continue with those facts.
  Exact conversation continuity still depends on the adapter/provider accepting
  the stored session ID, and exact filesystem continuity depends on the
  workspace still existing.

This is the strongest explicit restart protocol of the group. Its guarantee is
classification plus durable continuation, not universal process resurrection.

### Git workspaces and integration

Execution workspaces are first-class database rows with project/source issue,
strategy, provider, cwd, repository, base ref, branch, derivation, last use,
status, and cleanup eligibility
([workspace schema, lines 15-67](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/packages/db/src/schema/execution_workspaces.ts#L15-L67)).
The service validates that a recorded Git worktree is registered and on the
recorded branch, and records bounded failure evidence rather than blindly
launching in an incoherent directory
([execution semantics, lines 355-379](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/execution-semantics.md#L355-L379)).
It also includes branch reconciliation, quarantine/restore, and rescue-ref
machinery.

For a user, a stale or moved worktree becomes an explainable blocked recovery
case rather than silent execution in the wrong folder. For an implementer, the
workspace service has to reconcile two authorities: the PostgreSQL record and
actual Git/filesystem state.

Paperclip can create and preserve worktree branches, reviews, and work
products, but this study did not find one general, serialized accepted-head
integration protocol comparable to a dedicated merge queue. Its control plane
is strongest before and during execution; target-repository integration remains
more policy/adapter-specific than its run lifecycle.

### Code structure, seams, and verification

The monorepo separates database schema, shared contracts, adapters, server, UI,
plugins, and environment runtimes. Within the server, routes call focused
services for issues, workspaces, recovery, watchdogs, budgets, environments,
and activity. Adapters and plugin worker/environment managers provide real
production/test seams; service constructors generally accept a database and
some optional runtimes.

The main exception is architectural gravity around
`server/src/services/heartbeat.ts`: at this commit it exceeds sixteen thousand
lines and creates/coordinates issues, workspaces, adapters, sessions, budgets,
environments, retries, recovery, events, and finalization. Some policy has been
extracted into `recovery/*`, task-watchdog, execution-policy, workspace, and
run-liveness services, but many end-to-end slices still return to the heartbeat
service.

Tests cover database transitions, recovery durability, pause behavior, hot
restart, workspace seams, adapters, services, and routes with example-based
integration tests. The pinned manifests contain no property-testing framework,
formal model, or model-based state-machine suite. This matters more here than in
the smaller systems because the number of interleavings grows with every run,
issue, workspace, review, environment, and recovery state.

### Maintenance and reliability risks

1. **The heartbeat service is a correctness hotspot.** A change can couple
   admission, workspace realization, provider launch, recovery, budget, and
   finalization behavior across thousands of lines.
2. **Some locks have different scopes.** PostgreSQL row locks are
   cross-process; the per-agent start lock is memory-only and times out
   fail-open. Reviewers must identify which one actually protects each
   invariant.
3. **Current state plus events is not event sourcing.** History helps explain
   failures, but recovery still depends on many mutable columns being updated
   consistently.
4. **Rich recovery creates rich policy.** Automatic retry, escalation,
   watchdog, review recovery, workspace quarantine, and dependency wake repair
   can interact. Users get better recovery, but maintainers need exhaustive
   scenario and interleaving tests to prevent repair loops.

## Cross-project implications for Dalph

### What is worth borrowing

1. **From Beads: atomic graph-frontier claim with ambiguity resolution.** The
   combination of dependency-aware ready selection, claim CAS, renewable lease,
   retry after optimistic conflict, and verify-by-re-read after commit ambiguity
   is the best isolated admission primitive in this group. Dalph should preserve
   tracker authority, but its provider contract should demand equivalent atomic
   claim semantics or make the weaker boundary explicit.
2. **From Paperclip: separate checkout intent from live execution.** A planned
   attempt can reserve and validate a workspace before it becomes the live run.
   That maps well to intent-before-effect and observation-afterward, especially
   if Dalph brands the identities and stores only its workflow-journal facts.
3. **From Paperclip and Gas Town: classify restart, do not call every retry a
   resume.** “Adopted process,” “resumed provider session,” “fresh session in
   preserved worktree,” and “fresh attempt from clean base” should be distinct
   domain events with different user expectations.
4. **From HerdOS: externally durable compare-and-swap where the authority
   already lives.** Its review-lock branch is a useful example of using Git's
   non-fast-forward rejection as a real cross-process fence rather than adding
   an unrelated local mutex.
5. **From Symphony: keep the scheduling policy understandable.** Its one-process
   loop is easy to audit. Dalph can retain that clarity while interpreting the
   workflow algebra against a durable journal and typed provider boundaries.

### What should remain a deliberate non-goal

- Do not reproduce Gas Town's organization chart as control logic. Named agents
  are a product metaphor, not a substitute for explicit states and effects.
- Do not use mutable issue labels plus workflow-run counts as the only worker
  claim, as HerdOS does.
- Do not equate a reusable directory with an exact task attempt, as Symphony
  effectively permits.
- Do not centralize the entire execution and recovery state machine in one
  Paperclip-sized service. Keep the shared workflow algebra small, and express
  provider, Git, executor, integration, journal, and cleanup phenomena as
  distinct services and branded domain facts.
- Do not duplicate tracker, Git, or executor authority inside Dalph merely to
  gain a Paperclip-style all-in-one database. Journal Dalph's intents and
  observations; reconcile external facts at their owning boundary.

### Suggested next research questions

The next phase should turn these findings into chronological failure scenarios
and executable protocol tests:

1. Two schedulers see one ready task. Which authoritative call makes exactly one
   winner, and what does the loser observe?
2. The claim succeeds but the response is lost. Which reread distinguishes
   applied, rolled back, and still ambiguous?
3. The worktree is created but the journal observation is not written. Which
   exact base SHA and locator let reconciliation adopt or dispose it?
4. The executor process survives a control-plane restart. When may it be
   adopted, and which identity/token proves it belongs to the planned attempt?
5. The process is gone but the workspace has WIP. When is a fresh-session
   continuation safe, when must WIP be quarantined, and when must a clean
   attempt start?
6. Accepted work is integrated but the response is lost. Which Git reread
   proves success before retry, and how is cleanup disposition chosen?
7. A task returns after a week. Which facts are guaranteed by the tracker, Git,
   executor, and journal respectively, and which expired facts require a new
   attempt?

Those scenarios would expose the key competitive wedge: a smaller control plane
than Gas Town or Paperclip, but with stronger attempt identity, exact workspace
ownership, explicit ambiguity handling, and formally checkable recovery than
HerdOS or Symphony.
