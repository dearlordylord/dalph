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

**Claim token**:
The unguessable Dalph-assigned capability recorded with one task claim. A
release or later claim change must name the exact current claim owner and token;
a token from an earlier claim cannot authorize a replacement claim.
_Avoid_: Operation identity, run identity, provider-user identity

**Task claim acquisition intended**:
The workflow-history fact recorded before Dalph asks the task tracker to create
one exact task claim. It neither proves that the request crossed the boundary
nor that the tracker accepted it.
_Avoid_: Task claimed, tracker execution admitted

**Task claim acquired**:
A fresh task-tracker claim observation proves that the exact intended owner and
token currently own the task. It does not prove that the task remains open or
inside the run's current task-tracker target closure.
_Avoid_: Claim request acknowledged, tracker execution admitted

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

**Provider work-unit availability**:
The task-work provider adapter's explicit observation of one registry-known
provider work unit: available with current details, confirmed purged by the
native provider, or temporarily unreadable. Purged and unreadable units remain
known members of their task-work session rather than disappearing from its
history.
_Avoid_: Task-work session existence, provider work-unit result, empty provider listing

**Provider work unit purged**:
The provider adapter proves that one registry-known provider work unit existed
and that its native record was intentionally removed. Its task-work session
remains established, but that work unit cannot be resumed; later workflow must
select replacement, preservation, or failure explicitly.
_Avoid_: Provider work unit absent, provider work unit temporarily unreadable, no matching task-work session reported

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
for one concrete task-work provider. It is an application boundary, not a
deployment boundary: an adapter may wrap a local CLI, operating-system process,
SDK, filesystem-backed runner, or remote API. A local adapter reads OS
processes; a future Sandcastle adapter reads Sandcastle sessions and work units.
_Avoid_: Task runner, task-work provider, execution service

**Task-work provider correlation registry**:
Provider-adapter-owned durable metadata that correlates one exact `OperationId`
and planned task attempt with its provider-assigned task-work session and
provider work units. It survives for the lifetime of every recoverable run even
when a provider removes native session details. It is neither Dalph workflow
journal state nor a retained transcript or cached process listing.
_Avoid_: Dalph workflow journal, task-work provider cache, workflow projection, native session retention

**Task selected by the task-tracker target**:
A task belongs to the task-tracker target closure after Dalph applies the
configured grouping/query selector and prerequisite expansion. Selection does
not claim the task, reserve capacity, or prove that work started.
_Avoid_: Tracker execution admission, task admission, task start

**Tracker execution admitted**:
After claim acquisition, a fresh read through the real task-tracker boundary
proves that the claimed task is open and remains in the run's task-tracker
target closure. Dry-run, rejected claims, inaccessible reads, and missing or
non-open tasks cannot establish this event.
_Avoid_: Task claim acquired, task execution admitted, task execution started

**Task execution admitted**:
The coordinator admits one runnable planned task attempt into its bounded
task-work capacity. Admission does not prove tracker scope or that a session,
provider work unit, or worker process started.
_Avoid_: Tracker execution admitted, task execution started

**Task execution started**:
The task-work provider reports evidence that task work began. Claim ownership,
bounded capacity, a start request, or task-work session establishment alone
cannot establish this event.
_Avoid_: Tracker execution admitted, task execution admitted, task-work start requested

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
For a matching session, every registry-known provider work unit is reported as
available, confirmed purged, or temporarily unreadable. Failure to establish
the session correlation itself produces no session report.
_Avoid_: Task execution started, task started, executed

**No matching task-work session reported**:
The task-work provider adapter proves from complete durable correlation metadata
that no current or historical task-work session matches the exact `OperationId`
and planned task attempt. A request error, empty native session listing, purged
native session, or unavailable registry cannot establish this report.
_Avoid_: Task-work session lookup failure, native session absent, task-work session correlation conflict

**Task-work session correlation conflict**:
A fresh task-work session lookup reports multiple matches, an identity or
payload mismatch, or other provider records that contradict the exact
`OperationId` and planned task attempt. Dalph preserves the conflicting
provider evidence and blocks the affected workflow operation instead of
choosing a session, requesting another one, or overriding provider authority.
_Avoid_: Task-work session reported, execution resource conflict, lookup failure, operator-selected session

**Task-work session lookup failure**:
The task runner could not obtain an authoritative task-work session report from
the configured provider. It records why the fresh result check could not
answer, leaves the task-work start operation unresolved, and authorizes only a
later fresh result check.
_Avoid_: No matching task-work session reported, task-work session correlation conflict, task-work session established

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
The stable Dalph-assigned identity allocated when one workflow operation is
selected. Once its intent is committed, the identity links that immutable
intent to any state-changing request, fresh result checks, recovery, repeats of
that same request, and its recorded outcome.
_Avoid_: Task identity, attempt identity, journal position

**Causal predecessor**:
A workflow operation whose recorded outcome or decision was necessary to select
another workflow operation. Direct `OperationId` references record this
relationship; journal adjacency and tracker task dependencies do not.
_Avoid_: Previous journal event, task prerequisite, earlier operation

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

**Task-work start request acknowledgement**:
The provider response saying one task-work start request returned. Dalph records
it as managed workflow history, but it does not prove that a task-work session
exists and never replaces the required fresh result check.
_Avoid_: Task-work session reported, task-work session result reported, recovery authority

**Task-work session established**:
The managed workflow outcome recorded after a fresh result check reports exactly
one task-work session matching the start request's stable `OperationId` and
complete planned task attempt. It says only that the requested session for that
one planned task attempt exists. An established session may normally contain no
provider work unit or worker process yet; requesting that work is a distinct
workflow operation. The session's current state and terminal result remain
separate provider observations.
_Avoid_: Task-work start request acknowledgement, task-work session result reported, task completed successfully

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
