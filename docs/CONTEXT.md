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
attempt and reports only the attempt-level executing, safely suspended, or
terminal result required by generic orchestration. The production executor's
inner algorithm is post-milestone design.
_Avoid_: Dalph orchestrator, universal review pipeline

**Executor implementation**:
The opaque mechanism behind one Dalph executor. Generic Dalph neither observes
nor prescribes whether it uses one agent session, several sessions, review,
commits, provider sessions, or another algorithm.
_Avoid_: Production executor adapter as a generic algorithm, generic review
stage

**Operator**:
The one logical V1 human actor that intentionally applies a Pause or Unpause
direction, an exact Continue, Restart, or Stop choice for one changed attempt,
or a task-claim reacquisition direction, or requests graceful application Exit,
through Dalph. V1 records the actor class `Operator`, not an authenticated
person identity; a separately accepted transport request identity may identify
a redeliverable request without identifying the person. Authentication and
multiple operator identities require a separately accepted boundary design.
_Avoid_: Authenticated operator identity, claim owner, provider user

**Graceful application Exit request**:
An Operator or process supervisor's transport-neutral request that the running
Dalph application stop through its accepted lifecycle protocol.
_Avoid_: Effect scope closure, process death, Pause, Run termination

**Application lifecycle protocol**:
The process-wide contract that accepts a graceful application Exit request and
reports its completion, timeout, or failure outside every Run workflow journal.
_Avoid_: Run workflow, applied control direction, Effect scope finalization

**Graceful application Exit**:
The ordinary application-lifecycle outcome in which Dalph reaches its accepted
shutdown boundary, reports the result, and then requests process termination.
_Avoid_: Process disappearance, coordinator death, cancellation, Run termination

**Production-host-scoped Exit result**:
The exact `ApplicationExitResult` that Alice's production host receives after
the Exit admission cutoff and bounded drain. Registered process-local
quick-drain close operations run before the exact result: `Succeeded` proves
those operations closed their resources; `Failed` proves useful operations
settled with diagnostics, but not necessarily that every resource closed; and
`TimedOut` may leave unresolved resources for later host scope finalization.
The host reports the result and returns from its use callback; only then do
remaining host-scope finalizers close resources and release coordinator
ownership. A host-scoped `Succeeded` therefore describes the completed
bounded drain, not an already released coordinator lock, and this mode has no
process-end capability or event.
_Avoid_: Report lease, acknowledgement actor, process-end request, Run journal fact

**Exit admission cutoff**:
The process-wide point at which an accepted graceful application Exit request
prevents every later forward-progress admission while preserving earlier work.
_Avoid_: Pause application, proposal selection, process interruption

**Forward-progress owner**:
One process-local action that acquired permission before the Exit admission
cutoff and is still inside its exact tracker, Git, journal, evidence, cleanup,
executor-control, or already-authorized Run-termination boundary. Admission is
registered as one indivisible handoff so preparation cannot straddle the
cutoff. An interruptible owner may release after recording an already-produced
result or behind its acknowledged exact intent; an admitted atomic owner may
only finish its current boundary inside the original Exit drain.
_Avoid_: Tracker claim owner, durable workflow responsibility, replacement work

**Interruptible tracker or Git boundary state**:
The process-local phase of one admitted tracker or Git call after Dalph has
acknowledged its exact workflow intent. It distinguishes waiting for the named
outside family and `OperationId`, an already-produced result awaiting its
ordinary journal record, a recorded result, and a recoverable ambiguity after
the local wait was interrupted. It disappears with the owner and never replaces
the durable intent or the outside system's result authority.
_Avoid_: In-flight Boolean, persisted request state, inferred outside outcome,
Exit recovery mode

**Atomic integration Exit boundary**:
The one already-admitted delivery action currently inside an Integrator call or
reading/updating the target ref for promotion. If Exit closes admission while
that action is inside its boundary, the action may record its produced result
and release its process-local owner, but it cannot enter a successor delivery
action. The application drain limit may still force nonzero process termination;
restart uses the boundary family's existing journaled intent and ordinary
reconciliation protocol.
_Avoid_: Whole integration obligation, unbounded Integrator completion,
Exit-specific workflow recovery, durable integration lock

**Exit drain**:
The short, bounded application-lifecycle interval after the Exit admission
cutoff in which Dalph brings admitted work to a durably recoverable boundary.
_Avoid_: Work completion, durable-resource cleanup, Run stabilization

**Exit drain limit**:
The fixed V1 maximum of five seconds allowed for one Exit drain on macOS and
Linux, measured from its Exit admission cutoff without reset or extension.
_Avoid_: Supervisor force deadline, configurable timeout, per-request duration

**Application Exit drain duration**:
The finite-positive branded duration that materializes the Exit drain limit at
the application-lifecycle clock boundary. It measures Dalph's local drain only;
it is not a deadline for GitHub, Git, an executor session, or any other outside
authority.
_Avoid_: Remote request timeout, executor shutdown proof, configurable deadline

**Coordinator ownership observation interval**:
The finite-positive branded interval between local descriptor/path comparisons
while Dalph holds one OS-backed coordinator lock. V1 starts the next comparison
one second after the previous comparison completes; mutations still compare
synchronously before crossing their boundary. It is not a remote lease or
distributed fencing period.
_Avoid_: Tracker claim TTL, network timeout, distributed lock lease

**Exit drain failure**:
The conclusive application-lifecycle result that graceful Exit is impossible
after every remaining useful quick drain operation has settled.
_Avoid_: Exit timeout, executor failure, Run failure

