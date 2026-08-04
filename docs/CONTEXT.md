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

**Dalph coordinator**:
The typed production actor that intentionally initiates Dalph workflow actions,
such as committing one exact tracker-read intent before asking the task tracker.
It is not a process identity, deployment, journal writer identity, or claim
owner.
_Avoid_: Coordinator process ID, Dalph orchestrator, claim owner

**Dalph executor**:
The Dalph component that performs the complete work for one planned task
attempt and reports only the attempt-level running, safely suspended, or
terminal result required by generic orchestration. The production executor's
inner algorithm is post-milestone design.
_Avoid_: Dalph orchestrator, universal review pipeline

**Operator**:
The one logical V1 human actor that intentionally applies a Pause, Unpause, or
task-claim reacquisition direction through Dalph. V1 records the actor class
`Operator`, not an authenticated person identity; a separately accepted
transport request identity may identify a redeliverable request without
identifying the person. Authentication and multiple operator identities
require a separately accepted boundary design.
_Avoid_: Authenticated operator identity, claim owner, provider user

**Workflow occurrence**:
One concrete happening relevant to a Dalph run. Constructing a command,
workflow operation, frontier transition, or test control does not prove that a
workflow occurrence happened.
_Avoid_: Workflow operation, command, proposal, journal record

**Initiated action**:
A past-tense workflow occurrence intentionally initiated by a typed production
actor. Its runtime value is classified as `InitiatedAction` and carries
`initiatedBy`.
_Avoid_: Requested action, constructed operation, actorless occurrence

**Non-action occurrence**:
A past-tense workflow occurrence that is not itself an action. Its runtime
value is classified as `NonActionOccurrence` and does not copy the actor from a
causally related initiated action.
_Avoid_: Uninitiated action, action outcome with copied actor

**Workflow event**:
The immutable production domain value representing one past-tense workflow
occurrence. Its concrete tagged type retains its specific name, exhaustive
initiation classification, and only the causal or evidence relationships that
production proves. A journal record is the durable envelope for an event, not
the event or outside happening itself.
_Avoid_: Journal record, command, proposed operation, physical occurrence

**Tracker-graph read initiated**:
The initiated action established when the Dalph coordinator commits one exact
tracker-read intent and owns its continuation. The constructed
`ReadTrackerGraph` operation alone does not establish this event.
_Avoid_: Tracker facts observed, tracker edit, operation selected

**Task-tracker facts observed**:
The non-action occurrence established when Dalph receives exact normalized
tracker evidence through one identified tracker-graph read action. It may
reference that earlier action by `OperationId`; its concrete evidence retains
coverage, freshness, target, revision, and journal position. It neither copies
the action's actor nor claims the read caused the tracker facts.
_Avoid_: Tracker edit, tracker read initiated, cached graph state

**Applied control direction**:
The initiated action established when Operator's Pause or Unpause direction is
accepted and applied to one exact run or task subject. Receiving or durably
recording a command request is not this event.
_Avoid_: Control command receipt, pause phase, operator identity

**Planned-attempt executor work**:
The selected executor's complete course of work for one planned task attempt.
Dalph may start, continue, ask to suspend, or receive the outcome of that work
without learning an internal stage. In v1, the planned task attempt identifies
this work at the generic executor boundary; Dalph does not allocate a second
outer-invocation identity. The controlled fake has no coding-agent, reviewer,
evidence, handback, retry, or restoration stages.
_Avoid_: Executor outer invocation, review stage, worker process, workflow
operation

**Planned-attempt executor-work responsibility began**:
The initiated action established when Dalph records its intent and assumes
responsibility for one exact planned attempt before asking the executor to work.
It does not prove that the executor accepted or started work.
_Avoid_: Executor work started, executor accepted work

**Planned work undertaken for a task**:
The task-level phenomenon established when Dalph assumes executor-work
responsibility for at least one planned attempt belonging to that task. It does
not prove that the executor accepted or started work, that the task tracker
closed the task, or that Git integrated the work.
_Avoid_: Executor work started, completed tracker task, integrated task

**Planned-attempt executor-work report**:
The non-action occurrence established when Dalph receives `Running`,
`SafelySuspended`, or `Terminal` for one exact planned attempt. It proves the
reported condition, not an executor-internal action or actor.
_Avoid_: Executor action, executor decision, completed tracker task

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

