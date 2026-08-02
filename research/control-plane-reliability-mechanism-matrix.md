# Reliability mechanisms across the closest open-source control planes

**Status:** source-inferred synthesis from pinned code, repository tests, and
first-party documentation; no competitor crash experiment has run.

Read this with the [mental-model atlas](./control-plane-mental-model-atlas.md)
and the [Dalph competitive evidence ledger](./dalph-competitive-evidence-ledger.md).
The former compares organizing ideas; the latter prevents intended Dalph
architecture from being presented as already implemented or empirically
proven.

This document compares mechanisms, not feature names. It asks how each product
limits work, survives interruption, preserves agent and Git state, and keeps
the implementation maintainable. The detailed evidence and fixed-commit source
links live in the individual architecture cards:

- [Gas Town + Beads](./cards/gastown-beads-reliability-architecture.md)
- [HerdOS](./cards/herdos-reliability-architecture.md)
- [OpenAI Symphony / Elixir OTP](./cards/symphony-otp-reliability-architecture.md)
- [Paperclip](./cards/paperclip-reliability-architecture.md)
- [Agent Kanban](./cards/agent-kanban-reliability-architecture.md)
- [Any Managed Agents](./cards/any-managed-agents-reliability-architecture.md)
- [AIF Handoff](./cards/aif-handoff-reliability-architecture.md)
- [Kandev](./cards/kandev-reliability-architecture.md)
- [Warren](./cards/warren-reliability-architecture.md)
- [Burrow](./cards/burrow-reliability-architecture.md)

The comparison assumes one coordinator at a time for one repository. It does
not treat active-active multi-replica scheduling as a current Dalph
requirement.

## What each product is really built around

| Product | Core mental model | What makes restart possible | Main cost |
|---|---|---|---|
| Gas Town + Beads | An organization of long-lived supervisory roles around persistent worker identities and worktrees | Beads/Dolt records, Git worktrees, hooks, tmux inspection, checkpoints, handoff mail, Witness/daemon repair, and selected provider resume paths | Claims, hooks, sessions, worktrees, tmux processes, and integration slots each have their own recovery state and procedure; maintainers must keep those procedures mutually consistent |
| HerdOS | GitHub issues, labels, Actions runs, branches, PRs, and checks collectively form the workflow state | A later job rereads GitHub and remote Git, then starts a fresh agent from pushed commits and a progress file | Intermediate label, dispatch, comment, branch, and cleanup effects are separate calls with uneven ambiguity handling |
| Symphony | One supervised in-memory scheduler repeatedly polls an external tracker and runs an agent in a deterministic directory | OTP resets the local runtime; a fresh scheduler polls again and may reuse the directory | Claims, retries, blocked state, model context, and process identity reset; Git and integration are delegated to hooks and prompts |
| Paperclip | Mutable PostgreSQL current state plus startup/periodic reconcilers around issues, runs, sessions, processes, and workspaces | Durable rows classify queued, live, detached, lost, retrying, or recoverable work; workspace and provider handles may remain | Correctness converges in a very large heartbeat slice, and current rows, audit events, Git, processes, logs, and provider state can disagree |

None of these is a general durable workflow engine. Gas Town and HerdOS use
different recovery procedures for different external operations; Symphony
intentionally resets; Paperclip persists more current state and runs more
reconcilers, but does not rebuild current state by replaying one event history.

All recovery code, including Dalph's, is authored application code. The
comparison is not “hand-written versus automatic.” It is whether each boundary
develops a separate lifecycle and repair policy, or whether boundary-specific
observations are reduced through one shared recovery vocabulary and decision
model.

## Admission and bounded parallel work

| Product | Actual admission mechanism | Important qualification | User-visible consequence |
|---|---|---|---|
| Gas Town | Host-local scheduler lock, capacity plan, Polecat creation/reuse, then generic durable `hooked` assignment | Beads has a stronger transactional leased claim API, but Gas Town's reachable scheduler path does not call it | Capacity is real and uncertain/dirty Polecats stay occupied, but crash windows can leave workspace, hook, session, and scheduler-context facts out of agreement |
| HerdOS | Counts workflow runs, changes labels, then dispatches a GitHub Action | Different paths count queued/running work differently; label and dispatch are not atomic | A failed label can coexist temporarily with a queued worker, and retries can duplicate work |
| Symphony | One GenServer serializes decisions and counts its live `running` map | The claim and capacity record are process memory only | One healthy coordinator is simple and predictable; restart forgets occupied responsibility and may launch fresh work |
| Paperclip | Process-local per-agent start lock plus database compare-and-set for each queued run | The individual run claim is cross-process, but the capacity recount and all claims are not one database semaphore | One coordinator respects the configured cap; two coordinators could each claim a different run from the same observed free slot |

