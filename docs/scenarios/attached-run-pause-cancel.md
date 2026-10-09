# The Operator pauses or cancels the owning Run during history work

Accepted scope: attached whole-Run controls under [#491](https://github.com/dearlordylord/dalph/issues/491).

## Governing behavior

Pause preserves [whole-Run Pause](pause-whole-run.md) and the
`applicationClaimsNoLaterEffects` law in [control direction application](../../specs/controlDirectionApplication.qnt).
Cancellation preserves [exact stop, abandonment and claim settlement](cancel-unusable-production-run.md),
including unavailable and foreign evidence. The `handoffRequiresSettledResponsibilities`
and `handoffRequiresFreshGraph` laws in [Run cancellation](../../specs/runCancellation.qnt)
constrain its terminal handoff. [Attached command ownership](running-host-clients.md#http-transport-composition)
owns disconnects. [D21–D24](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
forbid treating missing evidence as completion. These scenarios add public
routing to the existing owner, not task controls or an authorization policy.

## S1: The Operator controls a Run while a historical page is busy

The host owns unfinished Run R, its Journal and coordinator. Its accepted
history may include exact claims, planned worktrees and executing attempts.
An observer has requested an optional historical page at a fixed cursor;
preparation or its output is still pending. The Operator handshakes for the
explicit host and R, then sends Pause or Cancel with protocolVersion 1,
that hostInstanceId, R and a fresh requestId. No alternate coordinator starts.

The host validates all correlation before admission. Admission belongs to the
host scope; it is receipt only, with no claim of durable application. It uses
the existing control application or Run cancellation boundary and returns
PauseApplied (ordinal and acceptedAt) or CancelApplied (acceptedAt). An idle
paused Run that has never established a complete graph can apply cancellation
yet remain blocked at TrackerTargetUnsettled; application cannot manufacture
classification evidence. Pause
seals its existing covered forward admission. Cancel requests settlement by
the same Run owner, including when Pause has disabled ordinary wake hints.
Optional history preparation and output are not prerequisites for admission.
The response is application evidence only: neither safe Pause boundaries nor
completed cancellation. Existing snapshots expose Pause progress and retained
responsibilities; only exact Run termination proves cancellation settlement.
No Git or tracker call is needed merely to apply the local direction.

Scoped acceptance tests: `public clients apply whole-Run controls while history remains busy`
in `running-host-run-control.acceptance.test.ts`; declared repeated native
profiles in that file measure local request admission separately from later
executor/tracker settlement, against p95 100 ms (provisional, not a timeout).

## S2: The reply is lost after admission

Starting from S1, the client disconnects after the host admits the request but
before receiving its result. The host retains and completes the command in
its own scope. The client reports CommandOutcomeUnknown with its exact
request/operation/Run correlation; it must not resend automatically. On a fresh
handshake it reads control and current status to reconcile direction and
settlement. To establish cancellation application before termination, it reads
bounded occurrence pages at the exact controlObservedAt cursor and locates the
existing RunCancellationApplied fact. The process-local requestId is not echoed
in that durable fact; a reader cannot attribute a later direction to a lost
request merely because the direction agrees. RequestId is process-local transport correlation, not a durable
idempotency key. A host crash after append reconstructs the same applied
control through existing Journal recovery. An ambiguous append fences later
attached controls until Journal reconciliation; no second Pause ordinal is
inferred safe. Cancellation reuses its existing one-per-Run application fact.

Scoped acceptance tests: `CLI/MCP lost pause/cancel replies retain the host command without replay` and
`CLI/MCP reports an ambiguous pause/cancel reply without retransmission`
in `running-host-run-control.acceptance.test.ts`. Existing SQLite cut tests in
`running-host-command.acceptance.test.ts` remain the durable recovery seam.

## S3: Cancellation has unavailable or foreign executor evidence

R retains an exact executing attempt, worktree and claim. The Operator sends
Cancel to its owner. After RunCancellationApplied, the existing workflow
records exact stop intent and reads the execution substrate. Unavailable,
foreign or contradictory reports retain responsibility and the claim; they
cannot authorize abandonment, release, cleanup or terminal cancellation.
Current status exposes the existing retained progress and activation failure.
Only exact stopped evidence permits abandonment, then fresh claim observation
and exact settlement, then Run termination. A crash at any intent/outcome
boundary uses the existing reconciliation protocol before retry; disconnect
neither discards responsibility nor authorizes retry. Offline Cancel remains
valid after the owner exits and acquires the existing coordinator lock.

Scoped acceptance tests: `attached cancellation retains Unavailable/Foreign executor responsibility`
in `running-host-run-control.acceptance.test.ts`. Existing cancellation tests
in `production-reactivation.test.ts`, `journaled-run-bootstrap.test.ts` and
`run-cancellation.test.ts` own exact stop/claim/crash and offline entry.


## Scenario-to-check map

| Scenario | Physical acceptance boundary | Retained protocol checks |
| --- | --- | --- |
| S1 history and applied direction | Both native CLI and MCP `public clients apply whole-Run controls while history remains busy`; real production host, SQLite Journal and Git; held optional history and application cursors | `running-host-contract.test.ts`, `running-host-http.test.ts`, `running-host-mcp.test.ts` preserve schemas, correlation, terminal refusal and tool discovery |
| S1 receipt versus application versus settlement | `attached cancellation settles an executing attempt through exact stop abandonment and claim release`; separate receipt, durable application, reply and held executor observation cuts | `production-reactivation.test.ts`, `run-reactivation-owner.test.ts`, `journaled-run-bootstrap.test.ts` preserve installed owner and Pause admission |
| S2 disconnect and ambiguous reply | Four native client disconnect cuts and four closed-socket ambiguous reply cuts; admitted controls survive without retransmission | Existing `running-host-command.acceptance.test.ts` owns durable SQLite/crash recovery and host cutoff |
| S3 unavailable/foreign evidence | Both typed executor-evidence cuts retain the claim and forbid abandonment and termination | `run-cancellation.test.ts` preserves offline cancellation and existing settlement requirements |
| Provisional admission target | Native HTTP client repeated Idle, BusyHistory and ExpandingHistory profiles, 20 exact requests per operation/profile; expanding profile adds 256 durable controls and overlaps real occurrence preparation | Exact request-ID clocks record server receipt to host command entry separately from client handshake through durable application; each p95 must be at most 100 ms |

The 10 ms cooperative quantum remains the parent specification's provisional
reference target; this change does not claim a measured or hard real-time
quantum guarantee. Provider settlement latency and native child startup are
outside the local server-admission clock. Profile evidence must retain raw
samples and candidate/environment identity. A target miss blocks this slice's
acceptance; shared CPU load is not a cause established merely by observation.
The parent integration slice #501 must qualify its final integrated candidate
independently.

[Slice acceptance evidence and raw profiles](../evidence/issue-496-acceptance.md)
record the exact source candidate and scoped verification; parent integration
requires its own qualification.
