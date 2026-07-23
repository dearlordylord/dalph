# Dalph Tooling Architecture

This document records stable architecture for Dalph repository tooling. It does
not define a target repository's rules, product runtime, authored content, or
application architecture.

Canonical boundary terminology lives in [CONTEXT.md](CONTEXT.md).

`runWorkflow` selects operations from Dalph's workflow algebra. The
`WorkflowInterpreter` is the injected Effect service whose methods execute
those selected operations at their named boundaries. An Effect Layer constructs
that service from real or simulated tracker, journal, Git, task-work-provider,
and executor capabilities. “Interpreter” names this operation handler, not an
environment or runtime mode; one Layer may intentionally combine real behavior
at one boundary with simulated behavior at another.

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
task tracker, creates planned task attempts, receives task-work session
identities from the task-work provider, and records workflow history in the
Dalph workflow journal.

## Exclusive Coordinator Lock

At most one live Dalph coordinator may send state-changing requests for a
canonical Git common directory. It proves exclusivity by holding an
operating-system lock on that directory. Closing the Effect Layer scope or
ending the coordinator process releases the lock. A competing coordinator fails
before sending a state-changing request.

Requested path aliases pass through the same canonical-path resolution code
before either the deterministic-test or production lock implementation checks
the resulting locator.

Before Dalph sends a live request that may change task-tracker, Git, or
task-work-provider state for this Git common directory, the coordinator verifies
that it still holds the directory lock. If the locked descriptor and canonical
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
copies of current task-tracker, Git, or task-runner state so that coordination
can continue from those copies after restart.

After restart and while holding coordinator ownership, Dalph scans every
physical journal row and discovers every recoverable run without an age cutoff.
It validates each run's complete event history in position order before it
rereads current task and claim state from the tracker, refs and exact worktrees
from Git, current sessions from the task runner, worker processes from the task
executor, and evidence, review, and handback state from their authorities. It derives new in-memory
coordination and presentation state from those reads. A restarted process must
not treat a pre-crash queue buffer, capacity reservation, timer instance,
frontier, presentation cursor, or projection as proof that work occurred.

Discovery accumulates independent physical-row, envelope, payload, identity,
ownership, semantic-history, and reconciliation issues. A row that cannot be
decoded does not hide another row or become an empty history. Any run with a
boundary issue or invalid managed history remains preserved and is not resumed;
ambiguous external resources likewise remain untouched for operator repair.
Startup fails closed after collecting the available issues rather than allowing
one unreadable authority to hide another authority's reconciliation fact.

Journal storage, decoding, and reduction are separate boundaries. The
reconstruction workflow reads each run's physical rows once in canonical
position order, decodes and upcasts them, then passes the resulting event values
through one pure composed reducer. Its graph-knowledge, workflow-history,
resource-responsibility, and pause reducers neither read the journal nor invoke
any other effect. They update distinct component states for each event, after
which the composition validates cross-component invariants and returns one
`ReconstructedManagedRunState`.

One decoded journal event may update more than one component reducer without
merging their state models. When a successful tracker mutation response both
completes its workflow operation and supplies normalized task-graph facts, one
`TaskGraphFactsUpdated` event updates workflow history and graph knowledge
atomically. Its tagged origin preserves whether those facts came from an
explicit read or mutation result. The graph-knowledge reducer applies them
through the same coverage, completeness, temporal-consistency, and replacement
algebra.

The live process may retain that derived state together with its last applied
`JournalPosition` and incrementally apply later decoded events. This is only a
process-local optimization: it is discarded on process loss, never persisted
as journal authority, and never substitutes for reading and validating the
complete history during restart.

For each valid run, reduction derives one non-persisted managed-run recovery
stage containing an entry for every unfinished pre-attempt task and exactly one
entry per acknowledged planned task attempt. A pre-attempt entry that cannot
reconstruct a safe claim or plan fails closed instead of being mistaken for a
terminal run.