**Forced application termination**:
The non-graceful application-lifecycle outcome in which Dalph ends its process
after an Exit drain failure or the Exit drain limit without claiming unresolved
work reached safety.
_Avoid_: Graceful application Exit, safe suspension, cancellation, Run termination

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

**Occurrence provenance boundary**:
When a workflow occurrence is decoded outside the process, its run, authority,
resource, and ordinal fields must agree within that occurrence. The projection
then requires the exact earlier initiating intent before presenting the
occurrence. Constructing a typed value alone is not evidence that the outside
action or result happened.
_Avoid_: Trusted projection input, copied actor, operation as outcome

**Production trace read**:
When Alice asks to inspect one Run, the presentation boundary calls the
read-only `TraceReader` over that Run's committed `JournalStore` prefix. The
reader validates the Run beginning, contiguous `JournalPosition`s, and explicit
causal links before returning history; it does not append journal records or
call a provider.
_Avoid_: Live workflow execution, provider refresh, mutable projection store

**Trace position identity**:
When the reader returns one projected occurrence at journal position 7 for Run
R, Alice receives the exact pair `(RunId R, JournalPosition 7)`. The same
schema is used for a historical cursor, a history item, and every relationship
that points at an occurrence; no presentation-local ordinal can replace it.
_Avoid_: Array index, story frame number, operation identity

**Graph at cursor**:
When Alice selects a committed cursor, the reader reconstructs the latest
complete task-tracker graph observation at or before that cursor through the
trace boundary. The graph is descriptive history fixed to that prefix; it is
not a current tracker fact and cannot include an observation recorded later.
_Avoid_: Current task graph, provider cache, cursor-independent snapshot

**Causal predecessor lookup**:
When Alice asks why one projected operation appears, the reader follows the
named predecessor `OperationId` relationship inside the validated Run prefix
and returns that predecessor's exact trace identity. An absent, duplicate, or
non-earlier predecessor is a failed read, not a fallback to the previous
journal record.
_Avoid_: Previous array item, inferred adjacency, operation selection

**Fixed-history/current-status composition**:
When Alice reconnects while watching a Run, presentation keeps the selected
historical trace cursor unchanged and reads a separate passive current-status
signal. The status boundary may reconnect or change without rewriting history,
appending a journal fact, or granting provider mutation capability.
_Avoid_: Live status persisted as history, status-derived cursor, workflow action

**Read-only trace source**:
When presentation reads a committed Run prefix, its source exposes only the
journal `read` boundary. Journal append/lifecycle operations and tracker, Git,
executor, and provider mutation capabilities remain outside the source and are
not recoverable through the trace view.
_Avoid_: Journal store, workflow coordinator, provider adapter

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

**Applied attempt choice**:
The initiated action established when Operator's exact Continue, Restart, or
Stop choice is accepted and applied to one exact pre-integration planned task
attempt and one earlier/current task-revision fingerprint pair. Receiving or
durably recording the request is not this event; the first valid choice
committed for that pair wins.
_Avoid_: Attempt-choice request receipt, executor result, replacement event

**Pause progress observation**:
Alice's process-local, current-first subscription to the derived progress of
one exact applied Run Pause or Task Pause. It reads current delivery and
live-action projections, performs no tracker, Git, executor, or journal call,
and ends when the Pause is confirmed, is no longer applied, or the subscriber
disconnects. A new process or subscriber derives a fresh result rather than
recovering an observer cursor.
_Avoid_: Persisted drain phase, workflow responsibility, polling loop, Pause command

**Pause progress view**:
One derived explanation of every outstanding responsibility covered by the
observed Pause, the exact responsibilities already at their ordinary safe
boundaries, and the exact boundary facts or live actions still preventing
confirmation. It is process-local descriptive state and never authority to
cancel, release, clean, resume, or retry work.
_Avoid_: Pausing state, confirmed-paused record, cleanup disposition, ETA

**Pause-covered responsibility**:
One exact outstanding workflow responsibility included by a Run Pause, by the
paused task itself, or by that task's descendants in the latest accepted
complete grouping graph. Coverage explains why the responsibility appears in
the view; it does not copy a Pause direction onto a grouping descendant.
_Avoid_: Paused task list, dependency coverage, persisted observer item

**Pause safe-boundary blocker**:
The exact executor correlation, workflow operation, integration resource,
promotion request, proposed action, or live action that currently prevents one
Pause-covered responsibility from being classified at its ordinary safe
boundary. A blocker belongs only to that correlated responsibility and cannot
be inferred from another obligation on the same ticket.
_Avoid_: Generic draining reason, ticket-level blocker, progress percentage

**Planned-attempt executor work**:
The injected executor implementation's complete course of work for one planned
task attempt.
Dalph begins a new attempt once. It may observe the current report, ask to
suspend, or receive the outcome without commanding executing work again. It
may resume only the same safely suspended attempt after an accepted rule
selects it. None of these boundaries reveals an internal stage. In v1, the
planned task attempt identifies this work at the generic executor boundary;
Dalph does not allocate a second outer-invocation identity. The injected
implementation's agents, reviewers, sessions, provider calls, commits, retries,
and other private stages are not part of this outer contract.
_Avoid_: Executor outer invocation, review stage, worker process, workflow
operation, repeated continuation command

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
The non-action occurrence established only when Dalph accepts a distinct
`ExecutorWorkExecuting`, `ExecutorWorkSafelySuspended`, or
`ExecutorWorkTerminal` lifecycle condition for one exact planned attempt. Its
monotonic ordinal orders distinct accepted conditions; it grants no command
permission and does not advance when a passive observation is unchanged.
_Avoid_: Executor action, command settlement, progress stage, completed tracker task