The strongest transferable ideas are:

- Gas Town counts dirty, stashed, unpushed, and uncertain Polecats against
  capacity.
- Symphony gives one local owner all scheduler mutations.
- Paperclip uses database compare-and-set for each run rather than trusting a
  local queue item.
- HerdOS correlates queued and running workflow inputs before redispatch in its
  strongest path.

Dalph can combine those ideas: one coordinator owns scheduling, tracker
claims remain authoritative, an attempt keeps its task-work position until the
executor is terminal or safely stopped, and startup reconciles real executor
and Git facts before freeing capacity.

## What “restored” means in each product

| Product | Control-plane task/run | Agent context and log | Exact Git worktree | Live execution |
|---|---|---|---|---|
| Gas Town | Durable task/hook/worker records survive, but there is no single exact planned-attempt object | Selected provider paths resume; common Witness restart starts a fresh process over the same hook/worktree; logs are telemetry, not replay state | Strong while the exact directory survives; checkpointing may commit and therefore transform staged/unstaged/untracked state; ignored and conflict state still depend on the directory | tmux/process observation finds what is live; a host reboot means process restart, not memory restoration |
| HerdOS | Issues, labels, run history, branches, and comments survive | Retry always starts a fresh provider invocation; Codex is explicitly ephemeral | Only pushed commits reliably survive a fresh job; timeout checkpoint collapses visible dirty state into a commit, while abrupt loss drops unpushed layers | GitHub knows the workflow run, but HerdOS does not adopt a surviving child, container, or old runner filesystem |
| Symphony | Tracker task survives; scheduler claim, retry, blocked, completion, and capacity state reset | A replacement always sends `thread/start`; old rotating logs are not supplied as context | Existing directory is reused without reset, so all layers may survive, but no base/ownership/coherence check proves reuse is safe | OTP proves no supervised-worker overlap inside one live BEAM; whole-BEAM/host loss has no survivor scan |
| Paperclip | Issues, wake requests, runs, retries, workspaces, and recovery actions survive as database current state | Adapter-owned session handles may resume; process adapter cannot; finalized logs can be durable while active local logs can disappear | Same-directory continuation is strong; quarantine and remote sync preserve content while collapsing or omitting some index, conflict, ignored, and stash distinctions | Hot restart can classify a PID/PGID as adopted; source does not show stream or completion-callback reattachment |

This is the largest practical opening for Dalph. A user should see four
separate answers:

1. Is this the same control-plane attempt?
2. Is this the same agent session/context/log?
3. Did every valuable Git layer survive?
4. Is an old executor still alive, adopted, stopped, or unknown?

Calling all four “resume” hides materially different risks.

## Git starting point and integration

| Product | Starting point | Combining accepted work | Important limit |
|---|---|---|---|
| Gas Town | Worktree creation resolves a moving base/ref; no durable exact Base SHA is first bound to the attempt | Shipped per-MR Refinery path runs gates, pushes, verifies remote state, and later proves submitted ancestry | Its persistent merge slot is a read/check/update record without compare-and-set, lease, or fencing; batch/bisect is not production-reachable at the pin |
| HerdOS | Workers start from or merge an evolving batch branch | Normal non-fast-forward push protects the batch ref; Actions groups serialize important paths; append-only ref CAS protects review | On merge conflict, the old worker branch may be deleted and restarted; ambiguous push is not immediately reread on the error path |
| Symphony | Hook/prompt policy chooses clone, branch, and synchronization | No core integration protocol | Installations can have materially different Git safety while using the same scheduler |
| Paperclip | Managed workspace records base/branch, but a clean unstarted workspace may advance to a newer base | Core restores agent output to a workspace; PR/merge is external | Workspace synchronization is not accepted-target integration |

An exact Base SHA has real weight when an attempt is expensive, resumes after
repository movement, or must be explained later. It is less useful when every
retry is intentionally a fresh attempt against the newest branch. Dalph should
make that distinction explicit: continuing one attempt preserves its planned
base; starting a new attempt may deliberately select a new base.

Separate integration also has real weight. Gas Town and HerdOS prove that
agent products eventually need controlled Git convergence. Their source also
shows why “a merge slot exists” is not enough: the protocol needs a real
accepted-head fence, authoritative reread after an ambiguous update, retained
candidate evidence, and cleanup only after the target result is proved.

## Maintainability and dependency seams

| Product | Strong seam | Where reliability logic spreads |
|---|---|---|
| Gas Town + Beads | Beads storage interface and backend conformance tests; pure workstate/capacity decisions | CLI/subprocess status conventions, large sling/Witness/Refinery slices, local retry loops, provider-specific restart paths |
| HerdOS | Injected platform and agent interfaces; temporary Git and fake executable tests | Git is often constructed directly; clocks and crash points are not first-class; dispatch, patrol, and integration implement related rules separately |
| Symphony | Tracker behaviour, memory adapter, injectable OTP names, app-server callbacks | Filesystem, workspace, timers, shell, SSH, Git hooks, and configuration are concrete/global; no shared fake runtime |
| Paperclip | Adapter execution context, database services, real Git/process fixtures | The heartbeat service coordinates most lifecycle states and direct database/filesystem/Git/process/provider effects |

