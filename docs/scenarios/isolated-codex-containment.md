# Stop one Codex attempt without stopping its neighbours

Issue: [#434](https://github.com/dearlordylord/dalph/issues/434).

Status: accepted direction and chronology. Implementation evidence must prove
the production composition, not merely an isolated mock's close counter.

## Governing behavior

The Dalph host gives each exact executor attempt a separate app-server process
and private launch/lease owner. The integrator owns a separate provider. These
are host-owned processes, not a machine-wide Codex daemon or isolated credential
homes. Tracker, Git and Journal authority remain unchanged.

This refines [tool containment](contain-non-converging-codex-tool-effects.md)
under [preservation and ambiguity invariants](../DELIVERY-INVARIANTS.md). An item
limit still records intent before interruption, closes its exact containment
and proves stopped writers. Isolation does not grant longer tool limits or
authorize replacement, claim release, candidate acceptance or task completion.

## S1: A expires while B continues

Starting facts: A and B have exact planned attempts, claims, worktrees and owned
provider turns. Capacity admits both. A has one observed active item and finite
deadline; B remains within its limit. When A's deadline expires, record A's stop
intent, interrupt its turn and stop only its owned containment. Prove its
writers stopped before recording the stopped disposition. Preserve A's WIP and
candidate. B continues work and may finish through ordinary delivery.

Forbidden: signal B, release A's custody without proof, infer task completion
from stop, or keep presenting A as currently executing after known containment
loss. Crash/retry follows S4.

## S2: Executor stop does not stop integration

Starting facts: an executor and a fixed integrator session are independently
admitted. On executor item expiry, close only its process group. The integrator
continues under its original session and ordinary candidate/Git/publication
rules. The stop never authorizes integration or another integrator session.

## S3: Notification closure cannot erase stop proof

Starting facts: a durable item stop intent precedes provider closure. Closure
ends completion-hint subscriptions while the stop action records its outcome.
End-of-stream must not interrupt the sibling action before stopped-writer proof
is persisted. If proof fails, retain a typed unresolved outcome and its fence;
do not turn shutdown into Accepted, Completed or an empty success.

## S4: Crash and ambiguous stop

Starting facts: launch/lease custody and stop intent name one exact owner.
Process loss may occur before spawn observation, during interrupt, during stop,
or after proof but before its record. On restart reconcile that exact process
and writer census before retrying. Preserve B's separate custody and original
deadlines. Never allocate duplicate turns/providers or signal a foreign PID.

## S3/S4 addition: an owned turn aborts after every tool completed

Starting facts: the tracker claim, exact planned Base, Git worktree and private
Running record belong to the original attempt. At least one retained tool item
is Completed; none is Started, StopIntended or LimitReached. Codex stops that
exact turn with status interrupted. Its initiating cause is unknown.

A matching completion notification triggers an exact thread/turn reread in the
same provider incarnation. When notification delivery is absent, restart first
reconciles the previous exact server and its writers, then rereads the retained
thread using the original store. Both paths must distinguish an aborted turn
from writers that are still live or whose census is unreadable. An unreadable
census exposes unresolved responsibility, rather than current Executing. An
exact live census retains custody; neither abort nor a completed tool ledger
proves writer absence. Only a fresh absent census permits recording ProviderFailed.

Preserve the original candidate, claim, planned attempt and history. Do not
start another turn, replace the provider, publish the candidate or infer a tool
deadline. A crash before failure persistence repeats exact reconciliation;
after a failure seal, retry preserves that seal. Continuation and replacement
require the separate accepted recovery protocol in #428. Tracker mutation is
inapplicable: this observation does not change tracker facts.

Acceptance mapping:
`reports unresolved custody for an aborted owned turn after completed tools`
exercises restart without notification, unreadable census, subsequent fresh
absence, immutable failure reread and no duplicate turn.
`reconciles an exact abortion hint through unresolved custody without another turn`
exercises same-incarnation notification, unresolved custody and paced reread to
fresh absence without interruption or replacement. Both seed a Completed tool
record and preserve the original private association until absence is proved.

Outstanding acceptance evidence: an exact live writer after abortion, custody
becoming unreadable at the final failure-seal census, and same-incarnation
observation without a completion hint. That last case requires an observed
boundary that authorizes failure reconciliation; elapsed silence alone is not
authority. Ordinary successful completion without an exact hint retains its
existing completion-authority requirements. These remaining cases still block
completion of #434.

## S5: Host-wide Exit

Starting facts: several executor owners and the integrator remain live. Exit
closes process-wide forward admission once and keeps the existing five-second
drain. Finalization reaches every owned containment independently. Report
success only at its defined boundary; preserve exact unresolved custody on
failure/timeout. Do not signal unrelated machine processes.

## S6: Exact routing and bounded resources

Starting facts: repeated observations, attachment and command reconciliation
target one exact attempt. Route them through one owner; concurrent acquisition
must not spawn two providers. Resource lifetime follows admitted execution
responsibilities, not polling or tracker hints. Rejected acquisition releases
its partial resources; foreign custody fails before signals or new work.

## S7: Retained shared-state admission

Starting facts: an earlier host has stored attempts under shared launch custody.
Before a new isolated provider starts, inspect that inventory. Until an explicit
migration can prove all affected writers and custody, return an actionable
admission refusal and preserve all old records, commits, worktrees and planned
Bases. Do not silently import a thread into new ownership, edit old records,
start a duplicate Run or manually publish a retained candidate.

Fresh-state passing tests do not prove migration of beta #426. A refused
migration is a declared supported boundary, not a repaired retained task.

## Verification owners

| Scenario | Named acceptance evidence |
| --- | --- |
| S1 / S2: stop A and preserve B / integration | `production executor expiry preserves B and the original gated integration session` uses the same `productionCodexExecutionLayers` assembly as the host, the real executor/router and integrator protocols, controlled provider/Git edges, and durable private stores. It requires A’s deadline-triggered `LimitReached`, B’s original turn and `Accepted`, the integrator’s original correlation and gated completion, and exactly one provider per owner. `production isolates executor A, executor B and integrator processes and stops all owners on host Exit` exercises the production provider factories with distinct native processes, custody directories and incarnations; B and the integrator answer subsequent protocol calls after A closes. `cuts a self-matching Codex item at its exact default deadline and retains dirty evidence` exercises the executor deadline, exact interruption, stop persistence and non-executing projection. Ordinary integration/delivery remains governed by the existing integration scenarios. |
| S3: notification closure cannot erase stop publication | `provider notification closure does not interrupt a sibling publishing stopped-writer proof` exercises native transport closure. The deadline test additionally closes the completion source while persisting `LimitReached`. Restoring the former `Stream.unfold` implementation makes the native regression fail with interruption; this is the negative control. `retains responsibility when a tool writer survives containment close` requires retained `StopIntended` when proof fails. |
| S4: reconcile crash and ambiguity | `reopens a durable item stop intent and finishes exact containment close without another Begin`; `reconciles a retained old app-server launch after a real incarnation change`; `does not claim a stopped item when the retained containment incarnation contradicts the current child`. Native ownership tests `reconciles an exact launch-token process before starting a replacement server`, `reconciles application lease owner identity before spawning`, and `escalates a real resistant writer and recovers after its leader exits before close` cover the underlying process boundary. |
| S5: host Exit reaches independent owners | The production three-process test requests the actual host shell's graceful Exit and requires `Succeeded`, then reopens all private stores and requires absent launch records. Existing `production-host-exit.test.ts` covers the fixed drain's failure/timeout and coordinator-release ordering; the native resistant-writer test covers escalation. |
| S6: reuse and bounded lifetime | `reuses one exact execution owner across concurrent observation and attachment`; `routes Begin, Suspend, Resume and work-unit replacement through the same exact attempt owner`; `retires a terminal owner only after its last attachment closes and closes each attachment once`; `closes a failed acquisition before returning a safe projection and does not retain the failed owner`. The production three-process test also rejects a duplicate live custody acquisition and proves the original owner still answers. |
| S7: preserve retained shared custody | `production provider refuses retained shared attempts before spawning and preserves their custody` seeds the former root store, requires actionable refusal, proves no child started and rereads the unchanged record. `fails closed when the private snapshot is malformed` additionally requires inventory failure rather than false absence. |

The isolated-router tests live in `isolated-planned-attempt-executor.test.ts`;
production composition tests in `production-host.test.ts`; transport tests in
`codex-app-server-protocol.test.ts`; tool-stop recovery in
`codex-planned-attempt-executor.test.ts`; and native ownership tests in
`codex-app-server-public.test.ts`. These controlled fixtures exercise real local
child processes but do not call a live model or claim beta migration.

All tracker mutation retries are inapplicable to this read/process boundary.
The workflow algebra and generic executor report variants remain unchanged.
The router retains scoped services only; tracker hints never create lifecycle
facts, authorize replacement, or release unresolved custody. No workflow model
or conformance transition changes are needed for this provider composition.
