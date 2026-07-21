# Ralph Tooling Architecture

This document owns stable architecture for Dalph repository tooling. It does
not own a target repository's rules, product runtime, authored content, or
application architecture.

Canonical boundary terminology lives in [CONTEXT.md](CONTEXT.md).

## Historical-Harness Boundary

The Ralph orchestrator is a clean tooling system. `scripts/ralph-run.sh` is a
one-off historical execution harness, not its architecture, compatibility
baseline, migration source, fallback scheduler, or runtime substrate. The
historical harness may supply candidate tooling requirements, failure evidence,
and design lessons. A candidate becomes an accepted tooling requirement only
when an owning decision or implementation specification explicitly accepts it.

The Ralph orchestrator must not invoke, wrap, resume, migrate, or preserve
behavioral parity with the historical harness. Historical plan indexes, shell
stages, claims, run directories, prompts, retained runs, and cleanup
conventions remain evidence outside the Ralph orchestrator's managed namespace.
Tracker claims, journal runs, attempts, sessions, evidence, and recovery state
are allocated and owned only through the orchestrator's typed ports.

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

## Documentation Authority

| Document or system                                                                 | Tooling authority                                                                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Ralph tooling context](CONTEXT.md)                                                | Canonical boundary terminology and the tooling/main-application distinction      |
| This document                                                                      | Stable Ralph tooling structure and ownership boundaries                          |
| Accepted implementation specification                                              | Executable Ralph requirements and acceptance                                     |
| Canonical issue tracker                                                            | Work identity, accepted planning decisions, and dependency state                 |
| [`research/`](../research/)                                                        | Historical investigation and decision evidence after accepted facts are promoted |
| Historical `ralph-run.sh` sources in their origin repository                      | Historical harness behavior only                                                 |

A target repository's architecture, ubiquitous language, and modeling
assumptions are not Dalph architecture owners.
