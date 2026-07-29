# Dalph Tooling Context

This context names repository delivery-orchestration concepts. It is separate
from every target repository's application and domain model.

## Language

**Target application**:
The product system in a repository whose work Dalph coordinates.
_Avoid_: Ralph, delivery tooling

**Repository tooling**:
Software that builds, verifies, plans, or delivers changes to the target
application without becoming part of its product runtime or domain model.
_Avoid_: Target application, product runtime

**Dalph orchestrator**:
The graph-native repository tooling that coordinates delivery work. Ralph is
the retained identity of the original research record and historical harness,
not the name of the production orchestrator.
_Avoid_: New `ralph-run.sh`, shell-harness replacement

**Dalph executor**:
The Dalph component that performs the complete work for one planned task
attempt and reports only the attempt-level running, safely suspended, or
terminal result required by generic orchestration. The production executor's
inner algorithm is post-milestone design.
_Avoid_: Dalph orchestrator, universal review pipeline

**Planned-attempt executor work**:
The selected executor's complete course of work for one planned task attempt.
Dalph may start, continue, ask to suspend, or receive the outcome of that work
without learning an internal stage. In v1, the planned task attempt identifies
this work at the generic executor boundary; Dalph does not allocate a second
outer-invocation identity. The controlled fake has no coding-agent, reviewer,
evidence, handback, retry, or restoration stages.
_Avoid_: Executor outer invocation, review stage, worker process, workflow
operation

**Planned-attempt executor-work correlation**:
The exact `RunId` and `AttemptId` of the planned task attempt that Dalph uses
across executor start, continuation, safe suspension, and terminal outcome. An
internal `OperationId`, coding-agent invocation, reviewer invocation, provider
request, session, or worker process cannot replace or supplement this generic
correlation.
_Avoid_: Executor outer invocation identity, task identity alone, operation
identity, log correlation

**Task-work capacity requirement**:
The zero-or-one task-work position that Dalph says one workflow transition
needs. The executor does not request, acquire, declare, or release this
position. For example, Dalph may require one position before it asks the
executor to continue task A, while a tracker-only read requires none.
_Avoid_: Executor-declared capacity, review capacity, operation-name capacity

**Planned-attempt executor-work suspension**:
The executor's proof that its complete work for one exact planned task attempt
is safely stopped, has preserved what it needs to resume the same attempt, and
has no executor-owned activity for that attempt still running. Dalph may
therefore make the task-work position available. The controlled fake executor
produces this proof after Dalph asks it to stop for resume, such as during a
task pause, run pause, or safety stop. A coding-agent, reviewer, session, or
worker-process interruption alone is an executor-internal fact and does not
prove suspension.
_Avoid_: Executor interruption, process exit alone, coordinator cancellation,
attempt abandonment

**Planned-attempt executor-work outcome**:
An executor's normalized completed or failed result for one
exact planned task attempt. Suspension is separately resumable and therefore
is not a terminal outcome.
_Avoid_: Internal review result, raw provider response

**Planned-attempt executor-work projection**:
The controlled fake executor's current declaration that its complete work for
one exact `(RunId, AttemptId)` is running, safely suspended, or terminal with a
normalized result. Starting or resuming is a Dalph request, not another
persisted executor state.
_Avoid_: Generic inspection of executor-specific journal events, internal wait

**Historical Ralph harness**:
The one-off `scripts/ralph-run.sh` experiment and its execution formats.
_Avoid_: Ralph architecture, compatibility baseline, legacy runtime

**Candidate tooling requirement**:
A possible Dalph requirement mined from evidence but not yet approved in a
named decision or implementation specification.
_Avoid_: Requirement, contract

**Accepted tooling requirement**:
A Dalph requirement explicitly approved in a named decision or implementation
specification.
_Avoid_: Observed shell behavior, candidate

**Normalized task-graph fixture**:
A serialized set of normalized tasks and dependency/grouping edges used by
dry-run and deterministic-test scenarios. It is neither GitHub API data nor a
fresh read from a configured task tracker.
_Avoid_: Tracker fixture, tracker state file, GitHub Issues API fixture

**Run**:
One durable Dalph coordination instance for one task-tracker target. It begins
when Dalph records a fresh `RunId` and ends with one run termination record.
_Avoid_: Process, task, historical harness run

**Task-tracker target**:
The grouping root or query that tells a task-tracker adapter where to begin
collecting tasks for one run. It selects the starting membership; prerequisite
edges may add tasks through the task-tracker target closure.
_Avoid_: Run, task, task-tracker target closure, repository

**Task-tracker target closure**:
The tasks selected by a task-tracker target's grouping descendants together with
every transitive prerequisite needed to evaluate them. Grouping descendants of
a prerequisite-only task are outside the closure unless the target selects
them independently.
_Avoid_: Tracker target closure, scope, complete native graph

