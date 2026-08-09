# Abandon or quarantine an exact stopped attempt

Issue: [Abandon or quarantine a task attempt](https://github.com/dearlordylord/dalph/issues/67)

Status: **proposed and awaiting maintainer acceptance**. This file is not an
accepted source of Dalph behavior and does not authorize implementation.

The issue's links to `docs/BOUNDED-RESUMABLE-GRAPH-FRONTIER.md`,
`docs/adr/0010-govern-recovery-with-two-quint-models.md`, and
`specs/frontierRecovery.qnt` are stale: commit `360258012` deleted them when it
introduced the current planned-attempt executor boundary. This proposal uses
the current delivery invariants, the replacement subject-scoped ADR,
`specs/taskFactReconciliation.qnt`, and the accepted #65 and #137 scenarios.
The linked research decision remains historical evidence, not accepted runtime
behavior.

Issue #65 currently records implementation abandonment and then automatically
reads and releases the exact active claim. Issue #67 says quarantine preserves
that claim. Those two chronologies cannot both happen for the same stopped
attempt. The proposal below uses this recommended ordering: after Dalph proves
the exact executor quiescent and records that implementation responsibility
ended, it waits for Alice to choose Abandon or Quarantine before it reads or
changes the claim. Accepting this proposal therefore requires an explicit
amendment to the accepted issue #65 chronology and its shipped behavior.

The first acceptance-blocking question is:

> When Alice stops an attempt, should Dalph wait for her Abandon-or-Quarantine
> choice before touching its exact claim? I recommend yes, because otherwise
> issue #65 releases the claim first and issue #67 can no longer satisfy its
> requirement that Quarantine preserve it. Otherwise, keep #65's current
> automatic release and remove claim preservation from #67's Quarantine
> contract.

This proposal interprets Abandon conservatively. It ends Dalph's ownership of
the stopped attempt and releases only its freshly confirmed exact claim; it
does not delete the branch, worktree, work in progress, or journal evidence.
Its exact cleanup consists of settling the claim-release responsibility,
finishing the named process-local owners, and durably relinquishing P. That
matches D16, D17, and D37. A later decision to delete Git or executor-owned
artifacts needs its own resource-specific chronology, including lost-response
reconciliation, before that destructive behavior can be implemented.

## Proposed exact resource dispositions

The rows below are proposed outcomes, not a description of current behavior.
The branch and worktree stay present in both outcomes; the difference is
whether Dalph retains responsibility and may later offer a recovery action.

| Resource or fact | Quarantine | Abandon |
|---|---|---|
| Exact tracker claim K1 | Retain K1 without a tracker mutation. If the tracker instead reports absent, foreign, or unreadable, preserve that distinct fact and never reacquire or change another claim. | Read the tracker, then release K1 only if every owner, token, task, and acquisition identity is still exact. Preserve an absent or foreign result without mutation; retain a separate release responsibility while unreadable or ambiguous. |
| Planned attempt P and Dalph responsibility | Retain P and a quarantined disposition responsibility. P cannot resume, integrate, or authorize a replacement attempt until a later accepted Operator resolution. | Record that Dalph relinquished P after exact executor quiescence and claim disposition. P remains immutable history and cannot resume or integrate. |
| Git branch B1 | Preserve B1. Do not delete, reset, move, force-update, or retarget it. | Preserve B1 as recoverable evidence. Abandon does not authorize ref deletion in this proposal. |
| Git worktree W1 and WIP | Preserve W1 at its exact registered path, including commits, staged, unstaged, and untracked work. Retain its Dalph responsibility. | Preserve W1 and WIP, but relinquish Dalph's execution responsibility. No filesystem cleanup is authorized. |
| Executor state | Retain P's executor locator and the exact safe or terminal report. Send no new executor request. | Retain the same evidence and send no new executor request. The responsibility already ended only after issue #65's exact quiescence proof. |
| Executor-internal sessions, findings, and evidence | Send no cleanup request. The current generic executor exposes no separate session, findings, or evidence boundary, so Dalph cannot promise provider retention or deletion beyond preserving P's locator and journaled report. | Same. Issue #52's former generic session/review types were removed behind the planned-attempt executor boundary in `360258012`; reintroducing a production executor cleanup boundary requires separately accepted scenarios. |
| Process-local task position, live-action owner, and protocol guard | Release or finish each exact process-local owner after safe suspension and command finalization. None is persisted as quarantine state. | Same. Process loss discards these values; reconstruction uses journal history rather than restoring them. |
| Workflow-journal history | Append the exact Operator-initiated quarantine decision and retain the complete earlier history. | Append the exact Operator-initiated abandon decision and exact claim observations; retain the complete earlier history. |

## Alice quarantines P before Dalph releases K1

### Starting situation

Alice is the Operator. Run R retains task A and immutable planned attempt P for
authored fingerprint F1. The tracker currently reports A open in the target
closure at fingerprint F2 and carrying Dalph's exact active claim K1. Git
registers exact branch B1 at exact worktree path W1; W1 contains WIP. No
integration responsibility or integration-start event exists for P.

The executor has reported P safely suspended, and the journal contains the
exact report plus Alice's applied Stop request D2. Dalph has proved that no
later executor command broke that proof and has recorded that P's
implementation responsibility ended. Under the proposed amendment, the
journal contains no later claim-read intent, claim-release intent, claim
outcome, resource-disposition choice, or cleanup event. P uses no task-work
position, and no live delivery action owns P.

The tracker owns K1, Git owns B1 and W1, the executor owns its internal retained
state, and Dalph's journal owns only the workflow history just described.

### Trigger and chronological behavior

1. Alice submits Quarantine for exact R, A, P, F1, F2, and D2 with one
   immutable disposition-request identity Q1.
2. Dalph validates that the journal still ends before claim disposition and
   integration start for P. It reuses the exact safe report; no executor call
   applies because the unbroken journal proof already says that no executor
   writer remains.
3. Dalph records an intent and asks the tracker for A's current exact claim. It
   records the result as exact K1, absent, foreign, or unreadable without
   changing the tracker.
4. Dalph records a Git-read intent and asks Git whether W1 is still registered
   at its planned path for B1 and what current `HEAD` it contains. It records
   the exact observation without repairing any mismatch.
5. If the journal still names the same P and no later choice or integration
   start exists, Dalph records Alice's Quarantine decision with Q1 and the
   exact evidence positions from steps 2–4.
6. Dalph retains P's disposition responsibility, K1 when K1 was observed,
   B1, W1, WIP, executor locator, safe report, and every journal record. It
   selects no executor continuation, integration, claim release, replacement
   attempt, or resource deletion for P. Independent task C remains selectable
   whenever it needs none of A's facts or resources.

If the tracker reports K1 absent or foreign, Quarantine preserves the observed
state and does not invent or reacquire K1. If either the tracker or Git read is
unreadable or contradictory, Dalph does not record Quarantine as applied. It
returns an evidence wait or typed failure for Q1 and sends no state-changing
request; Alice may redeliver Q1 after the tracker and Git become readable.

### Crash, retry, visible result, and forbidden result

If Dalph crashes after a read intent or observation but before it records the
applied decision, restart reconstructs no applied Quarantine. Alice may
redeliver Q1; Dalph reads the tracker and Git again because the old
observations do not prove their current state. If it crashes after recording
the applied decision, restart reconstructs P as quarantined and performs no
claim, Git, or executor mutation. Exact redelivery of Q1 returns the recorded
result.

Alice sees P quarantined, the exact claim result, the preserved B1/W1
locators, and any unreadable or contradictory evidence wait. She sees C
continue when independent. Dalph must not release K1, edit a foreign claim,
reacquire an absent claim, resume or integrate P, create a replacement attempt,
delete or reset B1/W1, discard WIP or journal evidence, persist a process-local
position, or claim that it preserved executor-internal artifacts the current
boundary cannot observe.

### Future acceptance-test and cassette seams

- Test `quarantines the exact safely stopped attempt before claim release and
  preserves every observable resource` proves the ordered application and
  resource table.
- Test `waits for readable tracker and Git evidence before applying
  Quarantine` proves unreadability is not converted into absence or cleanup
  permission.
- Test `reconstructs Quarantine after process loss without resuming or mutating
  P` proves the post-application crash prefix.
- Cassette `attempt-quarantine-preserves-exact-resources` drives Alice's
  request through the composed controlled tracker, Git, executor, journal, and
  ordinary delivery loop.
- Cassette `attempt-quarantine-keeps-independent-task-selectable` shows A's
  visible quarantine while independent C continues.

## Alice abandons P and Dalph releases only a freshly confirmed K1

### Starting situation

Alice, R, A, P, F1, F2, D2, K1, B1, W1, WIP, and the executor's exact safe
report are as in the Quarantine scenario. The journal proves implementation
responsibility ended but contains no claim disposition, resource-disposition
choice, cleanup event, or integration start. No process-local resource is held
for P.

### Trigger and chronological behavior

1. Alice submits Abandon for exact R, A, P, F1, F2, and D2 with immutable
   disposition-request identity Q2.
2. Dalph confirms from the journal that P has an unbroken exact safe or terminal
   executor proof, no later executor command, no accepted result, no integration
   start, and no earlier Abandon-or-Quarantine decision. No executor boundary
   call applies because that exact retained proof already establishes the
   required condition.
3. Dalph records Alice's applied Abandon decision before any outside mutation.
   The decision relinquishes P only after its separately reconstructed claim
   disposition reaches a terminal result; until then, the journal retains that
   exact unfinished responsibility.
4. Dalph records a claim-read intent, asks the tracker for A's current claim,
   and records the normalized result.
5. If the tracker freshly reports exact K1, Dalph records the existing exact
   release intent before asking the tracker to remove K1. It records either the
   exact release result or an ambiguous outcome. If the tracker reports K1
   absent or a foreign replacement, Dalph records the exact no-release result
   and sends no mutation. If it is unreadable, Dalph records the wait and sends
   no mutation.
6. After exact release or a definite no-release result, Dalph records P's
   relinquishment. It preserves B1, W1, WIP, P, its executor locator and report,
   and all journal evidence. It performs no Git or executor cleanup and does
   not select integration, tracker completion, claim reacquisition, or a
   replacement attempt.

### Crash, retry, visible result, and forbidden result

If Dalph crashes after step 3, restart reconstructs the applied Abandon choice
and continues the same claim-disposition responsibility; it does not ask Alice
again or relinquish P early. If the tracker removed K1 but its response was
lost after the exact release intent, restart checks the tracker before another
release. If K1 is still exact, later activations may retry only the same
release request under the existing three-call bound. If the bound is exhausted
or the tracker remains unreadable, P stays visibly Abandon-pending with its
separate claim responsibility; no fourth call occurs.

Alice sees Abandon applied, then either exact K1 released, a definite absent or
foreign no-release result, or a named claim wait. Once terminal, she sees that
Dalph relinquished P while B1 and W1 remain available for recovery or a later
resource-specific cleanup decision. Dalph must not release a stale or foreign
claim, infer release from a lost response, allocate a new claim or attempt,
resume or integrate P, delete Git or executor artifacts, erase history, or
report abandonment complete while exact claim disposition is unresolved.

### Future acceptance-test and cassette seams

- Test `abandons the exact stopped attempt and releases only its freshly
  confirmed claim` proves the success chronology.
- Test `abandons without mutating an absent or foreign claim` proves #137's
  freshly read tracker-claim rule remains intact.
- Test `keeps Abandon pending and reconciles a lost claim-release response
  before retrying` proves the crash and ambiguity chronology.
- Test `preserves branch worktree WIP and journal evidence after Abandon`
  proves this proposal does not smuggle destructive cleanup into
  relinquishment.
- Cassette `attempt-abandon-releases-only-exact-claim` records the actor-visible
  exact-release path.
- Cassette `attempt-abandon-reconciles-ambiguous-claim-release` records the
  intent, lost response, tracker reread, and single settled result.

## A stale or competing disposition request cannot cross a boundary

### Starting situation

Alice submits two valid requests for the same R, A, P, F1, F2, and D2: Q1 says
Quarantine and Q2 says Abandon. Neither receipt is durable. Alternatively, one
request arrives after P has crossed integration start, after a replacement
attempt has been planned, or with a different attempt, fingerprint, or Stop
identity. The tracker, Git, and executor facts may still look compatible, but
the journal no longer exposes the exact choice named by the request.

### Trigger and chronological behavior

1. Dalph serializes application of the two choices through one exact-attempt
   decision boundary. The first valid decision committed to the journal wins.
2. Dalph returns a stale-choice result for the other request without calling
   the tracker, Git, or executor. Reusing the winning request identity with a
   different Run, task, attempt, Stop identity, or choice is a typed
   contradiction rather than a stale result.
3. Exact redelivery of the winning identity and payload returns its recorded
   application and current claim-disposition result without recording another
   decision or repeating a completed boundary effect.

No tracker, Git, or executor call occurs for the rejected request, so no outside
request can have an unknown result. If Dalph crashes after the winning journal
append but before returning it, redelivery reconstructs that append and returns
the same winner.

Alice sees which exact choice won and why the other was stale or contradictory.
Dalph must not let arrival order override journal order, apply both choices,
release a claim for a losing Abandon, preserve a claim by undoing a winning
release, resurrect a post-integration choice, or infer that a request failed
because its response was lost.

### Future acceptance-test and cassette seams

- Test `lets the first journaled valid Abandon-or-Quarantine choice win`
  proves the race.
- Test `coalesces exact disposition redelivery and rejects request identity
  reuse` proves transport retry and contradiction remain distinct.
- Test `rejects stale disposition after replacement or integration without
  crossing a boundary` proves the cutoff.
- Cassette `attempt-disposition-first-journaled-choice-wins` records both race
  winners and the actor-visible losing result.
- Cassette `attempt-disposition-rejects-stale-replay` records exact redelivery,
  conflicting reuse, and post-cutoff rejection.

## Proposed model and executable seam

If the ordering above is accepted, `specs/taskFactReconciliation.qnt` remains
the narrow owning model because the new choice occurs between its existing
exact executor-quiescence proof and stopped-claim disposition.
`specs/taskFactReconciliation_proof.qnt` and
`packages/dalph/test/conformance/task-fact-reconciliation.mbt.test.ts` must add
collected scenarios for first-journaled choice, Quarantine claim preservation,
Abandon exact-claim release, stale replay, and ambiguous-release recovery. The
model must retain the existing properties that Stop preserves WIP, a foreign
claim is never changed, unreadability never proves absence, and independent C
continues.

The production history seam must reject a disposition without its exact Stop
and quiescence predecessor, two decisions for one choice, resource disposition
after integration start, claim release after Quarantine, and relinquishment
before Abandon's claim disposition settles. Named history tests should mirror
those five malformed prefixes. The composed cassette runner must reach the
same production protocols through controlled fake providers; P0–P6 remain
test cut-point labels only and are not scenario or production vocabulary.

`specs/plannedAttemptExecutor.qnt` needs no behavior change under this proposal:
issue #65 still proves exact quiescence before issue #67 begins, and neither
choice sends a later executor command. If a future accepted proposal deletes
executor-owned resources or introduces an independently surviving production
session, that new boundary changes this conclusion and needs its own scenario
and model review.