Dalph consumes every independently valid part of the reconstructed run. A
contradiction, unreadable authority, ambiguous resource, or loss of
responsibility isolates only the exact task, attempt, or resource region whose
facts are needed to act there. Unaffected branches continue whenever their next
actions require none of the isolated facts or resources. A condition stops the
whole run only when it invalidates shared managed history or a shared capability
required for every otherwise allowed continuation.

Workflow responsibility is tracked per exact subject rather than as one flag
for a planned task attempt. Losing permission to change a tracker task may
relinquish that task-coordination responsibility while Dalph retains separate
obligations to preserve, stop, reconcile, or dispose the attempt's worktree and
task-work session. Each responsibility ends only through its own completed
disposition or a durable relinquishment backed by a fresh authority
observation.

If a fresh tracker read finds that a task changed during implementation, Dalph
updates graph knowledge and prevents that branch from crossing another
state-changing boundary while preserving its outstanding session and resource
responsibilities. The pause subject and safe boundary belong to W3; W6 decides
the reconciliation choices and whether any case may continue after an operator
merely unpauses it. This architecture does not assume that unpause alone
reconciles changed task intent.

Startup checks the exact current task claim and rereads the task tracker before
it selects a missing worktree, task-work-session, task-execution, or later
implementation-convergence operation.
The reread must still contain the task as eligible and must derive the same task
revision fingerprint. An already-recorded unresolved operation keeps its
operation identity and uses its existing reconciliation protocol. A recovery
activation that returns without either appending a durable next fact, reaching
an explicit terminal disposition, or returning a typed issue is rejected as
inert recovery.

| State or record | Where current state is read | Restart treatment |
| --- | --- | --- |
| Dalph-recorded workflow intents and observed outcomes | Read from the durable JournalStore in canonical `JournalPosition` order within one `RunId` | Reopen the journal and apply the uncertain-request recovery rules to each intent missing a recorded outcome before retrying |
| Task identity, lifecycle, dependencies, grouping, and claims | Read through the configured task tracker | Reread every task in the task-tracker target closure and derive current eligibility instead of restoring a stored frontier |
| Git lineage, refs, commits, worktrees, and integration state | Read from Git | Reread the exact resource locators recorded in the planned task attempt and compare them with journaled intents before continuing |
| Task-work sessions, provider work units, and worker processes | Read through the configured task runner; its adapter queries the configured task-work provider | Ask the task runner for a fresh report, then classify the task-work session and its provider work units or worker processes before retry, cleanup, or failure |
| In-memory queue buffers, wakeup signals, semaphore instances, permit holdings, and timer instances | Available only in the live coordinator process | Discard them on process loss and recreate them from accepted configuration, journaled scheduling records, and fresh task-tracker, Git, and task-runner reads; they never prove that work occurred |
| Runnable frontiers and resource-readiness views | Derived in the live coordinator process | Recompute them from fresh task-tracker, Git, and task-runner reads plus Dalph-recorded journal history |
| Workflow-comparison-trace entries, presentation cursors, and graph indexes | Derived presentation data, even when an output store retains a copy | Rebuild them from committed journal records in original `(RunId, JournalPosition)` order without reordering or renumbering history. After restart, reread the task tracker and Git, ask the task runner for a fresh task-work session report, and record new journal events for those reads and reports. Preserve returned identities or revisions and leave unreadable intervals explicit. Dry-run and deterministic-test comparison traces remain process-local and do not write the Dalph workflow journal |

A task-work provider adapter may satisfy its correlation contract with a
provider-owned durable registry outside the Dalph workflow journal. That
registry retains the exact operation, planned-attempt, task-work-session, and
provider-work-unit correlation for every recoverable run even when the native
provider has a shorter session-retention period. Native session absence, an
empty provider listing, or any request error whose contract does not explicitly
prove pre-creation rejection does not prove non-creation. When the adapter
cannot read complete correlation history, it returns a typed task-work session
lookup failure instead of reporting that no matching session exists.

An established task-work session with no provider work unit or worker process
is a normal explicit state. Establishing the durable session and asking the
adapter to start or resume work inside that session are distinct workflow
operations. Dalph records each operation's intent and observed outcome
separately. After restart it can therefore distinguish a session awaiting its
first work request from an uncertain work-unit or worker-process request.

