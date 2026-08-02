# Mental models of open-source coding-agent control planes

**Status:** pinned-source synthesis. No competitor crash experiment has run.

The companion [Dalph competitive evidence ledger](./dalph-competitive-evidence-ledger.md)
provides the more detailed architecture/implementation/proof audit for Dalph.

This atlas compares how the ten source-audited products think about control,
durability, and recovery. It is not another feature checklist. The question is:

> What does the implementation treat as the state of the workflow, who changes
> it, and what does a replacement coordinator do with it after interruption?

The detailed evidence and fixed-commit source links live in the architecture
cards. Statements labelled **source-code inference** describe the organizing
model inferred from reachable source, tests, schemas, and migrations; they are
not claims from the product authors. Prepared crash specifications and a
blocked Symphony preflight do not count as crash results.

## Atlas

| Product | Decision core | Durable representation | Runtime owner | What restart means | Event-log role |
|---|---|---|---|---|---|
| [Gas Town + Beads](./cards/gastown-beads-reliability-architecture.md) | Role-specific commands and daemons coordinate through Beads, Git, tmux, files, hooks, and pure local classifiers | Beads/Dolt rows and history, Git worktrees and refs, provider state, checkpoints, mail, and runtime files | Mayor, Deacon, Witness, Refinery, and Polecat processes divide responsibility | Inspect several surviving systems, repair mismatches, and restart or resume selected worker paths | Beads events, Dolt history, feed, and mail are evidence; no one attempt history reconstructs every boundary |
| [HerdOS](./cards/herdos-reliability-architecture.md) | Short-lived commands and Actions jobs repeatedly read GitHub, dispatch workers, patrol gaps, and integrate branches | Issues, labels, Actions runs, comments, branches, PRs, checks, and committed progress files | GitHub Actions and separate dispatch, patrol, worker, and integration commands | Read GitHub and remote Git again, then normally start a fresh agent from durable commits | GitHub histories are both visible workflow markers and audit evidence, but are not one replay stream |
| [Symphony](./cards/symphony-otp-reliability-architecture.md) | One OTP `GenServer` owns a mutable scheduler state machine and supervises task workers | External tracker facts and surviving workspace directories; scheduler maps, retry timers, and worker handles are memory-only | One supervised Orchestrator actor and its task supervisor | Reset local actor state, poll the tracker again, and start replacement agent work in a deterministic directory | Rotating logs are telemetry; they do not rebuild scheduler state |
| [Paperclip](./cards/paperclip-reliability-architecture.md) | Mutable PostgreSQL current state plus startup and periodic reconcilers centered in a large heartbeat workflow | Current rows for issues, wakes, runs, sessions, retries, processes, and workspaces, plus Git/filesystem/provider facts | One intended coordinator, database row transitions, adapter callbacks, and process registries | Reclassify queued, live, detached, lost, retrying, and recoverable work; reuse or quarantine surviving resources | Audit/activity events explain changes; current state is not rebuilt from them |
| [Agent Kanban](./cards/agent-kanban-reliability-architecture.md) | A D1-backed task state machine plus scheduled reconciliation and an external AMA session controller | Task, dependency, assignment, dispatch, session, action, and machine rows in D1; AMA owns execution state | Cloudflare Worker/API for tasks; AMA server and runner for execution | Reconcile stale task/session/dispatch rows, then close, retry, or redispatch external work | `task_actions` is a timeline and lookup aid, not the source of current task state |
| [Any Managed Agents](./cards/any-managed-agents-reliability-architecture.md) | D1 session/work-item state, Durable Objects, leases, and a runner pool coordinate local or cloud execution | D1 control rows and leases; runner-local workspace, canonical JSONL log, provider token, and process-local handles | Stateless Worker/Durable Object plus the runner that owns the active lease and filesystem | Recover the lease and reexecute on the same runner with a resume token; do not adopt the former process | Audit rows support diagnosis and correlation; the runner JSONL is agent output, not a workflow reconstruction log |
| [AIF Handoff](./cards/aif-handoff-reliability-architecture.md) | A polling coordinator advances one mutable task row through named stages; watchdogs release stale stages | SQLite task snapshot with stage, retry, lock, session, branch, worktree, and commit fields | Coordinator loops and stage-specific provider invocations | Wait for staleness, then rerun the recorded stage; one local-commit gate first inspects Git | Append-only usage events are accounting evidence; workflow state is not event-sourced |
| [Kandev](./cards/kandev-reliability-architecture.md) | Database-backed task/session/workflow services, durable queues, and startup/lazy reconcilers | Tasks, sessions, prompts, messages, WIP admission, runtime handles, workspace records, and Git directories | Backend orchestrator services plus selected executors and provider processes | Repair queued/current rows, reuse a valid surviving worktree, and lazily resume or recreate runtime work | Messages and logs preserve interaction history; they do not generate all current control state |
| [Warren](./cards/warren-reliability-architecture.md) | Typed run and plan state machines plus provider bridges, watchdogs, and polling reconcilers | SQLite run/plan rows, frozen prompt and agent input, provider locators, event cursors, inbox, PR URL, and cost | Warren coordinator plus a selected Local or Kubernetes provider | If both provider handles were stored and still resolve, reattach and continue the event stream; otherwise skip, retry, or reconcile | Provider events are durably cached after a sequence cursor; lifecycle rows remain independently authoritative |
| [Burrow](./cards/burrow-reliability-architecture.md) | SQLite repositories and an in-process run queue drive a fresh sandboxed CLI process for each run | Burrow/run/message rows, parsed output events, and the Git-backed workspace | One Burrow process owns admission, subprocesses, streams, sidecars, and previews | Requeue queued runs, mark interrupted running runs failed, and retain the workspace and persisted output | Events replay successfully persisted agent output; they do not reconstruct process or workflow ownership |

