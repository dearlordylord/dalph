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

**Current authority fact**:
A value currently maintained by its named external owner, such as task state in
the task tracker, a worktree registration in Git, or a session in the task-work
provider. Dalph learns it only from a boundary result whose contract proves that
fact; earlier journal history does not prove it remains current.
_Avoid_: Cached authority state, durable graph knowledge, journaled observation

**Normalized task-graph read result**:
The provider-independent boundary value a task-tracker adapter assembles with
explicit coverage, completeness, temporal-consistency, and freshness evidence.
Its normalized shape does not claim that every fact is fully current or came
from one instant.
_Avoid_: Current task graph, TaskGraphFactsUpdated event, provider response dump

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
worktree path, executor locator, and task-work-session locator before Dalph
creates or discovers any of those execution resources. Planning it does not
prove that an external resource exists or that task work started.
_Avoid_: Plan, attempt plan, task, task work, task-work session, retry counter

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
`HEAD`. This proof is logged before Dalph asks the task-work provider to begin
agent work.
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

**Task executor locator**:
The branded locator selecting the configured executor for one planned task
attempt. It is not a provider-assigned task-work-session identity.
_Avoid_: Task runner, task-work session ID, worker process ID

**Task executor**:
The task-runner application boundary that starts or resumes the configured
implementer in one exact established task-work session and freshly observes its
worker process. It does not establish sessions, allocate workflow operation
identities, or decide task-tracker success.
_Avoid_: Task runner as a whole, task-work provider, task executor locator

**Task-work-session locator**:
The branded, Dalph-planned locator used to create or rediscover one exact
task-work session. A task-work provider may later report a distinct native
session identity for that locator.
_Avoid_: Task-work-session identity, executor locator, worktree locator

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
_Avoid_: Claimed task eligibility observed, task admission, task start

**Claimed task eligibility observed**:
After claim acquisition, a fresh read through the real task-tracker boundary
proves that the claimed task is open, remains in the run's task-tracker target
closure, and has no unsatisfied prerequisite. Dry-run, rejected claims,
inaccessible reads, and missing, non-open, or blocked tasks cannot establish
this event.
_Avoid_: Tracker execution admitted, task claim acquired, task execution admitted

**Task execution admitted**:
The coordinator admits one runnable planned task attempt into its bounded
task-work capacity. Admission does not prove tracker scope or that a session,
provider work unit, or worker process started.
_Avoid_: Claimed task eligibility observed, task execution started

**Task execution started**:
The task-work provider reports evidence that task work began. Claim ownership,
bounded capacity, a start request, or task-work session establishment alone
cannot establish this event.
_Avoid_: Claimed task eligibility observed, task execution admitted, task-work start requested

**Task execution request**:
The coordinator asks the configured executor to start or resume one worker
process in the exact provider-assigned task-work session established for a
planned task attempt. The request retains the `OperationId` allocated at task
execution admission. Dalph records the exact request attempt immediately before
the adapter boundary; its return does not prove that a process began or exited.
_Avoid_: Task-work session establishment, task execution started, task execution outcome

**Task execution interruption request**:
The coordinator asks the configured executor to stop one exact running worker
process while preserving its task-work session and planned task attempt for
later reconciliation or resumption. Dalph may select this action while carrying
out a user-requested pause, but the action is not itself a pause. The request's
return does not prove that the process stopped; a fresh task-execution
observation must report interruption or another terminal outcome.
_Avoid_: User-requested task pause, task cancellation, task abandonment

**Task execution observation**:
A fresh task-work-provider read correlating the admission `OperationId`, exact
task-work session, and worker process. A running or terminal observation proves
that task execution started. A running observation remains nonterminal; only a
terminal observation reports success, nonzero exit, or interruption; provider
uncertainty remains explicit.
_Avoid_: Request acknowledgement, task execution admission, task completion

