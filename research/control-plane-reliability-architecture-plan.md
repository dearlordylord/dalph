# Research plan: reliability architecture of open-source agent control planes

**Created:** 2026-07-30

## Purpose

Several open-source products already combine a task graph, parallel agents,
isolated Git work, and some form of recovery. This research will determine:

1. how they technically make that behavior reliable;
2. how easy their architecture is to extend and maintain;
3. what users experience when the control plane or agent stops;
4. whether Dalph's Effect architecture can make valuable behavior easier to
   implement and verify; and
5. which apparent Dalph differences are important versus merely architectural
   preferences.

This is a research plan, not a Dalph runtime specification. It changes no
runtime behavior, so no operational scenario or scenario-to-test mapping is
required.

## Agreed research decisions

- Primary outcome: determine whether Dalph's Effect architecture can unlock
  valuable reliability or maintainability that competitors struggle to
  provide.
- Evidence: source audit plus destructive fault experiments in isolated
  temporary environments. Experiments never use real repositories, trackers,
  credentials, or user worktrees.
- Effect Workflow: research now; defer adoption until Dalph's prerequisite
  subgraph permits an implementation decision.
- Review cadence: complete and review one architecture card at a time even
  when source collection runs in parallel.
- Restoration is not one boolean. The audit must distinguish the control-plane
  attempt, the coding agent's session/context/log, and the entire Git worktree
  state.

## What restoration includes

For one interrupted task, record each layer independently:

| Layer | Evidence that may need to survive | Questions after restart |
|---|---|---|
| Dalph attempt | Run and attempt identity, task and tracker revision, planned Base SHA, branch/worktree locator, capacity use, intended and observed boundary effects | Is this the same attempt? Which actions happened, remain ambiguous, or may safely continue? |
| Agent session | Provider session identity, conversation context, agent event/log stream, tool-call history, token/rate-limit state, and provider-specific resume handle—for example a Codex or Claude session | Can the same agent context resume? If not, can a fresh agent receive an honest handoff without pretending it is the old session? |
| Git worktree | Current `HEAD`, committed changes, staged changes, unstaged tracked changes, untracked files, ignored-but-required local artifacts, conflicts, stashes, and worktree registration | Is every valuable change still present? Is the worktree still based on the planned commit? Can it be reused without overwriting or silently cleaning work? |
| Live execution | Process, container, VM, pod, PTY, remote host, open file handles, and child processes | Is anything still running? Can it be adopted, must it be stopped, or is its condition unknowable? |

The research must not call a task “restored” merely because one layer survived.
Examples:

- reusing a folder without the old agent context is worktree continuation with
  a fresh agent session;
- resuming a provider conversation in a missing or reset worktree is session
  continuation without workspace continuity;
- finding a live process without proving its attempt identity is an orphan
  observation, not restoration;
- reconstructing Dalph's attempt while losing unstaged files is control-state
  recovery with work loss.

## Scope

### First group: full source audit

| Product | Why it is first |
|---|---|
| Gas Town + Beads | Closest visible match to dependency-ready work, bounded agents, resumable sessions, Git worktrees, recovery, and serialized Refinery integration. At the pinned revision, its own phase table marks the full batch-and-bisect design incomplete. |
| HerdOS | Closest GitHub-authoritative graph-to-integration loop. |
| OpenAI Symphony | Cleanest external-tracker scheduler and the strongest Elixir/OTP comparison. |
| Paperclip | Broadest database-backed control plane with blockers, execution locks, persistent sessions, workspaces, budgets, and recovery. |

### Second group: targeted source audit

- Agent Kanban: distributed claims, capacity, worktrees, and session resume.
- AIF Handoff: state-machine recovery, review loops, watchdogs, and quarantine.
- Kandev: layers, workflow WIP limits, executor abstraction, and Git
  serialization.
- Warren: sandbox runtime, admission caps, restart recovery, and maintainable
  provider boundaries.

### Boundary sample

Chartr remains useful as a negative example: it deliberately prioritizes a
simple cockpit and shared workspace over unattended delivery recovery.

### Out of scope

- Closed-source products receive a short capability note only. We cannot make
  technical reliability or maintainability claims without their source.
- GitHub and GitLab are excluded from this focused study. Their platform
  position is strategically relevant but does not answer how these
  open-source control planes implement reliability.
