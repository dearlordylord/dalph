# Expire whole archived Run histories

Scope: [#489](https://github.com/dearlordylord/dalph/issues/489), governed by
[#487's accepted chronological scenarios](https://github.com/dearlordylord/dalph/issues/487).
#488's compact results are established before this work. Startup and idle
periodic triggers remain #490.

## Governing behavior

Dalph's exclusive Journal owner acts after ordinary accepted terminal settlement
and [lossless retirement](terminal-history-retirement.md#subsequent-expiry-refines-the-lossless-guarantee).
[D35](../DELIVERY-INVARIANTS.md#progress) and canonical finality still authorize
terminality, including absence of owed work; age and pressure do not replace that
proof. [D32](../DELIVERY-INVARIANTS.md#process-and-durability) now explicitly permits
whole archived-detail expiry. The workflow and its formal termination/admission
laws do not change: maintenance is storage availability, not a workflow event.

## The owner removes details and the Operator keeps the result

Starting facts: R has canonical settled terminal Cold history and an established
matching compact result. A has unfinished responsibilities. Git, tracker and
executor facts remain those accepted before settlement; maintenance calls none
of those boundaries. The normal terminal settlement of another Run starts one
finite pass after retirement. The owner captures UTC milliseconds, selects
storage metadata, first removes histories whose known completion or conservative
legacy baseline plus 30 elapsed days is at or before that time, then oldest
eligible whole histories while saved bytes exceed 268,435,456. Equality requires
no budget deletion. Equal baselines use RunId order. Younger and oversized
eligible histories have no minimum guaranteed retention under pressure.

Before each exact deletion the owner rereads storage, checks the compact result
and canonically validates that whole history. It removes all detail rows and
records Deleted, reason and captured observation time in one state transition
or SQLite transaction. It changes no immutable receipt field. A failure before
commit rolls back; a lost response after commit rereads exact availability
before any retry. A later ordinary pass selects current storage facts again.
Thirty-two units or one elapsed second stops selection at a safe whole-Run
boundary. Remaining expired backlog and byte excess are reported honestly.
Storage failure emits an observation and preserves unrelated active work.

The Operator reads the same completion and explicit Deleted details. An unknown
Run remains unknown. An overlapping read sees its complete established snapshot
or Deleted; fresh store and TraceReader requests never return a stale prefix.
Audit enumerates completion-only Runs without claiming replayed evidence.
Begin, append, terminate, recovery and establishment retain closed identities;
foreign targets remain mismatches. Initial policy, activation and external
effects cannot run for a completion-only identity. Clock rollback neither expires
immature history nor restores Deleted details.

Forbidden: partial row prefixes, deletion of unfinished/obligation-bearing or
malformed history, altered dispositions, empty successful deleted cursors,
convenient receipt repair, a second writer, immediate failure retry loop, automatic
VACUUM, archive-only daemon, artifact collection or a total-file cap. Physical
SQLite bytes may remain allocated while logical saved bytes fall.

## Acceptance mapping

| Parent scenario | Named test and owning boundary |
| --- | --- |
| 2, 5, 8, 9, 13 | `archive-retention.test.ts`: **“memory/SQLite expires complete terminal histories at the 30-day boundary and preserves aged unfinished responsibilities”** checks shared storage, saved accounting, TraceReader cached cursors, closed identity and completion-only audit. |
| 3, 4 | `archive-retention.property.test.ts` generates age/byte/order combinations against the production policy.  `archive-retention.test.ts`: **“enforces saved archive bytes by whole-Run completion order, equality, and oversized histories”** uses the production policy with controlled saved-byte facts; **“memory/SQLite deletes an oversized eligible Run as one unit using actual saved bytes”** exercises actual codecs and stores. |
| 6 | `store.test.ts`: **“expires Completed, Blocked, and Cancelled by identical rules and preserves exact receipts”**; existing canonical retirement negative cases preserve obligations and malformed prefixes. |
| 7, 10, 14 | `archive-retention.test.ts`: **“SQLite reconciles archive purge before/after commit and acknowledgement loss after physical reopen”** proves atomic physical rows, receipt survival, deferred failures, reconciliation and zero logical archive bytes without VACUUM. |
| 8 | `archive-retention.test.ts`: **“SQLite distinguishes expired details from unknown Run across overlapping reads”** serializes a real read and purge transaction. |
| 9, 13 | `journaled-run-bootstrap.test.ts`: **“rejects a completion-only Run before evaluating policy or constructing activation”** and **“rejects a reopened completion-only SQLite Run before constructing activation”**. |
| 9, 13 | `running-host-capacity-lifecycle.acceptance.test.ts`: **“public terminal inspection keeps the exact result after owned expiry while the host remains open”** reads HTTP control and verifies publication/result, closed commands and unchanged tracker/Git counts. |
| Ordinary trigger | `journaled-run-bootstrap.test.ts`: **“ordinary terminal settlement retires its history and expires an older whole archived Run”** uses the production settlement composition. |
| Finite portion of 12 | `archive-retention.test.ts`: **“bounds archive maintenance and honestly reports an expired backlog for later ordinary passes”**. Startup/idle triggers remain #490. |
| Legacy baseline | Existing `completion.test.ts` backfill/reopen/crash tests remain required; expiry consumes that established baseline. |

Paths above are under `packages/orchestrator/src/workflow-journal/`,
`packages/orchestrator/src/coordination/run/` and
`packages/dalph/src/application/`. Focused checks include these owners and
Available-history TraceReader/storage regressions, physical SQLite, docs,
`check:fast` and one coherent `check:submit`. Controlled transaction cuts and
reopen prove these boundaries, not every power-loss interleaving.