**Task execution session conflict**:
Fresh provider evidence that the session associated with an execution request
is stale, replaced, foreign, or absent from durable provider correlation.
Dalph preserves the evidence and does not select another session, create a
replacement identity, or advance the attempt.
_Avoid_: Task-work session lookup failure, task execution outcome, retry

**Task execution outcome observation**:
The discriminated successful, nonzero-exit, or interrupted process
fact returned by the task-work provider for one admission `OperationId` and
exact session. Nonzero exit and interruption preserve WIP and bounded partial
output. This observation does not decide task-tracker success.
_Avoid_: Task execution started, task completed successfully, review result

**Implementation evidence object**:
One complete byte sequence stored atomically under its SHA-256 content address
in the EvidenceStore. An object may contain executor output, a Git diff, or a
stage manifest; its presence alone does not authorize review.
_Avoid_: Workflow journal event, cached output, review result

**Implementation evidence manifest**:
The immutable implementation-stage record that names the exact successful task
execution operation as its causal predecessor and references the complete
content-addressed executor-output and Git-diff objects. Dalph seals the manifest
only after both referenced objects are readable from the EvidenceStore.
_Avoid_: Partial evidence, mutable report, task completion

**Implementation review authorization**:
A value decoded from one complete sealed implementation evidence manifest.
Unsealed bytes, partial manifests, dry-run projections, and deterministic-test
projections cannot establish it.
_Avoid_: Review request, successful process exit, simulated evidence

**Semantic review round**:
One reviewer disposition for the latest successful implementer invocation of
one planned task attempt. A round consumes no technical retry count; later
retry and convergence policy owns whether another round may begin.
_Avoid_: Reviewer process, technical retry, task attempt

**Implementation review round limit**:
The positive bound captured on every review request for one planned task attempt.
It limits successful semantic reviewer dispositions, not retries of a failed
reviewer or handback invocation. Findings at the limit select implementation
non-convergence and cannot select another unchanged handback/rework round.
_Avoid_: Technical retry limit, time limit, implicit progress

**Implementation acceptance**:
The final successful outcome of the current implementation-and-review protocol.
It may select later integration work but does not complete the tracker task,
settle every task responsibility, or terminate the run.
_Avoid_: Successful process exit, tracker task completion, task terminal state

**Implementation non-convergence**:
The final unsuccessful outcome of the current implementation-and-review
protocol selected when a findings-bearing
sealed review consumes the captured implementation review round limit. It is a
semantic result and remains distinct from exhausted technical transport retry.
_Avoid_: Reviewer failure, handback failure, task execution failure, run termination

**Implementation technical retry exhaustion**:
The final unsuccessful outcome of the current implementation-and-review
protocol selected only after the exact reviewer or findings-handback invocation
consumes its captured technical retry schedule. It does not advance the
semantic round or by itself terminate the task or run.
_Avoid_: Implementation non-convergence, finding, coordinator interruption, run termination

**Demonstrated resource emergency**:
Fresh execution-provider evidence that memory, process capacity, or storage was
exhausted while preserving WIP and bounded partial output. It terminates the
implementation loop and forbids automatic retry of the unchanged invocation.
_Avoid_: Nonzero exit, timeout inference, generic execution failure

**Technical retry scope**:
The exact reviewer invocation or findings-handback invocation whose typed
technical failures share one captured positive retry limit and bounded
exponential delay policy. The scope retains its workflow operation and semantic
review round, but its technical retry ordinal is a separate branded fact.
_Avoid_: Semantic review round, task attempt, coordinator recovery budget

**Technical retry scheduled**:
The Dalph workflow-journal fact recorded after one typed technical invocation
failure and before waiting. It binds the active technical retry scope, next
technical retry ordinal, capped delay, and absolute `notBefore` read from the
Effect clock. It does not prove that the retry began and does not make a
coordinator interruption by itself consume or preserve budget; later recovery
compares it with an exact deferral-supersession intent.
_Avoid_: Reviewer finding, semantic handback, timer instance, retry attempt

