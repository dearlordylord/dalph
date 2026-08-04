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

## Complete-history reconstruction

After restart and while holding coordinator ownership, Dalph scans every
physical journal row and discovers every recoverable Run without an age cutoff.
It validates each Run's complete record history in canonical position order
before it allows that Run to continue.

Journal storage, decoding, and reduction are separate seams:

1. Storage returns every physical row in canonical order.
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
models. The live process may incrementally fold later records after its last
applied position, but that cache is discarded after process loss and never
replaces complete-history validation.

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

## Restart summary

| Fact | Restart treatment |
| --- | --- |
| Workflow intents and recorded results | decode and reduce the complete Journal history; reconcile every unresolved intent through its owning protocol |
| Tracker tasks, lifecycle, graph, grouping, and claims | use journaled observations for history, then reread the tracker whenever the next decision requires current evidence |
| Git commits, refs, worktrees, and integration state | reread the exact planned locators and compare them with journaled intents and observations |
| Executor work | reconstruct the exact planned-attempt obligation; consult the Dalph executor according to its accepted protocol; substrate inspection remains executor-internal |
| Frontiers, bounded tickets, proposals, runtime owners, positions, timers, and wakeups | discard and rebuild from ordinary services and current signals |
