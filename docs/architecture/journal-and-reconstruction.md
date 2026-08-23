# Journal and Reconstruction

This page owns the detailed architecture for Dalph workflow history,
publication, reduction, and restart. Concrete crash chronologies remain in the
accepted operational scenarios.

## What survives

Dalph persists only the workflow history it records in the Journal. It does not
serialize a coordinator object or persist a frontier, bounded ticket set,
runtime position map, wakeup, timer, stream cursor, or presentation projection
as proof of work.

The task tracker and Git remain the owners of their current facts. The Dalph
executor owns complete planned-attempt work and its normalized reports; its
execution substrate owns agent-session and process observations. The Journal
may contain observations exposed by those seams and exact workflow intents,
but a continuation consults the owning seam whenever its protocol requires
current evidence.

The current controlled executor shares Dalph's process lifetime. A Dalph crash
therefore stops that executor too. This milestone does not prove discovery,
adoption, or safe classification of an independently surviving production
executor session.

When a retained planned-attempt responsibility is reconstructed after an
activation boundary, the Journal-backed recovery composition obtains fresh
tracker and Git observations before continuing executor work. It records one
generic continuation-authorization fact that witnesses those operation
identities; the fact is durable history for validation but is deliberately not
an occurrence projection or a recovery event. A cassette-only coordinator
death control is scoped lifecycle input and is never journaled or reconstructed.

## Journal state and publication

The `Journal` service exposes one current-first `state` signal together with
direct `append` and `read` operations. A successful append is serialized in
`JournalPosition` order, folded into `JournalState`, and published to current
subscribers. A subscriber receives a coherent state rather than independently
sampling records, graph knowledge, and responsibilities from different
positions.

A tracker graph observation retains the logical read identity and journal
position that recorded it. A later read with equal graph contents is still a
later observation and may support a later freshness or stabilization decision.
Derived frontier and delivery values are not journal records.

One completed logical tracker read records one normalized tracker observation.
A tracker mutation result may enter the same graph-knowledge path when it
contains enough normalized coverage, completeness, consistency, freshness,
and replacement evidence to satisfy a named tracker-observation contract. A
bare mutation acknowledgement updates workflow history only; it cannot by
itself establish task lifecycle, dependency release, or Run completion.

