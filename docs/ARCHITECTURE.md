# Dalph Tooling Architecture

This document records stable architecture for Dalph repository tooling. It does
not define a target repository's rules, product runtime, authored content, or
application architecture.

Canonical boundary terminology lives in [CONTEXT.md](CONTEXT.md).

`runWorkflow` selects operations from Dalph's workflow algebra. The
`WorkflowInterpreter` is the injected Effect service whose methods execute
those selected operations at their named boundaries. An Effect Layer constructs
that service from real or simulated tracker, journal, Git, and executor
capabilities. “Interpreter” names this operation handler, not an
environment or runtime mode; one Layer may intentionally combine real behavior
at one boundary with simulated behavior at another.

## Workflow Commands, Actions, Occurrences, and Events

A command, request, available capability, frontier proposal, or constructed
workflow operation asks for or describes work that may happen. It is not a
past-tense fact. A workflow occurrence is a concrete happening relevant to a
run. An initiated action is an occurrence intentionally initiated by a typed
actor; a non-action occurrence is not itself an action even when an action
caused it, requested it, or caused Dalph to observe it.

A workflow event is the immutable production domain value representing one
past-tense occurrence. A journal event record is the durable storage envelope
for such a value and is neither the physical occurrence nor external authority.
Recording an operation intent, sending its request, receiving its boundary
result, and observing an authority fact remain distinct events when the
accepted protocol needs each fact.

Every production event type exposed to a generic consumer declares exactly one
runtime-visible classification in its originating tagged domain type:
`InitiatedAction` or `NonActionOccurrence`. An initiated action carries
`initiatedBy`; a non-action occurrence does not copy an actor from a causally
related action. Actor variants are usage-earned from accepted production
actions. V1 has one `Operator` and no authentication boundary or operator
identity. A new actor or event variant must make every exhaustive production
projection and generic consumer fail typechecking until handled.

The schema-versioned `WorkflowOccurrenceProjection` currently exposes tracker
read actions and observations, planned-attempt executor-work responsibilities
and reports, and the `AppliedControlDirection` contract consumed by the later
control implementation. A tracker observation names its exact initiating read
by `OperationId`. An executor report names its exact planned attempt and
requires an earlier same-run responsibility-began action. Decoding uses
same-run indexes to require exactly one matching earlier action; production
journal projection fails with a typed error when the required action is
absent. Tracker observations and executor reports contain no `initiatedBy`.
Other journal intents and outcomes remain outside this generic projection
until accepted scenarios establish their concrete event semantics.

Concrete event types retain their exact domain names and their usage-shaped
origin, causal-predecessor, authority-evidence, observation-evidence, freshness,
coverage, and journal-position relationships. Those facts do not become a
generic source or provenance category. An observation references an originating
action only when production evidence establishes that relationship; reduction
must reject a mismatched relationship instead of fabricating it.

A presentation may map the two generic occurrence classifications and
usage-earned actor variants to visual treatment. It must not maintain an
operation-name, event-name, transition-name, button-label, Lab-source, or test-
source map that independently decides semantics. Synthetic unsupported input
fails the production type boundary rather than becoming another occurrence
category.

A dying coordinator cannot record its own death. The workflow journal contains
no synthetic coordinator-crash event, and startup recovery reconstructs every
retained prefix without requiring or inferring one. A future production value
may represent that non-action occurrence only when an accepted external
process-lifecycle boundary truthfully reports it; a Quint action, conformance
control, missing journal row, or prototype control is not that evidence.

## Historical-Harness Boundary

The Dalph orchestrator is graph-native repository tooling designed independently
of `scripts/ralph-run.sh`. That script is a one-off historical harness, not
Dalph's architecture, compatibility baseline, migration source, fallback
scheduler, or runtime foundation. The
historical harness may supply candidate tooling requirements, failure evidence,
and design lessons. A candidate becomes an accepted tooling requirement only
when a named decision or implementation specification explicitly accepts it.

The Dalph orchestrator must not invoke, wrap, resume, migrate, or preserve
behavioral parity with the historical harness. Dalph ignores identities and
records created by that harness. Dalph reads task claims from the configured
task tracker, creates planned task attempts, invokes the planned-attempt
executor boundary, and records workflow history in the Dalph workflow journal.

## Exclusive Coordinator Lock

At most one live Dalph coordinator may send state-changing requests for a
canonical Git common directory. It proves exclusivity by holding an
operating-system lock on that directory. Closing the Effect Layer scope or
ending the coordinator process releases the lock. A competing coordinator fails
before sending a state-changing request.

Requested path aliases pass through the same canonical-path resolution code
before either the deterministic-test or production lock implementation checks
the resulting locator.

Before Dalph sends a live request that may change task-tracker or Git state for
this Git common directory, the coordinator verifies that it still holds the
directory lock. If the locked descriptor and canonical
path identify different directories, Dalph interrupts an in-flight request and
rejects later requests. The descriptor locks the existing Git common directory
itself, so replacing a child lock file cannot create a competing lock. A durable
row, stale-file timeout, TTL lease, in-process semaphore, and journal record are
not substitutes. Dry-run remains read-only and does not acquire the lock.