**Planned-attempt executor command response**:
The exact non-action occurrence that settles one journaled Begin, Resume, or
Suspend command at the executor boundary. The response may repeat the already
accepted lifecycle condition, so command settlement and lifecycle-report
acceptance are distinct evidence. For example, an executing response to a
Suspend command settles that command without appending another work report.
_Avoid_: Accepted lifecycle transition, report ordinal, continuation permission

**Planned-attempt executor-work correlation**:
The exact `RunId` and `AttemptId` of the planned task attempt that Dalph uses
across executor begin, passive report observation, safe suspension, accepted
same-attempt resume, and terminal outcome. An
internal `OperationId`, coding-agent invocation, reviewer invocation, provider
request, session, or worker process cannot replace or supplement this generic
correlation.
_Avoid_: Executor outer invocation identity, task identity alone, operation
identity, log correlation

**Task-work capacity requirement**:
The zero-or-one task-work position that Dalph says one workflow transition
needs. The executor does not request, acquire, declare, or release this
position. For example, Dalph requires one position before it begins or resumes
task A, retains it while A is executing, and requires none for a tracker-only
read.
_Avoid_: Executor-declared capacity, review capacity, operation-name capacity

**Fresh-task candidate**:
One graph-described task, with stable derived rank, that may be considered for
new work. It is not a delivery action proposal and grants no permission to
claim, read a focused specification, plan, prepare a worktree, or begin
executor work. Admission may later materialize its first exact proposal.
_Avoid_: Admitted task, bounded ticket as capability, queued action, proposal

**Fresh-task admission commitment**:
The one task-level capacity occupancy reconstructed after Dalph accepts the
exact `TaskClaimAcquisitionIntended` record and retained through claim,
post-claim graph, specification, plan, and worktree stages. It is neither a
second workflow responsibility nor a task-work position. The exact
executor-responsibility handoff atomically replaces it with the attempt-held
position; only a conclusive pre-ownership rejection can end it earlier.
_Avoid_: Persisted admission event, claim ownership, task-work position, queue token

**Fresh-task admission basis**:
The process-local result of one coherent evaluation of current graph
candidates, Run policy, Journal-derived commitments, exact held attempts,
existing ready responsibilities, and live entry reservations. It derives free
capacity and the deterministic next candidates; no basis, queue, or capacity
snapshot is persisted as authority.
_Avoid_: Durable scheduler snapshot, tracker frontier, stored queue, semaphore authority

**Initial control policy**:
The schema-decoded values Dalph evaluates and records only when Run
establishment finds no history for the exact Run. The current production slice
contains task-execution capacity only; existing history supplies its own
initial and latest policy, so establishment neither evaluates nor accepts a
replacement initial value.
_Avoid_: Eager startup default, restoration input, mutable coordinator settings

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
therefore make the task-work position available. The injected executor
produces this proof after Dalph asks it to stop for resume, such as during a
task pause, run pause, or safety stop. An agent, reviewer, session, or
worker-process interruption alone is an executor-internal fact and does not
prove suspension.
_Avoid_: Executor interruption, process exit alone, coordinator cancellation,
attempt abandonment

**Planned-attempt executor-work outcome**:
An executor's normalized completed, failed, or accepted result for one exact
planned task attempt. Suspension is separately resumable and therefore is not
a terminal outcome; an accepted result carries the immutable Git commit and
evidence defined below.
_Avoid_: Internal review result, raw provider response

**Planned-attempt executor-work projection**:
The injected executor's current normalized declaration that its complete work
for one exact `(RunId, AttemptId)` is executing, safely suspended, or terminal.
The implementation remains opaque. Observing is passive; it never begins or
resumes work. Starting or resuming is a distinct Dalph command, not another
persisted executor state, and a missing projection does not prove that the
responsibility is safe or terminal or authorize replacement.
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
One durable Dalph coordination instance for one Run root task. Its
history begins with one Run-beginning fact, may receive several bounded
activations, and closes with at most one Run-termination fact.
_Avoid_: Process, task, historical harness run

**Workflow Run beginning**:
The first durable workflow-journal fact for one Run. It associates a freshly
allocated Run identity with one exact Run root task and its initial
control policy. The Journal rejects a second beginning for that identity even
though application-level Run establishment is idempotent.
_Avoid_: UUID allocation, process start, restoration start

**Run establishment**:
The idempotent application decision that appends a Run beginning when the exact
Run has no history, or otherwise validates its complete history and
reconstructs the exact target, latest policy, and responsibilities. It is the
one entry to activation and is not selected by a fresh-versus-recovered caller
mode.
_Avoid_: Run creation, fresh initialization, recovery start

**Run activation**:
One bounded process-local invocation over an established Run. It reconstructs
admission from exact unfinished responsibilities, runs ordinary delivery and
reconciliation, and reaches at most one post-quiescence tracker
reconfirmation before returning or recording termination.
_Avoid_: Process lifetime, recovery activation, continuous coordinator loop

**Workflow Run termination**:
The final durable workflow-journal fact for one globally settled Run. In V1 it
classifies the result as `Completed`, `Blocked`, or `Cancelled` from one fresh
complete Run task graph and the absence of unsettled workflow responsibilities.
It closes that Run's history; a crash leaves the Run unterminated. `Failed`
requires a separately accepted conclusive Run-failure protocol and is not a V1
disposition.
_Avoid_: Executor terminal report, process exit, safe suspension