**Initial control policy**:
The schema-decoded values Dalph records with a fresh Run beginning. The current
production slice contains task-execution capacity only. Recovery accepts no
replacement initial value and reconstructs the latest durable Run control
policy.
_Avoid_: Process default during recovery, mutable coordinator settings

**Run control policy**:
The latest schema-decoded task-execution capacity and monotonic revision that
Dalph reconstructs from one Run's beginning plus later applied changes. It is
durable workflow-journal history, not the process-local task-position map.
_Avoid_: Persisted positions, process configuration, admission snapshot

**Applied task-work capacity**:
The initiated action established when Operator's capacity change is durably
appended for one Run policy revision. Receiving or decoding the request is not
this event. Existing task-work position holders continue; later admissions use
the new ceiling.
_Avoid_: Capacity command receipt, executor capacity, preemptive contraction

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

**Workflow Run beginning**:
The first durable workflow-journal fact for one Run. It associates a freshly
allocated Run identity with one exact task-tracker target and distinguishes a
fresh start from recovery.
_Avoid_: UUID allocation, process start, recovery start

**Workflow Run termination**:
The final durable workflow-journal fact for one normally completed Run. It
closes that Run's history; a crash leaves the Run unterminated.
_Avoid_: Executor terminal report, process exit, safe suspension

**Workflow-journal history**:
The ordered, decoded Dalph workflow-journal records for one exact `RunId`.
It contains only facts Dalph recorded about its workflow; Git history,
task-tracker history, executor-internal history, and process logs remain owned
by their respective systems.
_Avoid_: Run history, external-system history, current authority facts

**Workflow-journal history reduction**:
The pure fold that validates one workflow-journal history, reconstructs its run
state, and derives its recovery frontier. It returns every history issue it can
establish instead of adopting, repairing, or discarding contradictory records.
_Avoid_: History validation alone, journal decoding, coordinator rehydration

**Reconstructed run state**:
The process-local composition of graph knowledge, outstanding workflow
responsibilities, applied pause directions, and workflow-journal records for
one `RunId`. Dalph derives it from workflow-journal history; it is neither
persisted authority nor a runnable frontier.
_Avoid_: Managed run state, serialized coordinator, current external state

**Run recovery frontier**:
The process-local projection naming the next durable boundary, unresolved
boundary, or terminal attempt for every task represented by one reduced
workflow-journal history. Dalph does not persist this projection.
_Avoid_: Recovery stage, runnable frontier, persisted recovery state

**Run recovery activation**:
The application capability that reads a reconstructed run's current runnable
frontier and executes its recovered transitions through the ordinary
activation and capacity path.
_Avoid_: Managed activation, process restart, separate recovery scheduler

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

**Task-membership constraint**:
The task-local stop derived when a later complete task-tracker observation no
longer includes a task for which Dalph still has an exact workflow
responsibility. Dalph preserves that responsibility for a later activation,
reconciliation, or disposition; the membership edit does not prove cleanup,
claim release, successful handoff, or a whole-run conflict.
_Avoid_: Removed task, automatic cleanup, whole-run membership conflict

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
_Avoid_: Current task graph, provider response dump

**Task-tracker fact family**:
One named kind of normalized tracker fact with one coverage and freshness
meaning. A V1 complete graph observation contains exactly these five kinds:
task identities, task lifecycles, task prerequisites, parent groupings, and
target membership. “Family” does not mean a task grouping, compatibility
generation, provider response, or cache partition.

For example, suppose GitHub work item #11 “Ship CLI” is open, cannot start
until #10 “Build parser” finishes, sits under #5 “Release 1.0”, and belongs to
the repository or project Dalph is running. The five families answer five
separate questions: which work item this is, its current state, which other
work must finish first, which larger work item contains it, and whether it
belongs to the body of work Dalph is running. They are five kinds of answer
from one graph read, not five separate tracker reads.
_Avoid_: Family without naming the facts, provider field group, response page

**Complete task-tracker facts observation**:
The normalized result of one logical complete target-closure read. It contains
exactly one complete family for task identities, lifecycles, prerequisites,
parent grouping, and target membership. Every family names its subjects,
content identity, potentially mixed-time consistency, and the same read
operation as its freshness boundary. It excludes authored title and body,
claim records, provider pages, cursors, and raw responses.
_Avoid_: Membership-only observation, current task graph, atomic tracker snapshot

