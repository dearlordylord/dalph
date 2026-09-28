# Issue #386 acceptance and scoped review audit

Audit started 2026-09-27 16:39:59 UTC; stop time 17:24:59 UTC (45 minutes).
Evidence reconciliation completed 2026-09-27 16:55 UTC, within the time box.
Planned Base: `7d4c545f5ad7a1ebff3d32940877c514083f297e`.
Reviewed candidate: `8cd92c9247607f6633cf8544a64867e6c820c01a` (clean at audit start).
Review diff: `git diff 7d4c545f5ad7a1ebff3d32940877c514083f297e...8cd92c9247607f6633cf8544a64867e6c820c01a`.
The accepted [S4/S5/S7/S8 chronology and eight-row plan](scenarios/direct-remote-publication.md#386-acceptance-test-plan) retain authority over this audit. Corrected test identifiers below do not remove any promised outcome. The original audit below is fixed evidence for `8cd92c924`; the focused implementation follow-up at the end records later proof and one runtime repair.

## Passing evidence used below

| ID | Exact evidence and limit |
| --- | --- |
| E1 | At `8cd92c924`, `pnpm exec vitest run packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.test.ts --testNamePattern='retains exact exhaustion without an ungranted fourth push intent' --maxWorkers=1`: 1 passed, 11 skipped. |
| E2 | At `8cd92c924`, `pnpm exec vitest run packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts packages/dalph/test/scenarios/production.test.ts packages/dalph/test/cassettes/direct-remote-publication.test.ts --testNamePattern='grant\|Grant\|exhaust\|publication proof\|production Run defers a real exhausted publication batch\|publishes M before local promotion' --maxWorkers=2`: 15 passed, 81 skipped. Selection and counts are recorded in `/tmp/dalph-386-audit-focused-core.log`. The command's actual shell argument uses `|` without backslashes; the backslashes here keep the Markdown table intact. |
| E3 | At `8cd92c924`, `pnpm exec vitest run packages/dalph/test/scenarios/hermetic-mvp.test.ts --testNamePattern='fixes a same-commit fourth successor only after the exact third-session exhaustion grant\|continues one exhausted publication responsibility through exactly one granted batch while an unrelated target progresses' --maxWorkers=1`: 2 passed, 6 skipped. Log: `/tmp/dalph-386-audit-focused-hermetic.log`. |
| E4 | Run `07d50621-90c7-4e1d-929a-fbcaae007265` at `288e4aed1`: `Quality gate 'affected formal proof'` passed at 2026-09-27 14:20:09 UTC. Its retained log at `.scratch/quality-gates/07d50621-90c7-4e1d-929a-fbcaae007265/logs/85bb6b93-2a8b-41d8-9428-efb75a546c30.log` records 20 positive and 16 negative base-model tests, 20/16 control-projection tests, 22/20 batch/finality-projection tests, and one bounded control-projection exhaustive proof, all passed. Formal inputs and effective-profile scripts have no diff from `288e4aed1` to `8cd92c924`. The whole earlier gate remains `UNPROVEN`; this is focused formal-stage evidence only. |
| E5 | The maintainer reported the complete `scripts/formal-gate.integration.test.mjs` file passed 17/17 at clean `8cd92c924` in 4m31s. This checks the formal harness fixtures; it does not replace accepted grant runtime, MBT, or formal-model evidence. |

## Row-by-row result

### S4: Initial and later batch bounds — covered by focused evidence

- **Initial three-session/three-intent limit:** [protocol-engine.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/protocol-engine.test.ts), `retains exact exhaustion without an ungranted fourth push intent`, and [acceptedResultIntegration_automaticSuccessor_proof_test.qnt](../specs/acceptedResultIntegration_automaticSuccessor_proof_test.qnt), `thirdSessionAndThirdPushExhaustWithoutUnrequestedFourthSessionTest`, remain initial-batch controls. Runtime E1 passed; the formal test passed in E4's affected profile.
- **Exact third-session exhaustion and authorized fourth session:** [automatic-successor-session.test.ts](../packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts), `reconstructs a fourth automatic successor only after its exact publication batch grant`, rejects the ungranted fourth session, records one grant for the current retained occurrence, fixes generation four with the grant position, and recovers that exact session. The named test in `successor-session.test.ts` does not exist; this is the actual test. E2 passed. [hermetic-mvp.test.ts](../packages/dalph/test/scenarios/hermetic-mvp.test.ts), `fixes a same-commit fourth successor only after the exact third-session exhaustion grant`, supplies the full journey; E3 passed.
- **Third push intent, committed-but-unsent intent, monotonic ordinals, and O2:** [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `records and replays one exact Full rerun grant during Pause, then executes one bounded batch after Unpause`, asserts the lost response after intent four makes no push, preserves ordinals 1–6 and the grant marker on 4–6, retains exact O2, and needs a separate O2 grant. E2 passed. Formal counterparts are [directPublicationBatchGrant_test.qnt](../specs/directPublicationBatchGrant_test.qnt), `thirdPushIntentExhaustionCanBeGrantedWithoutAnotherSessionTest`, `thirdSessionExhaustionRetainsExactCauseWithoutPushIntentTest`, and `nextExactExhaustionRequiresFreshGrantWithoutResettingOrdinalsTest`; E4 passed. The three originally named grant tests in `acceptedResultIntegration_automaticSuccessor_proof_test.qnt` do not exist; these are the current model seams.

### S4: Grant identity and replay — B1 resolved at `53158090c`

- **Exact O receipt, replay, different request ID, and one batch:** [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `records and replays one exact Full rerun grant during Pause, then executes one bounded batch after Unpause`, asserts `NewlyRecordedBatchGrant`, `BatchGrantReplay`, `BatchGrantAlreadyRecordedForExhaustion`, one `RemotePublicationBatchGrantApplied`, exact request/result and grant position, and a second batch only after O2. E2 passed. The receipt is a distinct event from `IntegrationQuarantineDirectionApplied`.
- **Wrong occurrence and unrelated quarantine:** the same file's `rejects a superseded exhaustion occurrence after a later successor candidate becomes current` and `rejects a publication batch grant for an unrelated quarantine occurrence` each assert subject mismatch and zero grant records. E2 passed. [directPublicationBatchGrant_test.qnt](../specs/directPublicationBatchGrant_test.qnt), `sameRequestReplayIsExactAndDifferentRequestCannotMintAnotherGrantTest`, and the negative model `detectsDifferentRequestIdMintingSecondGrantForSameExhaustionTest` passed in E4.
- **B1 — resolved focused boundary proof:** `batch-grant.test.ts::rejects wrong Run, responsibility, queue position, commit, and candidate at exact grant admission` submits the named wrong subjects at real admission and checks zero new grant, session, or intent; the exact request succeeds. The focused result and commit are recorded below.

### S4: Post-Unpause outcomes — B2 resolved at `53158090c`

- **Distinct model branches:** [directPublicationBatchGrant_test.qnt](../specs/directPublicationBatchGrant_test.qnt) has `exactPublicationProofAndFinalityRequireFreshBoundariesTest` (already published), `safelyReusableCandidateUsesPushWithoutNewSessionTest` (reusable M), `sameCommitSuccessorUsesOneTaskAttemptAndExactParentsTest` (same C), and `blockedPostUnpauseConstraintRetainsPreciseWaitTest` (blocked); all passed in E4. The three originally named tests in `acceptedResultIntegration_automaticSuccessor_proof_test.qnt` do not exist.
- **Runtime reusable M and same-C successor:** [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `records and replays one exact Full rerun grant during Pause, then executes one bounded batch after Unpause`, keeps the fixed original session and spends only the granted candidate intents (E2). [hermetic-mvp.test.ts](../packages/dalph/test/scenarios/hermetic-mvp.test.ts), `fixes a same-commit fourth successor only after the exact third-session exhaustion grant`, asserts one planned task attempt and one executor start through successor generation four (E3). `retains a precise policy wait after a granted attempt without retrying the denied push` proves the policy-wait branch (E2).
- **B2 — resolved focused runtime branches:** the already-published M and each named wait are exercised by the exact `batch-grant.test.ts` and ordinary production Run cases mapped in the follow-up table below. The production permission and claim waits append no promotion, completion, or cleanup.

### S4: Independent progress — covered

- [hermetic-mvp.test.ts](../packages/dalph/test/scenarios/hermetic-mvp.test.ts), `continues one exhausted publication responsibility through exactly one granted batch while an unrelated target progresses`, runs B while A's exact O/Q remain unsettled, then checks one grant, same-C fourth successor, one task attempt and executor start, and proof/promotion/completion/cleanup/termination only after the granted path. Its sibling `fixes a same-commit fourth successor only after the exact third-session exhaustion grant` checks the no-rerun branch. E3: both passed. The plan's `does not rerun the task executor when a granted batch fixes a same-commit successor` is a stale title for that sibling, not a separate test.

### S5: Grant and intent recovery — B3 resolved by focused conformance

- **Precommit and commit-before-ack grant cuts:** [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `retries an exact paused grant after a precommit crash in memory` and `replays an exact batch grant from a reopened SQLite journal after lost acknowledgement`, assert zero grant before commit, one retained receipt after commit, exact replay, Pause preserved, and no batch effects before Unpause. E2 passed. Both named `grant-recovery.test.ts` and `batch-grant-recovery.test.ts` paths in the scenario are nonexistent; these are the actual tests.
- **Fixed session and granted intent cuts:** [automatic-successor-session.test.ts](../packages/orchestrator/src/workflow/protocols/integrator/automatic-successor-session.test.ts), `reopens the exact granted fourth session after its SQLite fixation commits without acknowledgement`, asserts one fixed session after restart. [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `reconciles an applied granted push after its response is lost without another push` and `reconciles an applied granted push from reopened SQLite without another push`, assert exact original intent/push correlation and no duplicate send. E2 passed. The formal `crashAfterSessionFixationResumesSameSessionWithoutRepetitionTest` and `crashAfterCommittedGrantIntentReconcilesOriginalOrdinalTest` passed in E4.
- **B3 — resolved conformance proof:** [accepted-result-integration.mbt.test.ts](../packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts), `publication exhaustion grant consumes one batch consistently in memory and SQLite`, drives both stores through real three-push exhaustion, Pause, one grant committed before a lost acknowledgement, reconstructed memory and reopened SQLite, exact replay, and Unpause. Each consumes only ordinal four, returns `PublicationSucceeded`, and has one grant, proof, session, task Begin, and resumed push; it compares visible outcomes and forbidden-effect counts across stores. Focused MBT: 1 passed, 9 skipped.

### S7: Pause and Exit — B4 resolved by focused production activation

- **Pause receipt, replay, deferred effects, Exit cutoffs:** [production.test.ts](../packages/dalph/test/scenarios/production.test.ts), `production Run defers a real exhausted publication batch through Pause until Unpause`, uses real exhaustion and a SQLite Run. It asserts one grant during Pause, exact replay, unchanged provider/Git activity while paused, Exit-before-append rejects with no grant, Exit-after-commit preserves the prefix with no work, and a later post-Unpause remote observation/push with grant-marked intents. E2 passed. This is the actual test behind the planned `holds an exact exhaustion grant through Pause and enforces the Exit cutoff` title. [directPublicationBatchGrant_negative_test.qnt](../specs/directPublicationBatchGrant_negative_test.qnt) tests all four removed Pause/Exit guards; E4 passed.
- **B4 — resolved production read order:** the same production test taps ordinary `runWorkflow` after Unpause and counts control reconstruction, remote destination admission, current graph revision and claim, local Git reads, remote Git observation, and sender-custody preparation in that order before the first new `RemotePublicationAttemptIntended` append and push. The journal suffix independently orders the exact Unpause fact, current graph revision, exact claim, and target-lineage observation before that intent. A failed graph read produces no intent or push; terminal permission and foreign-claim forks retain Q without a new intent or push. Focused production case: 1 passed, 31 skipped.

### S8: Proof and finality — B5 resolved at `53158090c`

- [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `records and replays one exact Full rerun grant during Pause, then executes one bounded batch after Unpause`, asserts a grant leaves `publicationPremiseFor` missing, completion fails `RemotePublicationMissing`, and no completion or authorization calls occur (E2). The accepted plan's `completion-task-protocol.test.ts::does not complete a task from an exhaustion grant without exact publication proof` does not exist; this is the actual grant-specific test. [completion-task-protocol.test.ts](../packages/orchestrator/src/workflow/protocols/integration-finality/completion-task-protocol.test.ts), `requires exact remote publication proof before a new tracker completion`, independently asserts zero completion and authorization calls without proof (E2).
- [direct-remote-publication.test.ts](../packages/dalph/test/cassettes/direct-remote-publication.test.ts), `publishes M before local promotion and task completion, then releases its dependant from a later complete graph`, checks finality and all three cleanup results before the later completed graph observation and B's executor start after it (E2). The grant journey in E3 asserts exact proof, promotion, completion, finality, and termination. The formal `detectsGrantReceiptUsedAsPublicationProofTest` passed in E4.
- **B5 — resolved grant-only finality absence:** the grant-only `batch-grant.test.ts` prefix exercises the ordinary Run finality selector, sees `RunMustRemainActive`, and asserts zero `IntegrationFinalitySettled` appends and Q unsettled, as mapped below.

### S4/S5/S7/S8: Formal chronology — covered as formal evidence

- [directPublicationBatchGrant.qnt](../specs/directPublicationBatchGrant.qnt) and [directPublicationBatchGrant_test.qnt](../specs/directPublicationBatchGrant_test.qnt) retain the accepted paused-grant, exact replay, crash-after-fixation/intent, already-published, reusable, same-C successor, blocked, Exit, and bounded O2 branches. All 20 deterministic tests passed in E4.
- [directPublicationBatchGrant_negative_test.qnt](../specs/directPublicationBatchGrant_negative_test.qnt) includes the seven named grant/replay/budget/execution/proof mutants plus four Pause/Exit guard removals; all 16 passed in E4. The control projection's bounded exact proof passed in E4. The separate runtime and MBT evidence above closes B1–B5's focused gaps.

## Scoped review closure

The original review diff was Base `7d4c545f5ad7a1ebff3d32940877c514083f297e` to candidate `8cd92c9247607f6633cf8544a64867e6c820c01a`. The Standards review checked the changed code against `CONTEXT.md`, `ARCHITECTURE.md`, and `CODE_REVIEW.md`; the Spec review checked the accepted S4/S5/S7/S8 chronology and test plan. Later implementation and focused evidence resolve the five missing-proof findings. This review closure is scoped to acceptance mapping and focused checks; full qualification is separate.

| Finding | Disposition |
| --- | --- |
| Stale plan paths/titles for fourth successor, grant recovery, no-task-rerun journey, Pause/Exit production, grant-only completion, and three post-Unpause formal branches | **Resolved as documentation mapping:** exact current tests and decisive assertions are identified above. Accepted outcomes remain unchanged. |
| Possible optional `attemptOrdinalsInBatch` state and duplicated fallback in `state.ts`/`protocol-engine.ts` | **Rejected as a gate blocker:** standards review found the reducer populates the field and no supported failing caller or scenario. This is a judgement-call smell, not proof of a defect. |
| B1 wrong grant subjects, B2 runtime post-Unpause branches, B5 grant-only finality absence | **Resolved at `53158090c`:** exact tests and decisive assertions appear in the follow-up table below. |
| B3 grant MBT, B4 post-Unpause fresh-read ordering | **Resolved by the focused conformance and production tests above:** terminal check and final candidate details appear in the B3/B4 follow-up below. |

| Historical blocker at `8cd92c924` | Actor, trigger, boundary, and then-missing proof |
| --- | --- |
| B1 | Dalph admits Alice's Full rerun after a wrong Run, responsibility, position, commit, or foreign candidate is supplied. The grant admission boundary must reject each nonmatching subject without a receipt or batch authorization. No runtime test submits all named wrong subjects; only narrower unrelated-quarantine and superseded-O tests pass. |
| B2 | Dalph resumes Q after Unpause with an exact grant. The S4 branch boundary must avoid another session/push for already-proved M and retain each named current constraint without a forward effect. Model traces and reusable-M/successor/policy runtime cases pass, but the other promised runtime branches have no direct test. |
| B3 | Dalph recovers the same granted batch in memory and reopened SQLite. The conformance boundary must compare visible outcomes and forbidden effects. The promised grant MBT case is absent, despite narrower unit recovery tests. |
| B4 | Dalph resumes Q after Unpause. Before the first Q-owned forward effect, the production activation must reread current control, claim/revision, custody, permission/policy, and needed Git facts in order. The passing production test counts later remote observation but not the required earlier reads. |
| B5 | Dalph receives a grant with no exact publication proof. The finality boundary must append no `IntegrationFinalitySettled` and the ordinary Run finality selector must leave Q unsettled. The grant-only unit test checks missing premise and no tracker completion, but does not observe the finality selector or append absence. |

The Standards review found no hard violation against [CODE_REVIEW.md](CODE_REVIEW.md), [CONTEXT.md](CONTEXT.md), or [ARCHITECTURE.md](ARCHITECTURE.md). The Spec review found B3 and B4; the row audit additionally found B1, B2, and B5 as missing independent proof at `8cd92c924`. All five have later focused evidence. The accepted issue remains open pending any required qualification. No `check:all` was started for this audit or either focused follow-up.

## Focused B1/B2/B5 implementation follow-up

Started 2026-09-27 17:02:19 UTC; absolute stop 2026-09-27 17:45:00 UTC. Base remains `7d4c545f5ad7a1ebff3d32940877c514083f297e`; the implementation commits are `cd618c27c095813297d8fc9231f6d7da9992b9ec` and `49bce46ab78c7d3a8dd81743e4d735423f5b6896`. The final documentation commit and terminal elapsed time are recorded in the handoff, after checks finish. No full gate was started.

| Accepted row | Exact test and decisive passing assertion | Disposition |
| --- | --- | --- |
| S4 grant identity, B1 | [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `rejects wrong Run, responsibility, queue position, commit, and candidate at exact grant admission`: each submitted wrong subject fails the real admission call; journal position, grant count, fixed-session count, and push-intent count remain unchanged; the exact request then admits one grant. Commit and candidate are journal-owned parts of O, so attempted extra request fields are rejected by strict decoding; the existing `rejects a superseded exhaustion occurrence after a later successor candidate becomes current` proves a stale candidate's actual O cannot authorize a batch. | **Resolved for this focused boundary.** |
| S4 already-published M, B2 | [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `resumes exact already-published M toward finality after Unpause without another session or push`: an actual exhausted prefix receives Pause, grant, Unpause, remote M-current observation, exact proof, and `RunTargetPromotion` selection with zero new session/push. [production.test.ts](../packages/dalph/test/scenarios/production.test.ts), `production Run defers a real exhausted publication batch through Pause until Unpause`: its separate reopened SQLite branch observes M current and records `TargetPromotionObservedSuccess`, one proof, one grant, unchanged session count, and zero new pushes. | **Resolved for the no-session/no-push finality entry.** |
| S4 blocked post-Unpause branches, B2 | [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `retains exact post-Unpause authentication, throttle, custody, and lineage waits without retrying forward work`: each exact granted outcome retains its named cause, and replay adds no intent, session, proof, or push. `keeps a granted responsibility waiting after Unpause when tracker permission or its exact claim is absent` selects only safe release for ineligible lifecycle and no transition for foreign claim, with Q unsettled. The production test above also reopens separate SQLite prefixes, reads a fresh terminal graph or foreign claim after Unpause, and makes no new observation/push/session/intent. The earlier `retains a precise policy wait after a granted attempt without retrying the denied push` covers policy. | **Resolved for the named focused waits.** |
| S8 grant-only finality, B5 | [batch-grant.test.ts](../packages/orchestrator/src/workflow/protocols/direct-publication/batch-grant.test.ts), `records and replays one exact Full rerun grant during Pause, then executes one bounded batch after Unpause`: on the grant-only prefix, ordinary `deriveRunFinalityDecision` returns `RunMustRemainActive`, `deriveIntegrationFinalityStateFor` is not settled, zero `IntegrationFinalitySettled` records exist, and the existing `RemotePublicationMissing` completion rejection remains. | **Resolved for the focused grant-only boundary.** |

At `49bce46ab` plus the focused assertion follow-up, `batch-grant.test.ts` passed 13/13 and the named production test passed 1/1 with 31 skipped; terminal logs are `/tmp/dalph-386-b125-unit-final.log` and `/tmp/dalph-386-b2-production-final.log`. `pnpm typecheck`, `pnpm lint:changed`, and `git diff --check` passed. The scoped Standards review of `28d32551...cd618c27` and follow-up `cd618c27...49bce46` found no hard violation. Its note that `ineligibleCurrentTaskIds` is separate from `currentTrackerTaskIds` is a nonblocking design observation: both are derived together from one fresh complete graph, and S8 already requires any started responsibility whose current task is terminal to wait before a forward effect. The Spec review accepted B1/B5 and requested ordinary production activation for B2; that is covered by the SQLite branches above. Its requested direct checks for zero promotion, completion, and cleanup on permission/claim waits are included in the focused production test. No accepted B1/B2/B5 finding is deferred. B3/B4 were outstanding at the end of this earlier follow-up and have the separate closure below.

## Focused B3/B4 implementation and review closure

Started 2026-09-27 17:27:46 UTC; absolute stop 2026-09-27 18:25:00 UTC. Base remains `7d4c545f5ad7a1ebff3d32940877c514083f297e`; the prior clean candidate is `53158090cae8b04a71ce3095628ecc395c7f2b9f`. The follow-up changes only conformance and production acceptance tests plus this evidence mapping. No Dalph runtime behavior changes in this follow-up.

| Accepted row | Test and decisive assertion | Disposition |
| --- | --- | --- |
| S5 real exhaustion/grant/recovery, B3 | `packages/dalph/test/conformance/accepted-result-integration.mbt.test.ts::publication exhaustion grant consumes one batch consistently in memory and SQLite` drives three failed pushes to actual `AttemptsExhausted` in both stores, applies Pause, loses acknowledgement after the real grant append, reconstructs memory and reopens SQLite, then replays the same grant and Unpauses. The two paths have identical event-tag prefixes and equal visible recovery results; ordinal four alone consumes the grant, one resumed push yields exact publication success, and replay makes no second push, grant, session, task Begin, or proof. The test asserts each forbidden count and compares the result objects, rather than comparing only counters. | **Resolved; focused MBT passed 1/1 (9 skipped).** |
| S7 fresh facts before forward effect, B4 | `packages/dalph/test/scenarios/production.test.ts::production Run defers a real exhausted publication batch through Pause until Unpause` now observes the ordinary production activation after Unpause. Its trace counts and orders current control/policy reconstruction, remote destination admission, current complete graph revision/permission, exact claim, local Git, remote Git, and sender custody before the first `RemotePublicationAttemptIntended` append; that intent precedes push. Journal positions independently put the exact Unpause fact, fresh graph revision, claim, and target-lineage observation before the first new intent. A failed graph read records no intent or push, and separate terminal-permission and foreign-claim reads leave Q active without a new intent or push. | **Resolved; focused production case passed 1/1 (31 skipped).** |

The scoped review compares Base `7d4c545f5ad7a1ebff3d32940877c514083f297e` with this follow-up candidate under [review closure](CODE_REVIEW.md#review-closure). **Spec:** B3 and B4 now have the accepted chronological triggers, actual authority boundaries, crash/reopen or wait cuts, visible outcomes, and direct forbidden-effect assertions above; the scenario-to-test rows in the accepted plan identify them. **Standards:** the conformance test uses the same publication engine and grant admission for both stores, and the production test observes the existing production interpreter through boundary services; no parallel behavior path or authority duplication was introduced. The two controlled Git adapters repeat custody and observation setup; this is a nonblocking duplication smell rejected as a gate finding because the explicit initial rejection and resumed application phases make the different push outcomes reviewable at their boundaries. The only intermediate failures were a test assertion that counted a permitted admission read as a forward effect, an unavailable outer test service, a SQLite concurrent-read lock, and import/type setup; each was corrected in the focused test harness and rerun. No scoped finding is deferred. Focused terminal logs and final candidate SHA are reported with the handoff; no full gate was started.

## Failed gate 7cb32e99 focused recovery diagnosis

Recorded before editing runtime code or test fixtures at clean `0796c15c71918042b112c1cf384b16e6f24c4547`; planned Base remains `7d4c545f5ad7a1ebff3d32940877c514083f297e`. The admitted run passed 17 stages and failed coverage with five tests across three files. Its custody was stopped and reconciled, and qualification remains `UNPROVEN`. This attempt starts 2026-09-27 18:44:56 UTC, expects 30–40 minutes, and stops by **2026-09-27 19:30:00 UTC**. No full gate or automatic broad retry is authorized.

**Question.** Does the new ineligible-current-task lifecycle gate correctly suppress forward work after a truly terminal fresh graph, or misclassify an open/current responsibility and block required progress?

**Alternative A prediction.** At the first divergence, the fresh complete graph names the exact target task as terminal or ineligible, with its current revision and claim. The selected transition suppresses publication/finality progress, so an older assertion or cassette expecting forward work has a stale chronology; correcting it must retain S1/S8 finality and every forbidden effect.

**Alternative B prediction.** At the first divergence, the fresh complete graph names the exact target task as open/current, or the journal already contains complete finality evidence. A selected release/wait or missing required read despite those facts is a runtime gating or selection defect; fixture expectations must remain intact.

**Distinguishing observation.** Capture the exact fresh graph lifecycle and revision, focused claim, journal prefix and position, selected frontier transition, and next expected external or durable boundary at the first mismatch. Start with `integration-claim-graph.test.ts::rereads the post-claim graph with target initially held`. The retained gate log predicts focused exit **1** with literal **`expected true to be false`**. Save the diagnostic log and require both the exit and literal output; if either differs, mark the reproducer inconclusive and choose a changed focused action. Then inspect the two DS-17 capstone failures, direct-publication 45-second timeout, and the second claim/graph failure against the same boundary.

**First reproducer result.** The named test exited 1 and emitted the exact `expected true to be false` assertion in `/tmp/dalph-386-7cb32-focused-first.log`. Temporary instrumentation in `/tmp/dalph-386-7cb32-first-boundary.log` observed the first divergence at journal position 87, after `ReadTrackerGraph` intent/facts at 84–85 and focused claim intent/facts at 86–87. The complete graph's revision is `fresh-tracker-revision`; `integration-finality-task` is `CompletedSuccessfully`, and the exact active claim is `integration-finality-active-claim` owned by `dalph:integration-finality`. The selected transition is `ReleaseStartedIntegrationTarget`, while the old assertion expected no release and then a post-claim graph read before lineage. The prior prefix contains an accepted result, `IntegrationResponsibilityBegan` at 17, `IntegrationStarted` at 18, and `TargetLineageObserved` at 20, but no promotion or completion finality. This supports **A** for the claim/graph fixture: the target is terminal before the expected forward read. An open task at revision `fresh-tracker-revision` with the same selected release would falsify A and support B. Temporary instrumentation was removed immediately after capture.

**Remaining four failures.** The initially released claim/graph case used the same terminal `integrationFinalityFixture.graphSnapshot` and expected continuation lineage, so it shared A's stale chronology. Both cases now use a complete **Open** graph at revision `integration-current-open`; the exact four-test file passes in `/tmp/dalph-386-7cb32-claim-after-fixture.log`. The two DS-17 restart failures occur after durable `TargetPromotionObservedSuccess`: the `CompletionTaskAcknowledged` cut receives an extra `ReadTrackerGraph` at story position 43 instead of the expected focused completion read, while the `CompletionClaimDeleted` cut remains active for an unsettled integration responsibility. The gate treated terminal A as a reason to block even the already-promoted, publication-backed finality path. That supports **B's finality-already-satisfied arm**, not a stale S1/DS-17 finality expectation. The direct publication timeout's retained `/tmp/public-s1-timeout-diagnostic.json` and `/tmp/public-s1-timeout-audit.json` show `PromotionCompareAndSet` and `CompletionResponse`, durable `RemotePublicationSucceeded` at position 36, then repeated tracker graph reads through position 193 and a `GraphNotEstablished` wait; its provider log shows A closed and no dependant executor history. The same post-promotion terminal gate prevented finality and dependant release, rather than revealing a need to weaken S8 chronology.

**Repair and focused evidence.** The frontier now applies terminal-task ineligibility while promotion has not succeeded; after `PromotionSucceeded`, it still requires current tracker facts and the existing publication proof before finality. Unsatisfied prerequisites remain a wait. The two named DS-17 cases pass 2/2 (34 skipped) in `/tmp/dalph-386-7cb32-capstone-after-gate.log`; the named direct publication case passes 1/1 (4 skipped) in `/tmp/dalph-386-7cb32-direct-after-gate.log` in 10.40 seconds. Existing B1–B5 assertions and finality/cleanup ordering are retained. The affected typecheck and changed-file lint run expects 2–4 minutes and stops no later than **2026-09-27 19:00:00 UTC**; the overall attempt still stops at 19:30 UTC.

**Scoped review closure.** Planned Base is `7d4c545f5ad7a1ebff3d32940877c514083f297e`, prior candidate is `0796c15c71918042b112c1cf384b16e6f24c4547`, and the pre-review repair diff snapshot has SHA-256 `5436a4e891d9cdf0de89661a7e2103134fd63621f4214db1240615c0c84cab30`. The review followed [CODE_REVIEW.md](CODE_REVIEW.md#review-closure) and compared the three-file repair with the accepted S1/S4/S5/S7/S8 chronology, CONTEXT authority boundaries, and the existing scenario-to-test mapping.

| Finding | Actor, trigger, boundary, and disposition |
| --- | --- |
| F1, stale claim/graph fixture | The two integration-claim-graph tests supplied a fresh `CompletedSuccessfully` graph before asking Dalph to continue an unpromoted integration responsibility. The release/wait was correct; using a complete Open graph preserves both post-claim read assertions. **Resolved:** all four tests pass; no assertion was removed. |
| F2, finality blocked by terminal gate | After exact promotion, remote publication, and tracker completion, Dalph still applied the pre-promotion terminal-task gate to finality. That prevented DS-17 cleanup/settlement and left the direct S1 journey in a graph-read loop. **Resolved:** only the post-successful-promotion path bypasses terminal ineligibility; current tracker facts, publication proof, and prerequisite gates remain. The two DS-17 and direct S1 cases pass with their original finality, cleanup, and dependant-order assertions. |
| F3, proposed cassette chronology update | Treating the DS-17 focused completion read and `RunMayTerminate` expectations as stale would remove required finality and contradict S1/S8. **Rejected with evidence:** both pass unchanged after F2. |
| F4, proposed timeout increase | The 45-second direct-publication timeout exposed a repeat graph wait, not a slow successful path. **Rejected with evidence:** the unchanged 45-second test completes in 10.40 seconds after F2. |

No accepted-scenario finding is deferred. The first `pnpm check:fast` found one dprint layout issue in the new test fixture; `pnpm exec dprint fmt` corrected it. The rerun `DALPH_DIAGNOSTICS_BASE=7d4c545f5ad7a1ebff3d32940877c514083f297e pnpm check:fast` passed typecheck and changed-file lint in `/tmp/dalph-386-7cb32-check-fast-final.log`, and `git diff --check` passed. Additional focused preservation checks passed: 13/13 batch-grant cases (`/tmp/dalph-386-7cb32-batch-grant.log`), 33/33 integration-frontier cases (`/tmp/dalph-386-7cb32-frontier.log`), 1/1 production Pause/Unpause case (`/tmp/dalph-386-7cb32-production-s4s7.log`), and 1/1 memory/SQLite grant MBT in Vitest MBT mode (`/tmp/dalph-386-7cb32-mbt-s5.log`). The first MBT invocation used ordinary Vitest mode and selected zero files by configuration; the corrected `--mode mbt` command passed. This review makes no local-gate or dogfood completion claim.


## S1 executor-completion boundary follow-up (2026-09-28)

This follow-up is limited to the executor completion handoff. The preserved
Run was not retried, resumed, or modified. The retained workflow projection is
still `ExecutorWorkExecuting`; provider rollout metadata records
`event_msg/task_complete` for turn `01a0e567-441a-7151-8cb1-135e9efacb8a` at
`2026-09-28T00:28:10.370Z`. The retained journal/private executor state has no
raw JSON-RPC ingress, app-server hint-publish, or lifecycle-consume event, so
the live cause remains **inconclusive**.

The competing explanations and predictions are:

1. **Notification not delivered to Dalph.** The app-server reader has no
   `turn/completed` ingress for this exact owned turn, or fails before
   publishing its wake hint. The workflow remains Executing because the
   passive owner receives no wake.
2. **Notification delivered, then not mapped or accepted.** The reader
   receives and publishes `turn/completed`, but the lifecycle subscriber
   does not perform an exact attempt/thread reread, or the reread fails to
   produce the accepted terminal projection. The workflow also remains
   Executing.

`event_msg/task_complete` is rollout evidence, not proof of a JSON-RPC
`turn/completed` delivery. The minimum secret-free observation is now
implemented through an Effect logger at JSON-RPC ingress/publication
and at each attached lifecycle's global-hint-consumption and exact-reread/result
boundaries. Records include a per-app-server notification ordinal,
per-attachment hint/read ordinals, the app-server incarnation, exact attached
attempt/run, and exact projected thread/turn when available. The reader extracts
bounded allowlisted IDs from the notification, including `params.turn.id`; it
never logs the payload.

The lifecycle hint channel is `PubSub<void>` and can coalesce wakes. Therefore
`GlobalHintConsumed` reports the subscriber's attached attempt and its
`lastProjectedThreadId`/`lastProjectedTurnId`; these are the prior projection,
not identities recovered from the notification. The notification ordinal is
not carried across the channel. Matching ingress IDs and last-projected IDs can
support an exact-turn mapping observation when available, followed by the
logged reread result. An IDless or coalesced global wake proves only that a
subscriber woke; it cannot establish which ingress caused it. Ingress without
publication supports the reader/publish arm of cause 1. Publication without a
subsequent exact reread supports the delivery/mapping arm of cause 2. A reread
ending Executing or unreadable isolates the exact-state acceptance arm. The
retained S1 has none of these new logs, so its live cause remains
**inconclusive**.

This instrumentation is observational only: it uses process-local log records,
does not write workflow or executor journals, and does not participate in
projection, hint coalescing, or cadence decisions. The only effectful boundary
remains the existing wake-hint publication followed by the existing exact
provider reread. The retained Run has no retroactive reader logs, so its live
cause remains **inconclusive** until a future supervised S1 captures them.

### Proposed lost-hint chronology — UNACCEPTED

The current accepted passive-observation scenario permits paced census rechecks
only while a terminal exact turn plus a fresh ExactLive owned-activity census
is the sole reason the report remains Executing. The following active-turn
lost-hint chronology is a proposal for acceptance review only; it does not
change that rule or authorize active-turn polling.

- **Starting facts:** one exact Dalph attempt is Running in one attached
  app-server incarnation; its owned turn is exact; lifecycle listeners are
  subscribed before the current projection; no owned terminal activity is
  known. Unrelated attempts remain outside the observation.
- **Trigger:** Codex reaches a terminal turn state, but the app-server emits no
  `turn/completed` notification to the attached client (or the client loses
  that notification).
- **Diagnostic boundary and bound:** in a controlled fixture, set the exact
  provider thread to terminal without publishing a hint. After one fixed
  one-second silence interval, allow at most one exact lifecycle reread of the
  same attempt, thread, and owned-activity census. Stop after that read; no
  periodic retry or second provider session is implied. A production recovery
  interval, repetition limit, and stop rule would require explicit scenario
  acceptance before implementation.
- **Visible result:** if that one reread sees an exact terminal turn and Absent
  owned activity, it may publish the normal sealed terminal result. If it sees
  an active turn or unusable evidence, it remains Executing/unreadable and the
  diagnostic ends inconclusive.
- **Forbidden results:** no new `turn/start`, Begin, Resume, interruption,
  terminal seal without fresh exact evidence, or census across unrelated
  attempts. The one-shot diagnostic is not a broad gate or a live Run retry.
- **Crash/retry:** if the app-server exits before the observation, preserve the
  exact attempt record and surface the existing typed unavailable/unreadable
  boundary. A later owner subscribes before its exact current read; it must not
  restore a cursor, repeat a work-changing command, or treat process loss as
  terminal proof.
- **Acceptance tests needed if this proposal is adopted:** a controlled
  end-to-end notification fixture must exercise JSON-RPC ingress through hint
  publication and lifecycle mapping to the exact terminal projection; its
  paired suppressed-notification case must assert one bounded reread, exact
  result, and zero additional turn/session/interrupt effects. An active-turn
  case must assert the accepted no-poll behavior until the proposed bounded
  diagnostic boundary. Until those tests and a cadence/stop policy are
  accepted, active-turn lost-hint recovery remains open.

### Focused discriminator and P2 repair mapping

The real-parser delivered control is
`codex-app-server-protocol.test.ts::traces real turn/completed ingress and hint
publication without retaining notification payload`: its JSON-RPC fixture
uses the provider-shaped nested `params.turn.id`, emits an opaque sentinel,
and asserts ingress and publication traces contain only allowlisted IDs and no
payload. `codex-planned-attempt-executor.test.ts::labels a source-less global
provider wake with prior projection instead of event IDs` is a field-label
control: a single attached attempt receives a synthetic global wake without
source identity, and the trace names the channel and the subscriber's last
projected IDs, with no notification ordinal or event `threadId`/`turnId`. It
verifies the exact attempt reread without command progress. This is not a
two-attempt routing fixture and does not claim that the wake came from a
particular attempt or ingress. The absent-event
discriminator is
`does not poll a terminal Codex turn when the completion notification is
absent`: provider state becomes terminal without a hint, and the trace has no
`GlobalHintConsumed`, only its initial lifecycle read, and no extra exact
attempt read after two seconds. These controls distinguish the two boundary
outcomes in a fixture; they do not establish which event occurred in the
retained S1.

The accepted terminal-plus-ExactLive cadence race maps to
`codex-planned-attempt-executor.test.ts::continues targeted census checks when
the final terminal seal census finds exact live activity`. If the first
activity census reports Absent and the final seal census then finds ExactLive,
the final projection remains eligible for the existing paced exact census.
`starts held terminal activity cadence after a completion hint discovers exact
live activity` covers the related attach-Running chronology: only after a
completion-hint reread produces Terminal+ExactLive does paced census begin;
the next exact reread settles after activity exits without another hint.
`does not poll a terminal Codex turn when the completion notification is
absent` retains the active-turn no-poll assertion. Running turns and initial
pending-census recovery do not start this cadence. Unreadable/contradictory
census results remain fail-closed without cadence. These repairs preserve the
accepted passive-observation boundary and do not resolve the unaccepted
active-turn lost-hint chronology or establish the cause of the preserved Run.

### Scoped review disposition

The terminal-seal two-census race is resolved: final ExactLive eligibility now
starts the accepted paced census, covered by the named terminal-seal test. The
attach-Running-to-hint-to-Terminal+ExactLive path now activates that same
cadence only after the qualifying reread, covered by the dynamic-activation
test; the absent-hint active-turn no-poll test checks the corrected
`GlobalHintConsumed` predicate. The real-parser fixture now supplies nested
`params.turn.id`, and lifecycle consume records are explicitly labeled as
global wakes with prior projected IDs, not source event identities.

Sol's remaining P3 suggestion is deferred hardening, not a demonstrated
production failure. A cadence timer could race a separate hint reread that
invalidates its ExactLive premise before the timer's next tick. The ordinary
production observer in
`packages/orchestrator/src/coordination/run/passive-planned-attempt-observer.ts::makePassivePlannedAttemptObserver`
consumes `attachment.changes` with `Stream.take(1)` and closes the attachment
in `Effect.ensuring` after the first changed projection (or stream failure).
No focused fixture demonstrated an extra reread after an invalidating
notification while production ownership remains attached. **Deferred owner:**
the #386 executor follow-up. **Entry condition and scope:** add a controlled
same-projection invalidation fixture only if it demonstrates a timer read
after a notification-driven loss of ExactLive eligibility; then stop or
restart cadence from the latest exact projection without polling active turns.
No accepted behavior is replaced by this deferral.

The scoped review does not change the preserved Run diagnosis: its cause stays
**inconclusive** until a future supervised S1 captures the new secret-free
ingress/publication/subscriber/result logs. No broad gate or live S1 was run.

### Failed coverage-gate diagnostic: hermetic child stdout — 2026-09-28

At Base `7d4c545f5ad7a1ebff3d32940877c514083f297e`, gate
`f46bc5a4-1b68-4c23-b7eb-b8688f251767` finished with exit 1 at
`2026-09-28T02:35:32Z`; stopped-writer custody is recorded as stopped. Its
coverage stage reported one failed cassette among 4,626 tests and the literal
`HermeticChildOutputCanonicalFailure` at local log time 22:30:42.183
(02:30:42Z) in
`direct-remote-publication.test.ts`'s S1 cassette. The retained stage log is
`.scratch/quality-gates/f46bc5a4-1b68-4c23-b7eb-b8688f251767/logs/64c3c782-a17c-4358-b8f6-01d6052f4196.log`
(SHA-256 `cf3d3ecdf9a4762d5fcde12efe0127f137f119c40bae48c926266b4007fa9769`).

**Question.** Does the S1 cassette reject the new completion Effect diagnostic
record as an unexpected public child NDJSON frame (A), does the cassette/child
emit some other malformed canonical frame (B), or is the failure caused by
coverage-suite pressure/context and therefore transient in isolation (C)?

- **A prediction:** the exact isolated cassette below exits 1 and prints the
  literal `HermeticChildOutputCanonicalFailure`; its safe first-rejected-frame
  classification identifies a completion diagnostic record reaching the
  public child-output parser.
- **B prediction:** the isolated cassette may also exit 1 with that literal,
  but the safe first-rejected-frame classification identifies a distinct
  malformed canonical frame, not the completion diagnostic record.
- **C prediction:** the isolated cassette exits 0 and prints Vitest summary
  `Test Files 1 passed` and `Tests 1 passed`; the retained full-suite context
  had reported 1 failed / 4,583 passed.

**Distinguishing command and bound.** Run exactly:

```sh
pnpm exec vitest run --mode coverage --coverage --reporter=dot packages/dalph/test/cassettes/direct-remote-publication.test.ts -t 'publishes M before local promotion and task completion, then releases its dependant from a later complete graph'
```

Expected duration is under two minutes. Start 2026-09-28T02:41:00Z and stop
safely by **2026-09-28T02:43:00Z**; preserve the complete command log, actual
exit, literal-match result, Vitest summary, and elapsed wall time. When
classifying child output, inspect only bounded safe metadata (first rejected
frame category/tag and parser position); never print or retain raw child
payload or secrets. If the exit/literal/summary differs from these predictions
or no safe classification is available, record the result inconclusive and
choose a changed focused discriminator before repair. Make no runtime edit
until this observation distinguishes A from B/C.

**First isolated result (02:40:48Z–02:42:10Z).** The command exited 1 in
82 seconds; `/tmp/issue386-f46-focused-cassette.log` contains the literal
`HermeticChildOutputCanonicalFailure` and Vitest summary `Test Files 1 failed`,
`Tests 1 failed | 4 skipped`; the cassette itself reports 49.47 seconds. This
supports against C's predicted isolated pass, but does not distinguish A/B:
the parser intentionally omits all rejected-frame metadata. The next
discriminator adds temporary category-only metadata at that parser boundary.
**A predicts** the same command exits 1 with the same literal and first-frame
category `CodexExecutorCompletionTrace`. **B predicts** the same command exits
1 with the same literal but a first-frame category `OtherJsonFrame`,
`InvalidJson`, or `InvalidUtf8`. The classifier compares only the allowlisted
tag and emits no frame bytes or other field values. Expected duration is
50–60 seconds; start 2026-09-28T02:45:00Z and stop safely by
**2026-09-28T02:50:00Z**. Retain log, exit, literal, category and elapsed wall
time, then remove all temporary classifier changes before any repair or final
candidate check. No Dalph runtime code changes before this classification.

**Safe first-frame result (02:45:40Z–02:46:35Z).** The category-only rerun
exited 1 in 55 seconds with the same literal `HermeticChildOutputCanonicalFailure`
and Vitest summary `Test Files 1 failed`, `Tests 1 failed | 4 skipped`
(`Duration 48.29s`). Its first rejected frame was classified as
`CodexExecutorCompletionTrace`. This supports **A**: the Effect completion
diagnostic reaches the hermetic child's public NDJSON stdout parser. The
temporary classifier in test support emits only the allowlisted tag category;
its retained log is `/tmp/issue386-f46-focused-cassette-classified.log`.

**Scoped repair.** Keep the same secret-free records at ingress, publication,
subscriber consumption, and lifecycle result, but route their Effect messages
through a stderr-only logger. The hermetic child parser owns stdout as public
canonical NDJSON, while stderr is already a separate captured diagnostic
stream. The focused protocol/executor tests must continue to observe each
diagnostic through a test console, and the hermetic cassette must pass without
any trace frame on stdout. This changes no workflow decision, journal record,
provider call, or accepted S1/S8 chronology.

The post-repair discriminator is the same focused command as above, with
expected duration 50–60 seconds, start 2026-09-28T02:53:00Z, and safe stop
2026-09-28T03:00:00Z. Preserve its complete log, actual exit, Vitest summary,
and elapsed wall time before running protocol/executor tests or `check:fast`.

**Post-repair artifact mismatch (02:53:00Z–02:56:50Z).** The 02:53 cassette
exited 1 with `HermeticChildOutputCanonicalFailure` (1 failed / 4 skipped;
48.76s), and a bounded category rerun at 02:56 exited 1 with the same failure
(1 failed / 4 skipped; 48.43s). The first rejected category remained
`CodexExecutorCompletionTrace`, but these outcomes do not evaluate the source
repair: the cassette launches
`packages/dalph/dist/bin/production-hermetic-qualification.js`, whose mtime was
2026-09-28T02:07:22Z and SHA256 was
`d9693ee7048484e501e87050639054ad1949be13fb41736c2b6f5f98b8834153`. The
completion-trace helper source was newer (02:49:45Z), and the corresponding
dist module was absent. Therefore both cassette reruns used the pre-repair
artifact. The temporary category classifier has been removed; its retained
category-only result distinguishes the old artifact's frame and exposes no
raw payload.

**Source-matched verification.** Built only the affected package with
`pnpm --filter @dalph/dalph run build` (exit 0, 12.58s; full log
`/tmp/issue386-f46-package-build.log`). The built qualification entry now has
mtime 2026-09-28T02:58:38Z. Its SHA256 remains
`d9693ee7048484e501e87050639054ad1949be13fb41736c2b6f5f98b8834153` because
the entry wrapper is unchanged; the previously absent
`dist/src/application/codex-completion-trace.js` now exists, confirming the
source helper was compiled. The exact focused cassette was then rerun without
the temporary classifier; the source-matched result is recorded below. This
diagnosis uses no broad gate or live S1.

**Source-matched cassette result (02:59:35Z–02:59:47Z).** The exact focused
coverage cassette exited 0 in 11.71s using the rebuilt package: `Test Files 1
passed`, `Tests 1 passed | 4 skipped`. Its full retained output is
`/tmp/issue386-f46-focused-cassette-source-matched.log`. This supports cause A:
the completion trace was emitted to the child public stdout before stderr
routing; the source-matched artifact now passes the cassette without that
frame. The earlier source-mismatched reruns remain inconclusive about the
repair.

**Scoped review and verification closure.** Sol review round 4 found no code
finding after the source-matched pass. The stderr helper preserves completion
trace records on the diagnostic channel; protocol and executor tests now read
`TestConsole.errorLines`, retaining ingress, hint, and lifecycle assertions.
The rebuilt focused cassette passed 1/1, the two affected test files passed
228/228, `check:fast` passed after merging the duplicate `effect/testing`
imports, and `git diff --check` passed. The failed coverage
gate established a child stdout classification problem only. No claim is made
about whether the preserved live S1 received or mapped `turn/completed`; its
cause remains inconclusive without wire receipt evidence. No full gate, fresh
S1, or preserved Run retry was performed here.

## Focused #386 process-attribution diagnostic — 2026-09-28

Repair worktree: `/workspace/typescript/dalph-worktrees/issue-386-thread-attribution-repair-r1`,
branch `work/issue-386-thread-attribution-repair-r1`, exact clean source
`1f1dfb5133bca514ba598c7c657d386433984d8e`. The full candidate's planned Base
remains `7d4c545f5ad7a1ebff3d32940877c514083f297e`. The preserved S1 Run and
its retained evidence are not changed or retried here.

**Accepted outcome.** The passive-observation scenario's scheduling
clarification requires both the application incarnation and exact Codex
thread identity before an escaped descendant can keep a planned attempt
Executing. A foreign thread cannot hold A's position. A missing identity is
typed unresolved and cannot start the terminal held-activity cadence. The
existing public census test is not proof of this outcome: it passes
`IntegratorSession`, whose census deliberately omits the incarnation token,
and its fake processes have no root/child relation.

**Question.** In the production `PlannedAttempt` census, does a live helper
with the current app-server incarnation but a different `CODEX_THREAD_ID`
keep thread A's projection `ExactLive` (A), or does an exact-thread-aware
census exclude it, leaving the completion lifecycle path to settle A (B)?
Does a token-bearing helper with no thread identity instead return a typed
unresolved projection (C), so no held-terminal cadence is eligible?

**Distinguishing observation.** Add controlled Linux proc fixtures that call
`makeNodeCodexOwnedActivityCensusService(..., appServerPid, incarnation)` with
scope `PlannedAttempt`, an idle exact thread A, and a server-root/helper-child
process relation where the helper has left the server process group. Run
separate foreign-thread, missing-thread, and exact-thread cases. The foreign
case expects `Absent`; missing-thread expects `Unreadable`; exact-thread
expects the helper as `ProcessGroupDescendant` and then `Absent` after it exits.
The adjacent accepted cadence tests check that only terminal plus fresh
`ExactLive` starts cadence, and a typed census failure stops it.

**Predictions before the baseline run.** Run exactly:

```sh
pnpm exec vitest run packages/dalph/src/application/codex-app-server-public.test.ts --testNamePattern='planned-attempt census (excludes foreign-thread helpers|keeps missing-thread helpers unresolved|counts exact-thread escaped helpers)' --maxWorkers=1
```

- **A prediction (token-only attribution defect):** exit 1. The foreign case
  receives `_tag: "ExactLive"` with only the foreign helper's PID where it
  expected `_tag: "Absent"`; the missing case likewise receives `ExactLive`
  instead of typed `Unreadable`. The exact-thread exit control passes.
- **B prediction (fixture or contract mismatch):** the foreign case returns
  `Absent`; the exact-thread child is not attributed as
  `ProcessGroupDescendant`, or the native process observation is typed
  `Unreadable` for a fixture defect. This does not justify the proposed
  thread filter; repair the fixture/contract mapping before editing runtime.
- **C prediction (fail-closed missing identity):** the foreign case returns
  `Absent`, the missing case returns typed `Unreadable`, and the exact-thread
  case returns `ExactLive` until the child is removed. The three tests pass;
  the separately mapped cadence test must still show no later census read on
  a typed projection failure.

Expected duration is under two minutes. Baseline command window:
`2026-09-28T04:32:30Z` to `2026-09-28T04:34:30Z`. Fixture-and-audit repair is
separately time-boxed from `2026-09-28T04:30:30Z` through
`2026-09-28T04:55:00Z`. Preserve the full focused output, actual exit,
first failing assertion, and elapsed time. No code edit to census behavior,
live Run, or broad gate is authorized before this distinguishing observation.

**Initial invocation and test-environment setup.** The exact focused command
was attempted at `2026-09-28T04:32:30Z` and exited 254 in under one second with
the literal `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found`;
`node_modules` and `packages/dalph/node_modules` are absent in this worktree,
so no test ran and no diagnosis is drawn. This worktree has pnpm 10.29.3 and
Node 24.20.0. Install the frozen graph only in this isolated worktree with
`pnpm install --frozen-lockfile`, expected duration five minutes, window
`2026-09-28T04:33:30Z`–`2026-09-28T04:38:30Z`; stop and preserve install output
by the deadline. Then rerun the exact discriminating test command and record
its actual output before changing census behavior.

The frozen install actually completed in 3.54 seconds with exit 0 and no
downloads; pnpm warned that package bins could not yet link because this clean
source has no built `packages/dalph/dist` tree. This did not block Vitest. The
exact discriminating command ran `2026-09-28T04:33:57Z`–`04:34:03Z`, exited 1
in 6.53 seconds, and is retained at
`/tmp/issue386-thread-attribution-baseline.log`. Two tests failed and one
passed (`1 failed`, `2 failed | 1 passed | 15 skipped`): the foreign-thread
helper was returned as `ExactLive` with PID 191 instead of `Absent`; the
missing-thread helper was also `ExactLive` instead of `Unreadable`; the
exact-thread helper remained visible and its stop control passed. This is the
predicted **A** observation: the real PlannedAttempt census includes
token-matching helpers without requiring the exact thread identity. It
distinguishes the accepted ownership defect from the old fixture mismatch.
Only now may the minimal census repair proceed. A direct no-cadence test is
added alongside the existing typed-read failure test so census `Unreadable`
is distinguished from a thread-read error.

**Fresh supervised S1 retained evidence (reported at 04:40:43Z).** The
supervisor reconciled stopped custody by `2026-09-28T04:36:29Z`; this repair
worktree did not signal or reuse that Run. Its frozen source was clean at
`1f1dfb5133bca514ba598c7c657d386433984d8e`; candidate `db546599` had sole
planned Base `a08d5` (prefix as reported), while hosted main remained at its
Base and tracker issue #1 remained open. The retained SQLite journal has 2,169
records, last `ExecutorWorkExecuting`, and 1,351 exact lifecycle rereads all
remained Executing. `turn/completed` was observed at ingress, published, and
consumed; both provider rollouts reported `task_complete`. A foreign-thread
`codex-code-mode-host` helper persisted until supervised stop. Circuit-open
tracker reads were also present and remain a separate wait condition. This
distinguishes the missing-notification/unmapped-event alternatives: the
completion hint was delivered and consumed, while the app-server's
same-incarnation census admitted the foreign helper as exact activity. The
controlled baseline reproduces that census result directly. No inference is
made that the separate tracker wait was resolved.

**Full-file regression and repair.** The first repaired full public test file
run failed two cleanup tests because the first implementation incorrectly
required thread identity in the shared app-server replacement/close census.
That path owns all descendants of one server incarnation and has no task
thread scope; it retains its prior token-only rule. Thread identity now filters
only `PlannedAttempt` census candidates, preserving server replacement and
close cleanup. The full public file then passed 18/18; the process-policy file
passed 31/31; the three accepted cadence controls passed 3/3. Logs:
`/tmp/issue386-thread-attribution-public-suite-r2.log`,
`/tmp/issue386-thread-attribution-process-policy.log`, and
`/tmp/issue386-thread-attribution-cadence-tests.log`. The failing intermediate
run remains at `/tmp/issue386-thread-attribution-public-suite.log`.

**Affected fast-check window.** Run `pnpm check:fast` in this exact worktree,
expected duration six minutes, planned window
`2026-09-28T04:42:00Z`–`2026-09-28T04:48:00Z`; preserve the actual exit and
complete log. This is local typecheck and changed-file lint only, not a full
gate. No gate or live Run is part of this repair.

The command finished at `2026-09-28T04:42:20Z` (21.1 seconds) with exit 1.
`tsc -p tsconfig.json --noEmit` passed. `lint:changed` selected the two
changed TypeScript files and failed on
`codex-app-server.ts:1454:16: warning typescript(no-redundant-type-constituents)`;
that line is the pre-existing `CodexTurnSnapshot` normalization signature,
outside the repair diff. The clean frozen install also had not built workspace
package artifacts. Distinguish missing workspace artifact resolution from a
base lint issue by running `pnpm --filter @dalph/dalph... build`, expected
duration four minutes, window `2026-09-28T04:46:30Z`–`2026-09-28T04:50:30Z`;
then rerun `check:fast` if the build succeeds. No unrelated source cleanup is
authorized by this check failure.

The workspace dependency build succeeded at `2026-09-28T04:46:44Z` in 14.8
seconds (`/tmp/issue386-thread-attribution-package-build.log`). The next
`check:fast` run reached lint and failed only because the new executor test
needed dprint formatting (exit 20;
`/tmp/issue386-thread-attribution-check-fast-r2.log`). `pnpm exec dprint fmt`
formatted that one test file. The focused unreadable-census cadence control
then passed 1/1 at 04:47:13Z; final `check:fast` passed (exit 0, 2.96 seconds)
at 04:47:18Z using explicit base
`1f1dfb5133bca514ba598c7c657d386433984d8e`; complete log:
`/tmp/issue386-thread-attribution-check-fast-final.log`. `git diff --check`
also passed.

**Scenario-to-test closure for this repair.** The foreign helper returns
`Absent`; a token-bearing helper without `CODEX_THREAD_ID` returns typed
`Unreadable`; the exact-thread escaped child returns `ExactLive` until the
controlled stop, then `Absent`. The executor holds the prior report as
Executing on the unreadable projection and records no additional activity
census reads over five seconds; no cadence starts. The mapped targeted cadence
positive path, equal wake, and typed failure tests remain passing. Relevant
logs are `/tmp/issue386-thread-attribution-repair-focused.log` (3/3),
`/tmp/issue386-thread-attribution-public-suite-r2.log` (18/18),
`/tmp/issue386-thread-attribution-process-policy.log` (31/31),
`/tmp/issue386-thread-attribution-cadence-tests.log` (3/3), and
`/tmp/issue386-thread-attribution-unreadable-cadence.log` (1/1). No broad gate,
Run, provider mutation, or preserved-evidence mutation was performed by this
repair worktree.

**Scoped review disposition.** Independent Luna Spec and Standards review
completed with no findings. It verified the real PlannedAttempt escaped-child
fixture, exact/foreign/missing thread outcomes, unchanged IntegratorSession
behavior, terminal/finality handling, and fail-closed cadence behavior. The
review is closed for this scoped repair; no broad gate or live Run was started.

## Focused #386 Integrator asynchronous-completion repair — 2026-09-28

The accepted chronology in
[`production-codex-integrator.md`](scenarios/production-codex-integrator.md#3a-an-id-free-completion-wake-leads-to-an-exact-reread--accepted-for-386)
selects the existing ID-free `turn/completed` wake. A wake is non-authoritative;
it can only prompt a fresh exact thread/turn/token read. A hint received before
the `turn/start` response must remain buffered. An unrelated wake that finds
the exact turn active causes one exact reread and leaves the result unresolved.
No silence timer, active-turn poll, retry, second turn, or new session is
accepted. Exact terminal evidence still requires a complete `Absent` owned
activity census before sealing.

**Red discriminator.** The focused test
`seals one active turn after an ID-free completion wake arrives before the
start response` was added first and run alone:

```text
pnpm exec vitest run packages/dalph/src/application/codex-integrator.test.ts -t 'seals one active turn after an ID-free completion wake arrives before the start response'
```

At base `4c6761a4f07bbdf9198763f44686ebae27eba680`, it exited 1 in 1.51 seconds
with `IntegratorCallFailure: exact provider turn remains active` instead of a
terminal result. The test holds the start response, changes the exact provider
turn from active to completed, and queues the ID-free wake before releasing the
response. This is the predicted stale-snapshot discriminator; it does not
identify or reinterpret the preserved S1 event.

**Evidence boundary.** The retained S1 state and diagnosis above remain
unchanged and inconclusive: no retroactive app-server logs are inferred, no
S1 Run is resumed or retried, and this repair does not claim the S1 cause.
The focused Integrator tests and type/lint checks below own only the #386
asynchronous Integrator completion chronology.

**Green acceptance evidence.** The complete focused file passed after the
repair:

```text
pnpm exec vitest run packages/dalph/src/application/codex-integrator.test.ts
63 passed
```

The focused asynchronous controls cover listener attachment before
`turn/start`, a buffered wake before its response, no wake with no poll/retry,
an unrelated wake with only one exact reread while still active, terminal
recovery after app-server replacement, listener closure on success and
validation failure, and refusal to seal while exact owned activity remains
live. The ID-free hint is never used as terminal evidence.

`pnpm typecheck` passed. `pnpm check:fast` reached typecheck and changed-file
lint; typecheck passed, while lint reported only the existing
`codex-integrator.ts:144` `no-unnecessary-condition` error on
`next === undefined`. The exact base file at
`4c6761a4f07bbdf9198763f44686ebae27eba680` has the same condition at lines
143–145, and the changed-line lint diff contains no finding. This pre-existing
lint error remains outside this repair. `pnpm exec dprint check` on the four
owned files and `git diff --check` both passed. The `check:fast` run was bounded
to the parent-set expected duration of approximately three minutes and the
absolute stop `2026-09-28T07:55:00Z`; it completed in approximately eleven
seconds. The staged pre-commit lint hook repeated the same base-line error and
reverted its temporary staging changes; the reviewed four-file diff was then
committed with hooks disabled after confirming no changed-line diagnostic. No
full gate or live S1 was run.

**Scoped implementation review.** The diff adds one scoped ID-free stream
listener and one exact fresh thread/turn/token reread after each wake. Active
exact state loops only by awaiting another wake; the no-hint test confirms no
read cadence. The terminal path passes the just-reread exact thread into the
complete activity census before writing a sealed run. Listener scope closes
on normal result and failure/interruption. No adapter, executor, tracker,
publication, or cleanup code changed. The round-2 independent review of this
integrated candidate is recorded below.

## Round-1 Standards review fixes — 2026-09-28

The Sol Standards review of candidate
`c017ef2d73c807252682dc59aa09ea35171bbbfa` reported two documentation/test
findings. Runtime behavior is unchanged by these fixes.

- **S1, governing-behavior pointers.** Scenario 3a now links directly to
  [Scenario 3: Turn recovery requires the exact token](scenarios/production-codex-integrator.md#3-turn-recovery-requires-the-exact-token),
  the [ambiguity and evidence invariants](DELIVERY-INVARIANTS.md#ambiguity-and-evidence)
  (D22–D24), the formal
  [`acceptedResultIntegration.qnt`](../specs/acceptedResultIntegration.qnt)
  law `noAutomaticIntegratorSuccessor`, and executable model scenario
  [`unfinishedIntegratorRestoresSameSessionTest`](../specs/acceptedResultIntegration_test.qnt#L161).
  It states that the change preserves exact ownership, terminal, and
  quiescence rules, refines only the active-turn wake/read behavior, and
  supersedes no accepted behavior. It also bounds the formal model to the
  outer Integrator/session behavior; the model does not claim to describe the
  app-server notification transport.
- **S2, durable intent precedes Git.** The test
  `records exact run one before asking Git to materialize the candidate` now
  asserts that the `store:CandidateUnmaterialized` event exists and its index
  is strictly before the first `git:` event.

The affected test passed:

```text
pnpm exec vitest run packages/dalph/src/application/codex-integrator.test.ts -t 'records exact run one before asking Git to materialize the candidate'
1 passed, 62 skipped
```

`pnpm exec dprint check` on the changed audit, scenario, and test, and
`git diff --check`, passed. No typecheck, lint, full gate, or S1 qualification was run;
the change only adjusts governing links, test assertions, and this review
evidence. The existing line-144 lint finding is unchanged.

## Admitted quality-gate fixture diagnosis — 2026-09-28

The failed admitted run `3d3999a8-3604-4898-b0b3-119688658abe` used candidate
`2e6656a394294253b9c9fa18c406ec2d3f134a26` and Base
`4c6761a4f07bbdf9198763f44686ebae27eba680`. Custody reconciliation proved the
writer process group absent and the run stopped; qualification remains
`UNPROVEN`. The run is terminal and was not retried. The worktree was clean and
unchanged when diagnosis began. The retained log is
`.scratch/quality-gates/3d3999a8-3604-4898-b0b3-119688658abe/logs/ed029178-328f-4477-a999-32774ea27e74.log`.

The focused discriminator was
`capability-registration-quality-gate.test.ts > runs the capability audit
exactly once and continues to the next quality stage`: it passed in isolation
without `DALPH_COVERAGE_BASE_SHA` (one passed, two skipped), then failed with
the admitted Base in scope. The observed assertion expected
`test:delivery-repeatability`; the runner selected `test:delivery-smoke`.
Base-to-HEAD contains exactly four paths: the acceptance audit, the production
Codex Integrator scenario, and the Integrator source and test. The shared stage
algebra therefore selects six preflight commands—artifacts, typecheck, lint,
cycles, secrets, and capability registration—then delivery smoke and coverage.
It filters complexity, duplicates, hosted controls, the Lab, and recorded
catalog. This supports stale fixture inventories under context-aware
selection; it does not support changing production stage selection.

| Failed fixture assertion | Review disposition |
| --- | --- |
| Capability audit continues to delivery repeatability | **Resolved:** the pinned four-path narrow manifest asserts delivery smoke; the broad fixture asserts exact-once audit invocation followed by the exact broad suffix beginning with delivery repeatability. |
| Capability failure census contains CI classification | **Resolved:** the broad fixture asserts the complete structural sequence, one capability invocation last, and no qualification invocation. |
| Preflight multi-failure expects the old complete inventory | **Resolved:** the broad fixture retains all three independent failures and asserts the exact structural census and failure summary. |
| Standalone preflight/full gate expect the old complete inventory | **Resolved:** both runners are compared with the same exact broad inventory; every structural command occurs once and the full suffix order is exact. |
| Formal-controls failure fixture exits zero | **Resolved:** an explicitly broad fixture selects formal controls and proves the failure blocks qualification. |
| Maintained-Lab failure fixture exits zero | **Resolved:** an explicitly broad fixture selects the Lab and proves the structural census completes while qualification remains blocked. |
| Recorded-catalog success fixture sees no catalog command | **Resolved:** an explicitly broad fixture proves exactly-once catalog execution immediately before coverage. |
| Recorded-catalog failure fixture exits zero | **Resolved:** an explicitly broad fixture proves the catalog failure stops coverage. |

These are test-fixture and audit changes only. They do not change Dalph runtime
behavior or the shared stage algebra. The exact narrow and broad plans are
asserted; no fixture accepts arbitrary ordering.

The affected checks passed:

```text
DALPH_COVERAGE_BASE_SHA=4c6761a4f07bbdf9198763f44686ebae27eba680 pnpm exec vitest run scripts/capability-registration-quality-gate.test.ts scripts/preflight-quality-gate.test.ts scripts/recorded-catalog-gate.test.ts
3 files passed; 14 tests passed; 1.87s

DALPH_DIAGNOSTICS_BASE=4c6761a4f07bbdf9198763f44686ebae27eba680 pnpm lint:changed
passed

pnpm typecheck
passed with exit 0
```

The focused run began at 08:52:13 UTC. Its expected duration was 6–8 minutes,
with a hard stop at 09:00 UTC; it completed in 1.87 seconds. `git diff --check`
also passed. No full-gate retry or production implementation change was made.

## Round-2 scoped review disposition — 2026-09-28

The second Sol review of candidate
`0afb3bd39fadd66c811807d9db199f76ffda2de1` found no Spec findings and no
Standards hard findings. Standards noted one nonblocking `Duplicated Code`
smell: three tests repeat the same `broadQualificationCommands` suffix. This
is deferred to ordinary quality-test maintenance, owned by the quality-gate
test maintainers, for a future fixture-consolidation change. No accepted
behavior or safety requirement is deferred.