**Run cancellation**:
The Operator's durable direction to stop admitting forward work for one exact
Run and settle or durably relinquish all of its existing workflow
responsibilities. It begins with `RunCancellationApplied`; the request alone is
not the terminal result. V1 has no withdrawal command. After fresh
classification, all-success is `Completed`; otherwise settled cancellation is
`Cancelled`.
_Avoid_: Attempt Stop, Run Pause, application Exit, executor suspension,
`WorkflowRunTerminated(Cancelled)`

**Workflow-journal history**:
The ordered, decoded Dalph workflow-journal records for one exact `RunId`.
It contains only facts Dalph recorded about its workflow; Git history,
task-tracker history, executor-internal history, and process logs remain owned
by their respective systems.
_Avoid_: Run history, external-system history, current authority facts

**Journal partition**:
The durable storage provenance of one complete workflow-journal history:
`Hot` is the ordinary startup-discovery partition and `Cold` is the retained
partition for histories already proven terminal. A partition is not workflow
state: a Hot history may already contain a terminal record awaiting
maintenance, and Cold placement never proves current tracker, Git, or executor
authority.
_Avoid_: Run state, recovery eligibility, archive authority

**Terminal-history retirement**:
The one atomic maintenance operation that runs the canonical workflow-journal
reducer over a complete Hot history, requires a valid final
`WorkflowRunTerminated` occurrence, copies every persisted row to Cold, checks
the copied key, position, event kind, version, and payload bytes, and removes
the Hot rows in the same transaction. Repeating it over a valid Cold history
reports that history as already retired; contradictory Hot-and-Cold membership
and malformed history fail closed.
_Avoid_: Deleting old rows, inferred completion, asynchronous archive job

**Hot discovery and full journal audit**:
`scanHot` is the ordinary startup operation and considers only Hot histories
that may still require recovery validation. `auditAll` is the explicit
partition-aware diagnostic operation over both Hot and Cold, including retained
history and Cold decoding failures. Exact Run reads are transparent across the
two partitions but reject contradictory membership.
_Avoid_: Startup scan of every physical row, archive as authority, partial read

**Workflow-journal history reduction**:
The pure fold that validates one workflow-journal history, reconstructs its run
state, and derives its recovery frontier. It returns every history issue it can
establish instead of adopting, repairing, or discarding contradictory records.
_Avoid_: History validation alone, journal decoding, coordinator rehydration

**Reconstructed run state**:
The process-local composition of graph knowledge, outstanding workflow
responsibilities, latest control policy, applied pause directions, and
workflow-journal records for one `RunId`. Dalph derives it from
workflow-journal history; it is neither persisted authority nor a runnable
frontier.
_Avoid_: Managed run state, serialized coordinator, current external state

**Run recovery frontier**:
The process-local projection naming the next durable boundary, unresolved
boundary, or terminal attempt for every task represented by one reduced
workflow-journal history. Dalph does not persist this projection.
_Avoid_: Recovery stage, runnable frontier, persisted recovery state

**Run root task**:
The one task chosen when a Run begins. Each complete Run task graph read starts
from this task. The task tracker uses its native task locator at the boundary;
that locator is not a second task identity or a general query. A future Run
input that selects tasks without one root requires a separately accepted model.
_Avoid_: Task-tracker target, task query, Run task graph, arbitrary graph member

**Run task graph**:
The complete normalized graph produced by one accepted task-tracker read for a
Run root task. It contains the root task, every grouping descendant reached
downward from it, and every transitive supporting prerequisite. A task reached
only as a supporting prerequisite contributes its own prerequisites, but not
its grouping descendants. A later accepted read can produce a changed Run task
graph; the graph is not immutable Run input or persisted derived frontier state.
_Avoid_: Task-tracker target closure, initial closure, Run root task, delivery frontier

**Supporting prerequisite**:
A task that enters a Run task graph through a prerequisite edge rather than as
the Run root task or one of its grouping descendants. It is ordinary Run work
and contributes its transitive prerequisites. Its grouping descendants remain
outside the Run task graph unless a prerequisite edge also reaches them.
_Avoid_: Prerequisite-only task, observation-only blocker, grouping descendant

**Task-membership constraint**:
The task-local stop derived when a later complete task-tracker observation no
longer includes in the Run task graph a task for which Dalph still has an exact
workflow responsibility. Dalph preserves that responsibility for a later
activation, reconciliation, or disposition; the membership edit does not prove
cleanup, claim release, successful handoff, or a whole-run conflict.
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

**Authority/provenance semantics**:
Authority answers which outside system owns a fact; provenance answers which
accepted boundary result and causal journal history support Dalph's use of that
fact. A journaled intent proves that Dalph committed to ask an authority, while
only the matching observation or typed failure proves what that authority
returned. One system's observation never becomes another system's authority by
being copied into a derived view.
_Avoid_: Copied authority, inferred provider result, journal position as current fact

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
route, domain order evidence, and complete task-work, planned-attempt protocol,
or integration-resource requirements. Constructing, comparing, or observing a
proposal performs no action and acquires no process-local resource.
_Avoid_: Workflow occurrence, admitted action, runtime ownership