The native lock request is non-blocking and is never retried. Acquisition also
performs one canonical-path resolution, open, and stat, whose latency belongs to
the supported local filesystem. Before every state-changing request, the
coordinator synchronously performs one descriptor/path stat pair. While the lock
is held, the background check starts its next stat pair one second after the
preceding observation completes. On a responsive local host contradiction
detection is therefore nominally about one second, not a strict wall-clock
deadline; active state-changing requests add their own checks. This lock-check
cadence is independent of task-graph refresh and task-tracker API latency.

The production lock accepts local filesystem paths that `realpath` can
canonicalize, including symbolic links, `.` and `..` segments, and filesystem
case normalization when the host canonicalizes case aliases. Network
filesystems and distinct bind-mount aliases require separately specified lock
behavior before production use; local-path tests do not prove distributed lock
behavior.

## Durability and Reconstruction

Dalph persists only the workflow history it records in the Dalph workflow
journal. It does not make an in-memory coordinator object durable or persist
copies of current task-tracker, Git, or executor state so that coordination
can continue from those copies after restart.

After restart and while holding coordinator ownership, Dalph scans every
physical journal row and discovers every recoverable run without an age cutoff.
It validates each run's complete event history in position order before it
rereads current task and claim state from the tracker, refs and exact worktrees
from Git, and other current authority facts required by the accepted boundary.
It derives new in-memory
coordination and presentation state from those reads. A restarted process must
not treat a pre-crash queue buffer, capacity reservation, timer instance,
frontier, presentation cursor, or projection as proof that work occurred.

During the production-shaped fake-executor milestone, Dalph and the controlled
fake executor share one process lifetime. A Dalph crash therefore stops the
fake executor too, and restart does not search for surviving fake executor
activity. Independently surviving production executor work is post-milestone
design and must not be inferred from the current experimental process code.

Discovery accumulates independent physical-row, envelope, payload, identity,
ownership, semantic-history, and reconciliation issues. A row that cannot be
decoded does not hide another row or become an empty history. Any run with a
boundary issue or invalid workflow-journal history remains preserved and is not resumed;
ambiguous external resources likewise remain untouched for operator repair.
Startup fails closed after collecting the available issues rather than allowing
one unreadable authority to hide another authority's reconciliation fact.

Manual mutation of journal storage is outside Dalph's supported threat model:
the journal provides no cryptographic tamper resistance and Dalph does not
repair manually altered history. Crash-consistent append, process death,
storage reopening, decoding, and semantic validation remain supported.
Whenever startup encounters invalid physical or semantic history, it preserves
the evidence and fails the affected run closed.

Journal storage, decoding, and reduction are separate boundaries. The
reconstruction workflow reads each run's physical rows once in canonical
position order, decodes them, then passes the resulting event values
through one pure composed reducer. Its graph-knowledge, workflow-history,
resource-responsibility, and pause reducers neither read the journal nor invoke
any other effect. They update distinct component states for each event, after
which the composition validates cross-component invariants and returns one
`ReconstructedRunState`.

One decoded journal event may update more than one component reducer without
merging their state models. One completed logical tracker read appends one
`TaskTrackerFactsObserved` event. A complete graph read records identities,
lifecycles, prerequisites, grouping, and membership with per-family subjects,
coverage, completeness, consistency, freshness, and content identity. A later
comparable unchanged read records the same current evidence compactly and
refers to the earlier full payload. Mutation acknowledgements update workflow
history only; they never become graph observations.

The live process may retain that derived state together with its last applied
`JournalPosition` and incrementally apply later decoded events. This is only a
process-local optimization: it is discarded on process loss, never persisted
as journal authority, and never substitutes for reading and validating the
complete history during restart.

For each valid run, reduction preserves graph knowledge, workflow history,
pause state, and every exact outstanding responsibility. A pure selector derives
one non-persisted runnable frontier from those facts. The
frontier may contain multiple independently legal transitions for one task
attempt and carries a typed wait, pause, isolation, relinquishment, or settled
reason for each responsibility with no legal transition. A pre-attempt subject
that cannot reconstruct a safe claim or plan fails closed instead of being
mistaken for settled work.

Dalph consumes every independently valid part of the reconstructed run. A
contradiction, unreadable authority, ambiguous resource, or loss of
responsibility isolates only the exact task, attempt, or resource region whose
facts are needed to act there. Unaffected branches continue whenever their next
actions require none of the isolated facts or resources. A condition stops the
whole run only when it invalidates shared workflow-journal history or a shared capability
required for every otherwise allowed continuation.

Workflow responsibility is tracked per exact subject rather than as one flag
for a planned task attempt. Losing permission to change a tracker task may
relinquish that task-coordination responsibility while Dalph retains separate
obligations to preserve, stop, reconcile, or dispose the attempt's worktree and
executor work. Each responsibility ends only through its own completed
disposition or a durable relinquishment backed by a fresh authority
observation.

If a fresh tracker read finds that a task changed during implementation, Dalph
updates graph knowledge and prevents that branch from crossing another
state-changing boundary while preserving its outstanding executor and resource
responsibilities. The pause rules decide how already-started work reaches a
safe boundary. Unpausing alone never reconciles changed task intent.