The table deliberately separates Agent Kanban from AMA and Warren from Burrow.
The upper product asks the lower execution substrate to do work, but their
databases, process lifetimes, and recovery guarantees remain distinct. Treating
either pair as one atomic control plane would conceal the most important crash
windows.

## Engineering and user consequences by product

| Product | Effect and dependency seams | Verification style at the pin | Maintainability consequence | What a user experiences |
|---|---|---|---|---|
| Gas Town + Beads | Strong Beads storage boundary and pure classifier islands; operational code still calls CLI, Git, filesystem, and tmux directly | Storage conformance, ambiguity injection, broad examples, and focused randomized graph properties | Every lifecycle change must keep role, hook, session, worktree, checkpoint, and integration repair procedures aligned | Strong inspectable worktree continuity, but “resume” varies by provider and recovery path |
| HerdOS | Broad `Platform` and agent interfaces; Git, clocks, and job choreography remain concrete in several slices | Go unit/integration tests, temporary Git, fakes, race detector, and review-lock tests | The same logical state is joined from several GitHub objects, and related retry rules live in dispatch, patrol, worker, and integration paths | Familiar GitHub visibility and durable commits, but retries normally lose the old agent context and unpushed WIP |
| Symphony | Tracker behaviour, memory adapter, injectable OTP names and callbacks; filesystem, timers, shell, SSH, and hooks are concrete | ExUnit/Dialyzer plus real supervisor-reset, stale-token, and workspace-preservation tests | One actor makes live mutation ordering clear; configured hooks determine much of Git and recovery safety outside that core | Predictable reset and possible directory reuse, but no promise of the same agent thread or process after runtime loss |
| Paperclip | Strong adapter execution context and database seams; the heartbeat still mixes many direct effects | Extensive database, process, Git, workspace, retry, and race examples | Rich recovery vocabulary is coupled across schemas, the heartbeat, reconcilers, provider state, logs, and UI contracts | Often restores useful task/session/workspace state, while stream attachment, active logs, and exact Git layers can differ |
| Agent Kanban | D1 repositories and Miniflare are strong; AMA calls use HTTP fakes rather than one injected cross-plane algebra | State-machine, D1 integration, dispatch/reconcile, webhook, and legacy provider examples | Current AMA orchestration and deprecated local-daemon architecture coexist; task metadata carries many attempt-like facts | Board and review state survive, but diagnosis and exact workspace/session recovery depend on AMA |
| Any Managed Agents | Server/runner boundaries and fakes exist; control rows, local runner storage, provider bridge, and clocks are not one interpreter | Conventional TypeScript/Go tests for leases, recovery, relays, logs, and sandboxes | Multi-step create and lease construction must remain consistent across D1, Durable Objects, runner memory, and local files | Same-runner reexecution may recover context and files, but old process adoption and week-later workspace retention are not guaranteed |
| AIF Handoff | Runtime adapters and repository helpers exist; stage logic shares one broad task row | Example tests and mutation testing; no systematic crash or generative state-machine suite found | Status, watchdog, retry, session, Git, and stage-specific rules can disagree because no attempt aggregate owns the whole slice | A stale stage can rerun and a local commit can be recovered, but the exact former invocation may be duplicated or lost |
| Kandev | Numerous store, executor, workspace, Git, and orchestrator interfaces; no complete fake/dry-run workflow interpreter | Broad example coverage of queues, WIP, sessions, worktrees, runtimes, and startup repair | Clear technical services still share lifecycle meaning across several reconcilers and durable rows | Best local session/worktree continuity found, provided the original directory and provider token survive |
| Warren | Strong `RuntimeProvider` plus injected repository, clock, GitHub, Kubernetes, and process functions | Fakes, fake clocks, boot/watchdog tests, and a production-shaped Burrow/stub-agent acceptance path | Provider abstraction is clean, but bridge, watchdog, reap, plan, and backend-specific recovery remain parallel mechanisms | Can reconnect to the same provider run after both handles are stored; earlier crash windows can leave it undiscoverable |
| Burrow | Injectable spawn/materializer/sidecar functions, in-memory SQLite, and fake runtimes; production composition is direct | Large example suite with repository, queue, Git, sandbox, parser, replay, HTTP, and graceful cross-process tests | Layers are readable, but create, spawn, finalize, destroy, and archive lack one durable effect protocol | Workspace and persisted output remain inspectable; interrupted local execution becomes a failed attempt rather than the same resumed Codex session |

