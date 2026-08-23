# Retire terminal workflow-journal history without changing its meaning

Issue: [#70 — Archive terminal history losslessly](https://github.com/dearlordylord/dalph/issues/70)

Status: accepted operational scenarios; the implementation and test evidence
are being delivered while the owning issue remains open. This file is the
durable scenario register for the issue. The physical `Hot`/`Cold` placement
described here is storage provenance, not a workflow state, termination
disposition, archival Boolean, or Quint subject state.

The actor in these chronologies is normally Dalph's application maintenance or
startup code; no person directly requests Journal retirement. GitHub, Git, the
task tracker, and the executor are not called by retirement because moving
already-terminated Journal records cannot authorize workflow work or mutate an
external authority. Where a chronology names an active Run, it means the
Journal contains a complete valid prefix ending before
`WorkflowRunTerminated`; where it names a terminal Run, the final record is a
valid termination with its exact `RunTerminationDisposition` and
`RunFinalityEvidence`.

## 1. Dalph retires a newly terminated Run

Starting facts: Dalph owns active Run R, and R's complete valid history is in
the hot Journal partition. No GitHub, Git, tracker, or executor call is
needed for the maintenance action.

Trigger and boundary order:

1. Dalph proves the accepted global termination predicate.
2. `JournalStore.terminateRun(R, disposition, evidence)` appends exactly one
   `WorkflowRunTerminated` record. That append commits independently.
3. The same owner calls `JournalStore.retireTerminalRun(R)` once. The store
   reads and reduces the complete hot prefix, proves the final termination,
   copies every persisted row to Cold, verifies positions, keys, versions,
   kinds, and payload bytes, then deletes the hot rows in one transaction.
4. A later `JournalStore.read(R)` and TraceReader read the complete prefix.

Visible result: a maintainer sees the same ordered history, disposition,
causality, and evidence references. Forbidden result: no archive workflow
event, renumbering, omitted evidence, partial copy, or changed workflow
meaning.

Acceptance tests: the shared `JournalStore` test named **“atomically retires
every valid terminal history and keeps reads transparent”** in
`packages/orchestrator/src/workflow-journal/store.test.ts` runs for memory and
SQLite; **“reads actual Cold memory and reopened SQLite history with identical
cursors, causality, and evidence”** in
`packages/orchestrator/src/presentation/trace-reader.test.ts` proves the
presentation result after the move.

## 2. Every terminal disposition is eligible

Starting facts: three independent Runs have complete valid prefixes and
terminate as `Completed`, `Blocked`, and `Cancelled`, each with its own exact
termination evidence. No external authority is called by retirement.

Trigger and boundary order: for each Run, the owner calls
`terminateRun`, then `retireTerminalRun`; the store validates terminality and
copies the complete prefix without interpreting the disposition. A later
`read` obtains Cold records and the history reducer sees the original final
event.

Visible result: all three Runs are Cold and retain their original disposition
and evidence. Forbidden result: restricting retirement to `Completed`,
rewriting another disposition as `Completed`, or retiring an unfinished Run.

Acceptance test: **“retires Completed, Blocked, and Cancelled histories
without rewriting disposition evidence”** in `store.test.ts`, executed by the
memory and SQLite contract layers.

## 3. Retirement fails after termination commits

Starting facts: R has a committed valid `WorkflowRunTerminated` record and is
still entirely Hot. The storage boundary can fail the immediate retirement;
termination has already become workflow truth.

Trigger and boundary order: the application calls
`JournalStore.retireTerminalRun(R)` once. The controlled boundary returns one
typed `JournalStorageUnavailable` failure naming the exact operation. The
maintenance observer receives one `JournalMaintenanceDiagnostic` naming R and
that failure. No timer or repeat schedule is started, and the owner can keep
serving unrelated active work.

Visible result: R remains complete, readable, and Hot; its successful terminal
result is unchanged. Forbidden result: erasing termination, reporting R as
unfinished, partially moving rows, retrying on a timer, or failing unrelated
active work.

Acceptance tests: **“reports one immediate retirement diagnostic after
termination commits and keeps the terminal Run Hot”** in
`journaled-run-bootstrap.test.ts`; **“reports one immediate terminal-Hot
retirement failure and still returns the unrelated active memory Run”** and
**“reopens SQLite, reports one failed terminal-Hot reconciliation, and still
returns the active Run”** in `startup-recovery.test.ts`.

## 4. Startup reconciles terminal history left Hot

Starting facts: the previous process committed R's termination but stopped
before maintenance. R's complete valid prefix remains Hot; there is no archive
marker or persistent debt row. Another valid unfinished Run A may be Hot.

Trigger and boundary order: startup calls `scanHot`, validates and reduces Hot
histories, and exact-reads the requested Run through `JournalStore.read` when
the requested identity is no longer in Hot. It recognizes terminal R as
retirement work, calls `retireTerminalRun(R)` once, and then selects A for
ordinary recovery. If retirement fails, the observer receives one typed
diagnostic and A is still returned as the active history.

Visible result: successful startup leaves R Cold and lets A proceed; failed
maintenance leaves R complete and Hot while A remains recoverable. Forbidden
result: reactivating R, counting R as unfinished, requiring an archive Boolean,
or blocking safe active work because maintenance degraded.

Acceptance tests: **“retires terminal Hot memory history while allowing an
unrelated active Run to proceed”**, **“reports one immediate terminal-Hot
retirement failure and still returns the unrelated active memory Run”**,
**“reopens SQLite, reconciles terminal Hot history, and leaves an unrelated
active Run discoverable”**, and **“reopens SQLite, reports one failed
terminal-Hot reconciliation, and still returns the active Run”** in
`startup-recovery.test.ts`; the actual bootstrap paths are **“rejects a
terminated Run before constructing activation”** and **“rejects a reopened
cold SQLite Run before constructing activation”** in
`journaled-run-bootstrap.test.ts`.

## 5. A crash cannot expose half-retired history

Starting facts: R is valid, terminal, and entirely Hot. A process may stop
before the move starts, while the SQLite transaction is uncommitted, or after
commit but before the caller receives the result.

Trigger and boundary order: before transaction commit, rollback leaves all
rows Hot. After a committed but unacknowledged move, a reopened store checks
actual Hot/Cold membership and returns the already-Cold result without copying
again. Every read chooses one complete partition, and `auditAll` reports one
owner.

Visible result: R is either complete Hot or complete Cold. Forbidden result:
missing rows, split membership, duplicates, a restarted position sequence, or
an empty read during a crash cut.

Acceptance tests: the property case **“makes terminal-history retirement
idempotent and keeps one exclusive partition”** in
`retirement.property.test.ts`; SQLite **“rolls back a failed v1-to-v2
migration without changing the v1 hot journal”**, **“reopening after a
committed v1 migration does not repeat or retire the hot history”**, and the
shared retirement contract cover transaction/reopen behavior. The store
rollback test uses an explicit controlled migration cut, not a production-only
index or view.

## 6. A trace read overlaps retirement

Starting facts: R is terminal and Hot. A TraceReader caller and maintenance
may overlap; neither caller owns a workflow mutation or invokes GitHub, Git,
tracker, or executor boundaries.

Trigger and boundary order: the read obtains a storage snapshot through
`JournalStore.read`; retirement validates and atomically moves the complete
prefix. The read therefore sees either the complete Hot snapshot or the
complete Cold snapshot. A second read after the move uses the normal
two-partition lookup.

Visible result: the caller gets one complete, ordered, contiguous history with
the same identities. Forbidden result: empty, mixed, duplicated, or gapped
history. Acceptance evidence is the property test **“makes a concurrent
in-memory read observe one complete partition state, never a partial move”**
plus the shared memory/SQLite contract **“atomically retires every valid
terminal history and keeps reads transparent”** in `store.test.ts`.

## 7. Historical reads are transparent after retirement

Starting facts: R is entirely Cold. Its history begins at position one and
contains explicit predecessor relationships, graph observations, and evidence
references. A trace consumer holds an exact `(RunId, JournalPosition)` cursor.

Trigger and boundary order: `JournalStore.read(R)` checks both partitions and
returns the complete Cold prefix. TraceReader performs the same validation and
projection used for Hot history. Cursor-at-position, predecessor, graph-at-
cursor, fold, and evidence-reference reads do not restore R to Hot and do not
call an external authority.

Visible result: a maintainer or trace consumer cannot tell that placement is
Cold. Forbidden result: presentation-local positions, inferred adjacency,
omitted Cold rows, or storage mutation during a read.

Acceptance tests: **“reads actual Cold memory and reopened SQLite history with
identical cursors, causality, and evidence”** in `trace-reader.test.ts`; the
property **“keeps the canonical reducer and read-only trace projection
equivalent across retirement”** in `retirement.property.test.ts`; and the
shared retirement/read contract in `store.test.ts`.

## 8. A retired RunId cannot be reused or extended

Starting facts: R is entirely Cold and terminal. A later caller redelivers R's
RunId or attempts another workflow record. No external boundary is needed to
decide this identity conflict.

Trigger and boundary order: `beginRun(R)` checks both partitions and returns
`WorkflowRunAlreadyBegan`; `append(R, ...)` and `terminateRun(R, ...)` reject
the Cold terminal history; `readRunForRecovery(R, target)` returns
`WorkflowRunAlreadyTerminated`. Ordinary `JournaledRunBootstrap.activate` uses
the same durable fact before entering initial policy or runtime activation.

Visible result: R remains one complete Cold history and closed. Forbidden
result: another beginning, restarted positions, an append after termination,
or `WorkflowRunNotBegan`.

Acceptance tests: the shared contract **“atomically retires every valid
terminal history and keeps reads transparent”** and **“rejects every workflow
record after Run termination”** in `store.test.ts`; **“rejects a terminated Run
before constructing activation”** and **“rejects a reopened cold SQLite Run
before constructing activation”** in `journaled-run-bootstrap.test.ts`; and
the production-owner tests **“keeps a cold terminal memory Run closed in
production-shaped reactivation”** and **“keeps a reopened SQLite cold terminal
Run closed in production-shaped reactivation”** in
`packages/dalph/src/application/production-reactivation.test.ts`.

## 9. Nonterminal history cannot retire

Starting facts: R is unfinished, paused, quarantined, temporarily quiescent,
or merely old; its complete prefix has no valid final `WorkflowRunTerminated`.
No age or inactivity signal is an authority fact, and no external provider is
called.

Trigger and boundary order: maintenance calls `retireTerminalRun(R)`; the
store reduces the prefix and returns `JournalHistoryNotTerminal` without
copying or deleting any row. `scanHot` and `auditAll` still locate R in Hot.

Visible result: recoverable responsibility remains Hot and readable. Forbidden
result: retirement inferred from age, inactivity, a bare event tag, storage
pressure, or a partial terminal evidence set.

Acceptance tests: **“rejects retirement for a valid nonterminal history
without moving rows”** in the shared memory/SQLite contract and the property
case **“never treats a valid nonterminal prefix as eligible for retirement”**
in `retirement.property.test.ts`.

## 10. Malformed Hot history blocks safe startup

Starting facts: Hot history is malformed, gapped, undecodable, or otherwise
cannot be reduced far enough to determine whether it owns live responsibility.
GitHub, Git, tracker, and executor are not called because the Journal fact is
not safe to interpret.

Trigger and boundary order: startup calls `scanHot`; validation/reduction
returns a partition-scoped corruption issue. `inspectStartupRecovery` returns
`StartupRecoveryBlocked` before constructing initial policy or runtime and does
not attempt retirement.

Visible result: the exact corruption remains visible and no workflow work
starts. Forbidden result: automatic quarantine, assuming terminality,
retirement, or starting another Run around possibly live responsibility.

Acceptance tests: **“blocks memory startup before any retirement when a Hot
prefix is malformed”** and **“blocks reopened SQLite startup before activating
around a malformed Hot prefix”** in `startup-recovery.test.ts`; bootstrap
**“blocks runtime construction when the freshly read journal prefix is
invalid”** in `journaled-run-bootstrap.test.ts`.

## 11. Cold corruption is isolated from active startup

Starting facts: an old Cold history is unavailable or malformed while Hot
histories remain valid. Ordinary startup must only discover Hot histories;
the caller asking for the damaged Cold Run and a maintainer requesting a full
audit are distinct boundaries.

Trigger and boundary order: `scanHot` validates only Hot and permits safe
active recovery. An exact `read(R)` returns a typed error scoped to R when the
Cold prefix cannot decode or reduce. `auditAll` scans both partitions and
reports the Cold issue and Run identity.

Visible result: active Hot startup proceeds, while inspection/audit exposes the
Cold defect. Forbidden result: a partial Cold trace, a false successful audit,
or silently turning Cold corruption into a global startup block.

Acceptance test: SQLite **“keeps malformed Cold history out of startup while
full audit reports its partition and exact Run”** in `store.test.ts`, together
with the exact-read and full-audit portions of the shared corruption contract.

## 12. Contradictory partition membership fails closed

Starting facts: unsupported manual modification or corruption makes R appear
in both Hot and Cold. No actor is allowed to choose one copy as authoritative.

Trigger and boundary order: exact `read`, `beginRun`, `append`,
`readRunForRecovery`, `terminateRun`, `retireTerminalRun`, and `auditAll`
detect contradictory membership and return `JournalPartitionContradiction`.
No row is mutated and no external authority is called.

Visible result: the contradiction is explicit and recoverable by a deliberate
repair process outside this issue. Forbidden result: merging prefixes,
guessing which partition wins, appending to either copy, or deleting one copy
automatically.

Acceptance tests: memory **“fails every memory operation closed when a Run is
in both partitions”** and SQLite **“fails SQLite reads, lifecycle, retirement,
and full audit closed on contradictory partition membership”** in
`store.test.ts`.

## 13. A supported schema-v1 SQLite Journal upgrades without losing Hot history

Starting facts: no person triggers migration; Dalph opens a supported schema-v1
SQLite database containing exact Hot rows in `journal_records`, with no Cold
table. GitHub, Git, tracker, and executor are not called because migration
precedes workflow activation.

Trigger and boundary order: the SQLite open boundary reads the migration
version, creates `journal_records_cold` with the same identity constraints,
retains every existing Hot row, and commits the new supported version in one
transaction. A pre-commit process loss or controlled migration failure rolls
back to the complete v1 schema. A committed-but-unacknowledged migration is
reopened; the current version is recognized without repeating or retiring
rows. A newer unsupported version fails with `JournalSchemaIncompatible`.

Visible result: every original exact read remains Hot and unchanged, and Cold
is empty after migration. Forbidden result: terminal-row movement during
migration, duplicate rows, reset positions, premature store exposure, or
treating a newer schema as current.

Acceptance tests: **“upgrades an exact schema-v1 fixture transactionally and
preserves hot rows”**, **“rolls back a failed v1-to-v2 migration without
changing the v1 hot journal”**, **“reopening after a committed v1 migration
does not repeat or retire the hot history”**, **“rejects a journal schema from
a newer Dalph version”**, and property **“preserves generated schema-v1
Run-begin rows and leaves Cold empty through migration”** in `store.test.ts`
and `retirement.property.test.ts`.

## 14. A retired terminal Run remains closed to the reactivation owner

Starting facts: no person triggers this maintenance chronology. R is entirely
Cold, its final record is valid `WorkflowRunTerminated`, and the process-local
reactivation owner has no prior timer, queue, or control state. GitHub, Git,
tracker, and executor are not called because the exact Journal control read
proves durable closure.

Trigger and boundary order:

1. Hot startup discovery does not treat Cold R as an unfinished Run.
2. The production-shaped owner attaches its accepted-control observers and
   performs its mandatory exact current Journal read.
3. `read(R)` checks both partitions and reconstructs `RunTerminated`.
4. The owner closes without starting its bounded timer or consuming a startup
   hint. A direct ordinary `JournaledRunBootstrap.activate` also reads the
   Cold history and returns `WorkflowRunAlreadyTerminated` before initial
   policy, runtime, tracker, Git, executor, or provider calls.

Visible result: R remains inspectable and closed. Forbidden result:
classifying R as absent, creating another beginning, scheduling polling,
activating workflow work, calling tracker/Git/executor/provider boundaries, or
creating replacement ownership. The raw `JournalStore.beginRun` reuse guard is
a separate storage-contract assertion, not the ordinary establishment proof.

Acceptance tests: **“rejects a terminated Run before constructing activation”**
and **“rejects a reopened cold SQLite Run before constructing activation”** in
`journaled-run-bootstrap.test.ts`; and **“keeps a cold terminal memory Run
closed in production-shaped reactivation”** plus **“keeps a reopened SQLite
cold terminal Run closed in production-shaped reactivation”** in
`packages/dalph/src/application/production-reactivation.test.ts`. The latter
asserts one real control read, zero timer state transitions, zero activation,
tracker, Git, executor, and provider calls; the former asserts the real
bootstrap failure and that the activation program is never entered.

## Scenario-to-test index

| Chronology | Executable acceptance seam |
|---|---|
| 1 | `store.test.ts` “atomically retires every valid terminal history and keeps reads transparent”; `trace-reader.test.ts` “reads actual Cold memory and reopened SQLite history with identical cursors, causality, and evidence” |
| 2 | `store.test.ts` “retires Completed, Blocked, and Cancelled histories without rewriting disposition evidence” |
| 3 | `journaled-run-bootstrap.test.ts` immediate diagnostic test; memory/SQLite startup failure tests |
| 4 | All four terminal-Hot startup reconciliation tests; both bootstrap cold-history tests |
| 5 | `retirement.property.test.ts` idempotence property; SQLite migration rollback/reopen tests |
| 6 | `retirement.property.test.ts` concurrent in-memory partition property and shared retirement/read contract |
| 7 | TraceReader Cold memory/SQLite/reopen parity; trace/reducer property |
| 8 | Shared lifecycle contract and both real bootstrap cold-history tests |
| 9 | Shared nonterminal rejection and nonterminal property |
| 10 | Memory/SQLite malformed-Hot startup tests and invalid-prefix bootstrap test |
| 11 | SQLite malformed-Cold startup/full-audit test |
| 12 | Memory and SQLite contradictory-partition contract tests |
| 13 | SQLite schema-v1 migration, rollback, reopen, newer-schema, and property tests |
| 14 | Both real bootstrap cold-history tests plus both production-shaped owner tests |