**Technical retry deferral superseded**:
The Dalph workflow-journal intent recorded after one scheduled retry becomes
eligible and immediately before Dalph asks the same provider invocation to
create or rediscover its exact result. It retires exactly that scope and retry
ordinal's deferral. It does not prove that the request crossed the provider
boundary or consume another technical retry or semantic review round.
Like its matching schedule, it is valid only after the exact invocation intent
and before that invocation's durable outcome.
_Avoid_: Retry completed, timer fired, semantic review advanced

**Reviewer invocation**:
One request to a fresh independent reviewer, identified by its workflow
operation and durable reviewer-session identity before it crosses the reviewer
boundary. Restart resumes that exact invocation rather than creating another
semantic round.
_Avoid_: Review result, implementer invocation, retry attempt

**Reviewer session**:
The durable identity for one reviewer invocation. A later semantic round must
use a different reviewer session even when it reviews the same planned task
attempt.
_Avoid_: Task-work session, reviewer identity, semantic review round

**Implementation review evidence**:
An immutable content-addressed manifest that references its immediate evidence
predecessor, binds the planned task attempt, exact worktree, latest implementer
invocation and session, reviewer session, and semantic round, and retains the
complete finding history together with the reviewer disposition in the current
review-capable executor protocol.
The current review contract has no partial-resolution state: every finding in
that history remains unresolved and is supplied to the next fresh reviewer
until one accepted disposition resolves the complete set. The accepted manifest
retains the history as immutable audit evidence rather than current findings.
It is not a universal requirement of every future executor or resolution
protocol.
_Avoid_: Implementation evidence, mutable review report, workflow trace, task completion evidence

**Review findings handback**:
The request that sends one findings-bearing implementation review evidence
object to the exact task-work session and latest implementer invocation that
produced the reviewed implementation. A stale invocation, foreign session, or
different planned task attempt cannot receive it.
_Avoid_: Technical retry, new task attempt, reviewer response

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

**Workflow operation intent**:
The immutable journal event recording one selected workflow operation before
Dalph crosses the boundary named by that operation. It proves neither that a
request was sent nor that an external application changed.
_Avoid_: Request acknowledgement, external fact, operation result

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

**Workflow responsibility**:
Dalph's durable obligation to continue, reconcile, preserve, isolate, or
dispose one exact task-coordination action, workflow operation, or external
resource. It does not claim ownership of the external authority's facts.
_Avoid_: Task claim, external resource ownership, whole-attempt responsibility flag

**Workflow responsibility relinquished**:
The durable disposition ending one exact workflow responsibility after current
authority facts show that Dalph may no longer act on that subject. Other
responsibilities for the same task attempt remain until separately discharged
or relinquished.
_Avoid_: Attempt abandoned, task completed, external history rewritten

**State-changing request**:
A request that may change state outside Dalph's journal: for example, claiming
a task through the task tracker, creating a Git ref, or asking a task runner to
start task work.
_Avoid_: Mutation, controlled mutation, effect

**State-changing request acknowledgement**:
The durable workflow result recording that the named external boundary returned
from one state-changing request. It updates reconstructed graph knowledge only
when the same event also carries normalized task-graph facts under an accepted
adapter contract.
_Avoid_: Current external fact, fresh result check, duplicate observation event

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

**Runnable frontier**:
The process-local set of exact per-responsibility workflow transitions that
reconstructed managed-run state and accepted policy currently allow before
applying task-work capacity. Its derivation also returns a typed wait, pause,
isolation, relinquishment, or settled reason for each responsibility with no
legal transition; neither result is persisted as authority.
_Avoid_: Admission set, managed-run recovery stage, persisted queue, durable graph knowledge, task-tracker target closure

**Admission set**:
The process-local, deterministically ordered subset of the runnable frontier
chosen for currently available task admission positions. Membership commits no
workflow responsibility until Dalph records the selected transition's exact
operation intent.
_Avoid_: Runnable frontier, persisted queue, task claim, task execution admitted