**Planned-attempt protocol guard**:
The process-local exclusion held while Dalph either records an executor command
intent or proves and records that the same exact Run and planned attempt may be
abandoned. It prevents those journal changes from passing each other. It is not
executor authority, a task-work capacity position, or a durable fact, and it
disappears with the process that owns it; restart relies on reconstructed
journal chronology instead.
_Avoid_: Task-work position, executor claim, durable attempt lock

**Delivery action planning**:
The process-local descriptive composition that combines current delivery
consequences with exact proposed-action requirements from tracker observation,
ticket delivery, settlement or integration, and tracker reflection into one
ordered proposal frontier. It performs no action, admits no resource, allocates
no identity, and owns no fiber.
_Avoid_: Delivery runtime relation, action execution, action controller

**Delivery live action ownership**:
The process-local owner, exact admission reservation, and scoped fiber for one
admitted delivery action proposal. It prevents a second start for that exact
proposal while the action runs and, after success, until an ordinary accepted
fact publication removes the proposal. It is discarded on process loss and is
never durable evidence that the boundary request did or did not happen.
_Avoid_: Workflow responsibility, accepted action result, persisted owner,
relation revision

**Delivery runtime observation**:
The process-local current signal that combines one coherent accepted delivery
evaluation with sanitized snapshots of its exact live action owners. It lets a
passive observer distinguish proposed, admitted, materialized, intent-recorded,
and settled action boundaries without exposing fibers, reservations, mutable
controllers, or new workflow authority. The bootstrap process owns its signal
across ordinary Run activations; process loss discards it.
_Avoid_: Delivery relation authority, persisted runtime state, workflow history

**Delivery status read**:
The passive Run- or task-scoped description derived from one current delivery
runtime observation. Its canonical entries distinguish dependency waits,
tracker-fact waits, task-work capacity waits, proposed actions, live actions,
accepted-fact publication waits, integration-target waits, unavailable or
conflicting evidence, settlements, and relinquishments. It may report that the
observation is not ready, that a task is absent from an established graph, or
that the observation is closed; it never calls a tracker, Git, executor, or
journal, mutates a controller, allocates a resource, or persists a status.
_Avoid_: Workflow authority, action command, live owner, persisted status,
history occurrence

**Run quiescence**:
The process-local condition for one Run in which no delivery action is currently
executable and no admitted delivery action is still running. It does not prove
that every task completed, every responsibility settled, the tracker graph was
freshly reconfirmed, the Run may terminate, or the coordinator process should
remain alive. A durably published exact terminal executor report that ends its
correlated planned-attempt executor-work responsibility may supply the
no-live-owner fact used by this condition. A distinct accepted terminal report
replaces an earlier safe-suspension report as the current lifecycle fact; an
Accepted outcome then follows ordinary integration admission, but the report
remains neither tracker completion nor replacement authority.
_Avoid_: Run completion, empty target, polling permission, finality proof

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
families to read, such as one task's complete blockers or one Run task graph.
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
inside the Run's current Run task graph.
_Avoid_: Claim request acknowledged, claimed task eligibility observed

**Rejected fresh-task claim constraint**:
The task-local constraint established when the tracker conclusively reports a
different exact active claim for one fresh-entry acquisition intent and Dalph
durably accepts that rejection. It ends that task's admission without changing
the foreign claim and prevents another acquisition while the constraint
remains. A later complete graph observation may wake one focused claim read,
but only a focused authoritative `UnclaimedTask` observation clears the
constraint.
_Avoid_: Provider failure, acquisition retry, graph-observed claim, foreign-claim cleanup

**Task-tracker mutation throttled**:
The typed boundary failure returned when the task tracker conclusively refuses
one acknowledged exact claim, completion-claim, completion, or cleanup mutation
because of provider throttling. It names the logical mutation and its existing
operation identity, and may retain safe decoded timing evidence for diagnosis;
it neither authorizes nor schedules another request. A later invocation must
first read the owning tracker facts under the existing protocol.
_Avoid_: Ambiguous mutation outcome, retry deadline, provider payload

**Explicit task-claim reacquisition authority**:
The durable authority linking one replacement task-claim acquisition intent to
one earlier applied Operator direction for that Run and task. The direction's
non-person `TaskClaimReacquisitionRequestId` coalesces exact transport
redelivery and remains available after a coordinator restart. The authority is
represented explicitly on the acquisition operation; an `OperationId`
spelling or an earlier claim token cannot imply it.
_Avoid_: Operation-ID prefix, stale claim token, automatic reacquisition

**Completion claim**:
The temporary task-tracker evidence that takes over workflow authorization
from one exact active task claim immediately before Dalph asks the task tracker
to mark the task complete. It binds the exact confirmed integration result,
current task revision, and supporting resolution evidence; its provider record
may coexist with the active-claim record until later authorized cleanup.
_Avoid_: Task claim, task completed successfully, Git branch

**Completion claim fingerprint**:
The bounded identity derived from one canonical encoding of every field in an
exact completion claim. It identifies evidence for comparison and cannot by
itself reconstruct or authorize the claim.
_Avoid_: Completion claim, claim token, task revision

**Completion-claim cleanup disposition**:
The recoverable, task-local removal of the two tracker records retained after
fresh focused task success. Dalph first confirms that the exact completion
claim still witnesses the cleanup, then records generic intent and confirms
release of the exact original active claim. It deletes the exact completion
claim only after a new marker read followed by a current active-record read
that proves the original claim remains absent. Marker absence is not finality:
after observing it, Dalph reads the current active record again, and only its
fresh absence permits deletion evidence and settlement. A mutation
acknowledgement is not an observation: after a lost response or restart, Dalph
rereads the exact remaining record before deciding whether any request is
still authorized. A missing original claim is acceptable only while the exact
completion claim remains; a recreated exact active claim is a premise
contradiction, while foreign, malformed, stale, or incomplete evidence
authorizes no deletion.
_Avoid_: Single-record claim deletion, acknowledged cleanup, reusable cleanup
approval, foreign-claim repair