See [ADR 0007](../adr/0007-fold-normalized-mutation-results-into-graph-knowledge.md)
and [issue 145](https://github.com/dearlordylord/dalph/issues/145).

## Idempotent Run establishment

The production Run entry does not accept a fresh-versus-restored mode. While
holding coordinator ownership, it reads startup facts and the exact requested
Run history. Discovery of more than one unfinished Run fails closed naming all
of them before any Run is activated.

When the exact history is absent, establishment evaluates a lazy initial-policy
source, decodes it, and asks the lifecycle Journal to append one beginning. A
lost append response is reconciled by entering the same establishment path and
rereading history. If the beginning exists, establishment validates and reduces
it instead of evaluating the fallback or appending again. The lifecycle Journal
continues to reject a direct second beginning; application idempotence does not
weaken record admission.

When history exists, establishment validates its exact Run identity and target,
reduces the complete chronology, and reconstructs the latest control policy and
unfinished responsibilities. Mismatched, invalid, or terminated history never
enters activation. Successful absent-history and existing-history cases produce
the same established Run value for one bounded activation.

See
[ADR 0011](../adr/0011-establish-runs-idempotently-before-activation.md) and
[the accepted chronology](../scenarios/run-establishment-and-activation.md).

## Complete-history reconstruction

On startup, while holding coordinator ownership, Dalph calls `scanHot` to
discover the histories whose rows remain in the ordinary Hot partition. It
does not make a startup decision by scanning Cold retention rows: Cold is
storage provenance for a history already proven terminal, not a claim about
current tracker, Git, or executor authority. A terminal history that has not
yet been retired may remain in Hot and is maintenance debt, so Hot itself does
not prove that a Run is unfinished.

An exact `read` and recovery read check both partitions in one SQLite snapshot
or one memory state transition. They return the complete history from whichever
partition contains it and fail closed if the Run appears in both. The explicit
`auditAll` operation scans both Hot and Cold with partition-bearing issues and
does not silently omit retained or malformed rows. It is the diagnostic and
repair-evidence boundary; it is not ordinary startup discovery.

When a terminal history is ready for maintenance, terminal-history retirement
runs the canonical reducer over every decoded record, requires a valid final
`WorkflowRunTerminated` occurrence, copies every persisted row from Hot to
Cold, verifies the exact key, position, event kind, version, and payload bytes,
and deletes Hot rows atomically. A valid nonterminal Hot prefix is reported as
`JournalHistoryNotTerminal`; malformed, gapped, or semantically invalid
history is `JournalDataCorruption`. A Cold nonterminal history is impossible
storage state and is also corruption. A failed immediate or startup
maintenance attempt emits typed `JournalMaintenanceObservation`; there is no
timer retry loop.

Journal storage, decoding, and reduction are separate seams:

1. Hot discovery returns Hot rows in canonical order; an explicit full audit
   returns both partition scans and preserves each row's storage provenance.
2. Schema decoding produces typed records or explicit row/envelope/payload
   issues.
3. One pure composed reducer validates the decoded history and reconstructs
   Run state.
4. The graph-knowledge, workflow-history, responsibility, control-policy, and
   pause reducers update their own component states.
5. The composition checks relationships between those component states and
   returns one reconstructed Run state or typed history issues.

The reducers do not read the Journal or call the tracker, Git, or executor.
One event may update several component reducers without merging their state
models. The live activation may incrementally fold later records after its last
applied position, but that cache is discarded after process loss and never
replaces complete-history validation on the next establishment.

See [ADR 0004](../adr/0004-compose-pure-run-reducers.md).

## Intent, observation, and retry

Before a request whose outcome may become ambiguous, Dalph records the exact
intent and waits for the append acknowledgement. It then calls the owning
system. After the call it records the exact returned or observed result.

If the response is lost or the process exits after the request, restart sees
the intent without a conclusive result. The same protocol rereads the request's
destination before deciding whether the original request happened and whether
another request is allowed. It reuses the recorded identity; it does not infer
from absent process memory that nothing happened.

This pattern is specialized by each protocol. A claim intent is reconciled
against the tracker claim record; a worktree intent against Git; an executor
responsibility through the Dalph executor, which may consult its execution
substrate internally. There is no generic recovery command that fabricates
authority.

## Failure locality

Discovery accumulates independent physical-row, envelope, payload, identity,
ownership, semantic-history, and reconciliation issues. An unreadable row does
not disappear or turn the Run into an empty history. Dalph preserves the
evidence and fails the affected Run closed.

Manual journal mutation is outside the supported threat model. The Journal
does not provide cryptographic tamper resistance or repair manually altered
history. Crash-consistent append, process death, storage reopening, decoding,
and semantic validation are supported.

A contradiction local to one task, attempt, or resource prevents action in the
region that needs the disputed fact. Independent regions continue when their
next action uses none of it. A condition stops the whole Run only when it
invalidates shared workflow history or a shared capability required by every
otherwise legal continuation.

Responsibility is retained per exact subject. Losing permission to update a
tracker task may end or isolate task-coordination responsibility without
silently disposing its worktree, executor work, accepted result, or integration
resource. Each obligation ends through its own established disposition or a
durable relinquishment supported by current authority evidence.

See [ADR 0005](../adr/0005-track-workflow-responsibility-per-subject.md) and
[issue-55-localize-task-conflicts.md](../scenarios/issue-55-localize-task-conflicts.md).

## Later-activation summary

| Fact | Treatment after process loss |
| --- | --- |
| Run beginning, policy changes, workflow intents, and recorded results | enter the same idempotent establishment path, decode and reduce the complete Journal history, and reconcile every unresolved intent through its owning protocol |
| Tracker tasks, lifecycle, graph, grouping, and claims | use journaled observations for history, then reread the tracker whenever the next decision requires current evidence |
| Git commits, refs, worktrees, and integration state | reread the exact planned locators and compare them with journaled intents and observations |
| Executor work | reconstruct the exact planned-attempt obligation; consult the Dalph executor according to its accepted protocol; substrate inspection remains executor-internal |
| Frontiers, bounded tickets, proposals, runtime owners, timers, and wakeups | discard and rebuild from ordinary services and current signals |
| Task-work positions | derive held positions from exact unfinished responsibilities and the reconstructed policy before admitting new work; never restore the old process-local map |
