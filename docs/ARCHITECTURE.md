# Dalph Tooling Architecture

This document records stable architecture for Dalph repository tooling. It does
not define a target repository's rules, product runtime, authored content, or
application architecture.

Canonical boundary terminology lives in [CONTEXT.md](CONTEXT.md).

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

After restart, Dalph reads the run's journal events in position order, rereads
current task state from the task tracker, rereads refs and worktrees from Git,
and asks the task runner for current task-work sessions, provider work units,
and worker processes. It derives new in-memory coordination and presentation
state from those reads. A restarted process must not treat a pre-crash queue
buffer, capacity reservation, timer instance, frontier, presentation cursor, or
projection as proof that work occurred.

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
conflicting session, changing the planned attempt, or issuing another session
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
Physical SQLite changes use ordered Effect SQL migrations.
Each journal event record contains its identity, position, kind, version, and
JSON payload. Effect Schema decodes that record and converts older payload
versions; stored history is not rewritten merely to adopt a newer in-process
event shape. Successful row decoding is necessary but
not sufficient for recovery: journal history validation must read events in
order, check rules between them, and return either a valid recovery state or
typed validation errors. Dalph does not persist that derived state. See
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
claim ownership, Dalph performs a new complete task-graph read; only an open
task still present in the target closure can emit `TrackerExecutionAdmitted`.
Dry-run records claim intent without receiving tracker mutation authority and
cannot emit that admission.

## Durable Task-Attempt Planning

Before the coordinator asks Git or a task-work provider to create or discover
an execution resource, it records one immutable planned task attempt in the
Dalph workflow journal and waits for the append acknowledgement. The plan binds
the run, task, normalized task revision, attempt, declared Base SHA, branch ref,
worktree path, executor locator, and task-work-session locator. The subsequent
session-establishment operation causally depends on that acknowledged planning
operation.

All plan identities and locators cross the journal boundary through Effect
Schema and retain distinct brands. A failed or contradictory plan append
therefore leaves Git and the task-work provider untouched. Repeating the same
planning operation is idempotent; attempting to replace its journal key with a
different plan is a journal contradiction. The key is scoped by `RunId` and
`AttemptId`, so changing a planning-operation identity cannot replace an
attempt. Genuine retry planning allocates a new attempt identity and new branch,
worktree, and task-work-session locators.

Only the journal-backed interpreter constructs durable plan acknowledgement.
Dry-run and live-fake interpreters return a distinct simulated result, and the
workflow routes that result only to a pure task-work simulation method. That
method emits `TaskWorkSessionEstablishmentSimulated` with the plan's session
locator; it neither fabricates a provider session ID nor claims authoritative
establishment. It has no task-runner lookup or start capability. Before live
session establishment or recovery, the journaled interpreter requires exactly
one earlier `TaskAttemptPlanned` event with the identical plan whose planning
operation is a direct causal predecessor. Missing, duplicate, non-causal, and
mismatched plan evidence fail with a typed contradiction before provider
mutation.

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