**Unchanged task-tracker facts reconfirmation**:
A compact later observation proving that a comparable complete read normalized
to unchanged content. It records current coverage and freshness for every
graph fact family and refers to an earlier full observation for the payload.
_Avoid_: Duplicate full payload, current tracker authority, no-op

**Task-tracker facts observed**:
The single immutable workflow-journal event family for normalized tracker facts
that satisfy a named observation contract. Complete graph reads, unchanged
graph reconfirmations, focused task-work specification reads, and sufficiently
evidenced mutation results may produce it. A mutation acknowledgement without
the required coverage, completeness, consistency, freshness, and replacement
evidence cannot stand in for an observation.
_Avoid_: Provider response dump, mutation acknowledgement, parallel graph event

**Best available durable graph knowledge**:
The reducer's reconstruction of usable task and edge facts from
`TaskTrackerFactsObserved` history. It may lag current tracker facts and changes
only by folding later facts with explicit coverage, completeness, consistency,
freshness, and replacement evidence.
_Avoid_: Current task graph, persisted frontier, tracker authority

**Delivery frontier**:
The process-local, evidence-bearing projection of each ticket's eligibility or
graph-owned reason for exclusion from delivery. It is derived from one current
complete task graph and does not include exact workflow responsibility,
process-local ownership, held positions, or integration resources.
_Avoid_: Runnable workflow transition, persisted frontier, admission result

**Bounded parallel tickets**:
The process-local desired tickets selected from one delivery frontier under the
current control policy. The selection may include a ticket that cannot yet
acquire a task-work position; it neither holds a position nor proves that an
action or workflow responsibility began.
_Avoid_: Admitted tasks, running attempts, capacity positions

**Ticket delivery**:
The process-local lifecycle relationship derived from desired ticket placement
and every exact outstanding workflow responsibility for that ticket. It can
describe a selected ticket before its first intent and can retain a ticket
after planned-attempt executor work ends while integration or another delivery
consequence remains outstanding. It is not persisted, is not proof that an
outside action occurred, and does not make the Dalph executor responsible for
claim acquisition, integration, cleanup, or tracker mutation.
_Avoid_: Planned-attempt executor-work responsibility, integration responsibility, durable delivery flag

**Delivery action proposal**:
A pure description of one exact next Dalph protocol action, its immutable
route, domain order evidence, and complete task-work or integration-resource
requirements. Constructing, comparing, or observing a proposal performs no
action and acquires no process-local resource.
_Avoid_: Workflow occurrence, admitted action, runtime ownership

**Delivery settlement**:
An established terminal delivery fact backed by the accepted integration and
exact resource-disposition protocols. A terminal executor report, accepted
result, constructed candidate, request acknowledgement, or tracker command is
not a delivery settlement.
_Avoid_: Executor completion, integration candidate, tracker completion request

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
_Avoid_: Potentially mixed-time task-graph read, invalid workflow-journal history, provider retry policy

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

**Explicit task-claim reacquisition authority**:
The durable authority linking one replacement task-claim acquisition intent to
one earlier applied Operator direction for that Run and task. The direction's
non-person `TaskClaimReacquisitionRequestId` coalesces exact transport
redelivery and remains available after a coordinator restart. The authority is
represented explicitly on the acquisition operation; an `OperationId`
spelling or an earlier claim token cannot imply it.
_Avoid_: Operation-ID prefix, stale claim token, automatic reacquisition

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

**Attempt-choice request identity**:
The non-person identity of one Operator request to continue or stop one exact
pre-integration planned task attempt. It coalesces exact request redelivery and
cannot identify another attempt or a different choice.
_Avoid_: Operator identity, attempt identity, operation identity, idempotency key

**Accepted result**:
The immutable Git commit returned by the executor after its whole bounded
workflow accepts one planned attempt. It does not select repository policy,
prove integration lineage, promote a ref, or complete the tracker task.
_Avoid_: Completed task, integrated commit, promoted result

**Integration responsibility**:
The durable Dalph responsibility created after the exact accepted terminal
report is recorded and paired with the coordinator-selected repository/ref
target. Its workflow-journal position supplies its order; it is not a second
queue row or an integration-resource lease.
_Avoid_: Integration queue entry, target lock, accepted executor report