- Star counts, funding, and generic feature comparisons.
- Declaring Effect, Go, Elixir, actors, reducers, or event sourcing superior
  without connecting them to concrete failure behavior and maintenance cost.

## Deployment assumption

The focused comparison assumes:

- one active Dalph coordinator is allowed to change one canonical Git common
  directory at a time;
- that coordinator may run several task agents and may use executors on other
  hosts;
- after the coordinator stops, a replacement process may restart and recover;
- two active Dalph coordinators are not expected to share the same repository
  and coordinate through distributed leader election in the first production
  target.

In ordinary language: several agents may work at once, but only one Dalph
control process is allowed to make scheduling and Git decisions for that
repository. The research will still note products that support several
control-plane replicas, but will not treat active-active high availability as a
current Dalph requirement.

This is the recommended reading of Dalph's existing exclusive-coordinator
architecture. It should remain provisional if the intended deployment is
instead several Dalph servers concurrently controlling the same Git common
directory.

## Research orchestration and context management

The main research thread will not read every competitor source tree into one
conversation context. Work is divided into evidence packets.

### Main-agent responsibilities

- own this rubric, the research index, and the cross-product vocabulary;
- assign one output file and one bounded question set to each research agent;
- review the complete architecture card produced by each agent;
- challenge unsupported negative claims;
- maintain the comparison matrix and cross-product conclusions;
- decide when a finding changes Dalph's research direction.

### Research-agent responsibilities

Each agent receives one product or one cross-cutting technical question and
writes one self-contained Markdown file. Its handoff must contain:

- pinned source revision;
- source paths and fixed-commit links;
- the product's own mental model before any Dalph comparison;
- state-owner table;
- immediate-restart and week-later behavior;
- agent-session and complete-worktree restoration behavior;
- implementation layers and end-to-end slices;
- production/test/fake dependency seams;
- verification techniques and negative-claim search evidence;
- confirmed unknowns;
- technical and user-visible consequences.

Agents do not edit the shared research index or comparison matrix. That avoids
parallel merge conflicts and keeps synthesis with one owner.

### Parallel waves

The available concurrency should be used in bounded waves:

1. Gas Town/Beads, Symphony/OTP, and Paperclip source cards run in parallel;
   the main agent prepares the common crash-experiment protocol.
2. HerdOS and the first isolated fault experiments run after the first cards
   reveal which boundaries deserve execution rather than source reading.
3. Agent Kanban, AIF Handoff, Kandev, and Warren run as a second source-card
   wave.
4. Effect versus OTP and Effect Workflow versus database/event-log recovery
   run only after the competitor cards establish the mechanisms to compare.
5. The main agent produces the cross-product crash matrix and revises the
   technical-niche conclusion.

Parallel agents collect evidence; they do not independently produce competing
overall conclusions.

### Context compaction

The checked-in Markdown cards are the durable research context. After each
wave, the main thread retains only:

- the rubric;
- concise per-product conclusions;
- unresolved contradictions;
- source links needed for synthesis;
- the next bounded questions.

Raw command output and broad repository searches remain in the individual
cards rather than being copied into the main conversation.

## Preliminary source findings

The [pre-study](./control-plane-reliability-architecture-prestudy.md) changes
several starting assumptions:

- Beads currently has the strongest isolated admission primitive in the sample:
  dependency-aware selection, a transactional optimistic claim, renewable
  lease, and reread after an ambiguous commit. The full Gas Town card found
  that Gas Town's reachable scheduler dispatch does not call this primitive;
  it uses host-local locks and a generic durable `hooked` update instead.
- Paperclip has the richest explicit restart classification and durable
  recovery state, but much of its correctness converges on a heartbeat service
  exceeding sixteen thousand lines. That makes it the best maintainability
  stress case.
- Symphony's Elixir/OTP supervision gives clear single-process ownership and
  restart behavior, but it intentionally resets the scheduler, retry timers,
  claims, and agent-task tracking. OTP supervision is not durable workflow.
- HerdOS obtains excellent external visibility by placing state in GitHub
  issues, labels, Actions, PRs, and branches. Worker admission still crosses
  separate label and workflow-dispatch calls without one atomic claim.
- Gas Town preserves the most operational context—task graph, role identity,
  worktree, checkpoint, handoff, and sometimes provider session—but must
  reconcile Dolt, Git, files, tmux, provider sessions, heartbeats, and role
  agents. Its full batch-and-bisect integration design is not complete at the
  pinned revision.