## Pause, Unpause, and Resumption

A user-requested task pause does not cancel a bounded state-changing request
that Dalph already sent for that task. The request may be a quick local Git call
or a slower task-tracker or executor call. The pause
coordinator waits only under that operation's accepted bounded policy, records
its outcome through the request's existing workflow operation, and selects no
later forward-progress operation for the paused task. This wait needs no
separate pause-specific workflow event: the original request intent and outcome
remain explicit in the Dalph workflow journal. A coordinator interruption,
timeout, or uncertain request outcome uses the request's ordinary
fresh-result-check and recovery rules.

An ordinary user-requested task pause preserves the task's exact claim, planned
task attempt, worktree, and unfinished executor work. The pause does
not authorize claim release, resource cleanup, abandonment, cancellation, or
handoff. Those actions require their own accepted user command and disposition
rules.

A user-requested run pause is one run-level state, not a batch of
user-requested task pauses. It prevents selection of new forward-progress
operations across the run while each already-started task action reaches the
same boundary it would use for a task pause. Unpausing the run removes only the
run-level state; any independently requested task pause remains in force.

The control surface records four distinct durable commands in the run's
workflow journal before selecting any resulting boundary action: request run
pause, request run unpause, request task pause, and request task unpause. They
set the requested direction for one exact pause subject; they are not reference
counts. Repeating Pause does not stack another pause or require another
Unpause.
Each carries a branded `ControlCommandId`; an exact identity-and-payload
delivery retry is idempotent, while reusing the identity for a different command
is a typed contradiction. A later command with a new identity may change the
requested direction without cancelling an already-started safety action.

Issue #155 reconsiders the preceding receipt-durability protocol. A control
request that disappears before Dalph applies its direction may be lost. The
replacement design must retain enough durable evidence to reconstruct an
applied Pause or Unpause direction without treating receipt alone as applied;
command-id allocation remains undecided. Issues #134 and #135 do not consume
the provisional receipt protocol until that decision closes.

The pause reducer maintains run pause and per-task pause phases independently
from tracker lifecycle, task claims, workflow stages, and resource
responsibilities. Operation selection composes those facts instead of encoding
their Cartesian product as one task-status enum. A pause request therefore does
not acquire a missing claim, release an existing claim, or replace either claim
fact; an unclaimed task can remain paused.

The current journal records user Pause and Unpause commands, not `Pausing` or `Paused`
status updates. The pure pause reducer derives each phase and its tagged
progress reason from those commands, ordinary workflow outcomes, current
grouping coverage, and outstanding responsibilities. A task pause remains
pausing while any covered grouping descendant is still reaching a safe
boundary; the derived parent reason identifies each preventing descendant.

Every task pause is scoped to one exact `(RunId, TaskId)` pair. A terminated run
never reopens, and a later run that observes the same tracker task does not
inherit the earlier run's pause. Restarting a coordinator for a nonterminal
paused run reconstructs that same run and pause from its journal, then remains
passive until Unpause. A new run and an unpaused run both read current
tracker facts; neither restores a saved task graph.

A task pause covers the selected task and every task reached by following
tracker-owned grouping edges from parent to transitive descendant. Only the
selected task receives an explicit user pause command. Operation selection
derives descendant coverage from current graph knowledge; it does not write
pause state to each child or persist the resolved closure. A newly grouped
descendant becomes covered, and a task moved outside that grouping closure
stops being covered. The rule does not synthesize prerequisite edges: grouping
descendants do not wait for parent completion, and pausing a child does not
cover its ancestor or siblings.

Prerequisite edges retain their ordinary tracker meaning. Pausing task `B` does
not pause a prerequisite of `B` or a task that depends on `B`. A prerequisite,
including one shared with another branch, remains independently runnable. A
task whose prerequisite path reaches unfinished `B` is simply
dependency-blocked and becomes eligible automatically after fresh tracker facts
show its prerequisites satisfied. In the edge direction, the prerequisite
blocks the dependent; pause never reverses that edge or persists its transitive
dependent closure.

The generic Dalph orchestrator sees only the executor's complete work for one
exact planned task attempt, identified by that attempt's `RunId` and
`AttemptId`; it does not allocate a separate outer-invocation identity. When
pause requires admitted work to stop, Dalph asks the executor to bring that
complete planned attempt to a safe resumable stop. The executor reports the
attempt suspended only after no executor-owned activity for it remains running
and it has preserved what is required to resume. Dalph may then make the
task-work position available and later resume the same planned attempt.

How a production executor reaches safe suspension is future executor-internal
design. The milestone exposes no internal stages.

Pause never selects a not-yet-started cleanup or disposition action. If an exact
cleanup request already crossed its boundary, the request follows the same
bounded completion and uncertain-outcome reconciliation rule as every other
state-changing request; Dalph records the known result and selects no later
cleanup step for the paused subject. Pause does not reverse cleanup that already
completed. Concrete cleanup resources and their exact disposition protocols
remain owned by their implementation specifications rather than being invented
by pause semantics.