A matching task-work session report preserves every registry-known provider
work unit even when native details are no longer readable. Each work unit is
tagged as available, confirmed purged, or temporarily unreadable. Confirmed
purge leaves the enclosing task-work session established but forbids resuming
that work unit. Temporary unreadability authorizes only another observation;
neither condition is collapsed into an absent task-work session.

A task-work session correlation conflict leaves the session-establishment
operation unresolved under its existing `OperationId`. Dalph may only perform
a fresh lookup after provider-owned correlation data is repaired or follow a
separate run-disposition decision. Repair does not authorize selecting one
conflicting session, changing the planned task attempt, or issuing another session
creation request.

A journal event record is durable after Dalph receives successful
acknowledgement of its append. Presentation may apply process-local backpressure
after acknowledgement, but a crash before presentation output does not erase
that record: replay can reconstruct any corresponding comparison-trace entry
from the same `(RunId, JournalPosition)`. If Dalph persists live
workflow-comparison-trace entries, it
must either atomically commit each projected item with advancement of its source
cursor or enforce idempotency by `(RunId, JournalPosition)`, so replay cannot
persist a second projection of the same committed record. A workflow comparison
trace item saying task-work capacity was reserved does not prove that task work
began. After restart, Dalph requires the journaled start request and a fresh
task-work session report from the task runner.

SQLite schema migration, journal-event version conversion, and ordered journal
history validation change independently and require separate implementations.
Physical SQLite changes use ordered Effect SQL SQLite migrations before the
normalized schema is read or written. Each physical record stores normalized
run identity, canonical position, record key, event kind, event version, and an
immutable JSON payload; it stores no derived frontier or recovery rollup.
Effect Schema independently decodes every physical row and versioned payload,
then an immutable upcaster produces the current event meaning. Idempotent
reappend compares that upcasted meaning rather than historical JSON bytes.

Successful row decoding is necessary but not sufficient for recovery. The
total history reducer checks contiguous canonical positions, record-run and
record-key identity, event-kind and operation identity, attempt ownership,
legal intent/observation transitions, and duplicate or contradictory facts. It
returns either valid managed history or all detected typed validation issues;
it does not throw away the records or persist the derived result. See
[ADR 0001](adr/0001-versioned-journal-evolution.md).

Journal history validation rejects structurally impossible managed history,
such as an observation without its operation intent, an outcome without its
required observation, or mismatched operation and planned-attempt references.
Two well-formed provider reports that disagree remain valid journal history but
produce a typed provider-evidence conflict. Failure to obtain complete provider
evidence remains a typed lookup failure. Neither external condition is
reclassified as journal corruption.

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
that graph. The GitHub adapter must finish every bounded page, decode every task
in the task-tracker target closure, and reject detectable missing or
contradictory records before exposing a `TaskDagSnapshot`. Its `TrackerRevision`
identifies the canonical content actually read; it does not claim that GitHub
assigned one revision to the multi-request read.

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

An explicit read is not the only source of updated graph facts. A tracker
mutation result may produce `TaskGraphFactsUpdated` when its adapter contract
returns a normalized result with the same declared coverage and evidence
required from a named read shape. That single event also records the mutation
operation's successful outcome; Dalph does not append a duplicate
request-acknowledgement event. If the mutation response lacks sufficient graph
facts, its ordinary typed acknowledgement updates workflow history only and a
later read supplies graph knowledge.

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
coordinator asks Git or a task-work provider to create or discover an execution
resource, it records the planned task attempt in the Dalph workflow journal and
waits for the append acknowledgement. The planned task attempt binds the run,
task revision fingerprint, attempt identity, declared Base SHA, branch ref,
worktree path, executor locator, and task-work-session locator. The subsequent
session-establishment operation causally depends on that acknowledged
planned-task-attempt recording operation.