These are hypotheses and code findings to challenge through the chronological
failure cases below, not final rankings.

## Plain-language meanings to use in the research

The final comparison must explain these ideas without requiring Dalph
vocabulary.

| Short phrase | What it means technically | What a user notices |
|---|---|---|
| Fixed Base SHA | A task records one exact starting commit. A moving branch name cannot silently select a newer commit later. | A restarted task produces the same diff from the same starting point. If the repository moved, the tool reports that fact instead of quietly changing the task underneath the agent. |
| Start from a branch | The worktree resolves whatever commit the branch names when creation or retry happens. | The task may automatically receive newer work, which is convenient, but a retry can produce a different result or encounter changes that were not present originally. |
| External tracker remains authoritative | GitHub, Linear, Jira, or another existing tracker continues to decide what tasks exist, their dependencies, and their current state. | Teams do not migrate planning into another board or resolve disagreements between two task databases. |
| Product-owned task authority | The control plane copies tasks into, or requires work to originate in, its own database. | The product is simpler internally, but teams either move their process or keep two systems synchronized. |
| A task keeps its worker slot | Once Dalph starts a task, that slot remains occupied until Dalph knows the agent finished or stopped safely. A missing process after a crash is not enough evidence. | The configured limit is not exceeded by accidentally starting a duplicate after restart. |
| Safe pause | The control plane asks the executor to stop, preserves what is needed to continue, and waits until no executor activity remains before freeing the slot. | A user can pause work without losing it or leaving an invisible agent running. |
| Separate integration limit | Running agents and combining their Git results use different limits. Agents can continue while one-at-a-time Git updates are protected. | Several tasks can finish together without racing to overwrite the target branch. |
| Serial plan execution | The plan coordinator starts one child task and waits for its PR to merge before starting the next child. The underlying runtime may still support several unrelated runs at once. | One plan does not execute its independent children in parallel, even if the cluster has spare capacity. |
| Admission cap | The runtime refuses or queues new runs after a configured number of active sandboxes, pods, or agents. It does not necessarily understand task dependencies. | The system avoids overloading its host, but the cap alone does not decide which dependent task should run next. |
| Accepted-head integration | Before combining a result, the tool checks the target's current commit and controls which result advances it next. | A completed task is not silently merged against stale repository state, and concurrent completions have a clear order. |
| Operation-specific recovery | Each action—claim, workspace creation, agent launch, push, merge—has separate handwritten repair logic. | Recovery may work well for common failures but behave differently at less-tested boundaries. Maintainers must update several repair paths when the workflow changes. |
| One recovery model | The workflow records enough common history to decide what to reread and what action is safe after any interruption. | Restart behavior is more consistent and explainable across different failure points. |
| GitHub artifacts hold workflow state | Labels, comments, Action runs, branches, refs, and PR markers collectively record progress. | There is no separate workflow database, but diagnosing one task may require correlating several GitHub objects. |
| Workspace behavior is implementation-defined | The scheduler guarantees a directory but leaves cloning, branch choice, and worktree setup to configurable hooks. | Different installations may have different Git safety and restart behavior even though they all run the same scheduler. |
| No integration protocol | The control plane stops after producing a branch or PR, or delegates merge decisions to an agent, person, or hosting platform. | Users still review and merge themselves; completed parallel results are not automatically ordered by the control plane. |
| Leave uncertain resources alone | If the tool cannot prove that a worktree, branch, claim, or process belongs to the interrupted attempt, it reports the problem instead of deleting or reusing it. | Cleanup may require attention, but the tool avoids destroying work or another process's resources. |

These descriptions are hypotheses to test against each source tree. The report
must not assume that Dalph's version is preferable in every use case.

## Initial materiality hypotheses

| Difference | Likely important when | Probably minor when |
|---|---|---|
| Fixed Base SHA | Work runs for hours or days, retries after repository movement, or must be reproduced and audited | Tasks are short and users prefer every retry to start from the newest branch |
| External tracker remains canonical | Teams already depend on tracker permissions, reporting, dependencies, and audit | A team is willing to move all agent work into the control plane's own board |
| Exact session/worktree continuation | Agent work is expensive, contains valuable uncommitted progress, or must pause for scarce capacity | Tasks are cheap to restart and agents commit useful work frequently |
| Separate integration control | Several accepted tasks finish against the same moving target and unattended integration is desired | Humans merge PRs one at a time or the product only creates branches |
| One shared recovery model | The workflow crosses several systems and adds new operations frequently | The product has a small number of effects and manual repair is acceptable |
| Event history or journal | Operators need to explain ambiguous failures and recover after long outages | Current database state is sufficient and incomplete operations can simply restart |