**Planned task attempt**:
One immutable Dalph decision to try one exact task revision fingerprint in one
run from one exact Base SHA. It binds its attempt identity, branch ref,
worktree path, and executor locator before Dalph creates or discovers either
execution resource. Planning it does not prove that an external resource
exists or that executor work started.
_Avoid_: Plan, attempt plan, task, task work, retry counter

**Planned attempt replacement**:
The workflow event that atomically makes one exact pre-integration planned task
attempt no longer unsettled and records its one exact successor. It requires
the matching applied Restart choice, current executor quiescence evidence, the
fresh exact task and claim facts, the current ready old worktree with its
lineage proof, and the fresh target head. It preserves the old attempt's
immutable plan and resources; neither this event nor its Journal envelope
proves that the successor worktree exists or that executor work started.
_Avoid_: Attempt retry, worktree cleanup, executor restart, integration start

**Attempt-choice request identity**:
The non-person identity of one Operator request to Continue, Restart, or Stop
one exact pre-integration planned task attempt under one exact earlier/current
task-revision fingerprint pair. It coalesces exact request redelivery and
cannot identify another Run, task, attempt, fingerprint pair, or choice.
_Avoid_: Operator identity, attempt identity, operation identity, idempotency key

**Accepted result**:
The exact Git commit and content-addressed executor evidence manifest returned
after the executor's whole bounded workflow accepts one planned attempt. It
is executor-scoped language: downstream delivery does not continue to call the
commit "accepted." Instead, after the evidence qualifies, delivery derives an
integration-ready result from this historical executor outcome. It
does not imply review, select repository policy, prove integration lineage,
promote a ref, or complete the tracker task. An ordinary accepted result enters
one integration responsibility after its terminal report is recorded and
paired with the configured target. Historical journals written under the
former `StartOrContinue` protocol may contain a Restart choice before a late
accepted result. That vocabulary is historical documentation and proof
terminology only: the current journal schema does not decode it, and any
retained provisional journal requires an explicit offline migration before
use. Under issue #264,
a terminal choice cancels an admitted-but-unissued Resume, while a recorded
Resume intent or accepted executing report makes the choice unavailable.
_Avoid_: Completed task, integrated commit, promoted result

**Integration-ready result**:
The integration-facing projection of one exact executor Accepted result after
its commit and content-addressed acceptance evidence qualify for the configured
integration target. It is the input carried into integration; it is not a
second persisted result and does not mean that its commit has been merged,
verified, promoted, or reflected to the tracker.
_Avoid_: Accepted result outside the executor boundary, executed result,
integrated result, completed task

**Accepted-result evidence manifest**:
The executor-produced content-addressed envelope proving that one exact planned
attempt reported acceptance of one exact Git commit. Its immutable bytes do not
imply an internal review or repository-check stage and do not prove the later
Integrator result or Git promotion.
_Avoid_: Prepared candidate, review approval, promotion evidence

**Immutable evidence bytes**:
Evidence-store bytes whose content digest is their identity, so different bytes
necessarily have a different reference. “Immutable” describes that storage
property; Dalph has no corresponding mutable-evidence category.
_Avoid_: Editable evidence, current workspace state, review verdict

**Integration responsibility**:
The durable Dalph responsibility created after the exact accepted terminal
report is recorded and paired with the coordinator-selected repository/ref
target. Its workflow-journal position supplies its order; it is not a second
queue row or an integration-resource lease.
_Avoid_: Integration queue entry, target lock, accepted executor report

**Integration start**:
The durable initiated action that crosses one integration responsibility's
non-cancellable cutoff. It consumes the derived pre-integration cancellation
capability, but does not prove an Integrator result, Git qualification,
promotion, or tracker completion.
_Avoid_: Integration completed, target promoted, task completed

**Integration target resource**:
The process-local serialized right to act on one exact repository/ref target.
It is acquired before integration starts, released while the started
responsibility waits on tracker prerequisites, and recreated empty after
process restart. The journal never stores its ownership.
_Avoid_: Integration responsibility, durable lock, queue position

**Integrator**:
The injected boundary that owns one resumable integration session from merge
construction through repository checks and reports either a prepared candidate
or a conclusive unsuccessful result.
_Avoid_: Dalph executor, candidate agent, target-verification wrapper

**Integrator implementation**:
The opaque provider mechanism behind one Integrator. Its processes, turns,
checks, review, and technical retries are not Dalph workflow stages.
_Avoid_: Dalph executor implementation, generic integration algorithm

**Integration-agent run**:
One bounded request for the Integrator to advance an exact
integration session. Reconnecting to or observing that same work continues the
run; only another explicit request after a conclusive result begins another run.
_Avoid_: Codex turn, process invocation, technical retry, integration responsibility

**Integration session**:
One resumable integration-agent responsibility bound to a started integration
responsibility, its integration-ready result, one fixed expected target head, and a
persisted isolated candidate resource. At most one session for an accepted
result is unsettled; a superseded session may be followed by one bound to the
newly observed head. Its resource is distinct from the planned task worktree. A
conflict or process restart continues the existing identity. An invalid
reported object quarantines that identity; it does not
itself supersede the session or authorize a successor.
_Avoid_: Process invocation, retry attempt, worktree tip, candidate commit