No product in the first group interprets one complete workflow with production,
test, live-fake, in-memory, and dry-run services. Each has useful local seams;
none can swap the entire cross-authority execution while keeping identical
workflow logic.

This is where Effect services and layers can be genuine technical leverage:

- make tracker, Git, executor, journal, clock, filesystem, and observation
  dependencies explicit;
- run the same chronological workflow with production, fake, dry-run, and
  fault-injection layers;
- give ambiguous outcomes and cleanup dispositions distinct typed failures;
- scope process, worktree, lock, and subscription lifetimes;
- use a fake clock for retries and week-later scenarios; and
- keep pure scheduling and reconciliation decisions separate from effects.

Effect is not leverage when it merely recreates a GenServer, mutex, retry loop,
or database row in TypeScript. It matters only when those seams make a
user-visible protocol easier to implement, test, and change.

## Verification

| Product | Strongest evidence found | Missing from the pinned source |
|---|---|---|
| Gas Town + Beads | Beads ambiguity fault tests and backend claim/lease conformance; broad Git/Witness/workstate tests; some randomized graph tests | Whole-system boundary-kill matrix, formal model, generative state-machine suite, exact all-Git-layer reboot test |
| HerdOS | Broad Go tests, temporary Git, provider fakes, race-detector CI, review-lock tests | Crash harness, property/state-machine suite, formal model |
| Symphony | Real OTP subtree-restart/no-overlap test, stale-token tests, workspace preservation tests, broad ExUnit/Dialyzer checks | Whole-BEAM boundary matrix, durable recovery tests, fake clock, property/state-machine suite, formal model |
| Paperclip | Extensive process/recovery/workspace/race examples with PostgreSQL, Git, and subprocess fixtures | Whole-server boundary-kill matrix, cross-process capacity test, property/state-machine suite, formal model |

Dalph can out-engineer this group if it demonstrates, rather than merely
documents:

- scenario-to-test mapping for every interruption boundary;
- provider contract conformance across production and fake adapters;
- property tests for reducers, reconciliation, capacity, and cleanup
  classification;
- model checking for duplicate execution, lost responsibility, unsafe cleanup,
  and stale accepted-head integration; and
- isolated crash tests that preserve and compare all four restoration layers.

Formal methods are not a user feature by themselves. Their value is preventing
the failures users do notice: duplicate expensive agents, silent work loss,
unsafe deletion, inconsistent retries, and a false “completed” result after an
ambiguous Git update.

## What the second source wave changes

| Product | Serious intersection with Dalph | What it does not establish |
|---|---|---|
| Agent Kanban + AMA | Durable task DAG and lifecycle, assignment/task/dispatch compare-and-set operations, D1-enforced per-runner capacity, durable leases and resume tokens, same-runner reexecution, review messages, and GitHub-driven completion | Session creation has no client idempotency key; multi-step lease claim can leak capacity or strand work after hard death; recovery restarts rather than adopts the process; no exact attempt Base SHA or accepted-head integration record exists. |
| AIF Handoff | Bounded stage workers, durable task rows and locks, named branch/worktree reuse, provider adapters with optional session resume, watchdog retries, bounded review loops, and a local-commit recovery check | Its dependency layers are checklist items inside one plan rather than a durable task graph. Generic recovery reruns a stage after a timeout without reconstructing the exact attempt or first checking whether its provider effect completed. It stops at a local commit rather than integration. |
| Kandev | Durable tasks, workflow queues and WIP admission, task sessions, messages, runtime handles, prompt queues, parallel exact worktrees, lazy provider resume, and forge review/merge surfaces | Board WIP does not prove how many executor responsibilities remain alive. Runtime recovery is mostly lazy rather than an eager survivor census. A recreated worktree restores branch commits but not its former index or uncommitted layers. It does not bind a planned Base SHA or control accepted-head integration. |
| Warren + Burrow | Durable runs and ordered plans, frozen prompt/agent input, provider-neutral execution handles, restart reattachment when a provider execution survives, persisted event cursors, sandbox backends, and push-failure workspace preservation | Children inside one plan are serial, not graph-parallel. Warren can lose handles before recording them. Kubernetes caps are soft and pod loss destroys unpushed work. Burrow's local cap is process-only; restart marks interrupted runs failed and does not restore the Codex context or adopt the process. |