If a task already holds the serialized integration resource when its pause is
requested, it remains `TaskPausing` while the accepted integration protocol
finishes or reconciles that already-authorized attempt to a known state where
the shared resource can be released. Dalph does not interrupt the protocol,
automatically roll back Git, or hold integration exclusivity for the duration
of the pause. If the pause request is recorded before integration acquires the
shared resource, Dalph does not begin that integration attempt. A future
cancel-integration policy is a separate command and does not change pause
semantics.

A user Unpause request moves a task into `TaskResuming`; it does not directly
resume executor work. Dalph freshly rereads the exact task, claim, applicable
dependency and grouping facts, Git resources, and other accepted
provider-neutral facts needed by the task's preserved responsibilities. Only
compatible observations
allow ordinary operation selection. Edited, completed, closed, newly blocked,
newly unblocked, foreign-claimed, unreadable, or target-closure-removed tasks
enter their accepted reconciliation, wait, disposition, or isolation rule
without stale task work restarting.

If the user requests Unpause while a task is still pausing, Dalph records the
new requested destination but does not cancel the already-requested safe
suspension or start competing executor work. It waits for the complete-attempt
suspension result, then performs the ordinary resuming reads.

Pause handling does not select a replacement task. An admitted task keeps its
one position while Dalph asks the executor to bring the complete planned
attempt to a safe resumable stop. Only the executor's complete-attempt
suspension result makes that position available. Preserving a worktree or
safe executor suspension does not itself consume capacity. After Unpause, the same
planned attempt must be admitted again before executor work resumes.

A confirmed task or run pause is passive. Pause state by itself schedules no
polling, heartbeat, timer, or periodic tracker, Git, or executor read. The
workflow journal preserves the pause and outstanding
responsibilities. A user Unpause request triggers the required fresh reads; a
separately accepted observation policy may also read paused subjects without
authorizing forward progress.

See [ADR 0008](adr/0008-derive-run-scoped-pause-state.md).

## Frontier Derivation, Scheduling, and Capacity

Dalph first reconstructs usable graph knowledge, workflow history, per-subject
responsibility, and pause state. A pure derivation then returns the runnable
frontier: every workflow transition those facts and accepted policy currently
allow before applying task-work capacity. The derivation does not read the task
tracker, journal, Git, or executor and does not change when an
interpreter simulates a boundary.

The default tracker observation assembles the complete bounded task-tracker
target closure. A smaller named read shape may support a focused decision only
when its declared coverage completely proves the task's lifecycle, target
closure membership, complete prerequisite set, and every prerequisite
lifecycle needed by that decision. Missing, incomplete, or incomparable facts
never prove that a blocker is absent. They make only transitions that depend on
those facts unavailable; unrelated transitions derived from usable knowledge
continue.

Successful normalized facts from a completed tracker read update graph
knowledge through `TaskTrackerFactsObserved`. Completing task `A` therefore
does not imperatively enqueue dependents `B` and `C`, advance their execution
stages, or persist a downstream queue. A mutation response alone cannot release
them. A later journaled read must observe `A`'s completed lifecycle; only then
does frontier derivation decide whether the downstream region is runnable.

The scheduler chooses a process-local admission set from the runnable frontier.
It first admits ready transitions for tasks where Dalph already has workflow
responsibility. Those tasks are ordered by the earliest journal position that
began any of the task's still-outstanding responsibilities needed by its ready
transition, then by normalized `TaskId`. Fresh tasks follow in ascending
normalized `TaskId` order. The scheduler admits no more capacity-requiring
transitions than fit the currently available task admission positions. Tracker
enumeration order, hash-map iteration, ambient randomness, and a persisted
scheduling cursor never participate.

This ordering is deterministic for the exact reconstructed state presented to
one scheduling decision. Executor completion order, tracker edits, boundary
response timing, and capacity-release timing remain externally determined and
may change the state presented to the next decision. Dalph records those
observations in their actual order and does not delay work or reorder history to
manufacture the same global execution sequence across runs.

For a fresh task, scheduler choice is uncommitted until Dalph appends the exact
first ambiguity-crossing operation intent, normally
`TaskClaimAcquisitionIntended`. Dalph records no standalone durable
task-selection event. A crash before that append leaves no responsibility and
recomputes the choice from fresh facts. A crash afterward reconstructs
responsibility for that exact operation and follows its reconcile-before-retry
protocol before considering fresh work.

One process-local controller supplies the configured task admission positions
to ordinary and resumed work. Its key is `TaskId`, so one task can hold at most
one position. Dalph decides whether the selected workflow transition requires
zero or one position; the executor does not request, declare, acquire, or
release it. For example, continuing task A through the executor requires one
position, while reading task A from GitHub requires none.

Fresh coordinator creation receives one schema-decoded `InitialControlPolicy`.
The current policy contains task-execution capacity and is passed to the one
process-local admission controller. There is no production live-capacity
change in this slice; a cassette cannot mutate the controller on production's
behalf.

The production fresh-workflow entry point accepts only an
`AllocatedFreshWorkflowRunId` minted by the cryptographic fresh-run allocator.
Recovered activation derives its existing `RunId` from journal authority.
Dry-run and deterministic tests use a separately named synthetic entry point,
so a reused fixture identity cannot enter the durable fresh-run path.