**Integration-session supersession**:
The durable fact that one integration session's fixed expected target head is
stale, ending that session while preserving its candidate and isolated work as
evidence. It is not delivery settlement; it permits a successor session for
the same accepted result and newly observed target head.
_Avoid_: Integration-session settlement, retry, replacement session, delivery settlement

**Integration candidate**:
The first commit named by the integrator as prepared for this exact session
that Git proves has exactly two ordered direct parents: the fixed expected
target head first and the immutable integration-ready result second. A commit
that merely exists in the isolated resource, including its current HEAD, is not
selected implicitly. Git qualification does not repeat the Integrator's private
checks, update the target ref, or complete the tracker task.
_Avoid_: Worktree HEAD, agent success, promoted result

**Candidate prepared**:
The Integrator report naming the exact Git commit prepared for one integration
session. Dalph still asks Git to prove the reported commit; the report does not
mean that any target or separate integration branch was updated.
_Avoid_: Merged into target, pushed integration branch, inferred worktree HEAD,
free-form agent claim

**Candidate not prepared**:
The integrator's conclusive report that its exact integration-agent run ended
without naming a prepared candidate commit. Dalph records the report and
quarantines the session immediately. It preserves the isolated resource, does
not infer a candidate from Git state, and starts no automatic follow-up run;
Operator Retry may start one new run in the same session.
_Avoid_: Candidate failure inferred from process exit, automatic continuation,
empty candidate, worktree-HEAD submission

**Integration-agent run failure**:
The conclusive unsuccessful result of one exact Integrator run after its owned
activity is proven absent. Ambiguity, coordinator crash, or recoverable
application shutdown is not this result.
_Avoid_: Dalph crash, app-server disconnect, ambiguous response, automatic retry

**Integration shutdown recovery**:
Automatic restoration of an unfinished integration session after Dalph
deliberately interrupted its implementation activity for recoverable
application shutdown. On the next startup, ordinary delivery gives the same
session back to the integrator. A provider turn marked interrupted by that
shutdown is not a conclusive integration-agent run failure and does not
quarantine the session.
_Avoid_: Operator Retry, new integration-agent run, quarantine, Full rerun

**Target promotion request**:
The deterministic request that offers one exact Git-qualified prepared candidate M to one
repository/ref target by atomically replacing M's fixed first parent H. It
binds the prepared-candidate occurrence and required Integrator evidence.
Recovery reuses it; another operation identity cannot change H, M, the target,
or the evidence.
_Avoid_: Force update, target-head observation, candidate replacement, tracker completion

**Target promotion attempt intent**:
The durable numbered fact written immediately before Dalph may ask Git to
perform one target promotion request. A crash after this fact cannot prove
whether the request crossed Git, so recovery treats its ordinal as consumed
and reconciles before considering the next intent. The first intent requires a
current exact-H Git proof. After ambiguity, another intent requires Git to
report exact H again. One candidate permits at most three intents; Git reads
are not attempt intents.
_Avoid_: Retry loop iteration, Git read, promotion request identity, candidate attempt

**Promoted integration proof**:
The durable fact that Git either accepted the exact `H -> M` compare-and-set or
later proved M is the target head or its ancestor. It retains M's ordered
parents and required Integrator evidence. Equivalent content, a patch match,
or a journaled request without Git ancestry is not this proof.
_Avoid_: Candidate-prepared report, compare-and-set intent, target head alone, completed tracker task

**Integration success**:
The established condition that Git supplies a promoted integration proof and
current agent evidence proves that the exact integration session has no
running activity. It does not prove tracker completion or settle the retained
integration responsibility.
_Avoid_: Candidate submission, agent completion, promotion alone, tracker completion

**Integration quarantine**:
The durable disposition that stops automatic work for one exact integration
responsibility while preserving its integration-ready result, integration session,
candidate resource, and evidence for an Operator decision. It keeps its place
ahead of later responsibilities for the same integration target, but it does
not stop runnable delivery work that has no dependency or target conflict with
the quarantined responsibility. Its process-local target permit may be
released while its durable same-target ordering constraint remains.
_Avoid_: Cleanup, integration failure, delivery settlement, resource deletion

**Quarantined integration quiescence**:
The runtime condition in which a quarantined integration retains no live
integration worker, target permit, or session-specific polling. The Run remains
incomplete and its durable responsibility remains reconstructable. A later
Operator Retry or Full rerun direction changes Journal facts, after which
ordinary activation may select work again.
_Avoid_: Run completion, live quarantined worker, retained target permit,
background retry loop

**Integration Retry direction**:
The Operator direction that resumes one quarantined integration responsibility
through its same integration session and starts one new integration-agent run.
Once its direction choice is durable, ordinary recovery carries it out without
another Operator request. Before the agent call, Dalph checks that the
session's fixed target head is still current. A changed target starts no agent
run, records this Retry as not applicable, and establishes a fresh quarantine
occurrence from which the Operator may choose Full rerun.
_Avoid_: New integration session, automatic retry, Full rerun