**Integration start**:
The durable initiated action that crosses one integration responsibility's
non-cancellable cutoff. It consumes the derived pre-integration cancellation
capability, but does not prove candidate construction, verification, promotion,
or tracker completion.
_Avoid_: Integration completed, target promoted, task completed

**Integration target resource**:
The process-local serialized right to act on one exact repository/ref target.
It is acquired before integration starts, released while the started
responsibility waits on tracker prerequisites, and recreated empty after
process restart. The journal never stores its ownership.
_Avoid_: Integration responsibility, durable lock, queue position

**Integration session**:
The one resumable integration-agent responsibility bound to a started
integration responsibility, its accepted result, expected target head, and
persisted isolated candidate resource. That resource is distinct from the
planned task worktree. A conflict, process restart, or invalid submitted object
continues this identity; none authorizes a replacement session.
_Avoid_: Process invocation, retry attempt, worktree tip, candidate commit

**Integration candidate**:
The first explicitly submitted commit that Git proves has exactly two ordered
direct parents: the fixed expected target head first and the immutable accepted
result second. Construction does not verify the contents, update the target
ref, or complete the tracker task.
_Avoid_: Worktree HEAD, agent success, verified candidate, promoted result

**Pending candidate submission**:
One explicit candidate commit awaiting a readable Git object-type and parent
observation. An unreadable Git call preserves this submission for a later
reread without asking the integration agent to resubmit it.
_Avoid_: Missing object, invalid candidate, agent failure

**Non-convergent candidate construction**:
The durable disposition after either the separately selected positive
correction limit or automatic agent-continuation limit is exhausted in one
integration session. Dalph preserves the accepted result and isolated Git
work, leaves the task incomplete, and releases the process-local
integration-target resource for unrelated work. Production supplies both
limits explicitly; Dalph does not silently choose them.
_Avoid_: Failed task, discarded worktree, replacement session

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

**Attempt worktree lost**:
A read-only Git observation that the exact worktree previously prepared for
one immutable planned task attempt is no longer registered. It carries that
attempt's exact branch, path, Base, Run, and task identity through the plan.
Dalph records the observation, safely suspends running executor work, and
preserves the claim, plan, evidence, and remaining resources. It never
authorizes recreating or repairing the disappeared worktree.
_Avoid_: Missing fresh worktree, worktree reconciliation request, disposable
worktree

**Target lineage observation**:
Git's exact current integration-target head together with whether one planned
attempt's immutable Base is its ancestor. Compatible advancement leaves the
attempt unconstrained. A proven non-ancestral target rewrite creates a
task-local Git constraint and preserves independent task eligibility.
_Avoid_: Target version, Base equality check, integration completion

**Result commit qualification**:
The pure decision from Git's result-commit existence and ancestry facts.
Missing or non-descendant commits are rejected while the planned worktree,
claim, and evidence remain preserved. Qualification does not construct or
verify an integration candidate.
_Avoid_: Executor result, candidate verification, integration success

**Exact-head promotion decision**:
The pure authorization immediately before the concrete promotion protocol. A
verified candidate may be offered only by compare-and-set against its exact
expected target head. A stale exact head selects candidate reconciliation; an
ambiguous head requires a reread. Neither decision authorizes a force update.
_Avoid_: Target overwrite, promotion result, integration start

**Task revision fingerprint**:
The opaque fingerprint of one task-work specification's exact normalized
tracker-authored title and body, bound to a planned task attempt. It excludes
lifecycle, dependency, grouping, membership, and claim facts. It is not a
version counter, release version, edit sequence, or historical revision chain.
It is distinct from the fingerprint of the complete task-graph observation.
_Avoid_: Task version, version number, tracker revision, Git commit, journal
position

**Active-task continuation read**:
A task-tracker read covering the authored task-work specification, lifecycle,
exact claim, target-closure membership, and complete blockers needed before
Dalph starts another long-running action for an existing attempt.
_Avoid_: Initial attempt eligibility, coding-agent progress poll, global refresh

## Executor-internal policy

The generic orchestrator models only complete planned-attempt executor work and its running, safely suspended, or terminal report. Review, retry, provider-session, handback, restoration, and convergence policy are not current Dalph domain concepts. Any future production executor algorithm requires new accepted operational scenarios and must remain behind this coarse boundary.
