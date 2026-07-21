# Dalph Tooling Architecture

This document owns stable architecture for Dalph repository tooling. It does
not own a target repository's rules, product runtime, authored content, or
application architecture.

Canonical boundary terminology lives in [CONTEXT.md](CONTEXT.md).

## Historical-Harness Boundary

The Dalph orchestrator is a clean tooling system. `scripts/ralph-run.sh` is a
one-off historical execution harness, not its architecture, compatibility
baseline, migration source, fallback scheduler, or runtime substrate. The
historical harness may supply candidate tooling requirements, failure evidence,
and design lessons. A candidate becomes an accepted tooling requirement only
when an owning decision or implementation specification explicitly accepts it.

The Dalph orchestrator must not invoke, wrap, resume, migrate, or preserve
behavioral parity with the historical harness. Historical plan indexes, shell
stages, claims, run directories, prompts, retained runs, and cleanup
conventions remain evidence outside the Dalph orchestrator's managed namespace.
Tracker claims, journal runs, attempts, sessions, evidence, and recovery state
are allocated and owned only through the orchestrator's typed ports.

## Coordinator Ownership

Exactly one live mutating Dalph coordinator owns a canonical Git common
directory. Ownership is a scoped capability backed by an operating-system file
lock, acquired before any affected mutation and released by scope closure or
process death. A competing coordinator fails before mutation.

Requested path aliases resolve through one shared filesystem boundary before
either controlled or production locking observes the canonical locator.

Every affected mutation runs through the ownership guard. Loss of the scoped
ownership or an observation that the locked directory descriptor and canonical
directory path name different resources interrupts in-flight guarded mutations
and rejects later ones. The descriptor locks the existing Git common directory itself, so
replacing a child lock file cannot create competing ownership. A durable row,
stale-file timeout, TTL lease, in-process semaphore, and journal fact are not
substitutes for coordinator ownership. Dry-run remains non-mutating and does
not acquire this capability.

## Durability and Reconstruction

Dalph persists only managed workflow history in the authority journal. It does
not make an in-memory coordinator object durable, copy facts owned by another
authority, or persist a derived view so that execution can resume from that
object after a restart.

Recovery reconstructs state through reconciliation; it does not rehydrate a
serialized coordinator. It reopens and reads journal facts at their canonical
positions, refreshes observations from the tracker, Git, and execution
substrate, and then derives fresh process-local coordination and presentation
state. A restarted process must not treat a pre-crash queue buffer, permit
holding, timer instance, frontier, presentation cursor, or projection as
authority.

| State or fact | Durability and authority | Restart treatment |
| --- | --- | --- |
| Managed workflow intentions and observed outcomes | Durable; the JournalStore is authoritative for Dalph-managed history and assigns canonical `JournalPosition`s within a `RunId` | Reopen the journal, read in position order, and reconcile any intent whose outcome was ambiguous before retrying |
| Task identity, lifecycle, dependencies, grouping, and claims | Durable only according to the tracker; the tracker remains authoritative | Refresh the tracker snapshot and derive current eligibility rather than restoring a stored frontier |
| Git lineage, refs, commits, worktrees, and integration facts | Durable only according to Git; Git remains authoritative | Re-observe the exact managed resources and reconcile them with journaled intentions before continuing |
| Session and process facts | Owned by the execution substrate; their availability across restart is a substrate property, not Dalph journal authority | Refresh substrate observations and classify the managed execution before retry, cleanup, or failure |
| In-memory queue buffers, wakeup signals, semaphore instances, permit holdings, and timer instances | Non-durable process-local coordination | Discard them on process loss and recreate them from accepted configuration, journaled scheduling facts, and reconciled authority observations; they never prove that work occurred |
| Runnable frontiers and resource-readiness views | Non-durable derived scheduling state | Recompute them from refreshed authority observations and managed journal history |
| Journal-backed live semantic-trace occurrences, presentation cursors, and graph indexes | Non-authoritative derived presentation state, even when a sink stores a copy | Re-project corresponding committed journal facts in original `(RunId, JournalPosition)` order, then rebuild indexes without reordering or renumbering observed history. After restart, obtain fresh external-authority observations and record them as new managed observations, preserving any authority-provided identities or revisions and leaving unobservable intervals explicit rather than inventing historical events. Dry-run and deterministic-test traces remain process-local interpreter projections and do not write the authority journal |

