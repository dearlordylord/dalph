# Cancel one production Run with an unusable executor

Issue: [Recover an unusable production executor](https://github.com/dearlordylord/dalph/issues/390)

Status: accepted on 2026-09-20 before behavior-changing implementation.

## Governing behavior

When Dalph decides whether an unusable executor may be settled and its Run may
terminate, this scenario preserves [exact identity, claim ownership, and
foreign ownership isolation](../DELIVERY-INVARIANTS.md#identity) under D1, D4,
and D5; [work-in-progress preservation](../DELIVERY-INVARIANTS.md#preservation)
under D16; [intent-before-effect](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
under D21; and [Run finality and convergence](../DELIVERY-INVARIANTS.md#progress)
under D35 and D37. It refines the accepted [running-executor
cancellation chronology](terminate-settled-run.md#alice-cancels-while-an-executor-is-running).
The governing `runCancellation` model laws are
`cancellationAppliedAtMostOnce`, `cancellationClosesForwardAdmission`,
`cancellationPreservesWorkInProgress`, and `cancellationHandoffReached` in
[`specs/runCancellation.qnt`](../../specs/runCancellation.qnt). This scenario
adds only the public command, exact production-Run selection, retained provider
reconciliation, and their end-to-end fixture; it does not replace the existing
cancellation, executor, claim-settlement, or finality protocols.

## Alice cancels the exact unfinished Run

Run R owns planned attempt P, worktree W, one task-work position, and exact
claim C for task A. Its Journal has executor-work responsibility without a
safe, terminal, replacement, or abandonment disposition. Executor-private
state may still say `Live`; W and retained evidence may be dirty. R has no
accepted integration result.

Alice invokes `dalph cancel TARGET --production --config PATH`. The command
decodes the ordinary production target and configuration, acquires that
repository's coordinator lock, and selects the only matching unfinished R. It
allocates no Run, starts no Integrator, and starts no replacement attempt.

Dalph records Operator `RunCancellationApplied` before asking the executor to
stop. The executor reconciles the exact retained containment for P, including
the app server and tool descendants. If a passive retained-thread request
expires, it durably records `SuspensionStopIntended` with the exact thread and
owned-turn identity before closing containment. It accepts only evidence that
every owned writer stopped and cannot resume; PID absence or reuse alone is
insufficient.

After conclusive stop evidence, Dalph records
`CancelledAttemptImplementationAbandoned`. This permanent cancellation
disposition releases executor-work responsibility and the task-work position,
but preserves W, commits, transcript, private state, and evidence. Dalph then
freshly reads C. It releases only the exact claim acquired by R, records an
absent or foreign claim without mutation, and uses the existing
intent/observation settlement protocol for an uncertain release.

After every cancellation responsibility settles, Dalph records R terminal as
`Cancelled`. An ordinary later `dalph run` may allocate a fresh Run. Repeating
the exact cancel command selects the already-cancelled R, reports its settled
result, and performs no second stop, abandonment, or claim mutation.

## Stop proof remains unavailable

### A crash after the suspension intent

R has an accepted Executing report, followed by an unreadable passive
observation. Alice cancels R. Dalph records cancellation and its exact Suspend
intent, then crashes before observing the command outcome. A later explicit
cancel reconstructs that same intent and reconciles its exact executor
containment before issuing another command. The cancellation cutoff must not
filter out this Suspend reconciliation. It grants no Begin, Resume, or
Continue reconciliation authority. An exact stopped report permits the existing
abandonment and claim settlement; an unavailable or contradictory projection
retains every responsibility and exits blocked. Worktree and evidence remain
retained throughout. No Git mutation is applicable to this stop boundary.

Acceptance: the durable cancellation regression in
`recovery-activation.test.ts` covers both cancellation before Suspend and a crash
after its intent. Existing command reconciliation tests own exact report and
unavailable projection outcomes; the native cancellation witness owns retained
containment and subsequent settlement.

If the executor reports a possible writer, incomplete containment, reused
identity, or contradictory evidence, Dalph leaves P, C, W, its task-work
position, and all evidence retained. It emits `cancellation.blocked` with the
typed blocker and exits the process-local owner. It performs no release,
cleanup, integration, replacement, Run termination, or automatic retry. Only
another explicit command can re-enter the same proof.

## A failed terminal report still needs cancellation settlement

Run R has a planned attempt, an exact acquired task claim, and a retained
`ExecutorWorkTerminal(Failed)` report. The task is still open; no integration
was admitted. Alice invokes the exact production `cancel` command. Dalph
records `RunCancellationApplied`, reads the already accepted terminal report
as stopped-work proof, then records `CancelledAttemptImplementationAbandoned`.
It freshly reads and settles the exact claim before marking R `Cancelled`.
The terminal report alone must not hide cancellation disposition or leave the
claim pending. A crash after `RunCancellationApplied` reconstructs the same
terminal proof and continues once; a repeated cancel after terminal Run
settlement makes no second abandonment or claim mutation.

Acceptance tests: `failed terminal executor work still abandons after Run
cancellation` in `recovery-activation.test.ts` checks the disposition and
frontier transition; the existing exact-claim cancellation tests above own
the subsequent release and retry boundaries.

## Alice cancels after a rejected result has stopped its writers

This refinement preserves the cancellation chronology above and the stopped
custody boundary in [rejected-result recovery](rejected-provider-result-recovery.md#s3--dalph-returns-an-exhausted-or-expired-cycle-to-alice-with-exact-custody).
It is accepted under the maintainer's instruction to repair the reproduced
cancellation defect while preserving the existing disposition and claim rules.

Run R retains exact claim C and attempt P's worktree W. The executor has
reported `ExecutorWorkResultRejected` with `Stopped` custody; no integration
was admitted and no later executor command supersedes that report. The host
has exited and Alice invokes the exact production cancellation command.
Dalph reconstructs P, records `RunCancellationApplied`, then uses the exact
latest accepted stopped report as its abandonment proof. It records
`CancelledAttemptImplementationAbandoned` without issuing Suspend, Resume,
Continue, Begin, or a new attempt. It freshly reads C, settles only R's exact
claim, and reaches `Cancelled`, preserving W and all implementation evidence.
A fresh activation need not establish a complete tracker graph to abandon P;
the focused claim read still belongs after abandonment.

A crash before abandonment reuses the same accepted proof. A crash after it
reconstructs the disposition and reconciles any uncertain claim read/release
before retry. Repeating cancellation after settlement performs no second
abandonment or mutation. A rejected report with `Unresolved` custody, a foreign
correlation, a stale report, or a later unresolved executor command cannot
supply abandonment proof or release capacity. Cancellation must not invent
safe suspension or turn rejection into terminal success. No new Git mutation
is involved: cancellation preserves the worktree rather than deleting it.

Acceptance seams: `cancels a Stopped rejected result without inventing stopped evidence`
in `recovery-activation.test.ts` proves the selected transition and rejects
unresolved custody; `accepts only Stopped rejected reports as cancellation
proof` in `cancelled-attempt-history.test.ts` proves durable proof validation.
`abandons a stopped rejected result through the Journal without calling the
executor` in `delivery-proposal-routes.test.ts` proves exactly one durable
abandonment through the real Journal and exact redelivery. The existing focused
claim cancellation mapping owns release and retry boundaries. The recovery
matrix also checks that only stopped custody releases the task-work position.

### Passive observation preserves the same custody rule

Before cancellation, a running host owns P's task-work position. Its passive
executor attachment observes a rejected result and records that exact
observation before accepting the report. `Stopped` releases only P's position;
`Unresolved` retains it. The host must not require terminal result acceptance
to release proved stopped writers, release another attempt, or grant Continue
from custody alone. After process restart the same latest accepted report and
absence of a later unresolved command determine position reconstruction.
Existing accepted observation provenance and intent/reconciliation rules own
crashes; this refinement adds no provider command or durable event.

`observes live executor RejectedStopped once and releases capacity only for
stopped writers` and its `RejectedUnresolved` counterpart in
`journaled-run-bootstrap.test.ts` prove production passive publication and
position release. `passive delivery observation RejectedStopped releases
capacity only for stopped writers` and its unresolved counterpart in
`delivery-proposal-routes.test.ts` cover the controlled delivery route.

### Cancellation reconciles an already intended release

Dalph has abandoned P with exact stopped-writer proof, observed its exact
active tracker claim, and recorded a cancellation-authorized release intent.
The release removes the claim, but its outcome has not yet been recorded.
A fresh focused tracker read names that release as a predecessor and observes
an absent claim. Dalph selects reconciliation of the original release operation,
records `TaskClaimReleased` under that operation ID, and settles cancellation.
It must not allocate another release identity, mutate an absent claim, or record
`CancelledAttemptClaimNoReleaseObserved` after the existing release intent.
An already selected no-release proposal rechecks accepted history at execution
and performs no append when that release intent exists. Its append compares
the same accepted prefix under the Journal lock; an intervening accepted record
reports a typed action deferral for fresh selection without writing against
stale facts or retaining a completed action that has no settlement record.
A foreign claim remains
protected by the release protocol's ownership-conflict boundary; unreadable
facts remain pending. On crash or retry, the same intent and fresh observation
reconstruct the same release operation. Git and executor calls are inapplicable
at this claim-only boundary; their abandonment proof is already accepted.

`derives cancellation abandonment, exact claim release, and typed no-release
settlement` in `recovery-activation.test.ts` checks absent and foreign observations
after an intent preserve its exact operation identity. `executes cancellation
no-release only for a fresh foreign claim observation` in
`delivery-proposal-routes.test.ts` checks a stale proposal cannot append after
an intended release, rejects an append against an intervening accepted record,
and reconciles the absent claim to exactly one release outcome with no second
mutation, through the real Journal and release protocol. The existing release protocol
and cancellation settlement tests own absent-claim reconciliation, release
outcome redelivery, and ownership conflicts.

## Claim settlement remains unavailable or foreign

After abandonment, an unreadable claim keeps the separate claim responsibility
pending. A foreign or absent claim without an existing release intent records the applicable
no-release observation. Dalph never deletes an unproved or foreign claim. Restart first
reconciles an uncertain prior read or release outcome before another effect.

## Crashes and rejected entry

Every uncertain effect records intent before the effect and observation after
it. A crash after cancellation, stop intent, stop proof, abandonment, focused
claim-read intent, release intent, or release outcome reconstructs R and
continues without duplicate work. A retry from `SuspensionStopIntended` does
not resume the retained thread: it retries the exact idempotent containment
close and records safe suspension only after close succeeds. A failed close
retains the intent for another explicit retry. Missing or ambiguous Run
selection, invalid configuration, or coordinator-lock contention fails before
cancellation or provider acquisition.

## Acceptance-test mapping

- Public command and entry: `accepts cancellation only for one production GitHub target and absolute configuration`, `routes cancel through the production host cancellation operation`, and `production cancellation fails before provider acquisition when no unfinished Run exists`.
- Exact selection and redelivery: `redelivers the exact cancelled production Run after its terminal history is retired`, `selects the sole exact unfinished production Run without allocating a replacement`, and `names every unfinished Run when production discovery is unsafe`.
- Cancellation ordering and settlement: `lets durable Run cancellation override an unreadable executor projection`, `records cancellation suspension intent before contacting the executor after executing state becomes unreadable`, `records suspension intent and closes the executor after cancellation survives a passive response deadline`, `keeps ordinary suspension unauthorized after executing state becomes unreadable`, `keeps cancellation suspension unauthorized after a contradictory executor projection`, `executes cancellation settlement through suspension, abandonment, reread, and exact release`, and the four ordinary cancellation tests in `packages/dalph/test/cassettes/run-cancellation.test.ts`. Their existing replays also check recorded round trips, claim/observation identity renaming, inverse renaming, and visible lyrics. These pure assertions no longer start four additional coordinator runs. Negative finality-premise checks use the small controlled history in `re-enters once after an unacknowledged cancellation termination append`; each omitted starting/read/observation premise must fail independently. This fixture change leaves Dalph runtime behavior unchanged.
- Stop containment: `bounds an unanswered passive retained-thread read without stopping its owned child`, `bounds an unanswered passive retained-thread resume without stopping its owned child`, `bounds an unanswered passive background terminal census without stopping its owned child`, `stops exact containment after a retained-thread deadline before reporting safe suspension`, `retries exact close without resuming after close completes before safe suspension is persisted`, `retains stop intent after close failure and retries without resuming`, `survives an application restart with an unresolved suspension stop intent`, `production provider cleanup preserves safe suspension across close and restart`, `terminates a reported background activity before reporting safe suspension`, `does not report safe suspension while a process-group descendant survives`, and `keeps suspension unresolved for contradictory, active, surviving, and failed activity cleanup`.
- Abandonment validity and redelivery: `rejects cancellation abandonment after replacement of the exact attempt`, `rejects a abandonment with the wrong authorized claim or a duplicate abandonment`, and `does not let a terminal report and pre-cancellation claim release bypass cancellation abandonment`.
- Claim safety and crash prefixes: `executes cancellation no-release only for a fresh foreign claim observation`, `retries Alice's exact stopped-claim release after reconciliation keeps the claim current`, and the cancellation-prefix cases in `cancelled-attempt-history.test.ts` and `run-cancellation.cassette.test.ts`.
- Public blocker: `maps a cancellation proof blocker without retaining private executor diagnostics` and `uses one canonical fatal classifier for throttles and recoverable failures`.
