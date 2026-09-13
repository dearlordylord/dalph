# Capacity and Unpause interruption research

## Question and concrete cuts

An attached client can disappear while Dalph is changing capacity or applying
Run Unpause. This round asks what a fresh caller can prove afterward, and what
changes when the command runs in the client request fiber versus an existing
host scope.

The source exposes four distinct chronological cuts:

1. **Before service invocation.** The request fiber has received the decoded
   request but has not called the real control service. No append is attempted.
2. **After INSERT, before COMMIT.** SQLite's test-only `onAppendInserted` hook
   runs inside `sql.withTransaction`, immediately after the real INSERT
   ([sqlite-store.ts](../packages/orchestrator/src/workflow-journal/adapters/sqlite-store.ts#L203)). The real live Journal masks interruption across this point.
3. **After COMMIT, before storage acknowledgement and journal publication.**
   `afterAppendCommit` runs after `sql.withTransaction` and before the SQLite
   checkpoint is published or the append record is returned
   ([sqlite-store.ts](../packages/orchestrator/src/workflow-journal/adapters/sqlite-store.ts#L207)).
4. **After the control service returns, before response delivery.** The service
   and live journal have accepted the record, but an outer request adapter has
   not delivered the result to its client.

The disposable probe does not call cut 2 or cut 3 “mid-COMMIT.” SQLite exposes
no hook inside the database engine's commit operation. Cut 2 is inside the
transaction before COMMIT; cut 3 is after COMMIT. The actual engine midpoint
remains unobservable with existing seams.

## Source findings before execution

### SQLite commit and cancellation boundary

The SQLite adapter serializes append, loads its current checkpoint, checks
the exact record key, performs the INSERT inside `sql.withTransaction`, and
only then runs `afterAppendCommit` and publishes the new process-local
checkpoint ([sqlite-store.ts](../packages/orchestrator/src/workflow-journal/adapters/sqlite-store.ts#L179)). Any failed or interrupted exit invalidates the cached checkpoint so a later caller must reread storage. Existing focused coverage already proves that a failure injected after COMMIT leaves one durable row and that an exact append returns that committed duplicate without reinserting
([sqlite-warm-append.test.ts](../packages/orchestrator/src/workflow-journal/sqlite-warm-append.test.ts#L104)).

Above that adapter, the real live `Journal.append` wraps the complete storage
append and accepted-record publication in `Effect.uninterruptible`
([journal.ts](../packages/orchestrator/src/coordination/delivery/journal.ts#L345)). Therefore request-fiber interruption after the control service enters
`Journal.append` is deferred until SQLite returns and the live accepted prefix
is published. Interruption at cut 2 does not roll back the INSERT through the
real capacity/control boundary; the gate must be released, COMMIT completes,
and the record becomes accepted before cancellation finishes. A raw
`JournalStore.append` call lacks this outer mask and has different semantics,
but it is not the capacity or control service under investigation.

The in-memory adapter changes its immutable state in one synchronous `Ref.modify`
([memory-store.ts](../packages/orchestrator/src/workflow-journal/adapters/memory-store.ts#L237)). It cannot represent SQLite's INSERT/COMMIT/acknowledgement cuts, so the executable probe uses real SQLite.

### Capacity

`TaskWorkCapacityControl.apply` reads the accepted policy, checks
`expectedRevision`, and appends the next revision under a revision-derived key
([task-work-capacity.ts](../packages/orchestrator/src/control/task-work-capacity.ts#L93)). An exact duplicate event at the same key is an idempotent journal replay; a later accepted-policy read sees the newer revision and instead returns the complete current policy as `TaskWorkCapacityPolicyRevisionConflict`.

Through the real live Journal, interruption cannot land between SQLite COMMIT
and accepted-prefix publication. Once append begins, cancellation completes
only after accepted history contains the new revision. Exact retry therefore
returns the complete current policy as a conflict, both in the still-open
runtime and after reopening from SQLite, with one capacity-change record.

### Unpause

`ControlDirectionApplication.apply` reads accepted history, counts existing
control records, and derives the next ordinal; its request has neither a request
identity nor an expected revision
([protocol.ts](../packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.ts#L34)).

Once live-Journal append begins, cancellation completes only after accepted
history includes the new ordinal. Exact retry in either the still-open runtime
or a reopened runtime therefore derives the next ordinal and appends a second
Unpause occurrence.

An intervening Pause makes the latter replay unsafe: the repeated Unpause is a
newer direction and overrides it. Capacity's expected revision prevents the
corresponding blind overwrite.

### Request ownership versus host ownership

A command executed directly in the request fiber is interrupted with that
fiber before service invocation, but the live Journal defers interruption once
its atomic append begins. Effect's `forkIn(command, scope)` separately makes
the command fiber a child of the supplied scope. If the request fiber merely
waits for that host-owned fiber, interrupting the waiter does not interrupt the
command; the command continues until it finishes or the host scope closes. The
probe uses the already-open test scope as the host lifetime and the unchanged
control and SQLite services. It adds no journal protocol or fake persistence.

### Accepted Run control and its owner callback

The bootstrap handles inactive-Run control by establishing a live journal,
calling the real `ControlDirectionApplication`, and only afterward invoking the
registered accepted-Run-control observer in `Effect.tap`
([journaled-run-bootstrap.ts](../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts#L1062)).
The live Journal's interruption mask ends before this bootstrap callback.
Consequently, an interruption requested while the append is gated can become
effective after accepted-prefix publication and before the observer runs.

The probe constructs this exact inactive `JournaledRunBootstrap` fallback over
SQLite, registers a control observer, and interrupts Unpause at the
post-INSERT/pre-COMMIT gate. After the gate is released, SQLite contains ordinal
1 but the observer count is zero. An exact retry records ordinal 2 and invokes
the observer once. This proves a gap between accepted control persistence and
the bootstrap callback. It does not instantiate the reactivation owner, so it
does not directly prove a timer's state or what later reconciliation does.

## Executable validation

Run from the repository root:

```sh
pnpm exec vitest run --config research/prototypes/invokee-command-interruption/vitest.config.ts --reporter verbose
```

Observed on 2026-09-13 at repository commit
`684aba853903cf1d1fc7f33e6af666f2bf37c915`:

```text
Test Files  1 passed (1)
Tests       7 passed (7)
Duration    12.74s
```

| Cut | Direct request result | Exact capacity retry | Exact Unpause retry |
| --- | --- | --- | --- |
| Before service invocation | interrupted; zero command records | applied; one record | applied at ordinal 1; one record |
| After INSERT, before COMMIT | interruption remained pending until gate release; append then finished with one accepted record | revision conflict; still one record | applied at ordinal 2; two records |
| After COMMIT, before checkpoint publication | interruption remained pending until gate release; fresh runtime read one durable record | revision conflict; still one record | applied at ordinal 2; two records |
| After service return, before response | interrupted after one accepted record | revision conflict; still one record | applied at ordinal 2; two records |

When the unchanged command effect was forked into the already-open host/test
scope, interruption of the request waiter completed while the command remained
pending at the SQLite gate. Releasing the gate let the command finish and left
one accepted record. The negative control closed the command-owning scope before
service invocation and observed zero command records.

Retries use the same live harness except the post-COMMIT row, which closes it
and opens a fresh runtime from SQLite before retrying.

Each protected-append gate is released before assertions or child-fiber cleanup.
Those tests and the bootstrap/host-scope cases explicitly check the request's
final `Exit` for interruption. The before-service and before-response cases
interrupt a request held on an unreleased gate; that gate prevents normal
completion, but those two cases do not inspect the final `Exit` separately.

## Scenario-to-test mapping

| Operational chronology | Acceptance test |
| --- | --- |
| Alice disconnects after decoding but before Dalph calls the control service; no mutation occurs and a later caller can apply it. | `interrupts before service invocation and a fresh exact request applies once` |
| Alice disconnects after SQLite inserted the command record but before transaction COMMIT; the live Journal finishes its atomic append before cancellation is observed. | `defers request interruption during the real INSERT until the atomic live-Journal append finishes` |
| Alice disconnects after COMMIT but before the SQLite checkpoint and accepted prefix are published; a new runtime reconstructs the durable result. | `defers interruption after COMMIT until live-Journal publication and distinguishes a fresh runtime` |
| The service accepted Alice's command but its response was lost; capacity detects the stale revision while Unpause creates a new occurrence. | `distinguishes response loss after the real service has accepted the record` |
| Alice disconnects while a command owned by the existing host scope is gated; the host continues the command after the request waiter ends. | `keeps a command running in the existing host scope after its request fiber is interrupted` |
| An accepted inactive-Run Unpause survives interruption, but interruption lands before the bootstrap tells its registered control observer. | `can skip the inactive bootstrap control observer after persisting Unpause and invokes it on exact retry` |
| The owning command scope closes before service invocation; no append may occur. | `negative control: closing the owning scope before service invocation leaves no command record` |

## Evidence classification and limits

**Proven by source and this executable probe:** the real live Journal defers
interruption across its SQLite append and accepted-record publication; capacity
retry reports the accepted current revision without adding a record; Unpause
retry adds a new ordinal; a command forked into an existing scope outlives the
request waiter; and the inactive bootstrap can persist Unpause yet skip its
post-apply observer when interruption becomes effective.

**Inferred from the accepted direction ordering:** if another caller records
Pause after a response-lost Unpause, blindly replaying Unpause records a newer
direction and overrides that Pause. The probe proves that replay is a new
ordinal, while the harmful intervening-client chronology was validated in the
separate control replay experiment.

**Open or deliberately unclaimed:** existing seams cannot stop inside SQLite's
COMMIT engine operation. The hooks bracket COMMIT instead. The host-owned case
uses an existing Effect scope with real services and SQLite, rather than a full
production repository host or HTTP connection. The exact bootstrap observer
case does not instantiate the reactivation owner, so owner timer state and
reconciliation remain outside this probe. No result here establishes a general
exactly-once request guarantee.
