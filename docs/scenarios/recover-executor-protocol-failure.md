# Alice requests new work after an executor result protocol failure

Alice asks the running Dalph host to recover one exact failed task attempt.
Dalph preserves that attempt's sealed result and checks the executor, tracker,
and Git before it may plan a successor. [Issue #428](https://github.com/dearlordylord/dalph/issues/428)
owns this proposed protocol. This document records design work; the command,
events, and tests below are not implemented or accepted merely by this file.
No runtime source, journal schema, or formal model changes in this design edit.

## Governing behavior

The trigger is a new request made after a proven terminal protocol failure,
not a previously applied Restart or Stop. Preserve
[D48a and D49](../DELIVERY-INVARIANTS.md#operator-requests),
the [safe-suspension requirement for ordinary Restart](clean-restart-changed-attempt.md#settled-maintainer-decision-restart-requires-exact-safe-suspension),
and [terminal observations](autonomous-executor-work.md#a-changed-terminal-observation-ends-the-exact-work).
The governing [taskFactReconciliation model](../../specs/taskFactReconciliation.qnt)
law `terminalChoiceBlocksResumeWhileLifecycleEvidenceRemains` continues to
forbid an old choice from resuming or replacing a terminal attempt. The
proposed new recovery authorization needs its own law and conformance cases;
the current model does not establish it.

Preserve [immutable plans, one unsettled attempt and exact claims](../DELIVERY-INVARIANTS.md#identity),
and [disposition-gated resource preservation](../DELIVERY-INVARIANTS.md#preservation).
This proposal extends new-successor authority only. It does not reopen the
failed executor, rewrite its result, accept a retained commit, reopen a terminal
Run, or grant integration or cleanup authority.

[Issue #434](https://github.com/dearlordylord/dalph/issues/434) governs the old
and new attempts' independent provider custody. Recovery must reconcile P1's
exact owner and unresolved stop state before P2 obtains its own owner; generic
Failed or missing transport cannot substitute for proof. Legacy shared-custody
migration must satisfy #434's S7 before this recovery direction can proceed.
This proposal does not implement or bypass that migration.

## Proposed decisions

- Use a distinct `RecoverTaskAfterProtocolFailure` direction. Address an exact
  Run, task, failed attempt, terminal journal position, failure-evidence digest,
  current task revision, and request identity. The public snapshot supplies
  this selection; an issue number alone never selects among attempts.
- The first slice covers an unfinished Run and a retained exact claim. A
  terminated Run, absent/foreign claim, other unsettled attempt, or integration
  responsibility makes recovery unavailable. Claim reacquisition and recovery
  across terminal Runs need separate specifications.
- Require a typed classification from the executor's application-owned result
  validation boundary, bound to the exact owned thread/turn and immutable
  attempt. Recoverable classes are malformed final-result envelope and
  model-transcribed correlation mismatch. Semantic failure, invalid candidate
  lineage/evidence, unknown cause, transport timeout, and unreadable provider
  state do not qualify. A model-authored explanation is not classification.
- The current private `CodexSealedTerminal.Failed` has no reason, and
  `commitFromTurn` collapses invalid output to absence. Implementation must
  distinguish validation failures before sealing and retain a sanitized code
  plus evidence reference. Historical generic Failed remains Failed. An
  additional read-only classification can describe it only if retained exact
  provider output and provenance prove the cause; no log-based migration.
- Plan a new AttemptId and a new executor session with the next task attempt
  ordinal, retaining the same Run and exact claim. Its immutable revision is
  the fresh revision confirmed for this request; its Base is the exact current
  configured target head read for this planning decision. Never amend P1.
- Maintainer decision in this design session: create a fresh worktree/branch at
  that Base. The old
  candidate is reference material, not a seed, acceptance manifest, or proof.
  Preserve its exact commit and resources. An explicit seed path is deferred.
  The maintainer selected this behavior; other protocol details remain proposed.
- Record request receipt before asynchronous reconciliation. `Submitted`
  means receipt only. `Waiting`, `Rejected`, and `SuccessorPlanned` are distinct
  request outcomes; none means executing, accepted, integrated, or delivered.

## Alice recovers a proven protocol failure

**Starting facts.** Run R is unfinished. Task A remains open in its complete
target closure; its prerequisites are satisfied. P1 ended with an exact Failed
seal and provable result-validation failure E1. Claim K1 is retained. Git owns
P1's exact registered branch/worktree W1, Base B1, and candidate H1. There is
no successor, integration obligation, or competing recovery direction.

**Trigger and calls.** Alice submits request Q1 through the running host's
native CLI or MCP control. The proposed semantic CLI operation is
`recover-protocol-failure`; implement it in the existing client command grammar,
not as a separate launcher. Both transports submit the same typed request.

1. The host checks exact selection and current admission cutoff. It journals
   Q1's receipt with its immutable payload, then returns Submitted(Q1).
2. The protocol reconstructs P1's exact seal and classified evidence. It records
   an observation intent and asks the owning executor to prove no owned turn,
   background activity, or writer survives. A terminal seal alone is not a
   current stopped-writer proof. An absent session alone is also insufficient.
3. Ordinary journaled tracker reads obtain the complete graph, A's authored
   specification, and exact K1. They must prove current membership, open
   lifecycle, prerequisites, revision, and claim. Ordinary journaled Git reads
   obtain W1's exact registration, HEAD, B1 ancestry, candidate existence and
   lineage, and target head H2. Missing or contradictory evidence blocks work.
4. The request protocol validates causal/current witnesses after the failure,
   with no later writer command or invalidating observation. It atomically
   records one recovery authorization and the immutable successor P2. P1's
   Failed fact and all P1 resources remain unchanged. The event names Q1, P1's
   seal/classification, each observation identity, and exact P2 plan; it does
   not duplicate tracker, Git, session, or derived capacity state.
5. P2 uses ordinary exact worktree reconciliation and bounded admission. After
   current admission checks, Begin receives machine-bound R/P2 correlations.
   P2 must establish ordinary accepted evidence before integration/publication
   and tracker completion. The retained H1 does not bypass any gate.

**Crash and retry.** Before receipt acknowledgement, exact Q1 redelivery
reconciles receipt. After receipt but before planning, restart reobserves any
missing or invalidated witnesses. An ambiguous append is read by exact record
identity before retry. After the atomic authorization/plan, restart discovers
P2; it never allocates P3 or calls Begin for P1. Existing worktree and Begin
intent/outcome recovery owns later uncertain effects.

**Visible result.** Alice sees Q1's stage and blocking reason, P1's retained
failure/candidate, and P2's identity only after its plan is durable. Capacity
wait remains visible. Dalph sends no claim mutation, deletes no old resource,
copies no WIP, and does not mark A delivered because Q1 was authorized.

## Rejection, stale facts, and unknown writers

Given semantic/unknown failure, Accepted/Completed evidence, another task's
seal, a replaced claim, changed revision, incompatible lineage, lost old
worktree, terminal Run, or started integration, Alice submits Q1. Dalph returns
the distinct sanitized rejection before successor planning or mutation. It
preserves claims, seal, candidate and resources. Fresh current changes require
a new explicit request selecting them; an old request never follows changes.

An incomplete graph or unreadable writer/provider boundary yields Waiting
with the failed boundary, not absence or authorization. A bounded later
activation may retry reads; it never repeats an ambiguous mutation or consumes
new capacity as though P1's writers were proved stopped. Read-only retries need
no provider-effect reconciliation beyond their own observation protocol.

## Duplicate requests, concurrent requests, and late terminal evidence

Given Q1's receipt, exact duplicate delivery returns its recorded receipt or
outcome. Reusing Q1 with different selection/revision/evidence is a typed
contradiction. Two distinct valid requests for P1 compete at the same journal
commit boundary; one may authorize exactly one successor, the other reports
AlreadyRecovered(P2). The Journal must enforce that predecessor uniqueness,
not just a process-local mutex.

Given an earlier Restart/Stop and then P1's terminal evidence, the earlier
choice remains unable to authorize replacement. Only a new classified recovery
request may propose P2. If new contradictory terminal evidence appears while
Q1 reconciles, reject the conflict; never rewrite Failed into Accepted. If Exit
closes admission first, accept no new forward work. If receipt precedes Exit,
retain Q1 and reconcile after restart; receipt alone does not override cutoff.
No downstream mutation occurs on rejection, so there is nothing to replay.

## Acceptance mapping and implementation order

All names below are tests to add at existing production/protocol seams; they
are not passing evidence. Use controlled providers for the variants, and one
bounded subprocess test only for stopped-writer custody that mocks cannot prove.

| Issue scenario | Named acceptance test and owner |
| --- | --- |
| 1: New authorized recovery | `Alice recovers one classified protocol failure into one fresh immutable attempt` in the attempt-choice protocol/control seam; running-host CLI/MCP parity proves shared receipt/outcome |
| 2: Rejected variants | `Alice cannot recover semantic unknown foreign or unfinished failure evidence`; executor tests prove provenance/classification and protocol tests prove zero successor/mutation |
| 3: Ordinary verification/delivery | `a recovered attempt cannot deliver its retained predecessor candidate without ordinary acceptance`; executor and integration protocol seams |
| 4: Crash, response loss, duplicates | `recovery receipt authorization worktree and Begin prefixes produce one successor`; journal stores plus startup-recovery/conformance seams |
| 5: Changed tracker/Git facts | `recovery reports changed specification claim lineage or resource ownership without consuming permission`; tracker/Git protocol seams |
| Old Restart negative control | `an old Restart remains invalid after terminal failure even when a later recovery request exists`; existing restart-authority tests plus taskFactReconciliation negative model trace |
| Exit and two-client race | `Exit cutoff and concurrent recovery clients never begin two successors`; host/control and admission seams |

First implement the failure classification and exact evidence contract (shared
with #429/#430), including retained-data capability limits. Then model new
authorization separately from terminal lifecycle and ordinary Restart. Proposed
laws: `oldTerminalEvidenceNeverChanges`,
`protocolFailureRecoveryRequiresCurrentWitnesses`,
`oneRecoverySuccessorPerFailedAttempt`, and
`oldRestartNeverGainsTerminalRecoveryAuthority`. Extend the owning conformance
adapter and add negative controls before the workflow/control implementation.
Finally wire the same control into CLI/MCP and status, documenting rejected
states rather than advertising unsupported recovery.

Before runtime work, obtain acceptance of these concrete decisions and amend
D48a/D49, affected clean-restart/autonomous-executor/terminal-result/Run-cancel
and CLI/MCP scenarios, and the corresponding model variants together. Preserve
the old terminal-precedence race. This design does not claim Bendvy #6 delivered.