A task position is reserved before Dalph starts executor work for one planned
attempt. After start, the position is correlated by that attempt's `RunId` and
`AttemptId` and remains occupied until the executor returns a terminal result
for the complete attempt or proves it safely suspended. No executor-internal
operation or executor report can change generic capacity directly.

Reconstruction validates that durable history identifies at most one
unfinished planned-attempt executor responsibility for each task before
deriving a frontier. Two are invalid workflow-journal history, not two controller
positions and not an ordinary identity mismatch.

Pure derivation, reducer execution, bounded journal appends, tracker and Git
reads, cleanup, and integration do not consume task-work capacity. Cleanup
follows its exact disposition protocol, and
integration uses its separately serialized resource. A paused branch, a branch
waiting on an external condition after its current bounded action settles, a
disposed or isolated branch, and a branch whose complete planned-attempt
executor work terminated hold no admission position merely because their
responsibility or recoverable resources remain.

Creating one exact task claim record is the exception for its already-committed
fresh task: retryable GitHub failures reuse the same operation identity under
the selected bounded retry policy and retain the reserved admission position
between attempts. Exhausting retries for a shared GitHub failure, or encountering
an authentication or invalid repository-configuration problem, stops fresh
admission and fails the run after already-started work reaches its defined safe
boundary. A confirmed task-specific conflict, such as a current claim owned by
another owner, leaves that task alone, releases the position, and permits an
unrelated task to be selected.

When no position is available, capacity waiting is derived from the runnable
frontier and controller state. It is exposed with its reason but does not append
a waiting event, queue entry, capacity reservation, or presentation rollup to
the workflow journal. Releasing a position or changing relevant reconstructed
state wakes scheduling. After process loss, Dalph discards the old controller,
reconstructs responsibility, freshly reads the applicable external boundaries,
and derives new positions and waits.

Every workflow wait names both the exact condition preventing the next
transition and the event or observation that can make that transition legal.
Current reasons include task-work capacity, an unfinished dependency, and an
occupied integration resource; the list remains extensible by
executor-declared protocols. A request that Dalph can reconcile immediately is
unresolved rather than waiting. Pause and branch-local isolation also remain
separate from waiting.

Branch-local isolation is a reversible safety boundary: Dalph forbids action on
the exact affected region while retaining every still-owned responsibility and
names the repair or fresh authority evidence that can permit progress.
Responsibility relinquishment instead durably ends one exact obligation after
fresh authority evidence or an authorized handoff proves Dalph may no longer
act. Relinquishment has no wake condition; other responsibilities for the same
attempt may continue or remain isolated.

One unavailable branch blocks another only when the second branch's next action
concretely requires its unfinished prerequisite, an integration resource it
already holds, the whole run is paused, or shared workflow-journal history or capability
is invalid. A paused, capacity-waiting, disposed, isolated, foreign-claimed, or
responsibility-relinquished task does not create a generic whole-run blocker.
An empty runnable frontier proves only that no transition is currently allowed;
run completion still requires a fresh tracker observation proving every task in
the live target closure completed successfully and all Dalph-owned work and
resources settled.

### Acceptance examples

With task-work capacity one and equally runnable fresh tasks `A` and `B`, the
frontier contains both tasks and the admission set contains only `A`. Dalph
reserves the position for `A` and appends only `A`'s exact claim intent. If the
coordinator dies before that append, restart rereads the tracker and recomputes
both uncommitted choices. If it dies after the append but before learning
whether GitHub created `A`'s claim record, restart reconstructs responsibility
only for `A`, checks GitHub for that exact owner and token, and leaves `B`
unselected. Observing both tasks therefore neither selects both nor creates
responsibility for both.

If responsible task `A` is paused after the executor reports its complete
planned attempt safely suspended, it retains its claim and recoverable
resources but holds no admission position. Fresh task `B` may use the sole
position. A later Unpause request triggers `A`'s required fresh reads while `B`
continues. If `A` becomes ready before `B` finishes, it derives capacity
waiting without a journal event. When `B` releases the position, `A` is
admitted before fresh task `C`; if `A` is paused, blocked, or isolated instead,
`C` may proceed.

See [ADR 0009](adr/0009-separate-frontier-from-bounded-admission.md).

Ordinary coordination and startup recovery invoke the same pure transition
selector after every recorded result. An already-recorded unresolved operation
keeps its operation identity and uses its existing reconciliation protocol.
The activation continues every immediately legal independent transition until
only named waits, pauses, isolations, relinquished or settled
responsibilities, subject-specific final outcomes, or typed issues remain. A
journal append alone is not a reason to return.