For a recoverable live run, a successfully acknowledged journal append is the
durability boundary for a managed fact. Presentation may apply process-local
backpressure after acknowledgement, but a crash between acknowledgement and
output does not erase the fact: replay can reconstruct any corresponding trace
item from the same `(RunId, JournalPosition)`. A persistent live-trace projector
must either atomically commit each projected item with advancement of its source
cursor or enforce idempotency by `(RunId, JournalPosition)`, so replay cannot
persist a second projection of the same committed fact. Conversely, no task
execution may be inferred from an admission trace alone; reconciliation
requires the authoritative journal and fresh execution-substrate observations.

Physical journal schema evolution, event evolution, and semantic recovery are
separate boundaries. Physical SQLite changes use ordered Effect SQL migrations.
Each immutable journal event has a versioned envelope and JSON payload decoded
and upcast through Effect Schema; stored history is not rewritten merely to
adopt a newer in-process event shape. Successful row decoding is necessary but
not sufficient for recovery: a managed-history reduction must validate the
ordered events and return either a valid recovery state or typed semantic
issues. Dalph does not persist that derived state. See
[ADR 0001](adr/0001-versioned-journal-evolution.md).

## Tracker Target Closure

Grouping chooses target membership; dependency edges extend that membership only
far enough to include every transitive prerequisite. For example, if selected
root `R` groups child `C`, `C` is blocked by `B`, and prerequisite-only task `B`
groups child `B1`, the closure contains `R`, `C`, and `B` but not `B1`. The
concrete consequence is that this run neither schedules nor presents `B1` unless
the selected root hierarchy also reaches it. This does not hide a prerequisite
needed to release `C`: GitHub records `B`, not `B1`, on `C.blockedBy`, and
grouping itself never controls eligibility.

## Tracker Observation Consistency

A complete tracker observation is all-or-nothing at the Dalph boundary, but it
is not necessarily a provider-transactional, point-in-time snapshot. The GitHub
adapter must finish every bounded page, decode every task in the tracker target
closure, and reject detectable missing or contradictory facts before exposing
a `TaskDagSnapshot`. Its `TrackerRevision` identifies the canonical content
actually observed; it does not claim that GitHub assigned one revision to the
multi-request read.

GitHub's current Issue GraphQL fields expose current issue values and paginated
`subIssues`/`blockedBy` connections without an as-of-time argument. GitHub keeps
an editable history for authored issue content, and `timelineItems(since:)`
includes timestamped lifecycle, dependency, and subissue add/remove events.
Those events are a possible future event-replay source, but they are not a
direct as-of graph query. Reconstruction would need separately specified
completeness, initial-state, ordering, deletion, transfer, retention, and access
semantics, so V1 deliberately does not claim historical reconstruction. Git
commits are a separate Git authority and cannot reconstruct tracker state.
Consequently, concurrent tracker edits that do not create a detectable identity,
pagination, repository, or parent contradiction can produce a mixed-time
observation. Consumers must refresh tracker authority before ambiguity-crossing
effects rather than treating an earlier `TrackerRevision` as a GitHub transaction
token.

The V1 GitHub adapter admits at most 1,000 distinct tasks and reads at most 10
pages from any one `subIssues` or `blockedBy` connection. With GitHub's maximum
100 nodes per GraphQL page, these caps bound one relation at 1,000 endpoints and
the worst-case observation at 21,001 provider requests. Crossing either bound
fails with `ResourceLimitExceeded`; a partial graph is never returned. These
are deliberate safety limits, not inferred properties of the current target.

Provider evidence: [GitHub Issue GraphQL fields](https://docs.github.com/en/graphql/reference/issues)
and [GitHub GraphQL query limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api),
plus [GitHub issue edit history](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue).

## Documentation Authority

| Document or system                                                                 | Tooling authority                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Dalph tooling context](CONTEXT.md)                                                | Canonical boundary terminology and the tooling/main-application distinction      |
| This document                                                                      | Stable Dalph tooling structure and ownership boundaries                          |
| Accepted implementation specification                                              | Executable Dalph requirements and acceptance                                     |
| Canonical issue tracker                                                            | Work identity, accepted planning decisions, and dependency state                 |
| [`research/`](../research/)                                                        | Historical investigation and decision evidence after accepted facts are promoted |
| Historical `ralph-run.sh` sources in their origin repository                      | Historical harness behavior only                                                 |

A target repository's architecture, ubiquitous language, and modeling
assumptions are not Dalph architecture owners.