**Task admission position**:
One process-local unit of configured task-work capacity, reserved while Dalph
prepares a freshly committed task or occupied while a task-work invocation
consumes capacity. It is recreated after process loss from configuration,
workflow responsibility, and fresh observations rather than restored as
authority.
_Avoid_: Task claim, persisted capacity reservation, worker process

**Capacity waiting**:
The derived condition in which a runnable transition needing task-work capacity
is excluded from the admission set because every task admission position is
reserved or occupied.
_Avoid_: Durable waiting status, retry deferral, dependency-blocked task

**Control command identity**:
The branded `ControlCommandId` assigned to one exact user control command before
Dalph appends that command to a run's workflow journal. Redelivery of the same
identity and payload is idempotent; reusing the identity with a different
command or subject is a typed contradiction. It is distinct from the
`OperationId` of any workflow action later selected to carry out the command.
_Avoid_: Operation identity, run identity, provider request identity

**Dalph user**:
The single human actor who issues pause, resume, interruption, cancellation, and
other control commands to Dalph. The current domain model does not distinguish
multiple user identities or transfer command authority between users.
_Avoid_: Claim owner identity, provider-user identity, multi-user authorization

**User-requested run pause**:
The durable pause of one exact `RunId` requested by the Dalph user. Dalph
selects no new forward-progress action for any task in that run after each
already-started action reaches its specified safe boundary. A run pause does
not create a user-requested task pause for each task. Resuming the run removes
only the run pause; independently paused tasks remain paused.
_Avoid_: Collection of task pauses, run termination, run blocked

**Run pause phase**:
The reconstructed pause dimension for one run: unpaused, pausing, paused, or
resuming. Dalph derives it from the run's durable user pause and resume commands
and the safe-boundary progress of every affected task; it does not write a
separate phase record. One task or grouping-covered descendant still reaching a
safe boundary keeps the run pausing and supplies its tagged progress reason.
_Avoid_: Run termination, collection of task pause phases, persisted run status

**Task pause phase**:
The reconstructed pause dimension for one task in one run: unpaused, pausing,
paused, or resuming. Dalph derives it from durable user pause and resume
commands, ordinary workflow outcomes, current grouping-pause coverage, and
outstanding responsibilities; it does not write a separate phase record. The
phase composes with rather than replaces the task tracker's lifecycle and claim
facts, the task's workflow stage, and its resource responsibilities. For
example, one task may simultaneously be unclaimed and paused while another is
claimed and pausing.
_Avoid_: Task lifecycle, task claim state, combined task status

**User-requested task pause**:
The durable pause of one exact `(RunId, TaskId)` pair requested by the Dalph
user. After the request reaches its specified safe boundary, Dalph does not
select new forward-progress actions for that task in that run. A task-graph
change does not remove the pause; the Dalph user must request its resume. A
later run containing the same tracker task does not inherit the pause. The
task's prerequisites and dependents do not become paused merely because this
task is paused. Its transitive grouping descendants receive grouping-pause
coverage without receiving their own pause phase.
Any existing exact task claim, planned task attempt, worktree, task-work
session, and unfinished work remain preserved for an ordinary pause such as an
overnight pause. Only a separate user-requested abandonment, cancellation, or
handoff may release or transfer the claim.
_Avoid_: Paused subtree, task-tracker target closure, blocked task

**Grouping-pause coverage**:
The derived prohibition on forward-progress actions for every transitive
grouping descendant of a user-requested task pause. Dalph stores only the
parent's pause phase and recomputes covered descendants from current
tracker-owned grouping edges. Adding or moving a child changes coverage without
creating or removing a child pause record. Coverage follows parent-to-descendant
grouping edges only; it does not create a prerequisite edge, pause a grouping
ancestor or sibling, or require the parent task to complete.
_Avoid_: User-requested task pause, dependency-blocked task, persisted pause closure