| State or record | Where current state is read | Restart treatment |
| --- | --- | --- |
| Dalph-recorded workflow intents and observed outcomes | Read from the durable JournalStore in canonical `JournalPosition` order within one `RunId` | Reopen the journal and apply the unresolved-request reconciliation rules to each intent missing a recorded outcome before retrying |
| Task identity, lifecycle, dependencies, grouping, and claims | Read through the configured task tracker | Reread every task in the task-tracker target closure and derive current eligibility instead of restoring a stored frontier |
| Git lineage, refs, commits, worktrees, and integration state | Read from Git | Reread the exact resource locators recorded in the planned task attempt and compare them with journaled intents before continuing |
| Unfinished planned-attempt executor work | Reconstructed from durable history for its exact `(RunId, AttemptId)` | Recreate the same-process controlled fake and continue the same planned attempt when capacity permits; do not search for surviving fake activity |
| In-memory queue buffers, wakeup signals, semaphore instances, permit holdings, fake-executor instance, and timer instances | Available only in the live Dalph process | Discard them on process loss and recreate them from accepted configuration, journaled workflow history, and fresh task-tracker and Git reads; they never prove that work occurred |
| Runnable frontiers and resource-readiness views | Derived in the live coordinator process | Recompute them from fresh task-tracker and Git reads plus Dalph-recorded journal history |
| Workflow-comparison-trace entries, presentation cursors, and graph indexes | Derived presentation data, even when an output store retains a copy | Rebuild them from committed journal records in original `(RunId, JournalPosition)` order without reordering or renumbering history. After restart, reread the task tracker and Git and record new journal events for those accepted reads. Preserve returned identities or revisions and leave unreadable intervals explicit. Dry-run and deterministic-test comparison traces remain process-local and do not write the Dalph workflow journal |

## Tracker Target Closure

Grouping chooses target membership; dependency edges extend that membership only
far enough to include every transitive prerequisite. For example, if selected
root `R` groups child `C`, `C` is blocked by `B`, and prerequisite-only task `B`
groups child `B1`, the closure contains `R`, `C`, and `B` but not `B1`. The
concrete consequence is that this run neither schedules nor presents `B1` unless
the selected root hierarchy also reaches it. This does not hide a prerequisite
needed to release `C`: GitHub records `B`, not `B1`, on `C.blockedBy`, and
grouping itself never controls eligibility.

## Task-Tracker Observation Consistency

The task-tracker adapter returns either one complete normalized task graph or a
typed failure. GitHub may still change between the API requests used to assemble
that graph. The adapter must finish every bounded page, decode every task in the
target closure, and reject detectable missing or contradictory records before
exposing scheduling knowledge. Dalph first appends the canonical observation
and then reconstructs selector input from the journal; raw provider records
never feed selectors. Its `TrackerRevision` identifies the canonical content
actually read and does not claim one provider transaction revision.

GitHub's current Issue GraphQL fields expose current issue values and paginated
`subIssues`/`blockedBy` connections without an as-of-time argument. GitHub keeps
an editable history for authored issue content, and `timelineItems(since:)`
includes timestamped lifecycle, dependency, and subissue add/remove events.
Those events are a possible future event-replay source, but they are not a
direct as-of graph query. Reconstruction would need separately specified
completeness, initial-state, ordering, deletion, transfer, retention, and access
semantics, so V1 deliberately does not claim historical reconstruction. Git
records commit history and cannot reconstruct task-tracker state. Consequently,
concurrent task-tracker edits that do not create a detectable identity,
pagination, repository, or parent contradiction can produce a mixed-time
observation. Before the Dalph coordinator sends a state-changing request whose
validity depends on the current task graph, it must reread the task tracker
instead of treating an earlier `TrackerRevision` as a GitHub transaction token.

The calling workflow selects a bounded task-graph read policy when it asks the
task-tracker adapter to assemble a graph. The policy may provide a short Effect
`Schedule` for retrying one failed provider page while retaining the other
in-memory pages already collected by that assembly. If the page schedule is
exhausted, a cursor becomes unusable, or consistency checking finds a
contradiction, a separate bounded assembly schedule may discard those pages and
restart the complete read. A single-attempt policy instead exposes the first
typed page failure or `TaskGraphReadContradiction`.

Intermediate failures consumed by the selected policy do not appear in its
caller-facing failure union, while exhaustion appears as
`TaskGraphReadRetryExhausted`. The policy therefore determines the complete
Effect return type, so callers do not match impossible failures with no-op
branches. No adapter policy may convert a detectable contradiction into a valid
normalized result, retry without a bound, or read the Dalph workflow journal.
The workflow recorder journals the selected read intent and its final result;
individual provider requests, page retries, and adapter-internal assembly
attempts are not workflow-journal events.

When the selected policy exhausts, workflow history records one explicit failed
task-graph read operation naming its requested shape, subjects, and final typed
failure. That outcome does not mark any tracker task failed. It leaves only the
affected graph knowledge unavailable, and a later manual or automatic
reconciliation policy may select a new read operation.

The adapter exposes a closed set of named task-graph read shapes earned by
workflow usage, such as reading one task, one task's complete blocker relation,
or one task-tracker target closure. Each shape defines the subjects and fact
families its successful result covers, so an empty complete blocker result can
remove earlier blocker knowledge while a task-only result says nothing about
blockers. New workflow requirements may add new shapes; Dalph does not expose
an arbitrary field bag or speculative general-purpose graph-query language.

