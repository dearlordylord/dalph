# Restart finishes the original Begin after its empty Codex thread disappears

Accepted authority: [#342](https://github.com/dearlordylord/dalph/issues/342),
the second accepted slice of [#330](https://github.com/dearlordylord/dalph/issues/330).
Its native prerequisite [#341](https://github.com/dearlordylord/dalph/issues/341)
is integrated at `09d23593486990b05cf5653e961b44d9a6189695`.

## Governing behavior

When Codex returns NotFound for an associated thread before any task turn was
authorized, apply [the first-turn crash cuts](issue-219-codex-app-server-executor.md#crash-and-retry-cuts).
This extends [the exact-idle Begin recovery](issue-341-pre-turn-begin-recovery.md#chronology)
only for conclusive empty-thread absence and interrupted empty allocation.
The delivery capability remains process-local, single-use, and bound to the
exact association; delivery still cannot allocate a thread.
The canonical `plannedAttemptExecutor.qnt` and its proof projection govern
one semantic Begin, fresh proof before redelivery, and at most one turn crossing.

## Chronology

The maintainer restarts Dalph after the coordinator and its scoped executor
have died. The Journal retains one unsettled Begin at ordinal 1 for R/A1.
The private store retains AssociatedPreTurn(A1,T), and no TurnIntentRecorded.
Git still owns A1's originally planned Base, branch and worktree. The existing
claim and task remain unchanged; no new tracker mutation or person choice is
required to finish this already-authorized Begin.

1. Ordinary reconstruction asks the executor to reconcile that Begin. It reads
   A1's private record and asks Codex about exact T at the recorded worktree.
2. An exact idle thread is retained. Only conclusive NotFound permits replacing
   its empty association. Unavailable, unreadable, foreign, active,
   turn-bearing and contradictory evidence preserve the association and
   responsibility and authorize neither allocation nor task work.
3. Before thread/start, the executor saves its existing EmptyPreTurn allocation
   intent. It calls thread/start with the same worktree, validates the returned
   exact idle/no-turn thread, and saves AssociatedPreTurn with the returned id.
   It never resets, recreates or deletes the worktree and never plans A2.
4. Only after the association is durable does the executor issue the existing
   BeginNotCrossed proof. Dalph journals that observation and redelivers the
   original request at Begin ordinal 1. The executor consumes the capability
   and rereads the private association. A capability from a successful
   allocation in this process retains the validated thread/start response;
   Codex cannot resume or return turn-inclusive history before its first user
   message. A capability from an existing association requires another exact
   Codex read. The executor records TurnIntentRecorded and calls turn/start
   once. Ordinary response or exact observation settles
   the existing command; the maintainer sees A1 executing.

## Repeated process loss

Loss before or after the absence read requires a new read on the next
activation. Loss before the replacement intent leaves the original association.
Loss after EmptyPreTurn, after thread/start, or before association persistence
leaves only the durable empty-allocation intent. No task turn could have been
authorized at those cuts. The next activation freshly reads that private
intent and may allocate an empty thread; an unassociated orphan is left alone,
never guessed from cwd or recency. This is the existing issue-219 allocation
protocol, not reuse of a historical absence observation.

Loss after association, after normalized proof, or before delivery discards
the local allocation capability and requires fresh private and Codex reads.
Historical proof ids grant nothing. A changed private association rejects
either capability. If an existing reconciled thread disappears after proof
issuance, delivery fails without allocation; a later reconciliation must
prove absence again. An error at turn/start consumes the durable turn intent
and never grants another allocation, including for a freshly allocated thread.

Once TurnIntentRecorded is durable, even loss before the actual call must
remain ambiguous. Missing turn evidence leaves responsibility unresolved and
starts no replacement. Loss after turn/start is reconciled against the same
thread and owned turn. NoReport never grants allocation or redelivery.

## Scenario-to-test mapping

| Scenario | Concrete acceptance evidence |
| --- | --- |
| Original idle association remains reusable | `restarts the production workflow after durable association and finishes Begin ordinal one` |
| Ordinary Run startup reconstructs the same responsibility across another association crash | `ordinary Run reconstruction replaces an absent empty Codex association and settles only Begin ordinal one`: three fresh production applications reopen SQLite and private files; process two rereads the prior association before allocation, saves turn intent before one task turn, and settles Begin ordinal 1; process three performs no allocation or turn; Git Base/worktree/branch and claim remain preserved |
| Absent association changes only private thread id and retains A1, worktree, Base and ordinal 1 | `reconstructs the original Begin after absent-thread replacement loss at … with …`: exact original intent/request, changed thread id, original cwd, one turn |
| Loss before/after absence read, private allocation intent, thread/start and association write | Same matrix for `before-absence-read`, `after-absence-read`, `before-allocation-intent`, `after-allocation-intent`, `after-thread-start`, `before-association`, `after-association`; each runs with memory and reopened SQLite plus file-backed private store |
| Loss before/after proof observation and before turn intent | Same matrix for `before-proof-observation`, `after-proof-observation`, `before-turn-intent`; fresh executor Layer/private read on each activation |
| Intent may have crossed but no owned turn exists | `after-turn-intent` retains the unsettled command, zero task turns and no later allocation |
| Turn response is lost | `after-turn-start` accepts the exact existing executing turn through command projection, with one task turn |
| Unknown or contradictory evidence grants nothing | `refuses Begin-not-crossed for … executor evidence` and existing stale-proof/changed-association matrix |
| Real supported-host loss after durable association | `post-association process-loss production scenario completes the first Begin after Codex proves its no-turn rollout absent`; a focused #75 fixture case journals Begin across killed/restarted processes, asserts one ordinal-1 intent and response, changed empty-thread id and one task request to the holding local model |
| Fresh allocation cannot confer durable or reusable permission | `rejects fresh-allocation Begin capability after … without another allocation or turn` covers missing/changed association, process restart, intervening command, newer proof and consumed proof |
| Replacement allocation response is not usable | `preserves empty allocation intent when replacement thread/start returns … evidence` covers active, notLoaded, systemError, turn-bearing and foreign worktree responses |

The controlled matrix exercises the production command workflow, and the
ordinary Run test enters `runWorkflow` and fresh production bootstrap layers
over the exact accepted Journal prefix. Its later provider unavailability
ends the activation while preserving the executing report; a subsequent
activation remains incomplete without allocating or commanding another turn.
The built host exercises the real Codex/private-store connection. Bulk cuts use no live
provider. The built host uses the supported-host fixture's isolated deterministic
local model endpoint, not production credentials.

The scoped Linux host case proves the first Begin settles as Executing. The
unchanged normal-start terminal qualification was also tried as a comparator:
its local model finished both responses, but terminal projection remained
Unreadable. That later terminal limitation was observed on the normal and
replacement paths; this child neither repairs that adapter behavior nor claims
terminal qualification. The original #75 terminal test remains unchanged.

#330 retains its acceptance audit and blockers of #261/#307 until both children
are integrated and reviewed. This child changes no #303/#339 prerequisite.

## Formal correspondence and negative controls

The canonical [planned executor model](../../specs/plannedAttemptExecutor.qnt)
exposes the private allocation chronology while retaining the predecessor's
one exact Begin command. `recordPreTurnThreadRead(ExactAbsent)` is the fresh
conclusive provider read; `recordEmptyReplacementIntent` is the durable
EmptyPreTurn write; `allocateReplacementThread` is the empty thread/start;
`associateReplacementThread` is the successful durable association write.
Unavailable, unreadable, foreign and turn-bearing reads are separate values
which enable none of those mutation actions.

An associated replacement retains `BeginAssociatedFreshAllocation` only in
the process which validated the allocation response and saved its association.
`recordCommandProjection(CommandProjectionBeginNotCrossed)` can consume that
authority without implying thread/read or thread/resume on an unmaterialized
rollout. For a recovered `BeginAssociatedPreTurn`, this same action abstracts
the predecessor's fresh exact idle read. `recoverActivation` discards the
allocation authority and every live proof. `redeliverBegin` consumes proof
without allocation, then `crossRedeliveredBeginTurn` exposes the task-turn cut.

The [finite evidence projection](../../specs/plannedAttemptExecutor_proof.qnt)
preserves those stages, including fresh allocation versus recovered association,
and maps canonical recovery to `loseReplacementProcess` or `loseBeginProof`.
Repeated empty allocations retain their count modulo two at the allocation stage;
the canonical allocation counter and production tests measure their number.
This introduces no production allocation budget. Exact request/worktree/Base
and private storage I/O remain production provider test obligations.

The normalized controller [conformance adapter](../../packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts)
maps the four private actions to stutters because they append no Journal
command or report and cross no normalized command boundary. It continues to
execute the production controller at the proof, original Begin delivery,
turn-crossing observation and settlement boundaries. The controlled production
provider matrix above supplies the private-effect correspondence.

| Scenario | Model test or independently checked law |
| --- | --- |
| Exact absence allocates and associates before completing the same Begin | `absentEmptyAssociationFinishesSameBeginTest`; `replacementKeepsOriginalBegin`; `replacementAllocationRequiresDurableEmptyIntent` |
| Repeated loss before/after absence, intent, allocation, association and proof | `repeatedReplacementCrashCutsKeepOneBeginTest`; projection `absentReplacementAndRepeatedCrashCutsTest` |
| Unknown/foreign/turn-bearing read grants no replacement | `ambiguousPreTurnReadForbidsReplacementTest`; projection `unsafeThreadNeverAllocatesTest` |
| Fresh allocation authority expires at process loss | `restartDiscardsFreshAllocationAuthority`; both `persistedFreshAllocationAuthorityMutationIsDetectedTest` controls |
| Historical absence cannot authorize another replacement | `staleAbsenceReplacementMutationIsDetectedTest`; `ambiguousReplacementMutationIsDetectedTest` |
| Allocation must follow its durable intent and proof must follow association | `allocationWithoutEmptyIntentMutationIsDetectedTest`; `proofBeforeReplacementAssociationMutationIsDetectedTest`; projection `missingAllocationIntentMutationIsDetectedTest` and `proofBeforeAssociationMutationIsDetectedTest` |
| Proof-consuming delivery cannot allocate or cross twice | `redeliveryAllocationMutationIsDetectedTest`; predecessor `staleBeginProofMutationIsDetectedTest` and `duplicateBeginTurnMutationIsDetectedTest`; projection counterparts |

All named invariants and stage witnesses are registered in the shared
[obligation manifest](../../scripts/quint-model-obligations.mjs). Collected
negative tests execute the forbidden transition and assert that its independent
law becomes false; an aggregate green test count alone is not this evidence.