All planned-task-attempt identities and locators cross the journal boundary
through Effect Schema and retain distinct brands. A failed or contradictory
append therefore leaves Git and the task-work provider untouched. Repeating the
same recording operation is idempotent; attempting to replace its journal key
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

Before live session establishment or recovery, the journaled interpreter
requires exactly one earlier `TaskAttemptPlanned` event with the identical
planned task attempt whose recording operation is a direct causal predecessor.
Missing, duplicate, non-causal, and mismatched evidence fail with a typed
contradiction before provider mutation.

## Exact Git Worktree Reconciliation

After the journal acknowledges one immutable planned task attempt and before
Dalph asks the task-work provider to begin agent work, Dalph records one exact
worktree-reconciliation intent. It then reads Git's registered worktrees and
the planned branch. Only a fresh observation that both resources are absent may
authorize `git worktree add`; an existing planned branch may authorize adding
that branch only after Git proves the declared Base is its ancestor.

Every create request is followed by a fresh Git read, including when the Git
command returns an uncertain failure. Dalph proceeds only with a
`PlannedWorktreeReady` proof containing the declared Base, current `HEAD`, exact
branch ref, and exact worktree path after `merge-base --is-ancestor` succeeds.
The task-work-session operation causally depends on both the acknowledged plan
and this worktree-reconciliation operation. Dry-run projects the same operation
without reading or changing Git and cannot fabricate a Base/HEAD proof.

If the declared Base is not an ancestor of current `HEAD`, Dalph stops without
resetting or recreating the branch. A target directory that Git does not
register, a planned branch registered at a foreign worktree, a different branch
registered at the planned path, duplicate registrations, detached planned
worktrees, and malformed Git output remain distinct typed reconciliation facts.
Dalph preserves every observed resource; this workflow performs no repair,
clean, move, reset, prune, or deletion.

## Exact Task Execution Reconciliation

After Dalph establishes the exact provider-assigned task-work session, it
selects a distinct task-execution operation and admits that operation to bounded
task-work capacity. The operation binds the immutable planned task attempt, exact
session identity, normalized task revision (fingerprint), and a new `OperationId`. Session
establishment is a causal predecessor; it is not evidence that worker-process
execution began.

The journal commits task-execution intent and then an exact request-attempt
record before the configured executor may start or resume a process. Every
request return, typed adapter failure, and fresh process observation retains
that admission `OperationId`; adapters cannot replace it. A request
acknowledgement never emits `TaskExecutionStarted`. Dalph emits that event only
after validating a fresh provider observation of the exact running or terminal
worker process.

On restart, an execution intent without a durable outcome authorizes a fresh
provider observation before any later retry policy may repeat a process
request. An intent without a request-attempt record proves that the first
request remains safe. After a request-attempt crash, Dalph observes first and
may complete the exact request only after authoritative evidence proves that no
process exists. Running reports remain explicit nonterminal evidence and pin
the worker-process identity for later observations; successful, nonzero-exit,
and interrupted outcomes remain discriminated. Equivalent terminal evidence
may arrive under a new provider-observation identity, but changed outcome or
process evidence is a typed contradiction. Nonzero exit and interruption
retain the provider session, worker-process identity, preserved-WIP proof, and
bounded partial output.
Ambiguous terminal evidence remains a typed unresolved outcome.

Stale, replaced, foreign, and untracked sessions are typed reconciliation facts
that block the attempt. Dalph does not choose a different provider record,
allocate a replacement operation identity, or discard the worktree. Dry-run
uses the planned session locator in the same exhaustive operation algebra but
cannot fabricate a provider session or process identity.

## Immutable Implementation Evidence

Only a successful exact task-execution outcome selects implementation-evidence
sealing. The sealing operation directly names that execution operation as its
causal predecessor. It reads the completed attempt's Git diff through the Git
boundary and stores the diff and bounded executor output as separate immutable
EvidenceStore objects.

Diff collection snapshots the exact linked worktree through a scoped temporary
Git index and object database. The repository's real object database is exposed
only as a read-only alternate, so staged and untracked bytes can be represented
without changing the target index or object inventory. Repository clean filters
still define Git's snapshot semantics; target filters used during orchestration
must therefore be deterministic and free of external side effects.

