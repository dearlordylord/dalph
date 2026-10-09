# Read one durable Run completion independently

Scope: [#488](https://github.com/dearlordylord/dalph/issues/488), the first slice of
[#487](https://github.com/dearlordylord/dalph/issues/487). Parent scenarios 1 and
11 and the Available-history identity/integrity portions of 9 and 13 govern
this work. [Deleted-history expiry](archived-run-expiry.md) extends these contracts in #489;
startup and idle periodic scheduling remain pending #490.

## Governing behavior

Dalph accepts termination only under [whole-Run finality](terminate-settled-run.md)
and [D35](../DELIVERY-INVARIANTS.md#progress). The existing canonical reducer
continues to prove that no unsettled responsibility remains. This adds storage
metadata, preserving workflow events, semantic versions and the existing
[lossless retirement](terminal-history-retirement.md). Establishment preserves
[ADR 0011](../adr/0011-establish-runs-idempotently-before-activation.md): a known
completed identity cannot evaluate initial policy or enter activation. No new
workflow decision or formal transition is introduced; existing termination and
identity laws remain unchanged.

## 1. Dalph commits termination and the compact result together

Starting facts: R has a complete valid active chronology and exact canonical
finality evidence. Trigger: Dalph accepts Completed, Blocked or Cancelled.
The store validates the complete prefix, then commits the terminal occurrence
and compact completion record in one memory state transition or SQLite
transaction. Retirement may subsequently move the complete details to Cold.
The Operator reads the same result before and after that move.

A failure before commit preserves the active prefix without a receipt. A lost
acknowledgement after commit leaves both facts present; reopen and exact read
reconcile the result, and repeated termination rejects the closed identity.
Neither retry nor retirement changes disposition, terminal position or time.
No tracker, Git or executor request is needed to inspect storage.

Tests: **“memory/SQLite keeps the same compact terminal result before and after
archive retirement”**, **“SQLite reconciles completion rollback before commit
on reopen”**, and **“SQLite reconciles completion lost acknowledgement after
commit on reopen”** in
[completion.test.ts](../../packages/orchestrator/src/workflow-journal/completion.test.ts).
The shared **“retires Completed, Blocked, and Cancelled histories without
rewriting disposition evidence”** in
[store.test.ts](../../packages/orchestrator/src/workflow-journal/store.test.ts)
checks compact results for all three dispositions.

## 11. Dalph adopts legacy terminal history conservatively

Starting facts: SQLite has supported legacy Hot or Cold terminal histories,
without completion records or trustworthy original dates. An unrelated active
Run may exist. Trigger: Dalph opens the store under its exclusive writer.
Schema generation 3 adds a completion table and terminal-candidate indexes.
Reconciliation selects terminal candidates, canonically validates their full
histories and commits their compact results without moving or deleting details.
The first committed verification time is an explicit conservative baseline;
the original date remains Unknown. Reopening preserves the baseline. Already
recorded results are checked independently, without full replay.

Invalid candidates remain unchanged and exact reads/audits expose their errors.
Cold corruption remains isolated from unrelated Hot discovery. Receipt/history
contradictions are never overwritten. A failed backfill transaction rolls back
its receipts; a lost response after commit preserves the baseline on retry.
Schema creation and adoption are separate recoverable transactions: schema 3
may exist without receipts after interrupted adoption; the next open reconciles.
No provider calls, retention timer, deletion or inferred cancellation occurs.

Tests: **“backfills legacy completion receipts without inventing dates or losing
histories”**, **“memory adopts valid legacy histories and reports invalid terminal
histories unchanged”**, and the two **“SQLite preserves legacy backfill across
... commit”** tests in `completion.test.ts`. Existing physical schema-v1 migration
rollback/reopen and malformed-Cold isolation tests in `store.test.ts` remain
required. These are controlled transaction cuts and physical reopen evidence,
not proof of every OS/power-loss interleaving.

## 9 and 13. The Operator reads completion and the identity stays closed

Starting facts: R has an Available complete history and matching compact result.
The Operator requests public Run control. Dalph reads the stored result and
returns exact identity, target, disposition, terminal position, timing, the last
recorded successful publication when present, and Available history. It does not
replay full history, construct activation, or mutate outside authorities.
Detailed trace reads remain available. Unknown and active Runs have no completion;
the active control path continues to use accepted control history.

Begin, append, repeat termination and exact recovery preserve closure. A foreign
target is rejected; same-target establishment rejects completion before initial
policy. Contradictory receipt bytes, history endpoints or partition membership
fail closed. Public control projections reject disagreements with termination.
Reads do not backfill or repair. There is no crash-sensitive write at inspection;
a new reader obtains the same committed snapshot after retry.

Tests: shared compact-result test above; **“independent SQLite completion reads
do not load any complete partition”**, **“reports contradictory completion
metadata without rewriting it”** in `completion.test.ts`; **“rejects a terminated
Run before constructing activation”** and **“rejects a reopened cold SQLite Run
before constructing activation”** in
[journaled-run-bootstrap.test.ts](../../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts).
The memory bootstrap test forbids both read and scan to prove the independent
path. Highest public boundary:
**“capacity reads and writes on a terminal Run return its accepted position
without another append”** in
[running-host-capacity-lifecycle.acceptance.test.ts](../../packages/dalph/src/application/running-host-capacity-lifecycle.acceptance.test.ts)
reads HTTP Run control and asserts the compact result, recorded publication,
unchanged history and unchanged tracker/Git calls.

## Read contract and evidence limits

`JournalStore.readCompletion` returns `NoCompletion` or `CompletedRun`, with a
separate typed history availability. Expiry subsequently produces Deleted with reason and observation time. The
completion row contains no original finality tree. SQLite reads check receipt
checksum and fingerprints of the beginning, terminal and last publication rows
in one serialized transaction; they do not decode those event payloads or replay
history. Full audits validate the entire chronology and its compact result.
Fingerprints detect accidental contradictions; they are not tamper resistance,
and a compact read cannot establish the validity of every interior event after
unsupported manual mutation. Existing schema decoding and canonical audit own
that evidence. Stored publication proves what Dalph recorded at its exact
position, never the receiving branch's current contents.

Completion records remain durable independently of detail placement. Available
without its required endpoints is corruption. The subsequent expiry owner produces Deleted only atomically with complete
detail removal. Evidence bundles and other archive artifacts are not deleted.