**Task tracker**:
The external work-record application configured for a Dalph run. It stores task
identity, description, lifecycle, dependencies, grouping, and claims; it does
not perform the requested repository work or report Git and process state.
_Avoid_: Tracker without context, task-tracker adapter, scheduler, task runner, Dalph journal

**GitHub Issues task tracker**:
The first concrete task tracker supported by Dalph. Dalph's GitHub adapter
translates between GitHub Issues and normalized task values and operations.
_Avoid_: Task tracker when GitHub-specific behavior matters, GitHub scheduler

**Task-tracker adapter**:
The part of Dalph that decodes one task tracker's API responses into normalized
task values and encodes normalized task changes as API requests. The GitHub
adapter is the first implementation.
_Avoid_: Task tracker, GitHub Issues

**Current authority fact**:
A value currently maintained by its named external owner, such as task state in
the task tracker, a worktree registration in Git, or the latest report from the
planned-attempt executor. Dalph learns it only from a boundary result whose
contract proves that fact; earlier journal history does not prove it remains
current.
_Avoid_: Cached authority state, durable graph knowledge, journaled observation

**Normalized task-graph read result**:
The provider-independent boundary value a task-tracker adapter assembles with
explicit coverage, completeness, temporal-consistency, and freshness evidence.
Its normalized shape does not claim that every fact is fully current or came
from one instant.
_Avoid_: Current task graph, TaskGraphFactsUpdated event, provider response dump

**Task-tracker target-closure membership observation**:
The normalized result saying one successful task-tracker read completely
covered membership in one task-tracker target closure and returned the named
task identities. It carries the read boundary's freshness evidence, the
provider-independent content fingerprint, and potentially mixed-time
consistency. It does not claim lifecycle, dependency, grouping, or claim facts.
An absent identity is proven only when the named read shape explicitly covered
that identity; journal order does not make incompatible membership observations
comparable.
_Avoid_: Current target closure, complete task graph, atomic tracker snapshot

**Task-graph facts updated**:
The immutable workflow-journal event recording provider-independent task and
edge facts returned by either a tracker read or a tracker mutation. The
graph-knowledge reducer applies both origins through the same coverage,
completeness, consistency, and replacement rules.
_Avoid_: Provider response dump, current task graph, read-only observation event

**Best available durable graph knowledge**:
The reducer's reconstruction of usable journaled task and edge facts, proven
absences, and unresolved conflicts for each observed graph area. It may lag
current tracker facts and changes only by folding later journal events.
_Avoid_: Current task graph, persisted frontier, tracker authority

**Task-graph knowledge conflict**:
Two successful `TaskGraphFactsUpdated` events report incompatible facts for one
subject without comparable provider evidence proving which fact is newer. The
conflict makes only that fact or dependent graph region unavailable pending a
focused reread.
_Avoid_: Invalid managed history, whole-run blocker, last-journal-event wins

**Potentially mixed-time task-graph read**:
A normalized task-graph read result assembled without a provider guarantee that
all covered facts share one revision or instant; different facts may reflect
different moments even when coverage is complete and no contradiction is
detectable.
_Avoid_: Atomic snapshot, transactionally consistent graph, fully current graph

**Task-graph read contradiction**:
A typed task-tracker adapter failure proving that provider reads used for one
requested task-graph result cannot form one valid normalized value. It exposes
the contradiction to the caller-selected task-graph read policy instead of
returning a potentially mixed-time result.
_Avoid_: Potentially mixed-time task-graph read, invalid managed history, provider retry policy

**Task-graph read policy**:
The caller-selected, bounded policy for retrying one failed provider page and
for restarting the complete assembly when local page recovery or consistency
checking cannot finish it. The selected policy determines the operation's
typed failure surface.
_Avoid_: Hidden adapter retry, fixed provider retry policy, workflow mode

**Task-graph read shape**:
A named, usage-earned adapter request defining the exact task subjects and fact
families to read, such as one task's complete blockers or one target closure.
Its matching result gives successful empty collections precise meaning without
creating a general-purpose tracker query language.
_Avoid_: Arbitrary field bag, provider query, speculative graph API

**Task-graph read retry exhausted**:
The typed final failure returned when a task-graph read policy consumes
intermediate page failures or contradictions but cannot assemble a valid
normalized result within its bound.
_Avoid_: Task-graph read contradiction, potentially mixed-time task-graph read, infinite retry

**Task**:
A normalized Dalph value describing one unit of requested repository work read
through a task tracker. It is not the provider record, work activity, attempt,
session, or process.
_Avoid_: GitHub issue, task work, process, session, attempt, workflow operation

**Task-work specification**:
The normalized tracker-authored title and body supplied to a Dalph executor for
one planned task attempt. It excludes lifecycle, graph relationships, claims,
and provider-only metadata.
_Avoid_: Task revision, task-graph facts, executor prompt

