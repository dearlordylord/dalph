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
_Avoid_: Process, task, task-work session, historical harness run

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

**Task**:
A normalized Dalph value describing one unit of requested repository work read
through a task tracker. It is not the provider record, work activity, attempt,
session, or process.
_Avoid_: GitHub issue, task work, process, session, attempt, workflow operation

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

**Claim owner identity**:
The opaque Dalph-configured identity sent to the task tracker when claiming a
task. It is distinct from `RunId`, `TaskId`, `OperationId`, and provider-user
identity unless an accepted specification explicitly relates them.
_Avoid_: Run identity, GitHub assignee, coordinator process ID

**Completion claim**:
The temporary task-tracker record that replaces one exact active task claim
immediately before Dalph asks the task tracker to mark the task complete. It
records the exact Git commit accepted for the task and references the files and
reports used to justify completion. Dalph deletes it only after the task tracker
confirms completion.
_Avoid_: Task claim, task completed successfully, Git branch

**Planned task attempt**:
One Dalph decision to try a task from one exact Base SHA using one exact set of
resource locators. Planning it does not prove that external work started.
_Avoid_: Task, task work, task-work session, retry counter

**Task work**:
The activity performed to satisfy a task's requested repository change. Task
work is not the task record, Dalph's request to begin, a capacity slot, a
session identity, or an operating-system process.
_Avoid_: Task execution, task, attempt, session, process

**Task-work session**:
A provider-assigned identity and record associating one planned task attempt
with its current and past provider work units or worker processes. A provider
that supports resumption reuses that session identity across running units.
_Avoid_: Task, planned task attempt, worker process, task execution

**Worker process**:
One operating-system process, identified by an operating-system process ID,
that performs task work within a task-work session. Process exit does not by
itself decide the task's task-tracker lifecycle.
_Avoid_: Provider work unit, task-work session, task, task execution

**Provider work unit**:
One provider-specific running unit, such as a Sandcastle job. It may wrap a
container, virtual machine, agent run, or process; Dalph does not call it an
operating-system process unless the provider reports an OS process ID.
_Avoid_: Worker process, task-work session

**Dalph-assigned identity**:
An identity Dalph creates before recording or requesting a workflow action, such
as a `RunId` or `OperationId`.
_Avoid_: Managed identity, provider-reported identity

**Provider-reported identity**:
A session, provider-work-unit, or process identity created outside Dalph and
returned through a task-work provider adapter. Dalph may record it but does not
claim to have assigned it.
_Avoid_: Dalph-assigned identity, managed identity

**Task runner**:
The part of Dalph the coordinator calls to ask a configured task-work provider
to start work and report current task-work sessions, provider work units, and
worker processes. It is not a separate deployed application or microservice by
definition.
_Avoid_: Execution service, execution substrate, task tracker, Dalph coordinator

**Task-work provider**:
The configured local mechanism or external application that creates and reports
task-work sessions, provider work units, or worker processes. A local process
provider and a future Sandcastle provider are different concrete task-work
providers.
_Avoid_: Task runner, task tracker

**Task-work provider adapter**:
The part of the task runner that translates start requests and session lookups
for one concrete task-work provider. A local adapter reads OS processes; a
future Sandcastle adapter reads Sandcastle sessions and work units.
_Avoid_: Task runner, task-work provider, execution service

**Task selected by the task-tracker target**:
A task belongs to the task-tracker target closure after Dalph applies the
configured grouping/query selector and prerequisite expansion. Selection does
not claim the task, reserve capacity, or prove that work started.
_Avoid_: Tracker execution admission, task admission, task start

**Task-work capacity reserved**:
The coordinator reserves one unit of its bounded task-work capacity for one
runnable planned task attempt. The reservation does not prove that a session,
provider work unit, or worker process started.
_Avoid_: Task execution admission, tracker execution admission, task start

**Task-work start requested**:
The coordinator asks the task runner to start task work by requesting a new
provider session or running unit for one planned task attempt. Sending the
request does not prove that the provider created a task-work session, provider
work unit, or worker process.
_Avoid_: `ExecuteTask`, task execution, task start, execution request

**Task-work session lookup requested**:
The coordinator asks the task runner to read the task-work provider's current
session and running-unit records for one planned task attempt. This read-only
request never creates task work.
_Avoid_: Task-work start requested, retry

**Task-work session reported**:
The task runner returns the completed session lookup. The report distinguishes
an absent session, a matching session with its provider work units or worker
processes, and conflicting records instead of collapsing them into “executed.”
Failure to query the provider produces no report.
_Avoid_: Task execution started, task started, executed

**Task-work session result reported**:
The provider's terminal completion, failure, or interruption for one task-work
session, returned through the task runner. It does not decide whether the task's
requested repository change is acceptable or whether the task tracker should
mark the task successful. A running session has current state but no result.
_Avoid_: Task execution outcome observation, task admission, canonical task ordering