**Task pausing**:
The nonterminal state after Dalph records a user-requested task pause and before
it confirms the task's safe pause boundary. Dalph selects no new
forward-progress action for the task, but it continues the exact bounded wait,
fresh result check, worker interruption, or provider observation needed to
settle work already in flight. The reconstructed state carries a tagged pause
progress reason naming that action and its exact subject. A paused grouping
parent remains pausing while any covered descendant has not reached its safe
boundary, and the reason names that descendant. The phase and reason are
derived so a later UI can explain the delay without persisting separate UI
state.
_Avoid_: Task paused, dependency-blocked task, generic pending state

**Task paused**:
The confirmed task pause phase after every already-started bounded request has a
known recorded result, every long-running agent invocation has stopped, no
shared integration resource or task-work-capacity permit remains held for the
task or a grouping-covered descendant, and their preserved responsibilities are
explicit. An unresolved request, unreadable authority, or covered descendant
still reaching its boundary keeps the selected parent task pausing with a
concrete progress reason. The paused phase creates no polling loop or periodic
authority read. Only a user resume request or a separately configured
observation policy causes new reads for the task.
_Avoid_: Task pausing, dependency-blocked task, run blocked

**Task resuming**:
The nonterminal state after the Dalph user requests resume and before Dalph
allows another forward-progress action for the task. Dalph freshly reads the
task, claim, applicable task-graph facts, Git resources, and task-work-provider
state required by the task's preserved responsibilities. Compatible facts
permit ordinary operation selection; changed or unreadable facts select the
applicable reconciliation, wait, or isolation rule instead of restarting stale
work. If resume is requested while pause actions remain in flight, Dalph first
settles those exact actions and derives a progress reason rather than cancelling
them or starting a competing worker.
_Avoid_: Task execution resumed, user-requested task pause removed, crash recovery

**Dependency-blocked task**:
A task that a fresh task-tracker read reports has at least one unsatisfied
prerequisite. It is not paused. Dalph automatically considers it for the
runnable frontier after a later task-tracker read reports no unsatisfied
prerequisite and every other eligibility rule is satisfied.
_Avoid_: User-requested task pause, persisted pause closure, grouping descendant

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

**Journal boundary decode issue**:
A typed fact that one physical journal row, normalized envelope, or immutable
versioned payload could not cross its Effect Schema boundary. Discovery retains
the row ordinal and the run identity when that identity itself decoded; it does
not discard other rows or convert the issue into an empty history.
_Avoid_: Invalid managed history, missing run, storage outage

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

**Reconstructed managed-run state**:
The validated process-local composition of reduced graph knowledge, workflow
history, resource responsibility, and pause state through one applied journal
position. It is derived from decoded journal events and is neither persisted
authority nor a runnable frontier.
_Avoid_: Serialized coordinator, reducer cache table, runnable frontier

**Named workflow wait**:
A derived reason that one exact responsibility has no immediately legal
transition, paired with the time, capacity release, graph update, authority
observation, or executor-declared signal that can make it actionable.
_Avoid_: Generic waiting status, unresolved request, task paused, branch-local isolation

**Invalid managed history**:
A preserved run whose individually decoded journal events contradict canonical
position, record-key, operation-identity, ownership, or workflow-transition
rules. Dalph accumulates the independent validation issues and does not resume
the run or rewrite its history.
_Avoid_: Journal boundary decode issue, provider reconciliation fact, repaired history

**Startup run recovery**:
The fail-closed process performed under coordinator ownership that discovers
every journaled run without an age cutoff, validates each complete managed
history, and freshly rereads the tracker, Git, executor, evidence, and reviewer
authorities for the exact recorded attempts before live coordination begins.
_Avoid_: Process rehydration, recent-run scan, journal replay alone

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

**Branch-local isolation**:
A recorded disposition preventing Dalph from acting on one exact task, attempt,
or resource region whose facts are invalid, unreadable, ambiguous, or unsafe.
It retains every still-owned responsibility until named repair or fresh
authority evidence permits action or authorizes exact relinquishment.
_Avoid_: Run blocked, global startup failure, discarded contradiction, workflow responsibility relinquished

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