A successful complete graph-fact update replaces reconstructed durable graph
knowledge for the graph area and fact families it covered. If GitHub previously
reported that task A was blocked by task B and a later comparable complete
result for A's blockers returns an empty list, reduction removes that edge.
Results that did not cover A's blockers neither preserve the edge as current
nor remove it; they simply add no new blocker knowledge.

A tracker mutation result is not a graph-fact source. Its typed acknowledgement
can complete the mutation workflow but cannot authorize dependency release,
eligibility, or attempt planning. A later logical tracker read supplies a new
`TaskTrackerFactsObserved` event before those decisions can change.

Immediately before attempt planning, Dalph performs a focused task-work
specification read. That observation contains the exact normalized title and
body and their fingerprint, while excluding lifecycle and graph relations.
Complete graph observations conversely exclude title and body. The planned
attempt's `TaskRevision` is this authored-content fingerprint.

Freshness evidence applies at the narrowest fact family the provider can
support. GitHub exposes `Issue.updatedAt`, which can help compare two observed
versions of one issue record, but its dependency and sub-issue connection edges
carry no corresponding edge revision or update timestamp. Timestamped
dependency and sub-issue timeline events do not by themselves make a current
multi-page connection read an as-of snapshot. `TrackerRevision` fingerprints
the normalized content read and is not a graph-wide freshness order.

When two successful observations conflict, reduction uses a provider comparison
only within the fact family for which the adapter declares it valid. If neither
fact is provably newer, reduction retains a `TaskGraphKnowledgeConflict` for
that exact subject and fact family, continues consuming independent valid
knowledge, and makes a bounded focused reread eligible. Journal position alone
never resolves the external-fact conflict.

One V1 GitHub adapter read supports at most 1,000 distinct tasks and at most 10
pages from any one `subIssues` or `blockedBy` connection. With GitHub's maximum
100 nodes per GraphQL page, these caps bound one relation at 1,000 endpoints and
the worst-case observation at 21,001 provider requests. Crossing either bound
fails with `ResourceLimitExceeded`; a partial graph is never returned. These
are deliberate safety limits, not inferred properties of the current target.