The EvidenceStore derives every object identity from the complete byte content.
Its filesystem adapter writes a private partial file and atomically publishes a
same-filesystem hard link at the SHA-256 address. Repeated writes of identical
bytes return the same reference; reads verify both digest and byte length.

The implementation-stage manifest is stored last and references both evidence
objects, the planned Base SHA, task, run, and successful execution predecessor.
Consequently, a crash can leave unreachable content-addressed objects but never
a manifest that authorizes review before all referenced bytes are sealed.
Recovery repeats the same content-addressed writes and returns an already
journaled sealed outcome when present. A journaled live interpreter requires
the exact successful execution outcome before it records sealing intent.

Dry-run and deterministic-test interpreters select the same sealing operation
after their execution projection, but emit only
`ImplementationEvidenceSealingSimulated`. That value contains stage and
predecessor ordering without a manifest or evidence reference and therefore
cannot pass the implementation-review authorization boundary.

## Fresh Implementation Review And Exact Handback

One semantic review round begins only from a complete implementation-review
authorization. Before invoking a reviewer, Dalph records the exact review
operation, semantic round, and fresh reviewer-session identity. The request
binds the same planned task attempt and worktree, the latest successful implementer
invocation, and its exact provider session. Journal validation rejects a stale
invocation, reused reviewer session, foreign provider session, or cross-attempt
continuation before either provider boundary is called.

The reviewer returns either acceptance or at least one typed finding. Dalph
stores that disposition in a content-addressed review manifest whose immediate
predecessor is the sealed implementation evidence for the first round or the
prior review evidence for a later round. Every manifest retains the complete
finding history. A later round must advance by exactly one semantic ordinal,
preserve the exact unresolved finding history, and use a fresh reviewer
session. Its predecessor must be findings, followed by the exact acknowledged
handback and a newer successful implementer invocation in the same established
session; that invocation's newly sealed evidence alone can admit the review.

Findings select a separate handback operation. The handback request carries the
immutable review evidence and repeats the exact planned task attempt, worktree,
implementer invocation, and provider session binding. The journal records
intent before provider delivery and records acknowledgement afterward.
Recovery reuses the journaled review or handback operation and session; it does
not allocate another semantic round. Reviewer and handback adapters implement
provider-enforced create-or-resume contracts: reviewer work is idempotent by
operation plus reviewer-session identity, and findings delivery is idempotent
by handback operation. An exact repeated payload returns the first accepted
result without duplicating provider work; reuse of a key with a different
payload fails.

Dry-run and deterministic-test interpreters select the same review operation
after simulated evidence sealing but return
`ImplementationReviewSimulated`. They cannot fabricate sealed review evidence,
a reviewer session observation, a semantic disposition, or a findings
handback.

## Bounded Technical Invocation Scheduling

Before the journaled interpreter invokes one reviewer or sends one findings
handback, it captures a positive technical retry limit, positive initial delay,
and maximum delay for that exact active scope. Reviewer scope binds the review
operation, reviewer session, and semantic review round. Findings-handback scope
binds its operation, reviewed operation, and the same semantic round. Technical
retry ordinals and semantic review rounds are distinct branded values; a
provider invocation failure never creates another semantic round.
The current default permits three retries after the first invocation, begins at
100 milliseconds, and caps each delay at five seconds; every active scope
persists those values rather than depending on later defaults.

Only `ImplementationReviewInvocationFailure` and
`ReviewFindingsHandbackFailure` advance these schedules. The Effect schedule
applies exponential delay capped by the captured maximum and stops after the
captured retry limit. Before each wait it records the next technical retry
ordinal, capped delay, and absolute `notBefore` from the Effect clock in the
Dalph workflow journal. Production and tests execute this same scheduling
algebra; deterministic tests advance `TestClock`. Dry-run has no provider
invocation and therefore cannot fabricate a technical failure or scheduled
retry fact.
If clock-plus-delay arithmetic cannot produce a nonnegative safe-integer
`notBefore`, scheduling fails with `TechnicalRetryScheduleOverflow` before a
schedule fact is appended, a timer waits, or another provider invocation runs.