**Workflow operation**:
One named Dalph action or observation, such as requesting task-work start or
recording a task-runner report. It is neither the whole task nor an individual
SDK, CLI, or agent tool call.
_Avoid_: Generic operation, tool call, task

**Operation identity**:
The stable Dalph-assigned identity that links one workflow operation's recorded
intent, any state-changing request, fresh reads, and recorded outcome.
_Avoid_: Task identity, attempt identity, journal position

**State-changing request**:
A request that may change state outside Dalph's journal: for example, claiming
a task through the task tracker, creating a Git ref, or asking a task runner to
start task work.
_Avoid_: Mutation, controlled mutation, effect

**Uncertain request outcome**:
The state after Dalph recorded its intent to send a state-changing request but
did not record the result and cannot yet determine the result by rereading the
task tracker, Git, or task runner. It names one missing answer, not generic
workflow ambiguity.
_Avoid_: Ambiguity, ambiguous effect, temporary ambiguity seam

**Fresh result check**:
A new read made after an uncertain request outcome from the exact boundary the
request targeted: the task tracker for a claim, Git for a ref, or the task runner
reading the task-work provider through its configured adapter for a task-work
session. Journal replay and cached projections are not fresh result checks.
_Avoid_: External authority observation, fact-owner observation

**Uncertain-request recovery rules**:
The explicit mapping from a recorded intent plus a fresh result check through
the same task-tracker adapter, Git operation, or task-work provider adapter to
the next allowed action: acknowledge an already-applied change, make a first
request, stop on a contradiction, or wait/fail when the check cannot currently
answer.
_Avoid_: Operation-aware launch/observation protocol, reconciliation magic

**Workflow comparison trace**:
A derived sequence of comparison-trace entries used to compare live, dry-run,
and deterministic-test interpreters. Entries come from interpreter reports, not
journal event records, and are not persisted as current task, Git, session,
process, or workflow-journal state.
_Avoid_: Dalph workflow journal, audit log, dry-run-specific trace

**Dalph workflow journal**:
The durable history of workflow-operation intents and observed outcomes that
Dalph records. It contains only that history; current task, Git, task-work
session, provider-work-unit, and worker-process state must be reread through
their respective task-tracker, Git, or task-runner operations.
_Avoid_: Authority journal, audit log, semantic execution trace, tracker state

**Journal event record**:
One persisted workflow-journal event containing its identity, position, kind,
version, and payload.
_Avoid_: Event envelope, serialized coordinator, unvalidated database row

**Git common directory**:
The canonical Git-owned administrative directory shared by a repository and
all of its linked worktrees. Dalph uses its canonical path as the key for the
single-live-coordinator lock.
_Avoid_: Worktree `.git` file, project directory, coordinator identity, coordinator ownership

**Git common-directory target**:
A requested path that must resolve to a canonical Git common-directory locator
before Dalph attempts to acquire the single-live-coordinator lock.
_Avoid_: Canonical locator, coordinator identity

**Journal history validation**:
The process that reads journal events in position order, validates rules between
events, and returns either a recovery state or typed validation errors. Dalph
does not persist the derived recovery state.
_Avoid_: Event decoding, coordinator rehydration, reducer rollup table

**Run termination**:
The final Dalph-recorded disposition of a run: completed, blocked, cancelled, or
failed. Dalph records any disposition only after all active task-work sessions,
provider work units, and worker processes stop, or each retained resource is
explicitly named, isolated, and recorded with recovery instructions, and all
required cleanup finishes. A terminated run does not reopen; later work for the
same target belongs to a new run.
_Avoid_: Empty frontier, paused run, drained run

**Task completed successfully**:
The normalized terminal task state saying the task tracker reports successful
completion. Each task-tracker adapter maps its provider-specific lifecycle,
labels, or project fields into this state.
_Avoid_: Closed GitHub issue, successful lifecycle, task-work session result

**Run completion**:
The run termination recorded only after every task in the task-tracker target
closure is in the `Task completed successfully` state and no
planned task attempt, task-work session, integration step, or cleanup step
remains unfinished.
_Avoid_: Last task success, partial success, temporary quiescence

**Run blocked**:
The run termination recorded when a typed condition prevents every currently
allowed continuation until one exact change occurs. The blocked-run record names
that required change and the person, task tracker, Git repository, or task-work
provider capable of making it.
_Avoid_: Paused, temporarily idle, failed

**Run cancelled**:
The run termination recorded after an authorized operator directs Dalph to stop
the run and the required preservation/cleanup steps finish.
_Avoid_: Interrupted process, failed, blocked

**Run failed**:
The run termination recorded when a typed terminal failure is non-retryable
under its named retry/recovery policy or reaches that policy's recorded retry
limit.
_Avoid_: One failed task-work session, blocked, cancelled

**Dry-run completion schedule**:
The reproducible pseudo-random order in which the dry interpreter completes
simulated task-work sessions holding reserved task-work capacity.
_Avoid_: Production prediction, randomized task admission, simulated execution, ambient randomness