An event log is not automatically event sourcing. The audit must determine
whether current state is rebuilt from events, whether events merely explain
mutable rows, or whether external systems remain the current authority.

## Research questions

### 1. What is the product's core mental model?

For each product, identify the actual organizing idea used in code:

- one daemon with mutable maps;
- actor processes and supervisors;
- an immutable reducer over events;
- a database-backed state machine;
- a heartbeat and watchdog system;
- a job queue;
- a set of idempotent commands over external state;
- an event-sourced workflow;
- or a mixture.

Name the modules that own state transitions. Determine whether two modules can
independently decide the same lifecycle fact.

### 2. Where does durable state live?

Trace each fact to its owner:

- task identity and dependencies;
- claim or assignment;
- queued/running/paused/completed state;
- capacity use;
- agent session identity;
- workspace and branch identity;
- retry count and next retry time;
- merge/integration state;
- cleanup state.

Determine whether the system stores current state, an event history, external
markers, or several copies. If it uses an event log, determine whether the log
is authoritative, diagnostic, or merely telemetry.

### 3. What happens when something stops?

Run or source-trace the same chronological cases for every product:

1. The process stops before claiming a task.
2. It stops after the claim but before creating the workspace.
3. It creates the workspace and then stops.
4. It starts the agent but loses the start response.
5. The agent finishes but the control plane stops before recording the result.
6. The branch push succeeds but its response is lost.
7. Integration succeeds but its response is lost.
8. The user closes the control plane and immediately opens it again.
9. The user reopens it after a week, after the tracker and target branch have
   changed.

For each case record:

- what persisted;
- what the restart code reads;
- whether it resumes, retries, duplicates, abandons, or asks for help;
- whether the same agent session and worktree are reused;
- whether partial work survives;
- whether a worker slot is counted correctly;
- what the user sees.

If a case cannot happen in that architecture, explain why.

### 4. How are parallel work and resource limits implemented?

Inspect:

- the source of the ready-task set;
- atomic claim or locking behavior;
- global, per-host, per-agent, and per-state limits;
- whether queued, running, retrying, paused, and lost work count against the
  limit;
- whether the limit survives restart;
- whether merge/integration work has a different limit;
- how two control-plane processes avoid starting the same task.

Do not translate every integer limit into Dalph's resource model. First explain
the competitor's own model and why it chose it.

### 5. How do Git workspaces and concurrent results work?

Trace:

- how the starting commit is selected;
- whether the selected commit is stored;
- when a worktree is reused versus recreated;
- what happens when the target branch moves;
- whether partial work is rebased, merged, discarded, or quarantined;
- who creates and pushes branches;
- who reviews and merges;
- how concurrent completions are ordered;
- what happens after an ambiguous push or merge.

Evaluate fixed Base SHA versus moving branch behavior on both axes:

- implementation: reproducibility, bookkeeping, conflicts, and recovery;
- user experience: freshness, surprise, manual intervention, and retained work.

### 6. How maintainable is the implementation?

Examine both layers and end-to-end slices.

Layer questions:

- Are domain decisions separate from database, Git, process, and HTTP code?
- Are failures typed or converted to strings?
- Can the scheduler be tested without starting real agents?
- Can Git or tracker providers be replaced without changing scheduling rules?
- Are production, test, in-memory, dry-run, and fake implementations behind a
  common interface?

Slice questions:

- Can a maintainer follow “claim one task” through every module without
  unrelated registries?
- Does adding pause or a new executor require edits across distant switches?
- Is recovery colocated with the operation it repairs or with one shared
  recovery model?
- Do database migrations and event-version changes have explicit compatibility
  rules?

Record repair commands and operational scripts as maintenance evidence, not
automatically as design flaws. A repair command may be an intentional safety
boundary.

### 7. What verification techniques are present?

Search source and dependency manifests for:

- pure reducer tests;
- state-machine tests;
- property-based tests;
- model-based tests;
- deterministic clocks and fake providers;
- fault injection and kill/restart tests;
- concurrency/race tests;
- formal specifications or model checkers;
- database invariant and migration tests;
- end-to-end crash recovery tests.