Coordinator ownership failure and Effect interruption are not technical
invocation failures and bypass this schedule. On restart, the interpreter
reuses the captured policy and exact invocation scope. A scheduled deferral in
the future waits only `notBefore - now` through the Effect clock; an overdue
deferral is immediately eligible. Immediately before the next provider call,
the journal records `TechnicalRetryDeferralSuperseded` for that exact ordinal.
A later typed technical failure alone may schedule the following ordinal.
Every schedule and supersession must follow the exact review or handback intent
and precede its durable outcome; policy capture alone may precede the intent.
Technical-retry events form one coherent version-3 protocol, and decoding does
not infer retry progress from earlier event versions.

Interruption after scheduling but before supersession leaves one pending
deferral. Interruption after supersession but before a durable provider outcome
resumes the same ordinal immediately through the provider's create-or-resume
boundary, which discovers an already-produced result before doing new work.
Neither crash position allocates a new reviewer session, semantic review round,
or technical retry ordinal. The total history reducer rejects gaps, crossed
scopes, delays inconsistent with the captured policy, schedules above the
captured limit, and a schedule that advances before its predecessor deferral is
superseded. Dry-run still fabricates no provider invocation or retry fact.

## Bounded Implementation Convergence

The live implementation control plane captures a positive semantic review
round limit and runs one explicit bounded loop. A successful execution seals
immutable evidence and selects a fresh independent reviewer. Acceptance records
`Accepted`. Findings below the limit are handed back to the exact implementer
invocation and provider session, then select a newer execution in that same
session and a fresh reviewer session. Each later reviewer receives the complete
finding history. Findings at the captured limit record
`ImplementationNonConvergent` without another handback.

Semantic non-convergence is distinct from technical retry exhaustion. Exhausted
reviewer transport records `ReviewTechnicalRetryExhausted`; exhausted findings
delivery records `HandbackTechnicalRetryExhausted`. Nonzero execution exit,
interruption, and demonstrated resource emergency also have distinct terminal
dispositions. A resource emergency requires explicit provider evidence for
memory, process-capacity, or storage exhaustion and forbids automatic retry of
the unchanged execution; Dalph never infers it from an exit code.

Every terminal disposition retains the exact active claim, planned task attempt,
authoritative ready-worktree operation and proof, provider session, applicable
findings/evidence chain, and selecting failure or outcome. Its direct
predecessor must contain exactly the embedded review, request, or execution
outcome; operation identity alone is insufficient. The journal permits one disposition per
attempt and rejects later attempt events. Restart first reconciles unresolved
provider intents, then reconstructs the last durable convergence stage. It
reuses an unresolved review or handback operation, continues an acknowledged
handback with same-session execution, and does not allocate a semantic round or
reviewer session merely because the coordinator restarted.

Dry-run selects the same bounded workflow shape but records only an
`ImplementationConvergenceSimulated` projection. It cannot fabricate a claim,
provider session, sealed review, findings, acceptance, or failure disposition.

## Documentation Responsibilities

| Document, application, or store                                                    | Records or decisions provided                                                    |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Dalph tooling context](CONTEXT.md)                                                | Canonical Dalph terminology and the tooling/main-application distinction          |
| This document                                                                      | Stable Dalph structure and rules for rereading task-tracker and Git state, obtaining task-runner reports, and reading journal history |
| Accepted implementation specification                                              | Executable Dalph requirements and acceptance                                     |
| Configured task tracker                                                            | Task identity, description, lifecycle, dependency/grouping relationships, and claims |
| [`research/`](../research/)                                                        | Historical investigation and decision evidence; accepted requirements and decisions are recorded in their named specification or decision document |
| Historical `ralph-run.sh` sources in their origin repository                      | Historical harness behavior only                                                 |

A target repository's architecture, ubiquitous language, and modeling
assumptions do not define Dalph architecture.
