# Expire whole archived Run histories

Scope: [#489](https://github.com/dearlordylord/dalph/issues/489), governed by
[#487's accepted chronological scenarios](https://github.com/dearlordylord/dalph/issues/487).
#488's compact results and #489's expiry operation underpin #490's startup and
idle periodic triggers.

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
| 9, 13 | `running-host-capacity-lifecycle.acceptance.test.ts`: **“public terminal inspection keeps the exact result after idle scheduled expiry while the host remains open”** reads HTTP control and verifies publication/result, closed commands and unchanged tracker/Git counts. |
| Ordinary trigger | `journaled-run-bootstrap.test.ts`: **“ordinary terminal settlement retires its history and expires an older whole archived Run”** uses the production settlement composition. |
| Finite portion of 12 | `archive-retention.test.ts`: **“bounds archive maintenance and honestly reports an expired backlog for later ordinary passes”** proves the Run-count bound; **“stops archive selection at exactly one second and progresses on a later pass”** proves the elapsed-time boundary, honest remaining excess/backlog and later progress. Scheduled and startup composition is mapped below. |
| Legacy baseline | Existing `completion.test.ts` backfill/reopen/crash tests remain required; expiry consumes that established baseline. |

Paths above are under `packages/orchestrator/src/workflow-journal/`,
`packages/orchestrator/src/coordination/run/` and
`packages/dalph/src/application/`. Focused checks include these owners and
Available-history TraceReader/storage regressions, physical SQLite, docs,
`check:fast` and one coherent `check:submit`. Controlled transaction cuts and
reopen prove these boundaries, not every power-loss interleaving.

## The existing host maintains archives without another termination

The Operator starts the repository host. Its coordinator lock precedes SQLite
acquisition; SQLite reconciles completion metadata before discovery. Existing
Hot startup validation and retirement still precede establishment. Malformed
or ambiguous Hot history blocks activation under the existing startup rules;
maintenance cannot reinterpret it as terminal. Valid old terminal Hot history
is retired with its established receipt, and unrelated unfinished work remains
recoverable. The established host invokes the same observed retention operation
used by post-termination settlement once at startup.

The host then invokes it one minute after each completed pass, even if no new
Run terminates. The interval does not shorten after failure or backlog. Each
pass selects metadata, starts at most 32 Runs and starts no further unit after
one elapsed second. One atomic unit can exceed that duration; this is no promise
of a one-second storage deadline. A large backlog therefore remains temporarily
over quota and is reported as deferred, then advances through later normal
passes. SQLite holds its storage permit for individual snapshots and atomic
whole-Run deletions, releases it between units, and explicitly yields. A separate
process-local pass permit prevents overlapping retention passes from the same
owner; it grants no independent storage custody and persists no frontier.

Storage failure retains the exact receipt and safe details, emits the typed
maintenance diagnostic/deferred observation, and waits for the next normal
trigger. That pass reads current owning storage facts and reconciles any lost
acknowledgement. The scheduler is scoped to the existing host and registers a
process-local Exit drain. Exit interrupts sleeping or between-unit maintenance;
a SQLite transaction commits or rolls back before custody is released. A
competing coordinator cannot open a mutating Journal. No tracker, Git, executor,
artifact or physical file-compaction boundary is called by maintenance.

### Combined parent evidence ledger

The accepted [parent scenarios](https://github.com/dearlordylord/dalph/issues/487)
govern the combined #488–#490 candidate. Names below describe the exact seams;
store contracts and composed host tests together establish the result.

The [integrated acceptance record](../evidence/issue-487-acceptance.md) binds
this mapping to the exact runtime candidate and named observed test results.

| Parent scenario | Delivered outcome and named evidence |
| --- | --- |
| 1 | Independent receipt and unchanged result: `completion.test.ts`, **“memory/SQLite keeps the same compact terminal result before and after archive retirement”**; public terminal-control test above. |
| 2 | Exact age boundary with protected active work: shared **“memory/SQLite expires complete terminal histories at the 30-day boundary and preserves aged unfinished responsibilities”**. Startup and idle host tests below exercise the owner trigger. |
| 3 | Saved-byte equality and deterministic oldest-first policy: **“enforces saved archive bytes by whole-Run completion order, equality, and oversized histories”**, plus `archive-retention.property.test.ts`. |
| 4 | Actual whole oversized history deletion: **“memory/SQLite deletes an oversized eligible Run as one unit using actual saved bytes”**. |
| 5 | Obligation-bearing histories remain protected by the shared age test and canonical retirement negative cases. |
| 6 | Exact dispositions share policy: `store.test.ts`, **“expires Completed, Blocked, and Cancelled by identical rules and preserves exact receipts”**. |
| 7 | Atomic deletion and ambiguity reconciliation: physical **“SQLite reconciles archive purge before/after commit and acknowledgement loss after physical reopen”**. |
| 8 | Complete overlapping snapshot or Deleted, fresh cursor invalidation: overlapping SQLite test and shared age/TraceReader contract above. |
| 9 | Closed identity before lazy policy/activation: shared lifecycle and completion-only bootstrap tests above; public closed commands after scheduled expiry. |
| 10 | Typed failure, safe unrelated work and no immediate retries: `host-archive-maintenance.test.ts`, **“the owning host observes one storage failure without retrying before the next normal pass”**; physical transaction cuts above and startup-retirement failure composition below. |
| 11 | Conservative adoption: `completion.test.ts`, **“backfills legacy completion receipts without inventing dates or losing histories”**, before/after-commit backfill cases, invalid/contradictory negative cases. `startup-recovery.test.ts`, **“reopens SQLite, reconciles terminal Hot history, and leaves an unrelated active Run discoverable”**, and malformed-Hot blocking cases preserve startup rules. |
| 12 | Finite Run/time bounds and honest later backlog progress: bounded/time tests above. `host-archive-maintenance.test.ts`, **“the host runs startup maintenance once, waits a finite interval and stops on Exit”**; physical startup and idle host tests below. **“the SQLite host yields between archive units and graceful Exit stops at an atomic boundary”** queues an unrelated read behind the first transaction, verifies it before the second, requests actual Exit during that unit, and proves its coherent commit/rollback and a retained third history. |
| 13 | Retained compact outcome and explicit deleted details: public idle-host control/closed-command test above, shared audit/cursor tests and contradictory-completion tests. |
| 14 | Logical saved accounting across physical reopen without VACUUM: physical purge/reopen test above; saved-codec memory/SQLite contracts. |

New composed tests are under `packages/dalph/src/application/`:

- `host-archive-startup.acceptance.test.ts`: **“the owning startup retires aged terminal Hot history before expiry and preserves unrelated unfinished work”** reopens physical SQLite through the actual host graph. Its **“the SQLite host yields between archive units and graceful Exit stops at an atomic boundary”** uses real SQLite transaction cuts and the host Exit boundary.
- `running-host-capacity-lifecycle.acceptance.test.ts`: the public idle scheduled
  expiry test uses a controlled host clock and actual SQLite and HTTP. Activation
  and retention have distinct fixture intervals so a wakeup cannot target the
  wrong owner. It checks unchanged publication/outcome and absence of tracker/Git
  effects after expiry.
- `production-host.test.ts`: the existing physical competing-owner scenario
  observes `journal.maintainArchive` among forbidden mutations by the second host.
- `startup-recovery.test.ts`: immediate and reopened retirement failures still
  return unrelated active work; malformed Hot prefixes block before retirement.

Maintenance changes storage availability and host scheduling only. It adds no
workflow occurrence, admission/finality decision or Quint action. Existing
activation/cancellation and application-Exit obligations remain applicable;
submission formal controls and focused owner/Exit checks qualify the composition.
The physical crash cuts prove the named transaction placements, not every
possible power-loss interleaving. Passing gate totals do not expand this ledger.

### Reopened storage boundary during qualification

Qualification reopened the complete-history cache lifetime boundary: two
`sqlite-scan-retention.test.ts` assertions also failed using the planned Base
`53ecaf61c3595d2c56c515fbd9efbeb3740d7d24` SQLite owner. A heap retaining path
ran through the native driver's prepared-statement cache, its completed fiber,
and the parent Effect span's history-valued exit. Completion queries introduced
an additional cached preparation path inside reads and audits, bypassing the
uncached complete-history query protection.

Completion reads now use the same uncached preparation boundary, containing
native preparation throws as typed storage failures. The original traced
**“releases completed auditAll history while its SQLite store stays open”** and
**“releases the first reopened read array while retaining the current SQLite checkpoint”**
assertions qualify this repair; tracing remains enabled. Completion, physical
crash/reopen, expiry and host tests remain required alongside them. This changes
query-cache lifetime, not historical interpretation, finality or retention policy.

The shared MBT provenance manifest binds changed storage source bytes even when
model transitions and lane options are unchanged. The explicit generator refreshes
the corpus receipts under the current manifest before conformance replay; copied
old receipts do not qualify the changed owner. Activation, cancellation and Exit
conformance preserve their existing decisions and negative controls.