For every claimed absence in an open-source project, perform an “X-ray search”
across manifests, source, tests, CI, design documents, and relevant issue
references. “The README does not mention it” is not evidence of absence.

### 8. What would Effect or Effect Workflow change?

Compare the competitors with Dalph's current and possible tools:

#### Current Effect architecture

- `Service` and `Layer` substitution;
- Schema decoding and branded identities;
- tagged failures;
- scoped resource lifetimes;
- structured concurrency and interruption;
- schedules, retries, streams, and deterministic test services;
- one workflow algebra interpreted by dry-run, fake, and production layers.

Determine which benefits are already implemented and which are only intended.
Effect cannot by itself persist a fiber, prove an external side effect, or
restore an agent after process death.

#### Effect Workflow

Evaluate only after its prerequisite subgraph authorizes the work. Research:

- durable step and workflow identity;
- persistence model;
- replay or re-execution semantics;
- activities and external side effects;
- cancellation and pause;
- timers and long sleeps;
- worker loss and versioning;
- testing and local simulation;
- compatibility with Dalph's journal and external authority reads;
- whether adoption would create a second workflow authority.

#### Elixir/OTP

Use Symphony to examine:

- GenServer state ownership;
- supervisors and restart strategies;
- process links and monitors;
- message ordering and mailboxes;
- timers and retry scheduling;
- what survives a BEAM process restart versus what still requires durable
  storage;
- how OTP shapes code organization and testability.

OTP may provide stronger process supervision than ordinary Go code, but it
does not automatically make tracker claims, Git operations, workspaces, or
agent sessions durable.

#### Go and database-backed systems

Do not treat “written in Go” as a reliability model. Identify the actual
mechanisms: file locks, database transactions, durable rows, idempotent
commands, watchdog scans, checkpoints, external markers, queues, and repair
tools.

Compare development and maintenance cost, not only runtime behavior.

## Evidence standard

Each product card must include:

1. pinned commit;
2. architecture diagram in ordinary words;
3. table of state facts and their owners;
4. chronological restart cases;
5. concurrency and Git behavior;
6. layer and slice assessment;
7. test and formal-method inventory;
8. user-visible consequences;
9. implementation consequences;
10. confirmed unknowns.

Use fixed-commit source links. Prefer implementation and tests over product
copy. When source and documentation disagree, record both and inspect which
path is reachable.

## How to decide whether a difference matters

Score each difference on two axes:

| Axis | Low weight | High weight |
|---|---|---|
| Technical consequence | Style preference, naming, or local implementation detail | Changes race safety, data loss, duplicate work, reproducibility, recovery, operability, or cost of future changes |
| User consequence | Invisible unless reading source | Changes whether work survives, duplicates, merges safely, pauses, resumes, remains explainable, or requires manual repair |

Do not promote a Dalph difference as an advantage when both weights are low.
When the technical weight is high but users rarely encounter it, identify the
operational environment where it becomes valuable instead of inventing a
commercial selling point.

Dalph is not being developed as a commercial product. “Competitive wedge” in
this research means a technically distinctive and useful niche, not a sales or
buyer strategy.

## Planned outputs

1. **Pre-study:** source sample of the first four products, identifying likely
   mental models and the highest-value unknowns.
2. **Four full architecture cards:** Gas Town/Beads, HerdOS, Symphony, and
   Paperclip.
3. **Four targeted cards:** Agent Kanban, AIF Handoff, Kandev, and Warren.
4. **Cross-product reliability matrix:** the same restart and week-later cases
   for every product.
5. **Effect/OTP/workflow comparison:** which mechanisms actually reduce code
   complexity or unlock behavior.
6. **Updated intersection analysis:** only differences with real technical or
   user consequences.
7. **Borrowing list:** concrete architecture, testing, and operational ideas
   Dalph should consider, without importing another product's authority model.

## Questions the research must leave open when evidence is insufficient

- Whether closed products implement stronger internal recovery than they
  publish.
- Whether users value detailed recovery explanations without observing them in
  practice.
- Whether exact agent-session restoration is feasible for every executor.
- Whether a separate integration limit materially improves the target
  repositories Dalph will initially operate.
- Whether Effect Workflow simplifies Dalph after accounting for its own
  persistence and versioning model.
- Whether a week-later resume should continue the old attempt, require
  replanning, or ask the operator; that is a product decision informed by the
  evidence, not something competitor behavior decides automatically.
