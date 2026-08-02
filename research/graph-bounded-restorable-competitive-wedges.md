# Graph-bounded, restorable coding-agent control planes: competitive wedges

**Research date:** 2026-07-30
**Scope:** Compare serious source-visible and commercial competitors against one
specific Dalph product contract. This research changes no Dalph runtime
behavior, so no operational scenario or scenario-to-test mapping applies.

## Reading boundary and next step

This document is the broad intersection scan. It is not the final technical
reliability comparison.

The next source audit focuses on open-source products and is defined in the
[reliability architecture research plan](./control-plane-reliability-architecture-plan.md).
That plan translates terms such as fixed Base SHA, safe pause,
operation-specific recovery, product-owned task state, and accepted-head
integration into both implementation consequences and things a user would
notice.

Closed products remain short market-context notes because their internal
reliability and maintainability cannot be audited. GitHub and GitLab remain in
this broad scan as platform context but are excluded from the focused technical
study.

## The contract being compared

The comparison is deliberately narrower than “runs multiple coding agents.”
Dalph's intended control plane combines six behaviors:

1. an **external task tracker** owns the dependency graph, and the observed
   graph mechanically determines which tasks are eligible;
2. a separately computed admission set consumes and releases **bounded
   task-work capacity**;
3. each admitted attempt is planned against one immutable **Base SHA** and gets
   one exact branch and worktree;
4. an executor can run, safely suspend, and restore that exact attempt;
5. after restart, Dalph reduces durable journal history and rereads the
   tracker, Git, and executor before deciding whether to continue or retry; and
6. integration consumes a **different bounded resource** and is serialized for
   each integration target.