Kandev materially raises the restoration bar in this comparison. If its exact
worktree and provider token survive, a user can often return to the same files,
conversation, prompt queue, and task session. Warren materially raises the
live-run bar: after both provider handles are stored, a replacement coordinator
can reconnect to the same execution and resume its event stream. The Burrow
follow-up limits that statement for Warren's local backend: Burrow deliberately
marks interrupted runs failed, retains the workspace and persisted events, and
starts fresh work later rather than adopting the former Codex process or
context.

Those mechanisms narrow Dalph's claim. “Persistent worktrees,” “persistent
sessions,” or “restart recovery” are not differentiators by themselves.
Dalph's remaining claim must be the composition:

1. one attempt records the exact starting commit and exact worktree;
2. the control-plane attempt, provider session/log, complete Git state, and
   live executor are reported separately;
3. an uncertain old executor continues to occupy a task-work position until it
   is proved stopped or safely suspended;
4. every ambiguity-crossing operation follows the same record-intent, perform,
   observe, and reconcile-before-retry shape; and
5. accepted target updates have their own capacity and recovery protocol.

The AMA follow-up changes Agent Kanban's assessment in both directions. Its
capacity is stronger than Agent Kanban's stale load precheck suggests: AMA
conditionally reserves D1 load below `maxConcurrent`. Its week-later recovery
is weaker than a generic “persistent session” label suggests: a self-hosted
runner deletes session directories older than 24 hours before it asks D1 which
leases still need recovery. That can remove the worktree and both local logs
before an active attempt is examined.

## Current competitive conclusion

There is serious intersection:

- Gas Town is the closest complete operational shape.
- Kandev is the strongest local session/worktree restoration competitor.
- Agent Kanban with AMA is the strongest task-board plus managed-runner
  combination in the second wave.
- HerdOS is the closest external-GitHub delivery loop.
- Symphony is the cleanest tracker-driven scheduling kernel and the strongest
  alternative language/runtime model.
- Paperclip is the richest durable current-state and restart implementation.
- Warren has the cleanest provider-neutral live-run reattachment seam, with
  Burrow and Kubernetes imposing different recovery floors.

The broad category is occupied. “Dependency graph + bounded agents + Git
worktrees + resume” is not a sufficient differentiator.

The source-visible niche that remains credible is:

> coordination beside the team's existing tracker and Git, with one exact
> attempt base, four-layer restoration, one typed ambiguity protocol, and
> separately controlled accepted-head integration.

The most defensible engineering wedge is not “uses Effect.” It is:

> the same workflow and recovery decisions run against production, fake,
> dry-run, and fault-injection services, with source-visible proofs that
> retries do not duplicate work and cleanup does not destroy uncertain work.

## Where Dalph can outcompete or out-niche

| Direction | Engineering requirement | What a person would notice |
|---|---|---|
| Honest restoration | Show the control attempt, agent context/log, complete Git state, and live executor separately, while treating them together as the user's coding session | “Resume” never hides that the conversation restarted, uncommitted files disappeared, or an old process may still be running |
| Reproducible attempts | Bind one planned Base SHA and exact worktree before starting the executor | A retry after a week either continues from the same code or clearly starts a new attempt against newer code |
| Capacity under uncertainty | Keep the task-work position occupied until the old executor is proved terminal or safely stopped | Restart cannot silently exceed the configured agent limit by launching a duplicate |
| Safe unattended convergence | Give accepted-target integration its own serialized capacity, target-head observation, intent, result, and ambiguity reconciliation | Several agents may finish together without racing or reporting a false merge failure |
| One recovery model | Express intent, effect, observation, retry, and cleanup through the same typed workflow decisions for tracker, Git, executor, and hosting boundaries | Recovery behaves consistently instead of changing by operation or provider |
| Executable reliability evidence | Run the same workflow against production, deterministic fake, dry-run, and faulting services; add property, model, and boundary-kill tests | Fewer duplicate agents, silent work losses, unsafe deletions, and unexplained terminal states |
| Existing-tool niche | Keep the team's tracker and Git authoritative instead of requiring migration to another product-owned board | Teams can add orchestration beside their current planning and review process |

Ordinary Effect already helps with the fifth and sixth rows because Dalph can
make every boundary an explicit service and substitute production, fake,
dry-run, clock, and fault Layers without rewriting the workflow. Effect
Workflow is not required for that advantage. Its Cluster engine may later help
deliver and replay named work, but it would add SQL message storage and a
second durable protocol whose relationship to Dalph's narrow journal must be
specified and crash-tested first.

The second source wave is complete. The first Symphony experiment harness was
implemented, but its preflight correctly blocked on this host before Symphony
started or any crash was injected. The competitive conclusion therefore
remains a pinned-source hypothesis backed by prepared fault specifications,
not yet a fault-experiment-proven product claim.