**GitHub issue task record**:
The GitHub Issues representation that the GitHub task-tracker adapter decodes
into a normalized task. Provider-only fields remain outside the normalized task
unless Dalph's task contract explicitly includes them.
_Avoid_: Task when discussing GitHub-specific fields or behavior

**Task claim**:
A task-tracker record associating a task with one `ClaimOwner` identity. It
remains until the adapter confirms release of that exact claim after authorized
abandonment, replacement by a completion claim, deletion after confirmed task
completion, or an operator-authorized repair. The task-tracker adapter defines
the provider-specific atomic claim request and conflict response.
_Avoid_: Task selection, execution capacity, local process lock

**GitHub task claim record**:
The repository-scoped GitHub label record that represents one task claim. It is
distinct from assigning a label to an issue and therefore does not appear in
the issue's visible label list.
_Avoid_: Issue label, label-backed lock, issue title

**Claim owner identity**:
The opaque Dalph-configured identity sent to the task tracker when claiming a
task. It is distinct from `RunId`, `TaskId`, `OperationId`, and provider-user
identity unless an accepted specification explicitly relates them.
_Avoid_: Run identity, GitHub assignee, coordinator process ID

**Claim token**:
The unguessable Dalph-assigned capability recorded with one task claim. A
release or later claim change must name the exact current claim owner and token;
a token from an earlier claim cannot authorize a replacement claim.
_Avoid_: Operation identity, run identity, provider-user identity

**Task claim acquisition intended**:
The workflow-history fact recorded before Dalph asks the task tracker to create
one exact task claim. It neither proves that the request crossed the boundary
nor that the tracker accepted it.
_Avoid_: Task claimed, claimed task eligibility observed

**Task claim acquired**:
A fresh task-tracker claim observation proves that the exact intended owner and
token currently own the task. It does not prove that the task remains open or
inside the run's current task-tracker target closure.
_Avoid_: Claim request acknowledged, claimed task eligibility observed

**Completion claim**:
The temporary task-tracker record that replaces one exact active task claim
immediately before Dalph asks the task tracker to mark the task complete. It
binds the exact confirmed integration result, current task revision, and any
supporting artifacts required by the selected resolution protocol. Dalph
deletes it only after the task tracker confirms completion.
_Avoid_: Task claim, task completed successfully, Git branch

**Planned task attempt**:
One immutable Dalph decision to try one exact task revision fingerprint in one
run from one exact Base SHA. It binds its attempt identity, branch ref,
worktree path, and executor locator before Dalph creates or discovers either
execution resource. Planning it does not prove that an external resource
exists or that executor work started.
_Avoid_: Plan, attempt plan, task, task work, retry counter

**Planned-task-attempt recording predecessor**:
An earlier workflow operation named by a planned-task-attempt recording
operation as the observed reason Dalph may record that immutable decision. Its
`OperationId` expresses causal lineage; it is not an attempt identity, task
version, or journal position.
_Avoid_: Plan predecessor, dependency, prior task version

**Planned worktree ready**:
A fresh Git observation proving that one planned task attempt's exact worktree
path is registered to its exact branch, reporting current `HEAD`, and that Git
successfully checked the attempt's declared Base SHA as an ancestor of that
`HEAD`. This proof is logged before Dalph starts or continues the
planned-attempt executor work.
_Avoid_: Worktree created, branch exists, task execution admitted

**Git worktree reconciliation fact**:
A typed fresh Git observation that prevents Dalph from creating or using the
planned worktree: an existing but unregistered target path, the planned branch
registered at a foreign path, a different branch registered at the planned
path, contradictory Git records, or a declared Base that is not an ancestor of
current `HEAD`. Dalph preserves the resource and fact for operator repair; it
does not repair, move, reset, clean, or delete the resource.
_Avoid_: Git error, worktree cleanup candidate, recoverable mismatch

**Task revision fingerprint**:
The opaque fingerprint of one normalized task's exact tracker-observed content
bound to a planned task attempt. It compares observed content; it is not a
version counter, release version, edit sequence, or historical revision chain.
It is distinct from the fingerprint of the complete task-graph snapshot.
_Avoid_: Task version, version number, tracker revision, Git commit, journal
position

**Active-task continuation read**:
A task-tracker read covering the authored task-work specification, lifecycle,
exact claim, target-closure membership, and complete blockers needed before
Dalph starts another long-running action for an existing attempt.
_Avoid_: Initial attempt eligibility, coding-agent progress poll, global refresh

## Executor-internal policy

The generic orchestrator models only complete planned-attempt executor work and its running, safely suspended, or terminal report. Review, retry, provider-session, handback, restoration, and convergence policy are not current Dalph domain concepts. Any future production executor algorithm requires new accepted operational scenarios and must remain behind this coarse boundary.