Provider evidence: [GitHub Issue GraphQL fields](https://docs.github.com/en/graphql/reference/issues)
and [GitHub GraphQL query limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api),
plus [GitHub issue edit history](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue).

## GitHub Task Claims

The GitHub Issues adapter represents one active task claim as a repository
label record whose deterministic name is `dalph-claim-` plus a bounded SHA-256
digest of the opaque `TaskId`. The label description is a schema-versioned
payload containing the exact `OperationId`, `ClaimOwner`, and `ClaimToken`.
The deterministic name associates the tracker-owned label record with the
`TaskId` even across a crash between label creation and later workflow
observations. The compact payload is bounded by GitHub's 100-character label
description limit; an owner or token that cannot be represented fails before
the request crosses the tracker boundary.

GitHub repository label names are unique. Atomic label creation is therefore
the adapter's create-if-unclaimed boundary: two competing creates for one task
cannot create two claim records. Every returned error or malformed response is
followed by a fresh repository-label lookup before the generic claim protocol
can authorize a repeat. Release first compares the complete owner/token claim,
then deletes the exact opaque GitHub label node ID. A delayed release for a
deleted label cannot delete a replacement label with a new node ID.

The journal records the exact claim-acquisition operation before label
creation. At coordinator restart, an intent without a durable acquired outcome
is reconciled with the same operation, owner, and token; the generic protocol
rereads the repository label before it can repeat the request.

The coordinator's Git common-directory ownership capability guards label
creation and deletion. Claim lookup remains read-only. After the adapter proves
claim ownership, Dalph selects a read-only claimed-task eligibility observation.
The production interpreter rereads the exact claim and complete task graph.
Only the claimed task being open, still present in the target closure, and free
of unsatisfied prerequisites can emit `ClaimedTaskEligibilityObserved`. Dry-run
records the same operation shape without receiving tracker mutation authority
and produces a distinct simulated outcome that claims no real tracker
observation.

## Durable Task-Attempt Planning

Under [ADR 0002](adr/0002-planned-task-attempt-admission.md), the coordinator
records one immutable planned task attempt only after a fresh durable
`ClaimedTaskEligibilityObserved` outcome matches the task identity and task
revision fingerprint. The planned-task-attempt recording operation has that
eligibility-observation operation as its sole direct predecessor. Before the
coordinator asks Git to create or discover the worktree, it records the planned
task attempt in the Dalph workflow journal and waits for the append
acknowledgement. The planned task attempt binds the run, task revision
fingerprint, attempt identity, declared Base SHA, branch ref, worktree path,
and executor locator.

All planned-task-attempt identities and locators cross the journal boundary
through Effect Schema and retain distinct brands. A failed or contradictory
append therefore leaves Git and the executor untouched. Repeating the same
recording operation is idempotent; attempting to replace its journal key
with a different planned task attempt is a journal contradiction. The key is
scoped by `RunId` and `AttemptId`, so changing the recording-operation identity
cannot replace an attempt. A later decision to make another attempt must state
which prior outcome authorizes recording it instead of continuing or
terminating the existing attempt.

The workflow selects and invokes the same planned-task-attempt recording and
worktree-reconciliation operations in every composition. Effect Layers select
the implementation of each boundary independently, so tests may intentionally
combine controlled adapters that exercise a production protocol at one
boundary with simulation at another. A composition that exposes an adapter
which may change external state must also record the required intent for that
exact boundary. The production Layer guarantees that Dalph records the planned
task attempt and rereads the journal before it may inspect or change Git. A
mixed test Layer does not acquire that production durability guarantee merely
because one of its controlled adapters exercises production protocol code.

Before recovered executor work continues, Dalph requires exactly one earlier
`TaskAttemptPlanned` event for the identical planned task attempt and a
causally later exact worktree-reconciliation result. Missing, duplicate,
non-causal, unreadable, and mismatched evidence fail with distinct typed
results before the executor is called.

The planned-attempt executor Quint model keeps durable responsibility-began
distinct from the first executor report. Its executable conformance driver
crosses the production journal workflow, pauses after the responsibility row,
and permits a running or terminal report only afterward.

## Exact Git Worktree Reconciliation

After the journal acknowledges one immutable planned task attempt and before
Dalph starts its executor work, Dalph records one exact
worktree-reconciliation intent. It then reads Git's registered worktrees and
the planned branch. Only a fresh observation that both resources are absent may
authorize `git worktree add`; an existing planned branch may authorize adding
that branch only after Git proves the declared Base is its ancestor.

Normal execution and recovery use the same read-after-request protocol. Every
create request is followed by a Git read because that read supplies the current
branch, worktree-registration, `HEAD`, and ancestry facts from which Dalph
constructs `PlannedWorktreeReady`; it is not an additional safety read taken
because the create command might be unreliable. If the coordinator restarts
without a durable result for a recorded worktree-reconciliation intent, it
enters that same Git-read step before issuing another create request. Dalph
proceeds only with a `PlannedWorktreeReady` proof containing the declared Base,
current `HEAD`, exact branch ref, and exact worktree path after
`merge-base --is-ancestor` succeeds. Executor work starts only after the
acknowledged plan and this worktree-reconciliation operation. Dry-run projects
the same operation without reading or changing Git and cannot fabricate a
Base/HEAD proof.

If the declared Base is not an ancestor of current `HEAD`, Dalph stops without
resetting or recreating the branch. A target directory that Git does not
register, a planned branch registered at a foreign worktree, a different branch
registered at the planned path, duplicate registrations, detached planned
worktrees, and malformed Git output remain distinct typed reconciliation facts.
Dalph preserves every observed resource; this workflow performs no repair,
clean, move, reset, prune, or deletion.

## Planned-Attempt Executor Boundary

For one planned task attempt, Dalph starts or continues executor work using the exact `RunId` and `AttemptId`. The executor reports `Running`, `SafelySuspended`, or a terminal `Completed` or `Failed` result. Safe suspension proves no executor-owned activity remains and allows Dalph to release the task-work position.

The milestone executor is a same-process controlled fake. Coding agents, reviewers, provider sessions, handback, retry, restoration, and convergence are executor-internal policy that Dalph does not currently model. Future production executor internals require separate accepted operational scenarios; they must not add compatibility types to this generic boundary.

Before recovered executor work continues, Dalph rereads the current exact tracker claim and exact Git worktree and requires a valid causal workflow-journal history. An unreadable boundary remains distinct from contradictory evidence.

Production startup validates every discovered run. Because this milestone exposes one requested run activation, startup fails closed when a different valid run still owns unfinished responsibility; it never silently ignores that work. Multi-run activation is future design.

## Future Resolution and Integration

Resolution, integration, tracker completion, and executor-internal review policy are not implemented by this milestone. Each requires accepted chronological operational scenarios before it may add domain types or workflow events.

## Formal Model and Executable Scenarios

The canonical `plannedAttemptExecutor` Quint model covers only the coarse
executor boundary: exact planned-attempt correlation, running position
ownership, retention of that position between a suspension request and its
result, safe-suspension release, and terminal release. Detailed executor
internals are not part of current Dalph.

Executable TypeScript scenarios cover the same reports and recovery boundary,
including generated traces replayed through the executor service. The Quint
gate typechecks, runs deterministic examples, samples the invariants and
witnesses, and exhaustively verifies the bounded model.

## Documentation Responsibilities

| Document, application, or store                                                    | Records or decisions provided                                                    |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Dalph tooling context](CONTEXT.md)                                                | Canonical Dalph terminology and the tooling/main-application distinction          |
| This document                                                                      | Stable Dalph structure and rules for rereading task-tracker and Git state, obtaining planned-attempt executor reports, and reading journal history |
| Configured task tracker                                                            | Task identity, description, lifecycle, dependency/grouping relationships, and claims |
| [`research/`](../research/)                                                        | Historical investigation and decision evidence; accepted requirements and decisions are recorded in their named specification or decision document |
| Historical `ralph-run.sh` sources in their origin repository                      | Historical harness behavior only                                                 |

A target repository's architecture, ubiquitous language, and modeling
assumptions do not define Dalph architecture.