## The five recurring models

### 1. Operational federation and repair

Gas Town is the clearest example. The implementation does not reduce one
workflow history. It asks Beads, Git, tmux, provider state, checkpoints, and
role-specific records what each knows, then uses Witness, daemon, doctor, and
Refinery procedures to restore agreement. Pure workstate and capacity
classifiers create useful decision islands, while end-to-end recovery remains
distributed across operational slices
([architecture and state owners](./cards/gastown-beads-reliability-architecture.md#2-plain-language-architecture),
[layers and slices](./cards/gastown-beads-reliability-architecture.md#9-code-organization-by-layers-and-end-to-end-slices)).

**Source-code inference:** the product's central abstraction is an organization
of durable roles and resources, not an immutable workflow reducer. This is a
reasonable fit for an inspectable local fleet. Its maintenance cost is that a
new lifecycle distinction can affect role commands, Beads conventions, tmux
inspection, checkpointing, Git cleanup, and integration repair. A user gets
durable, visible workspaces and powerful repair tools, but “resume” can mean a
resumed provider conversation, a fresh process over old files, or recovery of
only the task assignment.

### 2. External artifacts as workflow state

HerdOS makes GitHub the task database, queue surface, execution history, and
delivery surface. A replacement command joins issue labels, Actions runs,
branches, progress commits, checks, and PR state rather than reopening a HerdOS
workflow store
([architecture and state owners](./cards/herdos-reliability-architecture.md#2-plain-language-architecture),
[restart](./cards/herdos-reliability-architecture.md#6-immediate-restart)).

**Source-code inference:** the mental model is a set of idempotent or
reconcilable commands over external current state. This avoids a second task
ledger and gives users familiar evidence. The tradeoff is that one logical
transition crosses several API calls with uneven ambiguity handling. Recovery
normally starts a fresh agent, so pushed commits and progress files matter more
than the former process or context.

### 3. Supervised mutable actors and deliberate reset

Symphony gives one OTP actor ownership of scheduler mutations. Its mailbox
orders local decisions; supervision terminates the corresponding worker tree
when the Orchestrator is reset. That is a strong live-process ownership model,
not a durable execution model
([architecture](./cards/symphony-otp-reliability-architecture.md#2-plain-language-architecture),
[restart](./cards/symphony-otp-reliability-architecture.md#6-immediate-restart),
[verification](./cards/symphony-otp-reliability-architecture.md#11-verification-inventory)).

**Source-code inference:** the desired recovery boundary is reset and
recompute, not replay. This makes local concurrency easier to reason about and
prevents normal in-BEAM overlap. Whole-runtime loss still forgets claims,
capacity, retry timers, process identity, and provider context. A user may get
the same directory, but receives a new agent thread unless some separate hook
implements stronger restoration.

### 4. Mutable current state plus reconcilers

Paperclip, Agent Kanban, AIF Handoff, and much of Kandev share this family at
different levels of sophistication. Durable rows say what the product
currently believes; startup sweeps, watchdogs, heartbeats, and lazy checks
repair stale combinations.

- Paperclip has the richest current-state vocabulary and the most extensive
  process/workspace reconciliation. Its main cost is lifecycle logic
  concentrated in the large heartbeat slice
  ([layers](./cards/paperclip-reliability-architecture.md#9-code-organization-layers-and-end-to-end-slices),
  [risks](./cards/paperclip-reliability-architecture.md#13-maintenance-risks)).
- Agent Kanban has a small pure task-transition table, strong conditional D1
  operations for selected transitions, and separate cron repair. Its current
  execution lifecycle crosses into AMA and mutable task annotations
  ([layers](./cards/agent-kanban-reliability-architecture.md#9-code-organization-by-layers-and-end-to-end-slices),
  [AMA consequences](./cards/any-managed-agents-reliability-architecture.md#16-consequences-for-agent-kanban-and-dalph)).
- AIF Handoff stores an especially broad stage snapshot. It can say
  “implementing” after restart but cannot identify which exact provider
  invocation was active. Its local-commit gate is a useful narrow exception:
  it checks Git before repeating the commit operation
  ([architecture](./cards/aif-handoff-reliability-architecture.md#2-architecture-in-plain-language),
  [failure analysis](./cards/aif-handoff-reliability-architecture.md#12-chronological-failure-analysis)).
- Kandev durably represents more of the user's session—prompts, messages,
  runtime handles, queues, and workspaces—and therefore sets the strongest
  local restoration baseline in this family. A surviving directory is reused,
  while recreation restores branch commits rather than its former index and
  uncommitted layers
  ([restoration](./cards/kandev-reliability-architecture.md#5-restoration-layers),
  [risks](./cards/kandev-reliability-architecture.md#13-reliability-risks-and-gaps)).

**Source-code inference:** these systems optimize for a useful current answer
and convergent repair rather than for deriving the answer from a complete
immutable history. That can be simpler and faster to query. Its maintenance
risk is overlapping reconcilers or transition paths using slightly different
definitions of live, stale, recoverable, and complete. Users often regain a
task, session, or workspace quickly, but must not infer that every constituent
of the old coding session survived.

### 5. Durable execution handles and event cursors

Warren's strongest idea is to persist enough provider identity to ask the
provider for the same live run and continue reading after the last stored event
sequence. AMA similarly persists runner leases and provider resume tokens, but
reexecutes on recovery rather than adopting the old process. Burrow, Warren's
local substrate, persists run rows and parsed events but deliberately converts
an interrupted running row to failed
([Warren restart](./cards/warren-reliability-architecture.md#6-immediate-restart),
[AMA restart](./cards/any-managed-agents-reliability-architecture.md#6-immediate-restart-and-ambiguous-outcomes),
[Burrow restart](./cards/burrow-reliability-architecture.md#6-immediate-restart)).

**Source-code inference:** the durable handle is a capability for
reconnection, not proof of a complete attempt. If creation succeeds before the
handle is recorded, recovery cannot find the execution. If a runner resumes a
provider conversation on another filesystem, context may survive while Git WIP
does not. For a user, reattachment can be much better than retry, but the UI
still needs to say separately whether the process, context, log, and exact
worktree were recovered.

## Immutable core, reducers, and event sourcing

The audited products contain pure pieces, but purity is usually local:

- Gas Town has pure workstate and capacity classifiers.
- Agent Kanban has a pure transition table for current task state. It also
  retains a pure worker-session reducer from the old local daemon, but the
  current `ak start` path launches AMA's runner and does not call that reducer;
  current execution recovery is divided between AK's D1 bindings/reconcilers
  and AMA's sessions, leases, runner files, and resume tokens.
- Warren uses transition functions around typed string-state sets.
- Symphony centralizes transitions in an actor, but the actor state is mutable
  and memory-only.
- Database-backed products use conditional updates and transactions to make
  selected transitions atomic.

None of the ten audited products rebuilds its complete control-plane decision
state by reducing one immutable workflow history. Their event-like data has
one of four narrower roles:

1. audit or activity history beside mutable rows;
2. provider or agent output replay;
3. external platform history such as Actions runs and comments; or
4. versioned database history supporting current records.

That is not automatically a defect. Current-state models make ordinary queries
direct, actors simplify one-live-runtime ownership, and external-artifact
models avoid another database. The material comparison is whether a product
can explain an interrupted multi-authority operation without confusing a
historical observation with what the tracker, Git, or executor says now.

## Effect and dependency seams

| Product/model | Strongest substitution seam | Where the end-to-end workflow remains coupled |
|---|---|---|
| Gas Town + Beads | Beads storage contract and backend conformance; pure capacity/workstate policy | CLI status conventions, filesystem, Git, tmux, and role-specific recovery |
| HerdOS | Injected platform and agent interfaces | Direct Git construction, real clocks, and separate dispatch/patrol/integration rules |
| Symphony | Tracker behaviour, memory adapter, injectable OTP names and callbacks | Concrete filesystem, timers, shell, SSH, workspace, and hook behavior |
| Paperclip | Adapter execution context, database handles, environment/plugin seams | Heartbeat's direct database, filesystem, Git, process, log, registry, and event effects |
| Agent Kanban + AMA | D1/Miniflare tests, selected pure transitions, AMA HTTP and runner fakes | Two repositories and runtimes; no common workflow interpreter across task and execution planes |
| AIF Handoff | Runtime adapters and repository helpers | Broad mutable task row and stage-specific coordinator/watchdog/Git paths |
| Kandev | Interfaces around stores, executors, workspaces, Git, and orchestration services | Recovery and lifecycle meaning spans several services; no whole-workflow dry-run interpreter |
| Warren | `RuntimeProvider`, injected repositories, GitHub/Kubernetes/process/clock functions, production-shaped stub acceptance | Several parallel bridge, watchdog, reap, and plan lifecycle mechanisms |
| Burrow | Alternate spawn/materializer/sidecar functions, in-memory SQLite, fake runtimes | Direct process/filesystem/Git composition and no durable effect protocol |

The comparison does not show that interfaces are absent elsewhere. It shows
that no audited competitor interprets one complete cross-authority workflow
through production, deterministic fake, dry-run, and faulting services while
retaining the same decision code. That is where ordinary Effect services and
Layers can give Dalph maintainability leverage. Effect does not itself make a
fiber, agent context, or worktree durable; the application still authors the
history and reconciliation protocol
([Effect/Workflow/OTP comparison](./effect-otp-durable-workflow-comparison.md#4-ordinary-effect-useful-but-not-durable-by-itself)).

## Verification styles

The audited products have meaningful conventional evidence:

- Beads has storage conformance and ambiguity-injection tests; Gas Town has
  broad workstate/Git/Witness coverage and randomized convoy properties.
- HerdOS has broad Go tests, temporary Git repositories, provider fakes, race
  detection, and review-lock tests.
- Symphony tests OTP subtree restart, non-overlap, stale messages, and workspace
  preservation.
- Paperclip has extensive database, Git, process, recovery, workspace, and race
  fixtures.
- Agent Kanban and AMA exercise D1/Miniflare, HTTP, runner, lease, session, and
  reconciliation examples.
- AIF Handoff uses example tests and mutation testing.
- Kandev has broad service, queue, worktree, runtime, and startup-recovery
  examples.
- Warren has provider fakes, fake clocks, boot reconciliation tests, and a
  production-shaped Burrow/stub-agent acceptance path.
- Burrow has repository, queue, temporary Git, sandbox, parser, replay, HTTP,
  and one graceful cross-process test.

Except for Gas Town's focused randomized graph checks, the X-ray searches did
not find property-based state-machine suites in this group. They found no
Quint/TLA+/Alloy model of the audited control protocols and no systematic
whole-process kill-after-every-boundary matrix. This is a statement about the
pinned source searches documented in each card, not proof that no unpublished
verification exists. Most importantly, **this research has not run the
prepared competitor crash experiments**
([readiness status](./control-plane-crash-readiness-matrix.md#status-vocabulary)).

## Dalph's mental model and current maturity

### Intended organizing idea

Dalph's architecture records immutable workflow history, validates it, reduces
it through pure reconstruction functions, and then asks the tracker, Git, and
executor for the current facts they own. The journal is authoritative only for
the history Dalph chose to record; it is not a cached copy of current tracker,
Git, executor, capacity, queue, or UI state
([durability contract](../docs/ARCHITECTURE.md#durability-and-reconstruction)).

Ordinary Effect supplies explicit services and Layers around those boundaries.
The same workflow operation shapes can be interpreted by production, test,
fake, and dry-run compositions. This is an immutable-core/imperative-shell
shape, but the shell is not incidental: every external operation still needs
an authored intent, observation, and reconciliation policy.

The table below avoids comparing implemented competitor source with an
unqualified future Dalph promise. “Proven now” names the strongest evidence in
this repository; it does not mean production reliability has been established
under every crash schedule.

| Mechanism | Architecture | Implemented now | Proven now | Evidence |
|---|---|---|---|---|
| Authority split: tracker owns tasks/claims, Git owns lineage/worktrees/refs, executor owns session/process observations, journal owns workflow history | Yes | Yes for the current tracker, Git, journal, and coarse executor service boundaries | Source and focused composition tests; no end-to-end production-executor crash proof | [durability and authority rereads](../docs/ARCHITECTURE.md#durability-and-reconstruction), [production composition](../packages/dalph/src/application/production.ts) |
| Immutable journal reconstruction through pure reducers and semantic history validation | Yes | Yes | Property tests and history-validation tests exercise reconstruction laws; SQLite append/reopen behavior is tested, but no claim of host/storage-loss survival is made | [reconstruction reducers](../packages/orchestrator/src/coordination/reconstruction/reduce.ts), [Effect comparison evidence](./effect-otp-durable-workflow-comparison.md#10-deterministic-reduction-property-tests-and-models) |
| One shared intent/observation/reconcile vocabulary across ambiguity-crossing boundaries | Yes | Partial: journaled tracker graph/claim operations and selected Git worktree/target-lineage observations use the pattern | Focused source/tests for the named operations; no systematic crash matrix proves every boundary | [journaled interpreter](../packages/orchestrator/src/workflow-journal/journaled-interpreter.ts), [exact Git reconciliation](../docs/ARCHITECTURE.md#exact-git-worktree-reconciliation) |
| Graph-derived runnable work and bounded task-work responsibility | Yes | Yes for the production-shaped milestone and same-process coarse executor | Unit, property, executable scenario, and bounded Quint/model-based evidence cover the modeled coarse boundary | [planned-attempt executor boundary](../docs/ARCHITECTURE.md#planned-attempt-executor-boundary), [task-work capacity tests](../packages/orchestrator/src/control/task-work-capacity.test.ts) |
| One planned attempt binds exact Base SHA, branch, worktree, task revision, run, attempt, and executor locator before work | Yes | Implemented for the milestone planning and worktree-reconciliation path | Focused journal, Git-observation, ancestry, and contradiction tests; broader real-Git qualification remains incomplete | [durable task-attempt planning](../docs/ARCHITECTURE.md#durable-task-attempt-planning), [journaled worktree tests](../packages/orchestrator/src/workflow-journal/journaled-worktree-observation.test.ts) |
| Same workflow algebra with production, controlled fake, test, and dry-run Layers | Yes | Yes for the current workflow surface | Source and composition tests show substitution; behavioral equivalence at every future production boundary is not proven | [production composition](../packages/dalph/src/application/production.ts), [Effect comparison](./effect-otp-durable-workflow-comparison.md#4-ordinary-effect-useful-but-not-durable-by-itself) |
| Independent production executor restoration, including live-process adoption or proof of safe stop | Required direction, but detailed executor internals are explicitly post-milestone design | **No.** Production-shaped composition uses a same-process controlled fake whose state dies with Dalph | **No production proof.** Current tests and Quint model prove only the coarse fake executor contract | [durability qualification](../docs/ARCHITECTURE.md#durability-and-reconstruction), [controlled fake](../packages/executor/src/controlled-fake.ts) |
| Full user session restoration: agent context/log plus committed, staged, unstaged, untracked, ignored, conflicted, and stashed worktree state | Architectural objective; the constituent authorities are modeled separately | **Not implemented as a complete restoration feature.** Exact worktree observation is partial progress; agent context/log and live executor adoption are absent | **Not proven.** No end-to-end immediate-restart or week-later four-layer result exists | [planned-attempt executor boundary](../docs/ARCHITECTURE.md#planned-attempt-executor-boundary), [restoration-layer definition](./control-plane-reliability-architecture-plan.md#what-restoration-includes) |
| Separate accepted-result integration admission and per-target serialization | Yes | Implemented for responsibility recording, FIFO selection, process-local target ownership, dependency wait, and modeled promotion decisions | Quint and executable tests prove the bounded admission/order model, not a real accepted-head update | [integration admission](../docs/ARCHITECTURE.md#accepted-result-integration-admission) |
| Full accepted-head integration: construct/verify candidate, atomically promote the moving target, reread after ambiguous promotion, complete tracker state, and clean up | Yes as the intended protocol | **No.** Candidate construction, repository verification, concrete promotion, resolution, and tracker completion remain future work | **No production proof.** Pure decisions and the admission model do not prove a real target mutation | [explicit future-work boundary](../docs/ARCHITECTURE.md#accepted-result-integration-admission), [concurrent integration protocol research](./concurrent-accepted-head-integration-protocol.md) |
| Effect Workflow/Cluster as a durable replay engine | Research candidate, not adopted Dalph architecture | **No** | **No Dalph experiment.** Pinned upstream source establishes engine mechanics only | [Effect Workflow evaluation](./effect-otp-durable-workflow-comparison.md#14-proven-claims-future-claims-and-unknowns) |

### Maintainability bet

**Source-code inference about Dalph:** compared with the audited competitors,
Dalph moves more lifecycle meaning into immutable domain events, pure reducers,
typed outcomes, and boundary services. If completed consistently, a new
provider or failure mode can reuse the same reconstruction and decision model
instead of introducing another independent current-state repair vocabulary.

That is leverage, not free reliability. Maintainers must evolve event schemas,
history validation, reducers, boundary interpreters, and reconciliation rules
together. A missing event or incomplete authority read can still encode the
wrong model cleanly. The architecture becomes a competitive advantage only
where the implemented workflow and executable evidence demonstrate user-visible
behavior: no duplicate expensive agent, no silent WIP loss, no unsafe cleanup,
and no false integration result.

## Comparison conclusions

1. The competitors are not architecturally naive. They use mature ideas:
   single-owner actors, database compare-and-set, leases, provider handles,
   watchdogs, reconcilers, external-source rereads, and conservative workspace
   preservation.
2. “Has an event log” is not a useful dividing line. The important question is
   whether events generate workflow decisions, merely explain mutable rows, or
   replay agent output.
3. Kandev and Warren narrow any generic Dalph claim about restoration. Kandev
   can preserve a rich local session/worktree, and Warren can reattach to a
   provider execution when both locators survived.
4. Dalph's serious remaining distinction is the composition: exact planned
   lineage, separate restoration layers, capacity retained under uncertainty,
   one ambiguity vocabulary, external authority preservation, and an
   independent accepted-head protocol.
5. That distinction is partly architecture and partly current implementation.
   Independent production executor restoration, complete four-layer session
   restoration, and full accepted-head integration must remain explicitly
   unimplemented and unproven until their production paths and crash scenarios
   exist.

The next fair comparison is therefore not another checkbox scan. It is to
source-trace the same chronological interruption cases through Dalph and the
selected competitors, record each restoration layer separately, and compare
the maintainer-visible decision path as well as the inferred user-visible
outcome. Those conclusions must remain labelled **source-code inference**.
This atlas is a source-backed architecture comparison, not experimental proof
of superiority.