**Integration-quarantine direction fingerprint**:
The stable subject for idempotent Operator redelivery, formed from the exact
integration session, the Journal position of its quarantine occurrence, and
the requested direction such as Retry or Full rerun. Unrelated Run changes do
not alter it. Internally Dalph retains the typed components; a transport may
hash their canonical encoding for an idempotency key. The Journal records the
applied direction and supplies deduplication after restart, so no process-local
cache or retry counter owns this fact.
_Avoid_: Whole-Run state hash, in-memory idempotency cache, retry counter,
integration-agent run identity

**Integration-quarantine direction choice**:
The first Journaled Retry or Full rerun direction for one exact quarantine
occurrence. That occurrence accepts exactly one choice. Exact redelivery of the
winning choice returns its recorded result; a competing direction for the same
occurrence is stale and starts no integration-agent run or replacement
session.
_Avoid_: Last-write-wins direction, two actions for one quarantine, UI-local choice

**Integration Full rerun direction**:
The Operator direction that gives one quarantined integration responsibility a
new integration session and candidate resource for its same accepted result.
It reads and qualifies the current target head before fixing the successor
session; it does not reuse the quarantined session's stale head merely because
the responsibility kept its queue position. Once the direction is durable,
ordinary recovery carries it out without another Operator request.
The integration responsibility retains its original derived queue position;
Full rerun does not re-enqueue it behind later work for the same target. The
quarantined predecessor remains available for later authorized cleanup.
_Avoid_: Retry, new integration responsibility, task re-execution, cleanup

**Cleanup authorization subject**:
The immutable, family-specific permission to dispose one exact durable resource.
It names the terminal disposition occurrence, locator, owner, last authority
observation and operation, provider evidence revision, cleanup operation
identity, and causal predecessors proving writers stopped or transferred. A
cleanup authorization is not reusable after its locator, owner, disposition,
revision, or writer fact changes.
_Avoid_: Generic cleanup stage, reusable delete approval, current quarantine,
resource discovery, inferred process age

**Worktree cleanup settlement**:
The terminal fact that one exact superseded or terminal planned-attempt
worktree is absent or was removed after fresh matching Git facts. It is the
precondition for authorizing deletion of that attempt's exact branch; it never
authorizes another worktree, branch, candidate, journal, or evidence resource.
_Avoid_: Branch deletion, attempt replacement, worktree reconciliation,
filesystem absence without a disposition

**Integrator predecessor-candidate cleanup settlement**:
The terminal fact that one quarantined FullRerun predecessor candidate resource
is absent or removed after fresh matching session, locator, revision, and
writer-quiescence facts. The successor candidate and predecessor history remain
outside this subject.
_Avoid_: Integration quarantine, successor-session creation, candidate
qualification, evidence deletion

**Non-convergent target promotion**:
The durable preservation disposition after three exact target-promotion
attempts remain unresolved and the final Git reconciliation does not establish
promotion or a different readable head. Dalph keeps M, its candidate resource,
session, accepted result, and Git-qualification evidence, releases its process-local
target position, and sends no fourth attempt.
_Avoid_: Failed task, discarded candidate, automatic replacement, unbounded retry

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
prepared candidate that Dalph has Git-qualified may be offered only by
compare-and-set against its exact expected target head. A stale exact head
selects session reconciliation; an ambiguous head requires a reread. Neither
decision authorizes a force update.
_Avoid_: Target overwrite, promotion result, integration start

**Task revision fingerprint**:
The opaque fingerprint of one task-work specification's exact normalized
tracker-authored title and body, bound to a planned task attempt. It excludes
lifecycle, dependency, grouping, membership, and claim facts. It is not a
version counter, release version, edit sequence, or historical revision chain.
It is distinct from the fingerprint of the complete task-graph observation.
_Avoid_: Task version, version number, tracker revision, Git commit, journal
position

**Active-work tracker refresh opportunity**:
A tracker notification or configured timer occurrence that lets Dalph check
current tracker and Git facts for exact attempts whose accepted report is
`ExecutorWorkExecuting`. It is not evidence that those facts changed,
permission to command the executor, a durable wake fact, or the later
post-quiescence read.
_Avoid_: Executor-progress read requirement, report coverage, per-executor poll,
second scheduler

**Active-task continuation read**:
A task-tracker read covering the authored task-work specification, lifecycle,
exact claim, target-closure membership, and complete blockers needed before
Dalph starts another long-running action for an existing attempt.
_Avoid_: Initial attempt eligibility, coding-agent progress poll, global refresh

**Planned-attempt continuation authorization**:
The generic durable workflow fact that permits Dalph to Resume one existing
planned-attempt executor responsibility after an accepted safe-suspension
report and current task graph, task-work specification, exact claim,
planned-worktree, and target-lineage observations are causally recorded. It
names the five exact read operation identities and planned `(RunId, AttemptId)`;
it does not allocate an attempt, create a recovery occurrence, or turn an
unaccepted projection into lifecycle authority.
_Avoid_: Recovery event, replacement-attempt permission, executor invocation,
volatile restart flag

**Executor work begin intent**:
The durable exact intent recorded before Dalph asks an executor to begin one
new planned attempt. While that attempt is executing, passive observation of
the same report creates no later begin or resume intent. A separate resume
intent is valid only for the same safely suspended attempt after its accepted
resume rule and current facts permit it.
_Avoid_: Continuation authorization, progress permission, observation request,
command budget

## Executor-internal policy

The generic orchestrator models only complete planned-attempt executor work and its executing, safely suspended, or terminal report. Review, retry, provider-session, handback, restoration, and convergence policy are not current Dalph domain concepts. Any future production executor algorithm requires new accepted operational scenarios and must remain behind this coarse boundary.