The project architecture makes the authority split explicit: the tracker owns
task identity, lifecycle, dependencies, grouping, and claims; Git owns lineage,
refs, commits, worktrees, and integration facts; the executor owns session and
process observations; the journal owns only workflow history
([authority table](../docs/ARCHITECTURE.md#authority-and-reconciliation)).
The planned attempt binds the task revision, Base SHA, branch, worktree, and
executor locator before execution
([planned-attempt language](../docs/CONTEXT.md#executor-internal-policy)).

That composition, not any one checkbox, is the competitive test.

## Evidence labels

- **Source-verified** means the behavior was found in the pinned implementation
  under `.references` at the named commit.
- **Documented shipped** means a vendor's current first-party product
  documentation or release note says the feature is available. Proprietary
  internals were not available for verification.
- **Roadmap/research** means the vendor explicitly describes the behavior as
  future, experimental, preview, or research.
- **Undocumented** means no reviewed primary source establishes the required
  semantics. It does not prove that an internal implementation lacks them.

## Ranked conclusion

There are two honest answers to “closest.” Against the short product phrase
“graph + bounded parallel agents + restorable worktrees,” **Gas Town is first**.
Against Dalph's stricter authority-preserving delivery contract, **HerdOS and
Symphony expose the closest individual halves**, but neither composes the
whole.

1. **Gas Town plus Beads is the closest source-visible mechanism match.** It
   has a durable graph, ready-work selection, worker capacity, resumable
   sessions, worktrees, startup recovery, watchdog/doctor repair, and a
   one-at-a-time Refinery integration path in the intended topology. Its
   persistent merge slot is not an atomic or fenced lock, and its documented full
   batch-then-bisect protocol is still incomplete at the pinned revision. The
   price is adopting its own task authority and operational model.
2. **HerdOS is the closest source-visible external-authority delivery
   competitor.** It combines a GitHub task DAG, bounded workers, branches,
   review and CI repair, recovery, and serialized batch integration. Its
   attempt base and recovery algebra are materially weaker than Dalph's
   intended contract.
3. **Symphony is the cleanest tracker-driven reconciliation kernel.** It has
   external dependency eligibility, bounded dispatch, deterministic
   workspaces, retries, stall handling, reconciliation, and cleanup, but no
   exact Git attempt lineage or integration protocol.
4. **Paperclip is a serious broad control-plane overlap.** It has
   first-class blockers, dependency-gated wakeups, atomic execution checkout,
   bounded per-agent runs, runtime-created worktrees, persistent execution
   sessions, and stale-lock/orphan recovery. It still owns the task database
   and does not own Git integration.
5. **Factory Missions is the closest commercial product story.** It documents
   dependency-aware decomposition, resource allocation, parallel workers, Git
   handoffs, milestone validation, and failure recovery. Its implementation is
   proprietary and its AI-generated mission plan, rather than an external
   tracker graph, appears to own routing.
6. **Warren is a strong active sandbox, admission, and restart substrate.**
   Its current plan-run mode is deliberately serial and gated on each preceding
   PR merge, so it is not yet a graph-parallel delivery controller.
7. **Agent Kanban, AIF Handoff, Kandev, Replit, Devin, GitHub, and GitLab each
   cover serious slices**, but none of their reviewed contracts composes all
   six behaviors.

No reviewed competitor establishes the complete combination of external graph
authority, exact immutable attempt lineage, executor restoration, multi-authority
restart reconciliation, and separately serialized accepted-head integration.

## Compact comparison

Legend: **Yes** = central and source-verified; **Doc** = documented shipped but
not source-verifiable; **Partial** = real overlap with a materially different
contract; **No evidence** = absent from the reviewed primary-source boundary.

| Candidate | External graph controls eligibility | Bounded task-work capacity | Exact worktree + planned Base SHA | Run / suspend / restore | Restart rereads tracker + Git + executor | Separate serialized integration |
| --- | --- | --- | --- | --- | --- | --- |
| **HerdOS** | **Yes, GitHub** | **Yes** | Partial: branch checkout, no first-class immutable attempt base | Partial: redispatch/retry, not exact executor restoration | Partial: Action/issue/branch patrol, operation-specific | **Partial/strong:** serialized batch consolidation |
| **Factory Missions** | No: generated mission graph | **Doc** | Undocumented | **Doc:** worker sessions and recovery | Undocumented authority reconciliation | **Doc/partial:** Git handoffs and assembly |
| **Gas Town + Beads** | No: Beads/Dolt is its own authority | **Yes:** town-wide `max_polecats` | Partial: isolated worktree, base contract differs | **Yes/partial:** provider session resume on selected paths, checkpoints, handoff | **Yes/partial:** durable ledger, startup sweep, hooks, doctor/watchdogs | **Partial:** ordinary per-MR Refinery path; persistent slot is not atomic or fenced; full batch-then-bisect is incomplete |
| **Symphony** | **Yes, Linear contract** | **Yes** | Partial: deterministic directory; Git lineage unspecified | Partial: same workspace and retries; live state is not durable | **Yes/partial:** tracker reconciliation, no Git/executor authority protocol | No evidence |
| **Agent Kanban** | No: its D1 board owns the DAG | **Yes** | Partial: per-task worktree; immutable base not established | Partial: preserved session ID and resume | Partial: server task state, not authority reduction | No: PR/leader/human completion |
| **Paperclip** | No: its issue DB owns first-class blockers | **Yes:** `maxConcurrentRuns` plus locks/budgets | **Yes/partial:** managed worktree and recorded branch; no immutable attempt Base SHA | **Yes/partial:** durable runs, persistent sessions, wakeups | **Yes/partial:** stale-lock, process-loss, orphan, and workspace-coherence recovery | No evidence |
| **Warren** | No: optional Seeds plan, not external tracker authority | **Yes:** cluster admission caps | **Yes/partial:** fresh sandbox/branch; no planned Base SHA contract | **Yes/partial:** steer, cancel, runtime restart | **Yes/partial:** persisted events and run recovery | No: plan-runs wait serially for external PR merge |
| **AIF Handoff** | No: internal task/subtask graph | Partial | **Yes/partial:** worktree-backed stages, no Dalph base contract | **Yes/partial:** heartbeat recovery and retry | Partial: SQLite-stage recovery, not external authorities | No evidence |
| **Kandev** | No: its task/workflow DB is authority | **Yes:** workflow WIP | Partial: task/repository worktrees | Partial: sessions and executors | Partial: own state plus Git observations | Partial: Git operations serialize, not accepted-head integration |
| **Replit task system** | No: Agent-generated internal task board | **Doc:** 1 or 10 slots plus queue | **Doc/partial:** isolated project copies | Documented background threads; restoration unspecified | Undocumented | **Doc/partial:** human apply with automatic conflict resolution |
| **Devin managed sessions** | No: manager-generated work packages | **Doc/partial:** child and ACU limits | **Doc:** isolated VMs; exact Base SHA undocumented | **Doc:** inspect, message, sleep, terminate | Undocumented authority reconciliation | **Doc/partial:** conflict resolution and compiled result |
| **GitHub Copilot** | No documented dependency scheduler | Platform/runner limits, not a task admission contract | **Doc:** isolated worktree/branch or ephemeral environment; planned SHA undocumented | **Doc:** durable sessions and agent merge; exact restoration unspecified | Undocumented | **Doc/partial:** agent merge after GitHub gates |
| **GitLab Duo** | No documented dependency scheduler | CI runner capacity, not graph admission | **Doc:** isolated CI execution; exact planned attempt unspecified | **Doc:** sessions and jobs | Undocumented | MR lifecycle exists; no separate serialized agent integrator |

## Serious source-visible overlaps

### 1. HerdOS — closest end-to-end competitor

Inspected source:
[`herd-os/herd@afb8e527fee2f9081963310bad1645bdc2806d68`](https://github.com/herd-os/herd/tree/afb8e527fee2f9081963310bad1645bdc2806d68).

**Source-verified overlap**

- GitHub issues and labels are work items, milestones are batches, Actions are
  workers, and GitHub is the source of truth; there is no local database
  ([architecture](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/docs/design/architecture.md#L93-L145)).
- The implementation rejects graph cycles and computes dependency tiers with
  Kahn's algorithm
  ([DAG source](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/dag/dag.go#L8-L85)).
- `max_concurrent` bounds workers. Workers use separate branches, validate and
  push, while the integrator consolidates completed work before releasing the
  next dependency tier
  ([execution design](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/docs/design/execution.md#L9-L97)).
- GitHub Actions concurrency groups serialize batch integration. A losing
  non-fast-forward writer fails for retry rather than overwriting the winner
  ([GitHub integration](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/docs/design/github-integration.md#L192-L216)).
- Its patrol detects in-progress issues with no live Action, applies bounded
  redispatch and backoff, cancels overlong runs, deduplicates retry triggers,
  and escalates after exhaustion
  ([patrol source](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/internal/monitor/patrol.go#L72-L147)).

**Material gaps**

- A worker starts from the current batch branch. HerdOS does not materialize an
  immutable planned Base SHA as a first-class attempt invariant.
- Its GitHub issues, labels, comments, lock branches, Action runs, and progress
  markers collectively carry workflow state. Dalph keeps tracker, Git,
  executor, and journal authority distinct.
- If a resumed worker branch cannot merge the changed batch branch, HerdOS may
  delete the worker branch and start fresh, explicitly losing partial work
  ([retry/resume design](https://github.com/herd-os/herd/blob/afb8e527fee2f9081963310bad1645bdc2806d68/docs/design/execution.md#L212-L250)).
- Recovery guards are operation-specific. The source does not establish one
  intent-before-effect, observe-afterward, reconcile-before-retry algebra
  across claims, Git, executor work, integration, and cleanup.

**Competitive implication:** “GitHub DAG + parallel agents + review + retry +
merge” is not a defensible headline. Exact lineage and principled ambiguity
recovery are.

### 2. Gas Town and Beads — broad fleet runtime, wrong authority boundary

Inspected source:
[`gastownhall/beads@0e069115a231c537a83bb77a5106fe7c0efb47f2`](https://github.com/gastownhall/beads/tree/0e069115a231c537a83bb77a5106fe7c0efb47f2)
and
[`gastownhall/gastown@649b832b7672bc7a2dbef26f5983aba6198b819b`](https://github.com/gastownhall/gastown/tree/649b832b7672bc7a2dbef26f5983aba6198b819b).

**Source-verified overlap**

- Beads provides dependency and blocker records plus ready-work queries; Gas
  Town's convoy manager feeds newly ready work when blocker-close events occur
  ([convoy behavior](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/skills/convoy/SKILL.md#L1-L88)).
- Staged convoys validate dependencies and compute dispatch waves before
  launch, including capacity warnings
  ([staging](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/skills/convoy/SKILL.md#L175-L301)).
- Polecats work in isolated Git worktrees, provider presets can resume exact
  agent sessions when supported, and non-resumable providers receive fresh
  sessions with handoff mail
  ([provider lifecycle](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/agent-provider-integration.md#L19-L69),
  [resume fallback](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/agent-provider-integration.md#L606-L630)).
- A town-wide capacity scheduler counts all active polecats across rigs and
  applies `max_polecats`, a per-heartbeat batch size, and spawn spacing
  ([capacity source](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/scheduler/capacity/config.go#L1-L78)).
- The ordinary one-Refinery-per-rig path attempts to serialize default-branch
  pushes through a persistent merge-slot record and contains batch-queue
  implementation code
  ([merge processor](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L258-L318),
  [serialized push](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/engineer.go#L697-L699),
  [batch queue](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/refinery/batch.go#L1-L80)).
  The architecture's phase table nevertheless marks the parallel-gate
  prerequisite in progress and batch-then-bisect blocked, so the full protocol
  is not a completed capability at this revision
  ([status](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/design/architecture.md#L206-L235)).
  The slot itself is a read/check/generic-update protocol without a
  compare-and-set token, lease, or fencing value, so duplicate Refinery
  processes can race
  ([slot implementation](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/beads/beads_merge_slot.go#L98-L163)).
- Session checkpoints capture Git and work state for crash recovery, the daemon
  performs startup/stranded scans, and `doctor --fix` addresses orphan sessions
  and invalid worktrees
  ([checkpoint source](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/checkpoint/checkpoint.go#L1-L130),
  [convoy startup sweep](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/daemon/convoy_manager.go#L80-L120),
  [cleanup](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/docs/CLEANUP.md#L1-L127)).

**Material gaps**

- Beads/Dolt, not an already-adopted external tracker, is the work authority.
  Adding a conventional tracker would require synchronization or replacement.
- Gas Town's reachable capacity-dispatch path does not use Beads'
  transactional leased claim. It uses host-local locks, creates or reuses a
  Polecat worktree, and then records a generic `hooked` assignment before
  starting tmux
  ([dispatch sequence](https://github.com/gastownhall/gastown/blob/649b832b7672bc7a2dbef26f5983aba6198b819b/internal/cmd/sling_dispatch.go#L235-L425)).
- Persistent role, convoy, hook, queue, and worktree records form a broader
  operational ledger than Dalph's narrow workflow journal.
- The reviewed source does not establish one immutable Base SHA per attempt or
  reread tracker, Git, and executor authorities from a reduced journal after
  every ambiguous outcome.
- Refinery provides a real per-MR integration path and remote ancestry checks,
  but its slot is not a reliable fence against duplicate integrators. The
  complete batch-and-bisect design is unfinished, and its contract is not
  Dalph's separately bounded accepted-head integration protocol.

### 3. Symphony — strongest tracker-driven reconciliation baseline

Inspected source:
[`openai/symphony@f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7`](https://github.com/openai/symphony/tree/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7).

**Source-verified overlap**

- The tracker supplies blocker metadata and dispatchability. The orchestrator
  also applies claim, state, label, retry, and concurrency rules
  ([specification](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L173-L195)).
- Global and per-state concurrency limits mechanically bound dispatch
  ([configuration](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L448-L458),
  [admission](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L751-L794)).
- Each issue has a deterministic, contained workspace that survives successful
  runs and retries
  ([workspace invariants](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L857-L945)).
- Startup cleanup and active-run reconciliation reread tracker state, terminate
  stale or unroutable work, clean terminal workspaces, and retry stalled runs
  ([reconciliation](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L807-L849)).

**Material gaps**

- Blockers are best-effort adapter metadata; an adapter must not invent blocker
  semantics it cannot provide
  ([tracker contract](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1180-L1203)).
- Workspace population and synchronization are implementation-defined. The
  spec does not require an exact Git worktree and planned Base SHA.
- Running sessions and retry timers live in memory and are not restored after
  restart; startup reconstructs from tracker state and preserved workspaces
  ([restart boundary](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md#L1688-L1715)).
- It has no accepted-head integration lifecycle or separate integration
  resource.

### 4. Agent Kanban — strong graph, claim, and admission prior art

Inspected source:
[`saltbo/agent-kanban@a26bef6e4f657ed8217eca79b0b90a3a1a8ac198`](https://github.com/saltbo/agent-kanban/tree/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198).

**Source-verified overlap**

- A machine selects the highest-priority unblocked task only while under its
  configured `max_concurrent`, then performs an atomic server-side claim
  ([machine scheduler](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/docs/designs/vision.md#L44-L82)).
- Multiple machines compete for the same claim, with database atomicity
  deciding the winner
  ([decentralized scheduling](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/docs/designs/vision.md#L73-L82)).
- The daemon creates a worktree per task and preserves agent session identity
  for later resume
  ([task lifecycle](https://github.com/saltbo/agent-kanban/blob/a26bef6e4f657ed8217eca79b0b90a3a1a8ac198/docs/designs/vision.md#L90-L140)).

**Material gaps**

- Agent Kanban's D1-backed board is the canonical task system. It does not
  traverse an external tracker without replacing or mirroring that authority.
- The per-task worktree is not documented as deriving from one immutable
  planned Base SHA.
- Completion proceeds through leader/human PR review. The product does not
  specify journal reduction, multi-authority restart reconciliation, or a
  separately bounded accepted-head integrator.

### 5. Paperclip — broad graph, admission, workspace, and recovery overlap

Inspected source:
[`paperclipai/paperclip@d5b9f6c8c9d9edb0c9796df86c61826b11400b5b`](https://github.com/paperclipai/paperclip/tree/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b).

**Source-verified overlap**

- Paperclip owns agents, issues, first-class blockers, budgets, approvals,
  heartbeats, and governance while adapters invoke external agents
  ([product contract](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/PRODUCT.md#L5-L81)).
- A blocked issue remains idle until its last blocker completes; cancelled
  blockers do not release dependants. Checkout separates the issue-ownership
  lock from the currently active execution path, compare-and-clears terminal
  owners, and fails a live conflict closed
  ([execution semantics](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/execution-semantics.md#L121-L186)).
- The scheduler holds an agent-scoped start lock, computes available slots from
  `maxConcurrentRuns - runningCount`, orders queued runs, and evaluates
  dependency readiness before starting them
  ([scheduler source](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/server/src/services/heartbeat.ts#L12459-L12495)).
- Runtime-created Git worktrees persist a recorded branch. Reuse and finalization
  verify that the worktree is still registered and on that branch; unsafe
  incoherence fails with bounded evidence rather than silently becoming a
  healthy run
  ([workspace coherence](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/execution-semantics.md#L355-L379)).
- It also implements budget hard stops, durable activity, persistent sessions,
  idempotent wakeups, and orphaned-run/watchdog recovery
  ([README](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/README.md#L159-L278),
  [watchdog](https://github.com/paperclipai/paperclip/blob/d5b9f6c8c9d9edb0c9796df86c61826b11400b5b/doc/TASK-WATCHDOG.md#L83-L105)).

**Material gaps**

- Paperclip deliberately owns the issue ledger, so its recovery is internally
  coherent but does not preserve Dalph's external tracker authority.
- Its recorded branch and coherent worktree are substantial, but the reviewed
  contract does not bind one immutable planned Base SHA to each attempt.
- It is not a Git-integration controller and does not establish serialized
  accepted-head integration across independently accepted changes.

### 6. Warren — active execution substrate, serial delivery plan

Inspected source:
[`jayminwest/warren@b13c7597c529360ad150bccc629bf28f603bc692`](https://github.com/jayminwest/warren/tree/b13c7597c529360ad150bccc629bf28f603bc692).
Warren is the active successor to the archived Overstory project.

**Source-verified overlap**

- Every run is short-lived and sandboxed, validates changes, pushes a branch,
  and emits a persisted event stream. The control plane supports steering and
  cancellation
  ([README](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/README.md#L14-L30),
  [run controls](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/README.md#L87-L104)).
- Kubernetes mode uses one pod per run, kubelet CPU/memory limits, and admission
  caps that shed work before the cluster thrashes
  ([cluster runtime](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/README.md#L107-L132)).
- Scenario acceptance tests cover restart recovery, and the supervisor restarts
  its sandbox runtime under a bounded five-in-sixty-seconds budget
  ([status](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/README.md#L78-L98)).

**Material gaps**

- Warren's optional Seeds plan-run coordinator deliberately walks plan children
  one at a time and gates every child on the previous PR merging
  ([serial plan-runs](https://github.com/jayminwest/warren/blob/b13c7597c529360ad150bccc629bf28f603bc692/README.md#L99-L106)).
- It is therefore a strong executor/sandbox/admission/restart substrate, but not
  a parallel external-graph frontier or a separately serialized integrator.
- It creates a branch from a project target, but does not document Dalph's
  immutable planned Base SHA and tracker/Git/executor authority reconstruction.

### 7. AIF Handoff — strongest task-local recovery and convergence prior art

Inspected source:
[`lee-to/aif-handoff@50602104b1e0c958225b8796f3d9ac56e8c87d15`](https://github.com/lee-to/aif-handoff/tree/50602104b1e0c958225b8796f3d9ac56e8c87d15).

**Source-verified overlap**

AIF Handoff implements a worktree-backed plan/implement/review pipeline,
dependency layers inside one task, structured review findings, review-to-rework
loops, heartbeat recovery, retry backoff, and quarantine after stale-stage
retry exhaustion. These are implemented task-local lifecycle mechanics, not
only UI language
([official repository](https://github.com/lee-to/aif-handoff/tree/50602104b1e0c958225b8796f3d9ac56e8c87d15)).

**Material gaps**

- Its SQLite Kanban record and internal implementation graph own the work; they
  are not an external issue DAG releasing downstream tracker tasks.
- Recovery reconstructs its own stages rather than reducing a narrow journal
  and rereading independent tracker, Git, and executor authorities.
- It does not own serialized accepted-head integration. Semantic-review
  exhaustion becomes a manual-review handoff rather than Dalph's intended
  dependency-blocking non-integration outcome.

### 8. Kandev — credible product control plane with a second task ledger

Inspected source:
[`kdlbs/kandev@21742aa3ef85c2ed1bfc8e2714d14799599cecac`](https://github.com/kdlbs/kandev/tree/21742aa3ef85c2ed1bfc8e2714d14799599cecac).

**Source-verified overlap**

- A task owns workflow position, repository attachments, sessions, and a plan;
  workflow steps may impose WIP limits and start agents
  ([task model](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/tasks-and-workflows.md#L8-L22)).
- It supports worktree executors, multiple repositories per task, recorded
  branches, cumulative review, PR associations, and several local or remote
  executor types
  ([feature status](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/feature-status.md#L48-L85)).
- Git operations serialize per repository operator and Git remains authoritative
  for commit state
  ([Git operations](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/git-operations.md#L47-L90)).

**Material gaps**

- Jira and Linear launch paths copy external items into Kandev without a durable
  association. Kandev's own task/workflow database controls work.
- Its autonomous dependencies, routines, budgets, and approvals are still
  feature-gated/in progress
  ([Office boundary](https://github.com/kdlbs/kandev/blob/21742aa3ef85c2ed1bfc8e2714d14799599cecac/docs/public/feature-status.md#L91-L104)).
- Serialized Git commands are not the same as separately admitted,
  accepted-head integration. Exact immutable attempt bases and
  multi-authority recovery are undocumented.

## Documented closed-product context

These products show that the visible workflow exists elsewhere, but their
control-plane implementations are proprietary. They are not targets of the
technical reliability audit. “Undocumented” below means only that public
first-party material does not establish the behavior.

### Factory Missions — closest commercial control-plane story

**Documented shipped:** Factory says Missions decomposes goals into subtasks
with dependencies, ordering, and resource allocation, then runs multiple Droids
in parallel
([Missions](https://factory.ai/product/missions)). Its launch documentation
says an orchestrator creates milestones and features, coordinates Git
handoffs, uses validation workers, creates follow-up repair work, and recovers
from failures; it is available for Enterprise and Max
([Introducing Missions](https://factory.ai/news/missions)).

**Intersection:** generated DAG, bounded/resource-aware dispatch, isolated
workers, validation, Git assembly, and recovery.

**Gap:** the Mission plan is AI-generated and Factory-owned rather than an
external tracker graph. Atomic claims, immutable attempt Base SHAs, executor
restoration identities, journal reduction, authoritative rereads, and
per-target integration serialization are undocumented.

### Replit Agent task system — the clearest bounded task UX

**Documented shipped:** Agent creates a Drafts/Active/Ready/Done task board,
queues accepted work, runs tasks in isolated project copies, permits one Core
or up to ten Pro background tasks, and starts queued tasks as slots open. A
person reviews and applies results; Replit automatically resolves conflicts
when applying several task outputs
([task system](https://docs.replit.com/core-concepts/agent/task-system)).

**Intersection:** explicit tasks, visible queue, capacity consumption/release,
isolated attempts, review/apply, and conflict handling.

**Gap:** the task graph and board are internal and agent-generated. Exact Git
lineage, restoration after process loss, authoritative tracker/Git/executor
rereads, and a separate serialized integration resource are undocumented.

### Devin managed Devins — hierarchical fleet management

**Documented shipped:** A coordinator can decompose work, launch managed Devin
sessions in isolated VMs, assign playbooks/tags/ACU limits, inspect and message
children, sleep or terminate them, resolve conflicts, and compile results
([Advanced Capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities)).
The feature shipped as “Devin Manages Devins” on 2026-03-19
([2026 release notes](https://docs.devin.ai/release-notes/2026)).

**Intersection:** bounded child execution, isolated environments, durable
session management, conflict resolution, and aggregation.

**Gap:** the manager model owns decomposition and routing. External dependency
eligibility, claims, exact Base SHA/worktree identity, authority reconstruction,
and independently serialized integration are undocumented.

### GitHub Copilot — highest platform-envelopment risk

**Documented shipped:** assigning an issue starts a cloud-agent task and PR;
each task runs in an ephemeral GitHub Actions environment
([task launch](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task),
[environment](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment)).
The Copilot app runs parallel sessions in dedicated worktrees/branches or
cloud sandboxes, while agent merge fixes blockers and merges after GitHub
allows it
([app](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/github-copilot-app),
[agent merge](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/github-copilot-app/managing-issues-and-pull-requests)).

**Intersection:** GitHub already owns issues, dependency records, claims via
assignment/labels, refs, PRs, checks, runners, review, and merge. It has the
authority position to add Dalph-like scheduling with no provider adapters.

**Gap:** current documentation is session/event oriented. It does not establish
a dependency-derived frontier, atomic scheduler claim, task-work admission
protocol, immutable planned Base SHA, authority reconstruction, or separate
serialized integration controller.

### GitLab Duo Agent Platform — second platform-envelopment risk

**Documented shipped:** the GA Developer Flow creates draft merge requests from
issues, addresses review feedback, splits MRs, and resolves conflicts
([Developer Flow](https://docs.gitlab.com/user/duo_agent_platform/flows/foundational_flows/developer/)).
Flows execute in CI/CD on hosted or customer runners with optional sandbox
isolation, and sessions retain job logs
([flow execution](https://docs.gitlab.com/user/duo_agent_platform/flows/execution/),
[sessions](https://docs.gitlab.com/user/duo_agent_platform/troubleshooting/)).

**Intersection:** GitLab already owns work-item dependencies, lifecycle, Git,
MRs, runners, CI, permissions, logs, and merge.

**Gap:** no reviewed documentation says Duo derives a runnable frontier from
blocking links, atomically claims tasks, distinguishes graph eligibility from
capacity admission, plans an exact Base SHA/worktree, restores exact executor
attempts, or serializes agent integration.

## Explicit non-competitor boundary: Chartr

Chartr is a serious cockpit competitor but not a serious substitute for this
six-part control-plane contract. At pinned commit
[`278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58`](https://github.com/rengwu/chartr/tree/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58),
its repository-local Markdown map owns tasks and dependencies, an operator
chooses dispatch, sessions share one working tree, and no component performs
review or integration. The worktree decision is explicit: one session per
space by default, no per-ticket worktrees or branches, with an operator override
that knowingly risks clobbering uncommitted edits
([ADR 0003](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/docs/adr/0003-serialise-per-space-no-worktrees.md#L1-L23)).
After daemon restart, PTY sessions are gone and orphan claims require operator
release rather than automatic authority reconstruction
([release behavior](https://github.com/rengwu/chartr/blob/278e0ad2557b01f1ab4355ab2cc87cdd0de8ef58/internal/server/release.go#L11-L32)).

Chartr remains valuable UI prior art: stable graph layout, frontier display,
payload preview, agent choice, live terminal attachment, dead-session actions,
and explicit attention states. Those ideas should consume Dalph projections,
not become Dalph's task or workflow authority.

## Defensible engineering wedges

### 1. Make recovery the product, not a retry button

Most competitors recover from one local symptom: an orphan process, stale
label, missing Action, dead PTY, or failed worker. Dalph can own the harder
promise:

> After a crash or lost response, show the operator the recorded intent, reread
> the exact tracker claim, Git ref/worktree, and executor run, then explain why
> continuing, retrying, preserving, or stopping is safe.

This is externally testable and materially different from “durable sessions.”
Expose the reduced responsibility and fresh observations in the operator
surface without persisting a second status ledger.

### 2. Sell exact attempt lineage

“One exact Base SHA, branch, worktree, AttemptId, RunId, and accepted commit”
should be visible in every attempt and audit artifact. Existing products
usually create a branch or isolated environment, but reviewed sources rarely
make the immutable base a control-plane invariant. This wedge matters for
reproducibility, stale-base diagnosis, security review, and regulated audit.

### 3. Separate eligibility, task capacity, and integration capacity

Competitors commonly conflate “ready,” “queued,” and “a runner is available,”
or reuse a CI/merge queue as the only bound. Dalph should make three facts
legible:

- the tracker graph makes a task runnable;
- a task-work position authorizes one execution responsibility; and
- a repository/ref integration position authorizes one accepted-head mutation.

That separation enables safe pause, backpressure, multi-repository scheduling,
and independent scaling policies.

### 4. Remain executor-neutral while restoring exact sessions

Gas Town is strong prior art for provider presets and resume fallback; Coder,
Codex, Devin, Cursor, GitHub Actions, GitLab runners, and local processes are
potential substrates. Dalph's wedge is not another model loop. It is a typed
executor contract in which `Running`, `SafelySuspended`, and terminal results
have precise resource consequences and restoration always names the same
attempt.

### 5. Preserve existing tracker authority

Beads/Gas Town, Agent Kanban, Paperclip, Kandev, AIF Handoff, Replit, and
Factory gain coherence by owning their own task or mission ledger. Many
enterprises will not move planning, permissions, audit, and reporting into a
coding-agent product. Dalph can be the clean option for teams that require
GitHub, GitLab, Linear, or another tracker to remain canonical.

The tradeoff must stay honest: provider adapters need complete bounded reads,
freshness and contradiction policy, and atomic claim semantics. A shallow
one-way import would erase this wedge.

### 6. Make integration an independent protocol

HerdOS ships a merge queue, while Gas Town ships a per-MR Refinery integration
path with a best-effort persistent slot and documents a still-incomplete
batch-and-bisect design. That proves integration control is not unique; it does
not prove every Dalph user needs it. Dalph's narrower technical distinction is
stronger: accepted executor output is only a candidate;
integration rereads the moving accepted head, consumes a per-target lease,
preserves the accepted commit's ancestry, verifies the candidate, promotes
without overwrite, and reconciles an ambiguous promotion before retry.

This is especially valuable when several independently accepted tasks finish
concurrently or when one repository is an integration hotspot.

### Effect is leverage, not the moat

Effect can support better engineering here, but “built with Effect” will not
outcompete anything by itself. Symphony uses Elixir/OTP, and Gas Town and
HerdOS use Go; all three have credible concurrency and recovery foundations.

Dalph can get concrete leverage from Effect when it uses:

- `Service` and `Layer` boundaries to run the same workflow algebra against
  production providers, deterministic fakes, and dry-run interpreters;
- `Schema`, branded identities, and tagged failures to reject confused task,
  attempt, run, revision, capacity, SHA, and resource identities;
- scoped concurrency to tie process-local fibers and handles to exact
  responsibility lifetimes;
- schedules and streams for bounded retry, cancellation, and observation
  without ad hoc callback state; and
- exhaustive typed composition to make a new workflow occurrence or authority
  outcome break every consumer that has not handled it.

The limitations matter just as much:

- Effect does not make a fiber durable, restore an agent, or reconcile a lost
  GitHub response. The journal and boundary protocols do that.
- Scoped finalizers cannot prove cleanup happened after process death.
- Typed errors do not protect against a wrong domain model or incomplete
  authority read.
- This repository currently pins Effect `4.0.0-beta.99`; beta API churn,
  ecosystem maturity, and hiring familiarity are engineering costs that need
  containment.

The credible claim is therefore not “Effect workflow.” It is “the same typed
workflow has passed normal, simulated, crash-point, property, and Quint
conformance checks.” Effect is one implementation tool that makes that claim
cheaper to sustain.

## Defensible product wedges

1. **Recovery explanation:** an operator can answer “what survived, what is
   ambiguous, what authority was reread, and what will happen next?” without
   interpreting logs from four systems.
2. **Lineage explorer:** every attempt visibly connects tracker revision,
   planned Base SHA, worktree, run/session, accepted commit, integration
   candidate, and promoted head.
3. **Capacity console:** separate controls and telemetry for runnable frontier,
   task-work positions, suspended responsibilities, integration positions, and
   per-target queues.
4. **Authority-preserving adoption:** install Dalph beside the existing tracker,
   Git provider, and executor rather than migrating the organization's work
   ledger into a proprietary board.
5. **Provider qualification:** publish conformance evidence showing which
   tracker, Git, and executor adapters support atomic claims, complete graph
   reads, exact restoration, and ambiguity reconciliation.
6. **Production-shaped fake:** let teams exercise the same workflow algebra,
   crash points, authority rereads, and capacity behavior without spending
   agent tokens or mutating production repositories.

## Positioning to avoid

- **“Run agents in parallel.”** Every serious candidate does this.
- **“A dependency-aware agent board.”** HerdOS, Gas Town/Beads, Agent Kanban,
  Replit, Factory, and Chartr cover the visible idea in different forms.
- **“Worktree isolation.”** It is becoming table stakes.
- **“Durable sessions” or “automatic retries.”** Devin, Cursor, Amp, Symphony,
  Gas Town, Paperclip, and others already make credible versions of that claim.
- **“Merge queue for agents.”** HerdOS ships one, and Gas Town already ships
  much of the surrounding serialized integration machinery.

The defensible sentence is closer to:

> Dalph turns an existing tracker DAG into bounded, exactly identified coding
> attempts, restores their responsibilities by rereading the systems that own
> the facts, and serializes accepted results onto each moving Git target
> without creating a second task ledger.

## Usefulness risk and recommended validation

The technical niche may be real without being useful to the people running
Dalph. Teams may prefer a broader integrated tool even when it offers fewer
published recovery guarantees. The next validation should therefore test
whether the failure behavior matters in practice, not assume it is a selling
point:

1. two coordinators observe the same newly unblocked task and only one obtains
   its tracker claim;
2. the planned Base SHA becomes stale before work starts and no substitute base
   is silently chosen;
3. the executor starts but its response is lost, and restart discovers the same
   run rather than launching a duplicate;
4. two accepted tasks finish concurrently while one integration advances the
   target head;
5. integration promotion succeeds but its response is lost, and restart
   proves the new target head before deciding whether another mutation is
   allowed; and
6. a safely suspended attempt releases task-work capacity without losing its
   exact restoration identity.

If operators do not value the behavior in those scenarios, the extra
architecture may not justify its maintenance cost. If they do, the scenarios
define a useful technical niche beyond another agent dashboard or planner.

## Current-scope honesty

This analysis compares the intended contract, not a claim that every piece is
already production-ready. The current production-shaped fake treats executor
work as one coarse planned-attempt responsibility in the same process.
Detailed production agent restoration, review, handback, retry, and convergence
policy remains post-milestone design. Dalph should not market exact executor
restoration until a real executor adapter and the crash scenarios above prove
it end to end.
