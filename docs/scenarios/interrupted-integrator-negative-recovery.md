# Recover an exact interrupted Integrator turn as NotPrepared

The Run owner reopens an exact durably observed Integrator turn after old native
provider custody is proved stopped. The user accepted this chronology on
2026-10-10 in issue #514. Qualified #513 source is composed locally; this does
not establish its publication.

## Governing behavior

This refines [S4 crash and reopen](direct-remote-publication.md#crash-and-reopen)
only for actual interrupted native status. Completed without an exact hint
remains pending. The existing NotPrepared/quarantine workflow algebra, Retry
and first authorized FullRerun remain unchanged; no generic workflow, journal,
control or Quint model change is introduced. Executor Resume is separate.

## Starting facts and ordered boundaries

S/W/X/thread token/T/K/ordinal/C/Base and old provider incarnation are durable;
no private or workflow result is sealed. Ordinary Run activation reconciles old
writer custody and acquires the native provider. It subscribes for exact X/T
before one recovery read/resume with retained W and full native history.

Dalph verifies X/thread token/T/K and exact run correlation, every persisted
turn in complete nonforeign history, and actual interrupted status. It preserves
that native status. It then reads current background terminals and the complete
owned activity/process census, which must establish Absent. Old exit alone,
timeout, missing result, idle/notLoaded or a diagnostic summary is insufficient.

Dalph writes InterruptedTurnSealed/NotPrepared with the same identities and
exact original provider incarnation before
returning the existing workflow negative result and quarantine. It does not
select or publish a candidate, allocate another token/thread/turn/session,
record Started, reset a candidate, or automatically choose Retry/S3.

## Crash, replay and refusals

Before the seal, reconciliation and exact read repeat. After the seal but before
the workflow append, fresh exact interrupted history and Absent custody are
required to return the identical result. Response loss never starts another turn.
Later contradictory status, token or history fails closed; a late hint cannot
create a second result. Missing, duplicate, foreign, tokenless, active or
incomplete history, unavailable RPC, unknown/live old custody and incomplete or
nonAbsent current census cannot seal. Legacy completed/failed private records
remain readable with their distinct statuses.

A person may later choose existing Retry or available first FullRerun under
fresh H/C/Q/custody guards. Changed H requires authorized FullRerun; old H stays
fixed and no numeric human Retry cap is added. Tracker/claim and publication
facts remain under their existing authorities; this recovery makes no tracker
mutation. Retained original candidates and raw evidence remain untouched.

## Acceptance mapping

| Chronology | Named check |
| --- | --- |
| R1 exact interrupted plus stopped custody and fresh Absent/no hint | `codex-integrator.test.ts`: `R1/R4 seals exact interrupted recovery as NotPrepared and replays response loss without another turn`; existing protocol NotPrepared/quarantine checks |
| R2 completed/no hint pending | `codex-integrator.test.ts`: `keeps a completed Integrator turn pending after reopen when its matching notification was not replayed` |
| R3 foreign/missing/live/incomplete refuses | `codex-integrator.test.ts`: `R3 refuses interrupted recovery with $name and retains TurnObserved` |
| R4 seal/replay no extra turn | `codex-integrator.test.ts`: `R4 reconciles %s interrupted seal cut before replaying one negative result`; native process-reopen check |
| R5 late hint/contradiction | `codex-integrator.test.ts`: `R5 rejects contradictory %s history after interrupted seal without mutation` and `R5 ignores a late exact hint after interrupted seal without publishing a second result` |
| R6 Retry/FullRerun, private compatibility, cleanup | `codex-integrator.test.ts`: `R6 admits one explicit Retry after interrupted NotPrepared on the same owned candidate` and `R6 retains each interrupted run owner across Retry, interrupted run2 and old-seal replay`; `codex-integrator-private-store.test.ts`: `R6 decodes interrupted negative seals and legacy completed/failed records through restart and typed cleanup`; `codex-integrator-cleanup.test.ts`: `R6 removes an interrupted sealed predecessor only through typed cleanup with fresh absent evidence`; existing protocol fresh-authority checks |

The minimal `codex-integrator-interrupted-real-qualification.test.ts` check
`R1/R4 native exact interrupted process-reopen seals without replayed notification or another provider turn`
proves exact turn identity, no synthetic notification, no additional provider
turn and stopped custody across separate controller processes. Focused check receipts and source/raw hashes belong in the
issue's acceptance evidence; table entries alone are not passing evidence.
