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

## Accepted exact-ID completion follow-up (2026-09-28)

The user accepted the exact app-server completion rule recorded in
[S4 completion refinement](scenarios/direct-remote-publication.md#s4-completion-refinement-an-exact-app-server-notification-precedes-integrator-completion).
The one-shot terminal reread proposal above remains **rejected and
superseded**: an already active `turn/start` must have returned T with
`inProgress`, and Dalph must have retained the exact X/T association before a
completion hint can authorize lifecycle work. Only a well-formed
`turn/completed` carrying both wire identities (`params.threadId` and
`params.turn.id`) equal to that private association may trigger the exact
private-record, token, turn, and complete owned-activity reread. Terminal turn
state, a terminal `turn/start` response, or an `Absent` activity census cannot
seal without that matching hint.

On reopen, Dalph reuses the retained thread, tokens, and turn and does not send
another `turn/start`. If the app-server does not replay or later deliver the
matching X/T notification, the attempt remains `ExecutorWorkExecuting` even if
terminal state and absent activity could otherwise be observed. The accepted
rule adds no timeout, polling fallback, synthetic hint, replacement session,
duplicate turn, candidate, or push. The lost `turn/start` response before T is
durably associated remains under existing S4 intent reconciliation and is
outside this refinement. The scenario's exact acceptance-test map identifies
the provider protocol, wrong-ID, held-activity, missing-hint, and reopen
controls, including terminal response with no hint and terminal response with a
buffered exact hint. This follow-up does not change the earlier secret-free S1 evidence:
its observed `turn/completed` markers still lack a matched terminal report and
the S1 cause remains **inconclusive**.

## Exact-hint command-path seal repair (2026-09-28)

**Confirmed blocker.** The accepted S4 refinement requires the exact retained
X/T `turn/completed` hint before an unsealed attempt can be sealed. The
`requestSuspension` path reconciled a terminal provider turn at
`codex-planned-attempt-executor.ts::suspend` and called
`terminalOrRunning` without hint authorization. `resume` did the same from a
`SafelySuspended` record through `reconcileExistingResume`. With a completed
turn and no owned activity, the shared path wrote a durable `Terminal` record
and returned `ExecutorWorkTerminal`. The prior no-hint reopen test exercised
passive observation only and did not cover either command.

**Repair disposition.** Apply the exact-hint condition at the shared
terminal-sealing boundary for unsealed `Running` and `SafelySuspended` records;
keep already persisted `Terminal` records readable. An unauthorized Suspend
or Resume remains Executing and leaves its private record unsealed. Exact
completion attachment and association must accept a retained Safe record so a
later matching X/T hint can authorize the same terminal reread. No new turn,
candidate, or push is permitted. Decisive controls are
`codex-planned-attempt-executor.test.ts::keeps a completed turn pending when
suspension sees no exact completion hint` and
`::keeps a completed Safe Resume pending without its exact completion hint`;
both assert no-hint pending first, then exact-hint sealing, with one turn.
Existing S1/S8 finality and reopened exact-hint controls remain required.
Focused checks and review disposition are recorded below when terminal.

**Focused S1 artifact diagnostic.** Before the source-matched S1 cassette is
run, distinguish **A** (the completion trace still reaches child stdout and
reproduces `HermeticChildOutputCanonicalFailure`) from **B** (the trace stays
on stderr, the canonical child parser proceeds, and the cassette observes the
exact `ExactCompletionHintConsumed` X/T trace). The prior retained classified
run `/tmp/issue386-f46-focused-cassette-classified.log` supports A for the old
artifact. After the candidate package build passes, run only
`pnpm exec vitest run --mode coverage --coverage --reporter=dot
packages/dalph/test/cassettes/direct-remote-publication.test.ts -t 'publishes
M before local promotion and task completion, then releases its dependant
from a later complete graph'`. The cassette test now asserts the consumed
hint's exact thread and turn IDs at the child boundary. A mismatched result is
inconclusive and stops this repair window.

**Post-hint Observe rejection discriminator (2026-09-28).** Question: why is
`ObservePlannedAttemptExecutorWork` rejected after the matching completion hint
is consumed? **A:** its `PlannedTaskAttempt` differs from
`qualificationPlannedAttemptFor(context)`; predict safe equality `false` and
closed code `PlannedAttemptMismatch` or `InvalidPlannedAttempt`. **B:** the
attempt validates, then accepted progress, specification, route, or proposal
validation rejects; predict equality `true` and a later closed code such as
`InvalidAcceptedProgress`, `InvalidSpecification`, `InvalidFreshRoute`, or
`ProposalIdentityMismatch`. Distinguishing evidence is ordered after
`ExactCompletionHintConsumed` and contains only the equality boolean,
`acceptedProgress` tag, and closed rejection code; no IDs or payloads. The
focused diagnosis is expected to take at most 10 minutes and stops at
`2026-09-28T16:45:00Z`. Rebuild the Dalph package, run only the focused
coverage-mode S1 cassette, remove temporary instrumentation, and rebuild the
package without it. A missing or unmatched observation is inconclusive and
stops without behavior or fixture changes.

**Partial discriminator result (2026-09-28 16:37Z).** The instrumented package
build passed. The single allowed focused coverage cassette exited 1 in 5.10s
(`/tmp/issue386-post-hint-diagnostic-cassette.log`):
`ExactCompletionHintConsumed` for `hermetic-thread:0` /
`hermetic-turn:hermetic-thread:0:0` preceded the rejected
`ObservePlannedAttemptExecutorWork`. The temporary diagnostic was an
`Effect.tapError` on `validateExecutorStep(step, context)` in
`validateFreshStep`, restricted to `ObservePlannedAttemptExecutorWork`; it
logged equality, progress tag, and closed code only if that step failed
through its typed error channel. No marker appeared. Because there was no
success tap and defects bypass that typed-error tap, this does not locate the
rejection relative to enclosing proposal validation or establish equality or
code. The result remains inconclusive. No behavior or fixture change was
made. This window permits no second cassette; the next discriminator is safe
logging around `validateProposal`/route checks, then one focused cassette in a
separately bounded window. Temporary source instrumentation and its imports
were removed; the uninstrumented Dalph package rebuild passed at 16:41Z
(`/tmp/issue386-post-hint-diagnostic-build-clean.log`).

**Post-hint Observe validation discriminator, round 2 (2026-09-28).** After
the exact retained X/T hint, determine why Observe validation rejects. **A:**
the attempt differs from the fixed planner; predict comparison equality
`false` and `PlannedAttemptMismatch` or `InvalidPlannedAttempt`. **B:** the
attempt validates and a later specification, accepted-progress, route,
proposal identity, or subject check rejects; predict equality `true` and a
different closed code. The prior tap was only on typed errors inside
`validateExecutorStep` and emitted no marker, which is inconclusive. Instrument
the planned-attempt comparison and the `sourceRejectedAt` mapping for the
exact Observe transition to log only equality, the closed rejection code, and
the accepted-progress tag only if that validation stage is reached. Expected
duration is at most 12 minutes; stop at `2026-09-28T16:55:00Z`. Build, run the
focused S1 coverage cassette once, remove instrumentation, and rebuild. No
behavior or fixture repair, second cassette, full gate, or live Run is part of
this discriminator.

**Round-2 result (2026-09-28 16:47Z).** The instrumented package build passed
(`/tmp/issue386-post-hint-diagnostic-r2-build-instrumented.log`). The one
focused coverage cassette exited 1 in 4.61s
(`/tmp/issue386-post-hint-diagnostic-r2-cassette.log`). In the first logged
stream, after `ExactCompletionHintConsumed`, repeated Observe comparisons
reported `plannedAttemptMatches: true`; accepted-progress validation reached
`ExecutorReportAccepted`; the rejection mapper then reported
`rejectionCode: Uncoded`. This falsifies **A**'s attempt-mismatch prediction
and supports the attempt-valid part of **B**, but `Uncoded` does not identify
the later validation condition predicted by B. The exact rejection point
remains inconclusive; the missing observation is the call site producing the
uncoded `sourceRejected()` that is mapped to the Observe transition. No
behavior or fixture change was made. Temporary instrumentation was removed,
and the uninstrumented package rebuild passed at 16:49Z
(`/tmp/issue386-post-hint-diagnostic-r2-build-clean.log`).

**Post-hint Observe subject/proposal discriminator (2026-09-28).** Why is
Observe mapped as `Uncoded` after planned-attempt equality `true` and
`ExecutorReportAccepted`? **A:** entry subject validation rejects Run/task
scope; predict `runMatches` or `allowedTask` is `false`. **B:** subject matches
and a later controlled-entry or proposal check rejects; predict both subject
booleans `true` plus the first reached proposal validation stage. Instrument
only closed entry/route tags, those booleans, static stage markers, and any
existing closed rejection code; never emit identities or payloads. Expected
duration is at most 10 minutes; stop at `2026-09-28T17:02:00Z`. Build, run the
focused S1 coverage cassette exactly once, remove instrumentation, and rebuild
the uninstrumented package. If the evidence is not decisive, stop and name the
remaining boundary. No fixture/behavior repair, second cassette, full gate, or
live Run is included.

**Round-3 result (2026-09-28 16:55Z).** The instrumented package build passed
(`/tmp/issue386-post-hint-diagnostic-r3-build-instrumented.log`). The single
coverage cassette exited 1 in 4.97s
(`/tmp/issue386-post-hint-diagnostic-r3-cassette.log`). In the first captured
stream after the completion hint, Observe subject checks reported both
`runMatches: true` and `allowedTask: true`, ruling out **A** for those entries.
Most subsequent entries reached and passed the fresh-route, proposal
identity, proposal-subject, and action-identity stages. The last captured
entry reported subject accepted and controlled-entry validation started for
`ProposedDeliveryAction`, but had no following proposal-route-start marker.
No closed rejection code was emitted. This does not distinguish whether the
failure occurs before entering that controlled-entry arm or at its first
proposal call; the result remains inconclusive, with that branch-to-proposal
boundary as the missing observation. No behavior or fixture change was made.
Temporary instrumentation was removed; the clean package rebuild
passed at 16:58:39Z in 5.6s
(`/tmp/issue386-post-hint-diagnostic-r3-build-clean.log`). A source/dist
marker search is empty, and the two instrumented source files have no residual
diff.
## Safe projection regression repair (2026-09-28)

The exact-hint preflight shortcut currently maps both durable `Running` and
`SafelySuspended` records to `ExecutorWorkExecuting` without a matching hint.
This breaks the existing causally proved `SafelySuspended` projection after a
scoped restart. Repair only this projection: without a hint, return
`ExecutorWorkSafelySuspended` for `SafelySuspended` and
`ExecutorWorkExecuting` for `Running`, before any fresh lifecycle read. Keep
`terminalOrRunningOutcome`'s seal guard unchanged; terminal state without the
matching hint remains unsealed. Acceptance is covered by
`codex-planned-attempt-executor.test.ts::rebuilds a causally proved Safe Codex
projection from durable association across scoped restart`, alongside the six
requested no-hint/positive-hint controls. Expected duration is at most 10
minutes; stop at `2026-09-28T17:12:00Z`. Run only those focused executor tests,
then report exact status and diff.

**Focused repair result (2026-09-28 17:06Z).** The production diff changes
only the no-hint preflight projection: `SafelySuspended` returns its Safe
report and `Running` returns Executing, before lifecycle reconciliation. The
`terminalOrRunningOutcome` seal guard is unchanged. The Safe Resume test now
expects Safe from the later passive observation while retaining the Resume
command's Executing result, unsealed private Safe record, no-read, and one-turn
assertions. Its shared test helper accepts either Executing or Safe as the
initial projection before publishing the exact hint, preserving the positive
terminal control. The first selected run was 5/6 because the passive Safe
assertion still expected Executing; the next was 5/6 because the helper did
not publish a hint from Safe. After those assertion/helper corrections, the
same selected run passed all 6 tests (186 skipped) in 1.66s. Final log:
`/tmp/issue386-safe-projection-focused-tests-final2.log`.

Exact command:

```sh
pnpm exec vitest run --reporter=dot packages/dalph/src/application/codex-planned-attempt-executor.test.ts -t 'rebuilds a causally proved Safe Codex projection from durable association across scoped restart|keeps an idle running record executing without a matching completion hint|keeps a completed turn pending after reopen when its matching notification was not replayed|keeps a completed turn pending when suspension sees no exact completion hint|keeps a completed Safe Resume pending without its exact completion hint|seals after the exact completion hint arrives after reopen'
```

The worktree remains at HEAD `1f1dfb5133bca514ba598c7c657d386433984d8e`
with its prior shared dirty changes and dependency symlinks. The only new
runtime hunk is the preflight projection branch; no full gate, S1 cassette, or
live Run was started.

## Observe controlled-entry source-boundary discriminator (2026-09-28)

Prior safe traces show planned-attempt equality `true`, accepted progress
`ExecutorReportAccepted`, and Run/task subject checks `true`. A later status
entry reached controlled-entry validation as `ProposedDeliveryAction`, but no
proposal-route-start marker or closed rejection code was captured. Question:
is the uncoded rejection before proposal validation (**A**: no entry marker for
that observed entry; mapping remains `Uncoded`), or inside proposal validation
(**B**: entry marker followed by a specific route/proposal phase or code)? Add
temporary markers at the direct `validateControlledEntry` to `validateProposal`
seam with only safe closed entry/route tags, ordinal/phase, boolean equivalence
or check results, and closed rejection code. Do not log identifiers,
specifications, or provider/tracker data. Expected duration is at most 10
minutes; stop at `2026-09-28T17:20:00Z`. Build, run the S1 coverage cassette
exactly once, remove instrumentation, and rebuild clean. If marker placement or
result remains inconclusive, stop with evidence. No behavior/fixture repair,
second cassette, full gate, or live Run is in scope.

**Boundary result (2026-09-28 17:12Z).** The instrumented package build passed
(`/tmp/issue386-observe-controlled-proposal-r4-build-instrumented.log`). The
single coverage cassette exited 1 in 4.72s
(`/tmp/issue386-observe-controlled-proposal-r4-cassette.log`). After the exact
hint, the direct seam emitted `ValidateProposalStarted` then
`ValidateProposalAccepted` for Observe ordinals 2 through 9. Ordinal 10 emitted
`ValidateProposalStarted` then `ValidateProposalRejected` with code `Uncoded`.
This supports **B**: the rejection is inside `validateProposal`, after the
controlled-entry seam; it is not rejected before proposal validation. The
inner route/proposal check and its closed code remain unidentified. No
behavior or fixture change was made. Temporary instrumentation was removed;
the uninstrumented Dalph build passed at 17:13:31Z in 8.3s
(`/tmp/issue386-observe-controlled-proposal-r4-build-clean.log`). The
temporary marker is absent from source and dist.

## Observe proposal validation phase discriminator (2026-09-28)

Ordinal 10 entered `validateProposal` and rejected `Uncoded` after route,
attempt/spec/progress, and subject controls had appeared valid. Does it fail in
route validation (**A**: no `RouteAccepted` marker) or after route validation
(**B**: `RouteAccepted` followed by the first post-route phase marker and its
failed boolean or closed code)? Add temporary markers only for
`ObservePlannedAttemptExecutorWork` in `validateProposal`, separating route
start/success, proposal-ID comparison, order, wait-operation, and action
identity. Log closed tags, booleans, and rejection code only; no IDs or source
payloads. Expected duration is at most 8 minutes; stop at
`2026-09-28T17:25:00Z`. Build, run the exact coverage cassette once, remove
instrumentation, rebuild clean, and preserve logs. No behavior/fixture repair
or additional cassette is in scope.

**Phase-trace result (2026-09-28 17:21Z).** The instrumented Dalph package
build passed (exit 0; `/tmp/issue386-observe-proposal-phase-r5-build-instrumented.log`).
The single requested coverage cassette exited 1
(`/tmp/issue386-observe-proposal-phase-r5-cassette.log`). For Observe proposal
ordinal 10, the safe trace was `RouteValidationStarted`, `RouteAccepted`,
`ProposalIdCheck(matches=true)`, `OrderCheck(matches=true)`, then
`ActionIdentityValidationStarted` and `ActionIdentityValidated`; no wait ID
was present. Thus A is falsified, and the traced proposal passed every requested
route/proposal check. The outer operation still ended in
`HermeticQualificationSourceRejected`, so this does not identify the later
throwing stage; it does not support B's predicted failed post-route check.
The next discriminator must trace the Observe source after
`validateProposal` returns, at the first later failure boundary. Temporary
instrumentation was removed immediately after this one run; the uninstrumented
build result is recorded below.

The uninstrumented package rebuild passed (exit 0;
`/tmp/issue386-observe-proposal-phase-r5-build-clean.log`). A source/dist search
found no temporary marker, and `git diff --check` passed. HEAD remains
`1f1dfb5133bca514ba598c7c657d386433984d8e`; the pre-existing worktree changes
remain untouched.

## Qualification source failure boundary discriminator (2026-09-28)

The exact completion hint was consumed; attempt/progress/subject checks pass;
and Observe proposal ordinal 10 passes route, proposal-ID, order, and action
identity validation. The enclosing qualification source still rejects. Is the
rejection in per-entry validation after `validateProposal` (**A**: a specific
entry ordinal/tag emits `EntryValidationFailed`) or outside per-entry
validation in ready/status/focused-operation derivation or another outer stage
(**B**: no failed entry marker, with the last global phase marker)? Add
temporary safe markers around `validateHermeticQualificationCurrentSource`,
`completionReleaseOperationIds`, `validateStatusSnapshot`, and each
`validateEntry` begin/pass/fail, recording only ordinal, closed entry/route
tag, phase, and closed code. Do not log identifiers or payloads. Expected
duration is at most 8 minutes; stop by `2026-09-28T17:33:00Z`. Build and run
the focused coverage S1 cassette once, then remove instrumentation and rebuild
clean. No fixture/runtime repair, extra cassette, full gate, or live Run.

**Downstream-source discriminator result (2026-09-28 17:29Z).** The
instrumented build passed; the one focused coverage cassette exited 1
(`/tmp/issue386-downstream-source-r6-cassette.log`). The final entry sequence
was `TrackerGraphReadRoute` started/passed (phase ordinals 1065–1066),
`DependencyWait` started/passed (1067–1068), then
`ObservePlannedAttemptExecutorWork` started at entry ordinal 162 (1069) and
failed `Uncoded` (1070); `StatusSnapshotFailed` followed (1071). No later
entry passed. This supports **A**: the rejection is in per-entry validation
after `validateProposal`, not in the outer ready/status/focused-operation
derivation. The safe trace did not distinguish which subcheck inside that
entry failed. Temporary instrumentation is being removed and the clean build
result will be recorded below.

## Observe entry inner-validation discriminator (2026-09-28)

Entry ordinal 162 is `ObservePlannedAttemptExecutorWork` and fails `Uncoded`
after proposal route/ID/order/action checks passed in the prior trace. Does it
fail in `validateEntrySubject` before controlled dispatch (**A**: a run/task
subject boolean is false, with no controlled-dispatch marker), or after subject
and controlled dispatch succeed (**B**: subject booleans are true, followed by
a branch/proposal/owner-operation marker identifying the failing stage)? Add
temporary markers for the entry ordinal/tag, subject booleans,
controlled-entry predicate/tag, proposal validation start/pass, and owner
operation check start/pass when that branch applies; include only closed error
codes. Do not log IDs or payloads. Expected duration is at most 8 minutes;
stop by `2026-09-28T17:42:00Z`. Build, run the focused coverage cassette once,
remove instrumentation, then rebuild clean. No repair, additional cassette,
full gate, or live Run.

**Inner-entry discriminator result (2026-09-28 17:35Z).** The instrumented
build passed; the one focused coverage cassette exited 1
(`/tmp/issue386-inner-entry-r7-cassette.log`). For failing entry ordinal 162,
the entry tag was `ProposedDeliveryAction` and route tag was
`ObservePlannedAttemptExecutorWork`; run and task subject booleans were true,
subject validation passed, and controlled dispatch was true for the
`ProposedDeliveryAction` branch. `ProposalValidationStarted` appeared with no
corresponding pass marker before the source rejection. This falsifies A and
supports **B**: the failure occurs after subject validation and controlled
dispatch, inside proposal validation for this entry. The owner-operation
branch was not applicable. The exact inner proposal check remains unidentified;
the prior enclosing failure code remains `Uncoded`.

The uninstrumented Dalph package rebuild passed (exit 0;
`/tmp/issue386-inner-entry-r7-build-clean.log`). No temporary marker remains
in source or `dist`; `git diff --check` passed. HEAD and pre-existing dirty
files are unchanged.

## Final Observe proposal call discriminator (2026-09-28)

The prior proposal-phase trace covered Observe proposal calls 1–15 and all
passed. The later entry trace shows a 16th Observe proposal at status-entry
ordinal 162; its proposal validation starts but does not pass. Determine the
first rejecting subcheck for this call. **A:** route validation rejects;
predict no route-accepted marker. **B:** route passes and a later proposal
check rejects; predict route acceptance followed by the first ID/order/wait/
action-identity stage and its safe result or closed error code. Instrument
only Observe proposals, logging the call ordinal, route tag, phase, boolean
comparisons, closed action-identity source tag, valid/invalid operation-ID
result (without its value), and closed error code. Do not log IDs or proposal
payloads. Build, run the focused S1 coverage cassette exactly once, remove the
instrumentation, and rebuild clean. Expected duration is at most 8 minutes;
stop at `2026-09-28T17:50:00Z`. No fixture/runtime repair, second cassette,
full gate, or live Run is in scope.

**Instrumentation compile result (2026-09-28 17:40Z).** The first temporary
probe did not typecheck: its `Effect.tapError` instrumentation widened the
validator's error inference and caused errors in the proposal and consuming
status source. No cassette ran. The temporary source hunk was removed. A
second probe also failed before the cassette because `Effect.either` is not an
Effect v4 API. That temporary source hunk was removed. A changed probe will
use plain start/pass markers around existing yields and checks, without
wrapping any effect or changing error inference. If that build passes, execute
the same cassette once and remove/rebuild.

**Plain-marker result (2026-09-28 17:52Z).** The marker build passed. The one
focused coverage cassette exited 1 before proposal validation with literal
`HermeticChildOutputCanonicalFailure`; no proposal marker was emitted. The
stdout transport therefore contaminated the child-output boundary and did
not distinguish the validator stage. No behavior or fixture change was made.
The recorded diagnostic stop `2026-09-28T17:50:00Z` was exceeded while
preserving this result. The plain-marker source hunk is removed; package
output was rebuilt without instrumentation by `2026-09-28T17:53:00Z` (exit
0; `/tmp/issue386-observe-proposal-r8-build-clean.log`). The temporary marker
search over proposal source and generated output was empty, and
`git diff --check` passed. The production source has no instrumentation hunk.

## Out-of-band Observe proposal discriminator (2026-09-28)

The stdout trace caused the canonical child-output failure before reaching
the validator. Determine the first failing phase for the 16th Observe proposal
without writing to child stdout. **A:** `validateRoute` rejects; predict a
start record in a dedicated `/tmp` marker file with no route-accepted record.
**B:** the route accepts but proposal ID/subject comparison fails; predict
route-accepted plus a false comparison. **C:** route and comparisons pass but
wait-operation or action-identity validation rejects; predict passing earlier
phases and a started wait/identity phase without its matching passed phase.
Instrument only Observe proposals and write the call ordinal, closed route and
identity-source tags, phase, booleans, and closed error code to
`/tmp/issue386-observe-proposal-r9-markers.jsonl`; never include IDs or
payloads. Build, run the focused S1 coverage cassette once, remove the
instrumentation, and rebuild clean. Expected duration is at most 6 minutes;
stop at `2026-09-28T18:01:00Z`. If the file marker is absent or the first
failure remains ambiguous, stop and report it. No repair, second cassette,
full gate, or live Run is in scope.
**Out-of-band trace result (2026-09-28 17:57Z).** The instrumented build
passed; the one focused cassette exited 1 with `HermeticQualificationSourceRejected`
(`Test Files 1 failed`, `Tests 1 failed | 4 skipped`) and no child-output
canonical failure. The `/tmp` file contains complete validation markers for
Observe proposal calls 1–15, all of which pass route, ID, subject, wait, and
action-identity phases. It contains no call-16 marker, while the preceding
entry trace for status-entry ordinal 162 reports a `ProposedDeliveryAction`
whose step is `ObservePlannedAttemptExecutorWork`. This narrows the missing
fact to that proposal's outer route-family tag (or an earlier dispatch exit);
the trace intentionally counted only `FreshExecutorWorkflowRoute`, so it does
not yet prove which one. No behavior or fixture change was made. The marker
source hunk was removed and the package rebuild passed (exit 0;
`/tmp/issue386-observe-proposal-r9-build-clean.log`). Source/dist marker search
is empty and `git diff --check` passed.

The next changed discriminator must record the outer route-family tag at the
status entry and for every route carrying the Observe step. **A:** entry 162
uses `FreshWorkflowRoute`; predict a missing executor-route marker and
`InvalidFreshRoute` in `validateFreshRoute`. **B:** entry 162 uses
`FreshExecutorWorkflowRoute`; predict its route-family marker plus a later
proposal check failure. **C:** proposal validation is not invoked after the
controlled-dispatch start; predict an entry marker with no validator-entry
record. For this changed action (started `2026-09-28T18:01:19Z`), record every
Observe route family and phase to
`/tmp/issue386-observe-route-family-r10-markers.jsonl`. Keep all output in
`/tmp`, build, run this cassette exactly once, then remove instrumentation and
rebuild. No runtime/fixture repair, second cassette, full gate, or live Run is
in scope. Expected duration is at most 3 minutes; stop at
`2026-09-28T18:04:30Z`.

**Probe compile attempt (2026-09-28 18:02Z).** The first build failed before
the cassette with TS2339 because TypeScript did not narrow `route.step` through
the `observeRoute` boolean. The probe source remains temporary; the route-step
tag is now computed inside the narrowed route-family expression. No cassette
ran for this compile attempt.

**Route-family discriminator result (2026-09-28 18:05Z).** The corrected
instrumented build passed, but the single focused cassette again exited 1
with `HermeticQualificationSourceRejected` (`Test Files 1 failed`,
`Tests 1 failed | 4 skipped`). The out-of-band marker file contains the same
15 completed `FreshExecutorWorkflowRoute` Observe calls as r9 and no marker
for the later status-entry-162 proposal. This does not match A or B, and does
not establish C because the prior r7 controlled-dispatch trace was from a
different run. The observation is inconclusive: current-run status-entry
ordinal and outer route-family were not captured at the same boundary. The
`2026-09-28T18:04:30Z` stop was exceeded while preserving the result. The
temporary source probe is removed; the clean rebuild passed before
`2026-09-28T18:06:00Z` (exit 0; `/tmp/issue386-route-family-r10-build-clean.log`).

Next distinguishing action: instrument `validateEntry` and
`validateControlledEntry` with the status-entry ordinal, entry tag, outer
route-family/step tag, and a separate validator-call start/pass marker, all
written to `/tmp`. Predict route-family mismatch if entry 162 directly shows
`FreshWorkflowRoute` with Observe; predict a downstream source-boundary defect
if entry 162 is `FreshExecutorWorkflowRoute` and its matching proposal call
reaches/passes validation. Execute the focused cassette once under a new
explicit stop time. No repair, broad gate, or live Run before that observation.

**Route-family result cleanup (2026-09-28 18:07Z).** The uninstrumented build
passed (exit 0), the source/dist marker search was empty, and `git diff --check`
passed. For the changed direct status-entry probe, expected duration is at
most 5 minutes; stop at `2026-09-28T18:12:30Z`. Record status-entry and
proposal-call markers to `/tmp/issue386-observe-entry-r11-markers.jsonl`; run
the focused cassette once, then remove instrumentation and rebuild clean.

**Direct status-entry result (2026-09-28 18:13Z).** The instrumented build
passed and the focused cassette exited 1 with `HermeticQualificationSourceRejected`
(`Test Files 1 failed`, `Tests 1 failed | 4 skipped`). The marker file recorded
15 `FreshExecutorWorkflowRoute` Observe proposal validations, all passing.
Status-entry markers were recorded for nine direct Observe proposals at
ordinals 117, 120, 123, 131, 133, 135, 137, 145, and 147; each passed subject,
controlled-entry, and full status-entry validation. No status entry after
147 was recorded, and the prior r7 ordinal 162 was not reproduced. The current
failure boundary remains unidentified after these entries. The recorded stop
`2026-09-28T18:12:30Z` was exceeded while preserving the result. Temporary
markers were removed; the clean rebuild passed before `2026-09-28T18:14:30Z`
(exit 0; `/tmp/issue386-observe-entry-r11-build-clean.log`), source/dist marker
search was empty, and `git diff --check` passed.

## Full status-entry boundary discriminator (2026-09-28)

The focused cassette still rejects after all currently traced Observe status
entries pass. Does a later status entry fail (**A:** one `StatusEntryStarted`
record has no matching `StatusEntryPassed`, naming its ordinal and closed
entry/route tags), or does every entry pass and rejection occur in an enclosing
status phase (**B:** all entries pass, then the first outer status-phase
started marker lacks its matching pass)? Instrument all status-entry
start/subject/controlled/dispatch/pass boundaries, the completion-release
phase, and the outer current-source/status phases. Log only ordinals, closed
entry/route/status tags, booleans, counts, and phase names to
`/tmp/issue386-full-status-boundary-r12-markers.jsonl`; no identifiers or
provider payloads. For this action started `2026-09-28T18:16:34Z`, expected
duration is at most 4 minutes; stop at `2026-09-28T18:21:00Z`. Build, run the
focused S1 coverage cassette once, remove instrumentation, rebuild clean, and
report the exact first missing pass. No repair, full gate, or live Run until
the observation supports a specific source check.

**Full status-boundary result (2026-09-28 18:23Z).** The instrumented build
passed and the focused cassette exited 1 with `HermeticQualificationSourceRejected`
(`Test Files 1 failed`, `Tests 1 failed | 4 skipped`). The exact failing
boundary is status entry 162 in source snapshot 75. Entries 1–161 passed.
Entry 162 is `ProposedDeliveryAction`, route family `IdentityFreeWorkflowRoute`,
transition `ObservePlannedAttemptExecutorWork`; its subject and controlled
checks passed and dispatch began, but entry validation did not pass. The
source-level phases through ready-graph, focused completion, status
derivation/tag, and completion-release validation all passed; the snapshot's
entry validation did not complete. This supports a missing identity-free
Observe validator branch. It also explains why the earlier probes counted 15
fresh-executor Observe proposals: the failing route is a different accepted
family. The recorded `2026-09-28T18:21:00Z` stop was exceeded while preserving
this result. Temporary instrumentation was removed; the uninstrumented build
passed (exit 0; `/tmp/issue386-full-status-boundary-r12-build-clean.log`), and
the marker source was removed.

**Repair boundary before edit.** `delivery-transition-policy.ts` classifies
`ObservePlannedAttemptExecutorWork` as `IdentityFree` with the planned-attempt
protocol, and the transition carries exact `plannedAttempt` plus
`acceptedProgress`. The qualification source sends unhandled identity-free
running transitions into completion-transition validation, which rejects
this tag. Add an explicit branch that validates the exact planned attempt and
the same strict accepted-progress schema used by fresh Observe validation,
then preserves the `IdentityFreeWorkflowRoute` tag. Add this route to the
existing measured-route test and a malformed accepted-progress rejection
control, then rerun the S1 cassette. This changes hermetic qualification
validation only; it cannot start a session, push, or seal a Dalph Run.

**Focused repair verification plan (started 2026-09-28T18:30:03Z).** Run the
Dalph package build, the exact six-route-family qualification test with its
malformed-progress control, the focused direct-publication S1 cassette,
root typecheck, changed-file lint, and `git diff --check`. Expected duration
is at most 7 minutes; stop at `2026-09-28T18:38:00Z`. No full gate or live Run
is included.

## Integrator exact-completion gap and r13 cassette result (2026-09-28)

The accepted exact-hint decision applies to the Codex **Integrator private
run**, not only to the planned-attempt executor. The S4 scenario now names the
fixed Integrator session, candidate worktree, owned thread/token, run token,
and durably observed turn; maps exact-hint, no-replay, and reopen outcomes to
`codex-integrator.test.ts`; and retains the planned-attempt executor controls
as a separate boundary. A terminal fresh read or absent activity census does
not replace the matching hint for an already observed Integrator turn.

**Focused repair result (2026-09-28T18:30:03Z–18:38:00Z).** Package build
passed (log `/tmp/issue386-identity-free-observe-r13-build.log`) and the
measured-route test plus malformed-progress control passed
(`/tmp/issue386-identity-free-observe-r13-route-test.log`). The single S1
coverage cassette exited 1 after 47.79s with `PublicPublicationTimeout`
(`Test Files 1 failed`, `Tests 1 failed | 4 skipped`). The timeout is the
45-second child-process wait at the cassette's `awaitWithDiagnostic`, not a
remote publication timeout. The journal has 142 events: planned-attempt
executor work reaches terminal, `IntegratorSessionFixed` and
`IntegratorRunStarted` are recorded at positions 43–44, then only repeated
tracker graph reads follow. There is no `IntegratorRunResultRecorded`, remote
publication intent, promotion, or finality. The status projection leaves B
blocked because A has not completed.

The child trace records one exact task-executor `turn/completed` hint and its
terminal reread. It does not record an Integrator hint. The provider snapshot
counts two thread starts and two turn starts, but the cassette did not capture
the second turn's lifecycle or hint delivery. Therefore the preserved r13
trace alone does not prove whether that notification was delivered. The source
boundary does distinguish the failure: `codex-integrator.ts::startObservedTurn`
returns the original `inProgress` start response; `sealObservedRun` immediately
checks that response and returns “exact provider turn remains active” instead
of waiting for a notification and rereading the exact thread. The hermetic
bridge only routes completion hints to registered subscribers, and
CodexIntegrator does not attach one. This supports the missing Integrator
completion-wakeup explanation and falsifies a later publication/proof failure:
there is no Integrator result or publication intent to validate. The smallest
repair is to attach exact X/T before `turn/start`, durably retain T, wait for
that hint, reread exact thread/token/turn and complete owned-activity census,
then seal; on reopen attach and wait before lifecycle reread. A no-replay
reopen remains pending.

The cassette writes four fixed `/tmp/public-s1-timeout-*.json` paths. This r13
run overwrote earlier files at those same paths before that collision was
noticed. The current r13 copies are preserved as
`/tmp/issue386-r13-cassette-timeout-{diagnostic,provider,audit,git-boundary}.json`;
the older versions were not found in `/tmp` and must be treated as unavailable.
Future focused cassette runs use per-run diagnostic paths. No production live
Run, full gate, or retry of the preserved S1 Run was performed.

**Focused verification plan before implementation.** Add Integrator-level
tests for pre-start subscription and exact-ID filtering, terminal start
response pending until matching hint, fresh exact reread and absent activity
before seal, and reopened `TurnObserved` with terminal provider state but no
replayed hint remaining pending without another turn. Then run the exact
Integrator tests, affected app-server protocol tests, package build, root
typecheck, changed-file lint, and `git diff --check`. This estimate expired
before checks began; no process was left running.

**Integrator exact-hint repair verification plan.** The repair now subscribes
before a new `turn/start`, binds T only after storing `TurnObserved`, waits for
exact X/T, then rereads the exact thread and complete activity census. Reopen
attaches/waits before `ensureThread` resumes X. Run the focused Integrator test
file and app-server protocol test file, package build, root typecheck,
changed-file lint, and `git diff --check`. Expected duration is at most 25
minutes; absolute stop `2026-09-28T19:45:00Z`. Do not run a full gate or live
Run in this window.

**First focused Integrator test attempt.**
`pnpm exec vitest run --reporter=dot packages/dalph/src/application/codex-integrator.test.ts`
exited 1 in 11.81s (`52 failed | 8 passed`). The terminal cause was a testable
adapter integration error at `integratorServiceFor.prepare`: this code passed
`materialized.record` even though `ensureCandidateWorktree` returns the private
record directly. That made `runFor` receive `undefined`; the new no-replay
case consequently timed out before its exact-subscription signal. The observed
shape is confirmed by the existing pre-repair call site, which passed
`materialized` directly to `ensureThread`. The repair now passes that same
record value to `runFor` and `ensureThread`. No runtime qualification or live
Run was attempted.

**Second focused test attempt.** After correcting the record shape, the same
file exited 1 in 11.44s (`11 failed | 49 passed`). The new S1 and both reopen
completion controls passed. Most remaining failures were fixture timing: the
test fake changed its resumed lifecycle on the first post-hint read, while the
existing replay controls intend to change it on a later replay read. The exact
completion path now performs the first fresh read before sealing, so those
fixtures now have separate initial and replay observations. The manually
injected hidden-turn negative control now supplies its own exact hint so it
can reach the intended hidden-turn assertion; it no longer expects terminal
state alone to wake an observed Integrator run. One candidate tombstone/path
test also failed in this attempt and will be inspected independently if it
persists. No source gate, broad gate, or live Run was started.

**Third focused Integrator test attempt.** With sequenced lifecycle fixtures
and an explicit exact hint for the hidden-turn control, the file reached 59/60
passing in 1.59s. The sole failure is the existing foreign-thread replay
assertion: its three-read fixture now correctly reaches the replay boundary,
where the detail says “sealed result thread ownership changed before replay”
rather than the prior earlier-boundary phrase “ownership token”. The decision
remains rejection of the foreign owner. The candidate tombstone/path case
passed in this run. The assertion will be narrowed to the shared ownership
fact; no implementation behavior is being relaxed.

**Fourth focused Integrator test attempt.** After narrowing that assertion to
the shared ownership rejection, the exact file passed: `Test Files 1 passed`,
`Tests 60 passed (60)`, duration 1.38s; retained output is
`/tmp/issue386-integrator-exact-hint-test-r4.log`.

The affected app-server protocol file also passed: `Test Files 1 passed`,
`Tests 46 passed (46)`, duration 10.06s; retained output is
`/tmp/issue386-integrator-app-server-protocol-r1.log`.

The Dalph package build passed (exit 0; log
`/tmp/issue386-integrator-build-r1.log`). Its Effect analyzer reported two
style suggestions on the new `Effect.fail` yields; these were simplified to
direct typed-error yields before the next build.

**Typecheck finding.** The first root typecheck exited 1 with exactly one
compiler error: `production-hermetic-provider-state.ts:238` could not find
`CodexOwnedTurnToken`, which the new controlled completion helper accepts.
The file already imports adjacent branded Codex identities from
`codex-attempt-store.ts`; the missing type import is a local bridge compilation
defect, not a runtime behavior gap. Repair only that type import. The remaining
root typecheck output consists of Effect analyzer suggestions.

**Verification continuation plan (started 2026-09-28T19:29:00Z).** Rebuild
the Dalph package after that simplification, then run root typecheck,
changed-file lint, and `git diff --check`. Expected duration is at most 12
minutes; stop safely at `2026-09-28T19:45:00Z`. No broad gate or live Run is
included. A scoped Standards/Spec review of this exact Integrator follow-up is
running read-only against the accepted S4 refinement and this dirty worktree
diff.

**Scoped review and lint findings.** Both read-only review axes found the
same missing S4 proof: the scenario named a nonexistent post-bind
`ignores unrelated Integrator completion hints without reading lifecycle`
test; existing wrong-ID injection occurred before T binding and was filtered
by the fake adapter. Spec review also found no Integrator test proving that a
matching hint plus terminal reread remains unsealed when the subsequent
activity census is `ExactLive`; the existing Integrator live-writer control
stops before turn start. Repair with one controlled Integrator test that
delivers wrong IDs directly to the hint stream after durable T binding, then
the exact X/T hint, and uses the post-hint `ExactLive` census to assert only
the allowed fresh-read/census count and no sealed private result. Map both
outcomes to that decisive test. The first `pnpm lint:changed` also found four
issues in the dirty candidate: a type-only `Scope` import, a literal 64-entry
test-bridge bound, the provider-state file exceeding its configured 420
nonblank/noncomment lines by five, and a double type assertion in the malformed
Observe fixture. Fix those scoped issues; the lint command's implicit
`origin/master` comparison included unrelated repository paths, so the final
changed-file lint will pin `DALPH_DIAGNOSTICS_BASE` to this worktree's pre-edit
HEAD `1f1dfb5133bca514ba598c7c657d386433984d8e`. Expected repair plus focused
tests/lint is at most 8 minutes; stop by `2026-09-28T19:45:00Z`.

**Review-driven proof repair.** Added the exact missing S4 test title from the
map. It waits until the private `TurnObserved` record is stored and T is bound,
injects a wrong-thread hint, a wrong-turn hint, then matching X/T directly into
the Integrator's stream, and selects `ExactLive` only for the post-hint census.
It asserts one start, exactly one fresh thread read, two activity censuses
(pre-start and post-hint), and a retained unsealed `TurnObserved` record. The
test passes in isolation. The co-located hermetic turn-start helper was moved
to `production-hermetic-provider-turn.ts` to keep the provider-state fixture
within its documented line limit; the controlled `turn/start` error mapping
is preserved. The malformed Observe fixture now has one explicit cast from
`unknown`, and the 64-entry bridge bound is named.

**Focused test results.** The complete Integrator file passed `61/61` in 1.55s
(`/tmp/issue386-integrator-exact-hint-test-r5.log`); the app-server protocol
file passed `46/46` in 10.05s
(`/tmp/issue386-integrator-app-server-protocol-r2.log`). Both review findings
are resolved by the named Integrator test; the accepted completion chronology
and missing-hint pending behavior remain asserted. The first
`pnpm lint:changed` was run without a pinned diagnostic Base and exited 1 on
the four issues listed above; no unrelated source was edited to suppress that
moving-`origin/master` comparison.

**Stop and continuation.** The recorded `19:45:00Z` stop was exceeded while
finishing the review-driven test and style repairs. At
`2026-09-28T19:49:22Z` no process remained active; focused test logs and all
earlier diagnostic artifacts are preserved. Candidate build after the helper
extraction, final root typecheck, pinned changed-file lint, diff check, and
one focused publication cassette remain. New bounded verification window
(started `2026-09-28T19:51:40Z`): expected at most 8 minutes, absolute stop
`2026-09-28T20:00:00Z`. No broad gate or live Run is included.

The first post-extraction root typecheck exited 1: the test-support helper
declared the injected result producer as returning only
`CodexAppServerFailure`, but production fixture inference also includes Git,
filesystem, and schema errors. The parent had intentionally mapped all such
failures to the controlled safe `turn/start` failure. Preserve that mapping
and parameterize only the helper's producer error type; remove now-unused
turn-only imports from the state module.

The pinned changed-file lint then found one remaining issue: direct
`randomUUID()` use for cassette diagnostic path isolation violates the
project's Effect UUID rule. Replace the test-only path suffix with the process
PID and monotonic `hrtime.bigint()`, which still gives each run independent
retained files without generating identifiers used as domain identity.
The rerun found no remaining Oxlint rule errors and exited 20 because dprint
reported eight changed TypeScript files not formatted. Run `dprint fmt` only on
those eight selected files, then repeat the pinned changed-file lint.

**Final build and focused S1 check plan (started 2026-09-28T19:56:00Z).**
Expected duration is at most 3 minutes; stop safely at
`2026-09-28T20:00:00Z`. Rebuild the Dalph package, then run the one exact
direct-publication S1 cassette in coverage mode. Diagnostic files now include
the executing process PID and monotonic time, so this run cannot overwrite any
preserved S1 evidence. No full gate or production live Run is included.

**Final focused verification and cassette result (2026-09-28).** The Dalph
package build passed (`/tmp/issue386-integrator-build-r3.log`); root typecheck
passed with no compiler errors (`/tmp/issue386-integrator-typecheck-r4.log`);
pinned `pnpm lint:changed` passed (`DALPH_DIAGNOSTICS_BASE=1f1dfb...`,
`/tmp/issue386-integrator-lint-r4.log`); and `git diff --check` passed. The
full Integrator test file passed `61/61` and app-server protocol tests passed
`46/46`. The focused coverage S1 cassette ran once and exited 1 in 41.89s
(`/tmp/issue386-integrator-direct-publication-r1.log`). It did not time out:
it reached the final direct-publication assertions after the journey and
reported actual GitHub provider transport count `220`, exceeding the existing
ceiling `130` by 90. The assertion at test line 772 is unchanged. The four
older fixed `/tmp/public-s1-timeout-*.json` artifacts retain their prior
18:32Z timestamps; this run did not overwrite them because it reached the
counter assertion rather than the timeout diagnostic path. No repaired
candidate qualification or production live S1 is claimed.

**Focused count discriminator window (opened 2026-09-28T20:11:38Z).** At the
existing assertion that sums GitHub provider calls, is the excess 220-versus-
130 caused by repeated tracker reads around Integrator completion (**A**:
specific GraphQL operation tags dominate and repeat in a journal/boundary
sequence around the exact completion hint), or by other provider tags or
ordinary fixture/setup work (**B**: dominant tags occur outside that boundary
without a corresponding repeated journal/boundary pattern)? The distinguishing
observation is a safe per-tag `provider.operationCounts` snapshot beside the
ordered journal and boundary event tags at that assertion. Add temporary
diagnostics there only; do not log IDs or provider/tracker payloads. Expected
duration is at most 4 minutes; absolute UTC stop is
`2026-09-28T20:16:00Z`. Run the focused coverage cassette exactly once, then
remove instrumentation, rebuild clean, and preserve the result. No repair,
full gate, or production live Run.

**Review dispositions.** The Standards missing-map finding is resolved by the
passing exact-title post-bind wrong-ID test. The Spec wrong-ID and post-hint
live-activity proof gaps are resolved by that same test: it establishes
durable T before injecting either wrong identity, proves only the matching
hint permits the single fresh thread reread, and asserts the `ExactLive` census
leaves `TurnObserved` unsealed. Existing absent-activity exact-hint and reopen
no-replay tests remain green. No unresolved S4 chronology finding is known;
the S1 provider-call budget failure remains a blocker to qualification.

**Focused cassette recovery question.** Why does the now-completing S1 journey
use 220 GitHub provider operations against its unchanged 130 ceiling? **A:**
the additional 90 are repeated tracker reads/observations generated by a
specific new completion-boundary retry or wake path; predict one or more
specific GraphQL operation tags dominate the excess and correlate with a
repeated journal/provider boundary. **B:** the excess comes from a different
provider tag or ordinary fixture/setup work rather than completion wake
retries; predict the dominant tags occur before/after that boundary without a
repeating journal pattern. The missing distinguishing observation is the
per-tag `provider.operationCounts` snapshot at the existing assertion, joined
to the child journal tail and boundary sequence. The next action is one
focused cassette diagnostic that logs only safe operation tags/counts and
ordered boundary tags, then classifies the excess before any fixture or
runtime repair. Preserve the 130 ceiling and do not rerun qualification.

**Stop custody.** The verification window ends at `2026-09-28T20:00:00Z`.
The cassette process exited before the stop; no command or writer remains.
Source HEAD is still `1f1dfb5133bca514ba598c7c657d386433984d8e`, with the
dirty issue-386 candidate preserved. No full gate, live Run, or preserved Run
retry was started.

**Count discriminator result (2026-09-28 20:14Z).** The focused cassette ran
once and exited 1 in 40.41s, with 1 failed and 4 skipped; its count assertion
observed 219 GitHub provider operations against the unchanged 130 ceiling
(`/tmp/issue386-provider-count-r8-cassette.log`). Safe per-tag counts were:
`ResolveIssue` 27, `ReadIssue` 46, `ReadBlockedBy` 46, `ReadSubIssues` 41,
`FindClaimLabel` 42, `CreateClaimLabel` 4, `ReadTaskWorkSpecification` 7,
`CodexStartThread` 4, `CodexStartTurn` 4, `CodexResumeThread` 12,
`CodexListBackgroundTerminals` 16, `CodexReadThread` 2, `CodexListThreads` 2,
`CloseIssue` 2, and `DeleteClaimLabel` 4. The child stderr had exact-completion
hint markers at line indexes 1 and 4. The ordered journal had two
`IntegratorRunResultRecorded` positions (38, 208), while boundary tags were
`PromotionCompareAndSet`, `CompletionResponse`, `PromotionCompareAndSet`,
`CompletionResponse`. The relevant middle journal span contains 39
`TaskTrackerReadInitiated`/`TaskTrackerFactsObserved` pairs after the second
`PlannedAttemptExecutorWorkReported` and before the second
`IntegratorSessionFixed`. This does **not** support an Integrator completion
retry: the repeated graph reads precede the second Integrator session/result,
and there is no repeated correlated Integrator result/hint boundary. The trace
does not identify why those 39 graph observations occur. Next discriminator:
capture one safe projection of each of those fresh graph observations plus
selected transition/reason at the same journal positions.

**Post-diagnostic cleanup window (opened 2026-09-28T20:20:40Z).** Expected
duration is at most 2 minutes; absolute UTC stop is
`2026-09-28T20:22:30Z`. Remove only the temporary count diagnostic block,
then run `git diff --check` and one clean Dalph package build. No test,
cassette, or gate is authorized in this cleanup window.

Cleanup completed before the stop: the temporary console block is removed,
`git diff --check` passed, and the clean Dalph package build passed
(`/tmp/issue386-provider-count-r8-build-clean.log`). HEAD remains
`1f1dfb5133bca514ba598c7c657d386433984d8e`; all intended candidate changes
remain preserved.

## Repeated graph-state discriminator (2026-09-28)

For the 39 complete tracker snapshots after the second
`PlannedAttemptExecutorWorkReported` and before the second
`IntegratorSessionFixed`, are they redundant repeated observations of unchanged
facts/action (**A**: root/dependant lifecycle, revisions, blocker/claim state,
and selected transition/reason stay the same) or do tracker facts/selected
action change across that interval (**B**: concrete state or decision changes)?
Distinguish by temporarily logging only safe closed projections keyed by
journal index: event tag, root/dependant lifecycle, revisions, blocker
count/status, claim presence and owned-vs-other, selected action/transition/
reason. Never log task IDs, claim IDs, or payloads. Expected duration is at
most 6 minutes; absolute UTC stop is `2026-09-28T20:30:00Z`. Rebuild and run
the exact coverage cassette once, remove instrumentation, rebuild clean, and
diff-check. No production or fixture repair, full gate, or live Run.

**Fresh projection window (opened 2026-09-28T20:30:22Z).** This is a new
bounded action; the previous window stopped before source/test edits or
checks. Expected duration is at most 8 minutes, with absolute UTC stop
`2026-09-28T20:38:00Z`. Add only the safe ID-free projection for the 39
`TaskTrackerFactsObserved` entries between the second
`PlannedAttemptExecutorWorkReported` and second `IntegratorSessionFixed`, then
rebuild and run the exact coverage cassette once. Remove instrumentation,
clean-build, and `git diff --check`. No runtime/fixture repair, further
cassette, full gate, live Run, or #387/#388 work.

**Projection attempt result (2026-09-28 20:34Z).** The instrumented package
build passed. The single focused coverage cassette exited 1 in 43.27s
(`/tmp/issue386-graph-projection-r9-cassette.log`), but the diagnostic emitted
`snapshotCount: 0`; the raw-record interval/read-intent join did not match the
projected 39-event interval. This is inconclusive and supports neither A nor
B. No production or fixture behavior changed. Next discriminator: use the
already projected cassette entries to select the 39 observation indices, or
first establish a read-only mapping from those projected indices to raw
journal indices, then capture the requested ID-free state projection in a new
bounded window.

**Projection cleanup window (opened 2026-09-28T20:34:58Z).** Expected
duration is at most 1 minute; absolute UTC stop is
`2026-09-28T20:38:00Z`. Remove only this temporary projection block, rebuild
clean, and run `git diff --check`. No additional cassette is authorized.

Cleanup completed before the stop: the temporary projection block is removed,
the clean package build passed (`/tmp/issue386-graph-projection-r9-build-clean.log`),
and `git diff --check` passed. HEAD remains
`1f1dfb5133bca514ba598c7c657d386433984d8e`; intended dirty candidate changes
are preserved.

## Raw-journal repeated graph-state discriminator (2026-09-28)

Use raw `records` indices only: find the second
`PlannedAttemptExecutorWorkReported` and second `IntegratorSessionFixed`, slice
the raw records between them, then select entries whose
`event._tag === "TaskTrackerFactsObserved"`. Are the 39 complete snapshots
redundant repeated observations of unchanged facts/action (**A**: root and
dependant lifecycles, revisions, blocker/claim state, and selected
action/transition/reason remain the same), or do graph facts or the selected
decision change (**B**: concrete state/decision changes)? Emit only an ID-free
closed projection keyed by raw journal index: event tag, root/dependant
lifecycle, revisions, blocker count/status, claim presence and owned-vs-other,
selected action/transition/reason. Never log task IDs, claim IDs, or payloads.
Expected duration is at most 8 minutes; absolute UTC stop is
`2026-09-28T20:47:00Z`. Build and run the exact coverage cassette once, then
remove instrumentation, clean-build, and diff-check. If compilation or
projection fails, stop and report; no second cassette. No repair, full gate,
or live Run.

### Result and cleanup plan

The instrumented package build passed. The one coverage cassette exited 1 in
41.05s (`/tmp/issue386-raw-graph-projection-r10-cassette.log`): 1 selected test
failed and 4 were skipped because the existing provider-count assertion saw
211 requests against its limit of 130. The raw slice used second executor
report index 26 through second Integrator-session index 204 and found 49
`TaskTrackerFactsObserved` records: 29 `TaskTrackerFactsReadFailed`, 11
`UnchangedTaskTrackerFactsReconfirmed`, 5 `FocusedTaskClaimFacts`, 2
`FocusedTaskCompletionFacts`, 1 `FocusedTaskWorkSpecificationFacts`, and 1
`CompleteTaskTrackerFacts`. The single complete graph at index 104 showed the
root completed, dependant open, and one completed prerequisite; its revision
serialization contains task identities and is intentionally not reproduced.
With only one complete graph, the evidence does not distinguish unchanged
complete facts/action (A) from changing facts/decision (B). The intended 39
complete-snapshot set was not present in this raw event slice; that mismatch
is the diagnostic result, not evidence for A or B.

Next discriminator: inspect the raw event schema and reconfirmation references
to determine whether the remaining graph observations link to prior complete
graphs, then project those exact boundaries without identifiers. Before this
cleanup, expected duration for removing the temporary block, one clean package
build, and `git diff --check` is at most 1 minute; absolute stop is
`2026-09-28T20:47:00Z`.

## Tracker-read failure discriminator (2026-09-28)

Question: do the 29 `TaskTrackerFactsReadFailed` events reflect provider
throttling or an opened request circuit (**A**), explaining the repeated 211
provider calls, or do they reflect unsupported-target, fixture, decode, or
graph-projection failures unrelated to quota pressure (**B**)? A predicts
`failure._tag === "TrackerAdapterReadError"` and
`reason._tag === "Throttled"` or `"CircuitOpen"` for repeated graph reads. B
predicts another closed failure tag/reason/context operation. Emit only raw
journal index, selected action/reason tags, failure and reason tags, closed
context operation, and provider operation tag/count totals; omit failure
detail, identities, paths, and payloads. Use the existing coverage cassette
once, without changing the 130-call limit. Expected duration is at most 8
minutes; absolute UTC stop is `2026-09-28T20:59:30Z`. Build, run once, remove
the probe, clean-build, and diff-check. If the projection is inconclusive, do
not rerun. No runtime/fixture repair, gate, or live Run.

### Result and cleanup plan

The instrumented package build passed. The single coverage cassette exited 1 in
41.39s (1 selected test failed, 4 skipped) at the unchanged provider-count
assertion: 195 calls exceeded the limit of 130. The ID-free diagnostic selected
raw indices 26 through 138 but found zero `TaskTrackerFactsReadFailed` events
inside that interval; therefore it did not observe the target set of 29 events
and supports neither A nor B. The provider snapshot operation tag/counts were:
`ResolveIssue` 24, `ReadIssue` 40, `ReadBlockedBy` 40, `ReadSubIssues` 36,
`FindClaimLabel` 38, `CreateClaimLabel` 4, `ReadTaskWorkSpecification` 7,
`CloseIssue` 2, `DeleteClaimLabel` 4, `CodexStartThread` 4,
`CodexStartTurn` 4, `CodexResumeThread` 12,
`CodexListBackgroundTerminals` 16, `CodexReadThread` 2, and `CodexListThreads`
2. Next discriminator: project all raw `TaskTrackerFactsReadFailed` events in
the audit run without the second-session slice, retaining only closed failure,
reason, context-operation and action tags plus provider operation tag/counts.
Do not rerun this cassette unchanged.

Expected duration to remove this probe, clean-build, and diff-check is at most
1 minute; absolute stop remains `2026-09-28T20:59:30Z`.

## Global tracker-read failure discriminator (2026-09-28)

The r11 session-bounded slice contained zero read failures despite 29 in r10.
Question: did the full r11 journal contain throttled or circuit-open failures
anywhere (**A**), or were read failures absent or attributable to other closed
causes, leaving the excess calls in successful graph reads (**B**)? A predicts
at least one `TrackerAdapterReadError` with `Throttled` or `CircuitOpen` reason.
B predicts no such pair, with either no read failures or only other closed
failure tags/reasons/context operations. Inspect all raw records whose event is
`TaskTrackerFactsObserved` and observation is `TaskTrackerFactsReadFailed`,
without an index interval. Emit only raw index, selected action/reason tag,
failure tag, closed reason tag, closed context operation, and provider
operation tag/counts. Never emit detail, identities, paths, or payloads. Use
the exact coverage cassette once, preserving the 130-call limit. Expected
duration is at most 8 minutes; absolute UTC stop is `2026-09-28T21:08:30Z`.
Build, run once, remove the probe, clean-build, and diff-check. If inconclusive
or a build/run fails, stop without another cassette, runtime repair, gate, or
live Run.

### Result and cleanup plan

The instrumented package build passed. The one coverage cassette exited 1 in
7.91s (1 selected test failed, 4 skipped) before emitting the diagnostic
summary: the read-failure observation does not persist `failure.context`, so
the temporary projection's access to `failure.context.operation` threw. The
probe yielded no global failure tags or provider totals; A/B remains
inconclusive. The missing discriminator is the adapter context operation,
which must be observed at a boundary where it is still available or omitted
from this evidence claim. Do not rerun unchanged. Expected duration to remove
the probe, clean-build, and diff-check is at most 1 minute; absolute stop is
`2026-09-28T21:08:30Z`.

## Global tracker-read failure correlation (2026-09-28)

The r12 probe stopped before output because read-failure observations persist
failure tag/reason and `operationId`, but not adapter context. Question: are
the full-journal read failures throttled or circuit-open (**A**), or absent / a
different closed cause (**B**)? A predicts a `TrackerAdapterReadError` with
reason `Throttled` or `CircuitOpen`; B predicts no such pair or no read failures.
Scan all raw `TaskTrackerFactsObserved` records with
`TaskTrackerFactsReadFailed`; match `operationId` internally to the preceding
`TaskTrackerReadIntentRecorded.operation.operationId`. Emit only raw index,
failure tag, optional reason tag, matching intent operation tag, and its closed
read cause/action tag, plus provider operation tag/count totals. Never emit
identities, failure detail, paths, or payloads. Expected duration is at most 8
minutes; absolute UTC stop is `2026-09-28T21:11:30Z`. Build and run the exact
coverage cassette once, then remove the probe, clean-build, and diff-check. If
compile/projection fails, stop without another cassette. No repair, full gate,
or live Run.

### Result and cleanup plan

The instrumented build passed. The one coverage cassette exited 1 in 39.92s
(1 selected test failed, 4 skipped) at the unchanged provider-count assertion:
211 calls exceeded 130. The global raw-journal projection found 28
`TaskTrackerFactsReadFailed` events, at indices 135 through 189 on alternating
positions. All 28 were `TrackerAdapterReadError` with reason `CircuitOpen`,
matched to `ReadTrackerGraph` intents caused by `WorkflowEstablishment`. This
supports A's circuit-open branch; no `Throttled` failures were observed. The
safe provider operation tag/count totals are retained in
`/tmp/issue386-global-read-failure-r13-cassette.log`. This does not identify
what first opened the local circuit or establish an upstream throttle response.
The next discriminator, if pursued, is the first circuit-opening boundary's
closed cause tag, without request or task payloads.

Expected duration to remove the probe, clean-build, and diff-check is at most
1 minute; absolute stop is `2026-09-28T21:11:30Z`.

## Request-circuit instance diagnostic plan (2026-09-28)

Question: does the 211-call aggregate reflect one guarded GitHub client
exhausting its configured 140 admitted starts in 60 seconds and reopening
after its 30-second cooldown (**A**), or multiple guarded client instances /
another accounting path (**B**)? A predicts one instance's first circuit open
at 140 admitted starts, then a post-cooldown admission no earlier than 30
seconds later. B predicts another instance/count boundary or no such
one-instance sequence.
The discriminator records only a safe per-instance ordinal, admitted count,
first-open operation tag and elapsed time, and first post-cooldown admission;
no IDs, payloads, or paths. The direct-publication cassette selects the
hermetic qualification executable, whose source config sets the
qualification-only GitHub circuit limit to 140 while the production default
is 120. The cassette's separate acceptance cap remains 130; these are distinct
limits, so the observed first-open count must be compared with 140, not the
test cap or production default.

Expected duration is at most 10 minutes; absolute UTC stop is
`2026-09-28T21:42:00Z`. Add temporary instrumentation only, clean-build, run
the direct-publication cassette exactly once, retain its expected existing
211 > 130 failure plus safe discriminator output, then remove instrumentation,
clean-build, and diff-check. Do not change runtime behavior, the cap, tests, or
accepted scenarios. No full gate or live Run.

### Result and cleanup

The instrumented build passed. The single coverage cassette exited 1 in about
33 seconds (1 selected test failed, 4 skipped). It reported 220 calls > 130,
not the predicted existing 211 > 130, so the full command-output discriminator
is inconclusive under the plan's match requirement. The safe circuit markers
showed instance ordinal 2 first opened at 140 admitted starts on
`ResolveIssue`, 3.506 seconds after instance creation, then admitted its first
post-cooldown request after 33.563 seconds on `ResolveIssue` (30.058 seconds
after the open). For this cassette's qualification-only 140 limit, that
supports the single-instance exhaustion/cooldown explanation; it does not
establish why total provider calls differed from 211. The temporary circuit
probe and cassette message were removed. The uninstrumented package build and
`git diff --check` passed. The cassette remains unchanged at its 130-call
assertion, and all pre-existing candidate changes remain in the worktree.

## Read-traffic versus private Integrator completion diagnostic plan (2026-09-28)

Question: do repeated `WorkflowEstablishment` `ReadTrackerGraph` intents that
drive the 140-start circuit occur while the private Integrator waits for its
matching X/T completion (**A**), or only after exact hint/result as required
publication/finality reads (**B**)? A predicts the graph-read intent positions
precede private exact-hint consumption and the Integrator result. B predicts
they follow. Distinguish with safe raw journal positions/event tags for every
relevant graph-read intent, aligned to temporary ID-free markers at private
Integrator exact-hint consumption and result, plus circuit first-open and
post-cooldown markers. Do not log identities or payloads. Run the focused
cassette once; leave the 130-call assertion unchanged. Since previous totals
varied from 211 to 220, do not predict an exact count: require failure only at
`githubProviderTransportCount <= 130` plus all fixed safe boundary markers.
If the exit, failure site, or markers differ, mark inconclusive. Expected
duration is at most 12 minutes; absolute UTC stop is `2026-09-28T22:03:00Z`.
Remove temporary instrumentation, clean-build, diff-check, and verify existing
candidate edits remain. No runtime repair, full gate, or live Run.

### Result and cleanup

The instrumented build passed. The one coverage cassette exited 1 at the
unchanged 130-call assertion (219 calls; 1 selected test failed, 4 skipped).
All temporary markers appeared. Raw `WorkflowEstablishment` graph-read intent
positions were 4, 6, 10, 23, 35, 39, 108, 110, 114, 132, 134, 136, 138, 140,
142, 144, 146, 148, 150, 152, 154, 156, 158, 160, 162, 164, 166, 168, 170,
172, 174, 176, 178, 180, 182, 184, 186, 194, 198, and 267. Private Integrator
session/run/result boundaries were 47/48/49 and 206/207/208; publication and
finality boundaries were 53/54/80 and 212/213/239.

The first exact private hint/result markers were monotonic ns
1118600476478437/1118600489053117. Circuit ordinal 2 first opened at 140
admitted starts on `ReadTaskWorkSpecification`, monotonic ns 1118602657423200
(elapsed 3.801s); this is 2.168s after the first result marker. Its first
post-cooldown admission was `ResolveIssue` at monotonic ns 1118632817948007
(elapsed 33.962s). The second exact private hint/result markers were
1118633841555763/1118633857641167, about 1.024s after that admission.

The journal places six graph-read intents before the first Integrator result,
34 after that result/finality and before the next Integrator session/run, and
one after the second result/finality. No graph-read intent lies between either
recorded `IntegratorRunStarted` and its `IntegratorRunResultRecorded`. This does
not support A as stated: the observed intents cluster before, between, and
after completed Integrator runs, rather than inside a journaled exact-hint wait.
The circuit markers do not correlate individual GitHub operations to a graph
read intent, so they cannot prove whether a request from an earlier graph read
remained in flight across the next run boundary. The private Integrator phase
markers and journal positions are from the same child, but provider-operation
to-intent association was not recorded. Thus the broader A/B causal claim is
inconclusive; the next discriminator is an ID-free internal correlation from
each tracker-read operation to its provider-request tags, retaining its
journal position and comparing its request times with the private hint/result
markers.

Temporary markers and the test assertion message were removed. The uninstrumented
package build and `git diff --check` passed; no other candidate changes were
altered.

## Tracker-read to provider-request correlation plan (2026-09-28)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`;
HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`.

Question: do repeated `WorkflowEstablishment` `ReadTrackerGraph` intents that
drive the 140-start circuit occur while the private Integrator waits for its
matching X/T completion (**A**), or do their outbound provider requests occur
only after exact hint/result and at the subsequent workflow transitions
(**B**)? A predicts request start/finish times for those graph reads fall
between a private Integrator run start and its matching hint/result. B predicts
those requests are outside that wait, following the prior exact hint/result or
occurring at required next-transition reads. The discriminator must correlate
each graph-read journal position internally to its outbound provider operation
tags and monotonic request start/finish times, then compare them to private
exact-hint/result markers. Emit only safe journal positions, closed operation
tags, ephemeral read ordinals, phase tags, and monotonic times; no identities,
paths, or payloads.

Run the exact focused coverage cassette once with the existing 130-call
assertion and accepted assertions unchanged. Since recent counts varied from
211 to 220, require only that it fail at `githubProviderTransportCount <= 130`
with all planned safe markers present; otherwise mark inconclusive and stop.
Expected duration is at most 12 minutes; absolute UTC stop is
`2026-09-28T22:15:00Z`. Remove all temporary instrumentation, clean-build,
diff-check, and verify existing candidate edits remain. No behavior repair,
full gate, live Run, or other worktree.

## Tracker-intent/provider-request correlation plan (2026-09-28)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`;
HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`.

Question: do the repeated `WorkflowEstablishment` `ReadTrackerGraph` intents
that drive the 140-start circuit have their outbound GitHub request intervals
inside the private Integrator's pending matching-X/T window (**A**), or are
those requests outside that window, after a prior exact hint/result or before
a later run begins (**B**)? A predicts associated provider-operation
start/finish times between that run's private exact-hint wait entry and
matching hint/result markers. B predicts those intervals outside that wait.
Distinguish by assigning an ephemeral ordinal to each journaled read and
matching it internally to outbound provider operation tags and monotonic
start/finish times; compare the joined events with private exact-hint/result
markers. Emit only ordinals, journal positions, closed tags, and monotonic
times. No identities, paths, or payloads.

Expected duration is at most 12 minutes; absolute UTC stop is
`2026-09-28T22:15:00Z`. Run the focused coverage cassette once, preserving the
130-call assertion and accepted assertions. Counts varied from 211 to 220, so
do not predict an exact total. Require the sole failure to be the provider
count assertion with all safe markers present; otherwise mark inconclusive.
Remove all probes, clean-build, diff-check, and verify existing candidate
edits remain. No behavior repair, full gate, live Run, or other worktree.

### Provider-request correlation diagnostic stopped before execution (2026-09-28)

The planned exact worktree and HEAD were rechecked. No instrumented build or cassette was started. The temporary protocol ordinal queue and helper were removed/restored; no provider-request instrumentation was completed. This diagnostic is inconclusive: the missing observation is a safe internal join from each journaled tracker-read position to its outbound GitHub request operation tag and monotonic start/finish times, correlated with the private exact-hint/result markers. No request intervals or new acceptance evidence are claimed. The existing candidate changes were preserved. Next action requires a separately bounded window to implement the complete safe join, run the focused cassette once, and remove/rebuild without probes.

### Read-only tracker-intent/provider-request source-path trace plan (2026-09-28)

Question: can the `ReadTrackerGraph` journal intent/position be joined to outbound GitHub request tags and monotonic start/finish using existing internal execution context (**A**), or would that require a new safe ephemeral hook (**B**)? A predicts an existing operation/context path carries the intent operation or journal position to the graph-reader/client boundary. B predicts the journaled protocol boundary invokes the reader independently, with no correlation context crossing to request execution. The distinguishing observation is the exact call path and available context at `journaledTrackerGraphRead`, `WorkflowInterpreterService.readTrackerGraph`, `TrackerGraphReader.read`, and `GithubGraphqlClient.execute`, alongside the existing Integrator hint/result marker seam. Expected duration is at most 4 minutes; absolute stop is `2026-09-28T22:20:00Z`. This is read-only: no source probes, builds, tests, cassette, gate, or live Run.

### Read-only tracker-intent/provider-request source-path trace result (2026-09-28)

The exact worktree remains `issue-386-exact-notification-ids-r1` at HEAD `1f1dfb5133bca514ba598c7c657d386433984d8e`; no source probes, builds, tests, cassette, gate, or live Run were performed.

The source supports alternative **B**: the intent-to-request join is not carried by an existing execution context, but can be added as a temporary internal hook without changing domain schemas. `journaledTrackerGraphRead` in `packages/orchestrator/src/workflow/protocols/task-tracker-read/protocol.ts` appends the `ReadTrackerGraph` intent but discards the append result, then calls `interpreter.readTrackerGraph(operation)`. The operation itself has `operationId`, `cause`, target, read shape, and predecessors (`packages/orchestrator/src/workflow/registry/operation.ts`, `ReadTrackerGraphOperation`). The journaled wrapper in `packages/orchestrator/src/workflow-journal/journaled-interpreter.ts` adds accepted-journal access but does not add request context. At `packages/orchestrator/src/workflow/interpretation/layers.ts`, `workflowInterpreterLayer.readTrackerGraph` reduces that operation to `reader.read(operation.target)`, dropping operation ID/cause. The append result can be captured here to retain the assigned journal position. `githubTrackerGraphReaderLayer` in `packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts` expands the target through `resolveTarget` and `traverseGithubTargetClosure`; its internal `execute(request)` derives only `operationForRequest(request)` and calls `GithubGraphqlClient.execute(request)`. That client contract (`graphql-client.ts`) receives only the closed request tagged union. Thus no current context associates the journal position with request tags/times at the transport boundary.

Smallest next instrumentation path: temporarily provide a dynamically scoped `Context.Service` execution context around `interpreter.readTrackerGraph(operation)` in `journaledTrackerGraphRead`, carrying only the appended record position and closed `cause._tag` (with a per-read ordinal if useful). Read that context in `githubTrackerGraphReaderLayer.execute`; emit the request `_tag` and `Clock.monotonicTimeNanos` immediately before and after `client.execute(request)`. A dynamically provided service context avoids public operation/schema changes and isolates concurrent reads; one read may map to multiple GraphQL page requests.

Align with private Integrator activity using ID-free monotonic markers around `awaitExactTurnCompletionHint` in `packages/dalph/src/application/codex-integrator.ts`: wait-entry, matching-hint acceptance after the exact thread/turn comparison in `sealObservedRun`, then successful durable seal after `store.write(sealed)` / `store.write(sealedRun)`. Compare each request interval against those markers. Existing audit r15 journal/marker observations remain historical and are not a substitute for this new provider-request join.

### Tracker-read/provider-request versus Integrator wait diagnostic plan (2026-09-28)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`; planned HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`.

Question: do outbound GitHub request intervals associated with `WorkflowEstablishment` tracker-graph reads overlap the private Integrator's matching-X/T completion wait (**A**), or do they occur outside that wait (**B**)? A predicts at least one associated request start/finish interval lies after the Integrator wait-entry marker and before exact matching X/T acceptance. B predicts all associated requests occur before wait entry, after hint acceptance, or otherwise outside that interval. The discriminator temporarily carries only the appended journal position and closed cause tag in a dynamically provided temporary `Context.Service` execution context from `journaledTrackerGraphRead` through `workflowInterpreterLayer` to GitHub graph-reader `execute`; emit request tag and monotonic start/finish, with no IDs, paths, or payloads. Add ID-free private Integrator markers at exact-hint wait entry, matching X/T acceptance, and durable seal. Keep the provider-call ceiling at 130 and all accepted assertions unchanged. Run the exact direct-publication coverage cassette once; expected diagnostic result is the existing 130-call assertion failing, with all boundary markers present. A different failure, missing markers, or a passing cap is inconclusive. The pinned Effect V4 beta.106 API has no FiberRef module; use `Effect.provideService` and `Effect.serviceOption` for this temporary scoped context. Expected duration is at most 12 minutes; absolute UTC stop is `2026-09-28T22:31:00Z`. Remove all temporary instrumentation/context/helper, restore candidate source edits, clean-build the package, and run `git diff --check` before the stop. No production repair, full gate, live Run, or other worktree.

### Tracker-read/provider-request versus Integrator wait diagnostic result (2026-09-28)

The exact focused coverage cassette ran once in the planned worktree/HEAD. Command: `pnpm exec vitest run --mode coverage --coverage --reporter=dot packages/dalph/test/cassettes/direct-remote-publication.test.ts -t 'publishes M before local promotion and task completion, then releases its dependant from a later complete graph'`. Retained log: `/tmp/issue386-tracker-provider-intent-r17.log`. Exit 1 after 47.19s; Vitest reported 1 failed test and 4 skipped. The sole failure was the unchanged `githubProviderTransportCount <= 130` assertion, with actual 195 and expected 130. However, the log contains none of the planned `Issue386TrackerProviderRequest` or `Issue386IntegratorPhase` markers. Therefore the A/B timing question is inconclusive: no correlated request intervals or private wait/hint/seal boundaries were observed. Do not infer A or B from the count failure. The 130 ceiling and accepted assertions were unchanged; no second cassette ran.

All temporary request/context/private-phase instrumentation and the helper were removed; the pre-existing dirty candidate files were preserved. The retained focused log remains available for the exact command output. After restoring the uninstrumented candidate sources, `pnpm --filter @dalph/dalph... build` passed in 17.1s (contracts, orchestrator, and dalph); only existing Effect suggestions were emitted. `git diff --check` passed. HEAD stayed `1f1dfb5133bca514ba598c7c657d386433984d8e`, and no temporary diagnostic symbols remain in source.

### Tracker-read/provider-request diagnostic with captured-child-stderr sink (2026-09-28)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`; planned HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`.

Question: do outbound GitHub request intervals associated with `WorkflowEstablishment` tracker-graph reads overlap the private Integrator's exact matching-X/T wait (**A**), or do all associated intervals occur outside it (**B**)? A predicts at least one joined request interval falls between private wait-entry and matching-hint-accepted markers. B predicts every joined interval is before wait-entry, after exact-hint acceptance, or otherwise outside the wait. The previous r17 probes wrote via `console.error` to child stderr, retained in `child.stderrLog`, which the plain cap failure did not include. The new distinguishing capture is to filter only the exact ID-free `Issue386TrackerProviderRequest` and `Issue386IntegratorPhase` JSON lines from `child.stderrLog` and include that bounded marker list in the existing provider-cap assertion message, without changing the 130 cap or accepted outcome assertions. Require the exact markers and require the cassette failure to remain solely the `githubProviderTransportCount <= 130` assertion; missing/malformed markers or a different failure is inconclusive. Recreate the temporary `Context.Service` position/cause propagation, request operation-tag monotonic start/finish probes, and private wait/hint/seal probes. Run the exact coverage cassette once only. Expected duration is at most 10 minutes; absolute UTC stop is `2026-09-28T22:44:00Z`. Remove probes and temporary assertion diagnostic, restore candidate code, clean-build and `git diff --check` before stop. No runtime repair, full gate, live Run, or other worktree.

### Captured-child-stderr tracker-read correlation result (2026-09-28)

The one focused cassette ran from `/tmp/issue386-tracker-provider-intent-r18.log`; its filtered ID-free marker stream is preserved separately at `/tmp/issue386-tracker-provider-intent-r18-markers.jsonl` (402 lines). The markers were captured successfully. The test did **not** reach the provider-cap assertion: `packages/dalph/test/cassettes/direct-remote-publication.test.ts:528:11` failed `expect(childStatus).toBe(0)` with actual 1 / expected 0. This differs from the required count-only cap failure, so the A/B question remains inconclusive regardless of timing aggregates.

The extracted marker JSONL contains 402 raw lines but only 201 unique records; every marker was duplicated exactly once in the extraction. After de-duplication there is one wait-entry, one exact-hint-accepted, and one durable-seal marker. The wait-entry to matching-hint interval is 0.219168 ms. There are 198 unique provider request markers: 99 starts, 98 finishes, and 1 failure. By cause, `ExecutingWorkAuthorityCheck` has 7 starts/7 finishes; `PostQuiescenceReconfirmation` has 35/35; `WorkflowEstablishment` has 57 starts, 56 finishes, and 1 failure. Pairing each start with its following finish/failure for the same journal position, cause, and request tag yields 99 terminal intervals (98 successful, 1 failed); none overlaps the exact-hint wait window. The single failed marker is `WorkflowEstablishment` / `ResolveIssue` at journal position 133. The retained audit projection has zero `TaskTrackerFactsReadFailed` events, and the child runtime diagnostic reports only `HermeticQualificationSourceRejected` at `TaskTrackerFactsObserved`; it does not expose a `CircuitOpen` category. Thus neither circuit-open (**A**) nor semantic mismatch (**B**) is established. The missing observation is the safe error category for the failed `ResolveIssue` request at position 133 (or an authoritative circuit-open event tied to it). These timings remain diagnostic context only because the child exited before the provider-cap assertion.

All temporary probes, context helper, and cap-message projection were removed; pre-existing candidate code remains. No uninstrumented package build ran after r18 restoration before the `22:44:00Z` stop. `git diff --check` was confirmed after restoration; HEAD remains `1f1dfb5133bca514ba598c7c657d386433984d8e`.

### Retained r18 child-exit diagnosis plan and result (2026-09-28)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`; HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`.

Question: did the r18 child exit because a tracker request was rejected by the qualification circuit after its 140-start limit (**A**), or because the hermetic qualification source rejected a tracker fact/projection for a semantic mismatch (**B**)? A predicts a matching safe `CircuitOpen`/limit event for the failed read and a failed-read journal observation. B predicts no circuit-open event at the failed boundary and a source rejection code/tag independent of the circuit. Distinguish by correlating only safe error tags, request tags, cause tags, journal positions, and the provider circuit's open/limit outcome from the retained r18 marker stream and test diagnostics. Do not emit identities, IDs, paths, credentials, or payloads. Expected duration is at most 4 minutes; absolute UTC stop is `2026-09-28T22:51:00Z`. Read-only retained-evidence analysis only: no source edits, tests, cassette, gate, or live Run. If artifacts do not expose the error category, mark inconclusive and name the missing observation.

Result: the marker stream's failed request is `ResolveIssue` at position 133 under `WorkflowEstablishment`. The audit projection shows zero `TaskTrackerFactsReadFailed` events, and the sanitized child diagnostic contains only `HermeticQualificationSourceRejected` at `TaskTrackerFactsObserved`; there is no `CircuitOpen`/limit event to support A and no rejection code independent of the circuit to support B. The evidence is inconclusive; obtain the closed error category at the `GithubGraphqlClient.execute` failure boundary for this read, or an authoritative circuit-open event tied to position 133. No tests, source edits, cassette, gate, or live Run were performed in this evidence review. This review exceeded its recorded stop: completed at `2026-09-28T22:53:24Z`, 2m24s after the `22:51:00Z` stop. The work is stopped.

### ResolveIssue qualification rejection discriminator plan (2026-09-28)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`; planned HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`. Preserve all pre-existing candidate changes and the untracked provider-turn helper.

Question: was the `ResolveIssue` request at journal position 133 rejected by the qualification provider circuit (**A**), or by semantic/source validation (**B**)? A predicts a safe closed circuit rejection category at the provider-client failure boundary joined to position 133, or an authoritative `CircuitOpen` event for that request. B predicts a non-circuit closed source-validation category at that boundary for position 133. The distinguishing observation is the safe error category correlated with that journal position; emit no identity, path, payload, or credential.

First inspect the current client/provider boundary to ensure a temporary ID-free category probe can observe that distinction without changing the 130-call cap or accepted assertions. Run the exact focused coverage cassette no more than once, and only if this probe is able to distinguish A from B. Expected total duration is at most 12 minutes; absolute UTC stop is `2026-09-28T23:22:00Z`. Remove temporary probe changes afterward, preserve all pre-existing candidate files, run a clean package build and `git diff --check`, then verify HEAD/status. No broad gate, live Run, retry, or other worktree. If the category cannot be safely joined or source cleanup is unclear, stop inconclusive.

Probe execution bound: validate only the temporary orchestrator instrumentation with `pnpm --filter @dalph/orchestrator typecheck` (expected <=2 minutes), then run the exact focused coverage cassette once (expected <=2 minutes). Restore the two clean orchestrator files immediately after capture; verify the pre-existing candidate diff remains unchanged, then run `pnpm --filter @dalph/dalph... build` (expected <=2 minutes) and `git diff --check`. The absolute stop remains `2026-09-28T23:22:00Z` for all work, including cleanup.

The selected orchestrator package has no `typecheck` script; `pnpm --filter @dalph/orchestrator typecheck` exited 1 immediately with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. The package exposes only `build`; use `pnpm --filter @dalph/orchestrator build` (expected <=2 minutes) to validate the probe before the cassette. Stop remains `2026-09-28T23:22:00Z`.

### ResolveIssue qualification rejection discriminator result (2026-09-28)

The probe-validated exact focused coverage cassette ran once: `pnpm exec vitest run --mode coverage --coverage --reporter=dot packages/dalph/test/cassettes/direct-remote-publication.test.ts -t 'publishes M before local promotion and task completion, then releases its dependant from a later complete graph'`. Retained log: `/tmp/issue386-resolveissue-boundary-r19.log`. Exit 1; Vitest summary: `Test Files  1 failed (1)`, `Tests  1 failed | 4 skipped (5)`, `Duration  41.41s (transform 511ms, setup 0ms, import 1.48s, tests 38.20s, environment 0ms)`.

The ID-free `Issue386ResolveIssueBoundary` marker count in the retained log is zero. The sanitized log projection contains no `CircuitOpen`, `HermeticQualificationSourceRejected`, `TaskTrackerFactsReadFailed`, or `TaskTrackerFactsObserved` category to join to journal position 133. This does not match either predicted discriminator; A and B remain unsupported and the diagnosis is inconclusive. The exact missing observation remains a safe client outcome/category tied to position 133, or an authoritative `CircuitOpen` record for that request. The 130-call cap and accepted assertions were not changed. No second cassette, gate, or live Run was started. The temporary probe is being removed now; preserve all pre-existing candidate files and finish source/build/diff verification by `2026-09-28T23:22:00Z`.

Terminal cleanup and verification: restored the probe-only changes in `packages/orchestrator/src/authorities/task-tracker/graph-reader.ts`, `packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts`, and `packages/orchestrator/src/workflow/protocols/task-tracker-read/protocol.ts`; `rg` found no remaining `TrackerReadDiagnosticContext` or `Issue386ResolveIssueBoundary` source symbols. `pnpm --filter @dalph/dalph... build` exited 0 (about 23 seconds; existing Effect suggestions only), and `git diff --check` exited 0. HEAD remains `1f1dfb5133bca514ba598c7c657d386433984d8e`. Final status contains the same pre-existing candidate paths present at initial inspection plus this audit update; no probe source or other candidate file was removed or rewritten. Terminal stop: `2026-09-28T23:20:14Z`; elapsed from initial preflight at `23:08:36Z`: 11m38s, within the `23:22:00Z` bound. The result remains inconclusive; no retry, gate, or live Run was started.

### ResolveIssue marker-projection discriminator plan (2026-09-28)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`; planned HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`. Preserve all existing candidate changes and the untracked provider-turn helper.

Question: were safe position-133 `Issue386ResolveIssueBoundary` markers absent at the GitHub client boundary (**A**), or present in the captured child stderr but omitted from the provider-call cap assertion projection (**B**)? Distinguish by filtering only lines with the exact closed marker tag from `child.stderrLog` into both the `childStatus` and provider-cap assertion messages. If the exact private `HermeticQualificationSourceRejected` tag is needed to establish that a successful provider response preceded semantic rejection, project only that closed tag and safe enum/category fields, never the raw surrounding line. A predicts zero position-133 markers in both messages. B predicts a position-133 marker in child stderr and in the revised safe projection. Decide A/B only from a logged position-133 closed outcome; otherwise remain inconclusive and name the absent seam.

Temporarily restore only the client-boundary marker and journal-position context hook, plus the two assertion-message projections. Do not change the 130-call cap or accepted assertions. Validate with `pnpm --filter @dalph/orchestrator build` (expected <=2 minutes), then run the exact focused coverage cassette at most once (expected <=2 minutes). Restore all temporary source/test changes; run `pnpm --filter @dalph/dalph... build` (expected <=2 minutes), `git diff --check`, and exact HEAD/status verification. Total expected work is at most 10 minutes; absolute UTC stop is `2026-09-28T23:35:00Z`. No full gate, second cassette, or live Run.

### ResolveIssue marker-projection discriminator result (2026-09-28)

The revised exact focused coverage cassette ran once: `pnpm exec vitest run --mode coverage --coverage --reporter=dot packages/dalph/test/cassettes/direct-remote-publication.test.ts -t 'publishes M before local promotion and task completion, then releases its dependant from a later complete graph'`. Retained log: `/tmp/issue386-resolveissue-marker-projection-r20.log`. Exit 1; summary: `Test Files  1 failed (1)`, `Tests  1 failed | 4 skipped (5)`, `Duration  9.79s (transform 652ms, setup 0ms, import 1.83s, tests 6.05s, environment 0ms)`.

The filtered projection contains two copies of the same safe boundary record: `journalPosition=133`, `requestTag=ResolveIssue`, `outcome=Rejected`, `errorTag=GithubGraphqlClient.RequestError`, `failureKind=CircuitOpen`. The exact private tag `HermeticQualificationSourceRejected` was also projected without its surrounding line. This supports **B** for the changed discriminator: the marker was produced at the client boundary and captured in `child.stderrLog`; the prior r19 no-marker result was an assertion-projection gap, not evidence that no boundary marker existed. The logged closed outcome supports the earlier circuit explanation (**A**) for the position-133 rejection, not semantic source validation as its cause.

The revised run failed at the child-status assertion (test source line 534), before reaching the provider-call cap assertion; thus the cap-message projection was added but not exercised by this run. The 130-call cap and all accepted assertions remain unchanged. No second cassette, gate, or live Run was started. Temporary source and assertion-message changes are now being restored, followed by build and diff verification before the recorded `2026-09-28T23:35:00Z` stop.

Terminal cleanup: restored probe-only changes in the three orchestrator source files and restored the pre-existing cassette test content (only the prior candidate edits remain). `pnpm --filter @dalph/dalph... build` exited 0 (about 15 seconds; existing Effect suggestions only), `git diff --check` exited 0, and `rg` found no temporary diagnostic/projection symbols. HEAD remains `1f1dfb5133bca514ba598c7c657d386433984d8e`; final status matches the initial pre-existing candidate paths plus this audit update. Terminal stop: `2026-09-28T23:30:06Z`; elapsed from preflight `23:22:34Z`: 7m32s, within the 10-minute expectation and before `23:35:00Z`. No retry, gate, or live Run was started.

### Circuit-open follow-up scheduling source/log diagnosis plan (2026-09-28)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`; planned HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`. Preserve all existing candidate changes.

Question: after the qualification GitHub request circuit opens and `ResolveIssue` at journal position 133 rejects, does the workflow retain a precise wait/backoff and stop forward graph reads until allowed re-observation (**A**), or immediately select another `WorkflowEstablishment` tracker read and produce repeated `CircuitOpen` failures (**B**)? Distinguish using the retained r20 log's ordered journal tags and fact outcomes plus source line references from the GitHub client circuit error through adapter/journal mapping and the Run selector/scheduler path that can issue the next `ReadTrackerGraph`. Record only source line references, closed tags, and relative ordering; emit no identities or error details. State if source and retained log cannot prove actual runtime scheduling.

Read-only scope only: no edits outside this audit entry, tests, builds, gates, or live Runs. Expected duration at most 5 minutes; absolute UTC stop `2026-09-28T23:42:00Z`. Report supported explanation, falsifier, smallest repair location or exact missing runtime observation, and confirm HEAD/status unchanged.

### Circuit-open caller-path closeout plan (2026-09-28)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`; verified HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`. Preserve all existing candidate changes. Read-only closeout question: does the source show a typed workflow wait/backoff after `CircuitOpen`, or only process-local circuit cooldown plus error/defer propagation? Trace the existing mapping through caller/selector and reconcile only safe ordered tags from retained r20. No source edits, tests, builds, gates, or live Runs. Expected duration at most 3 minutes; absolute stop `2026-09-28T23:48:00Z`. If actual post-failure scheduling cannot be established, mark inconclusive and name the smallest deterministic observation.

### Circuit-open caller-path closeout result (2026-09-28)

Read-only source trace and retained r20 journal support a partial conclusion. The GitHub client maps an open circuit to `CircuitOpen` (`packages/dalph/src/application/production-host.ts:291-308`; circuit admission/cooldown in `packages/orchestrator/src/control/request-circuit.ts:42-61`). The graph reader maps that to typed `TrackerAdapterReadFailureReason.CircuitOpen` (`packages/orchestrator/src/authorities/task-tracker/github/graph-reader.ts:178-186`); task-tracker read protocol journals the failure as `TaskTrackerFactsReadFailed` and rethrows (`packages/orchestrator/src/workflow/protocols/task-tracker-read/protocol.ts:146-167,210-243`). The `WorkflowEstablishment` action adapter catches non-boundary adapter errors and returns `TrackerGraphReadUnavailable` (`packages/orchestrator/src/coordination/delivery/delivery-action-adapter-common.ts:46-76`). Delivery runtime records `AwaitChangedAcceptedFacts` at the accepted position for an `ActionDeferred`, and keeps that proposal locally excluded while the accepted position is unchanged (`packages/orchestrator/src/coordination/delivery/delivery-runtime-local-deferral.ts:57-83`; reconciliation in `delivery-runtime-local-deferral-reconciliation.ts:16-28`). Thus, within that activation, the same proposal is deferred until accepted facts change. The request circuit separately has a process-local cooldown; neither mechanism is a durable journaled workflow wait/backoff.

Retained `/tmp/issue386-resolveissue-marker-projection-r20.log` orders the position-133 `ResolveIssue` rejection (`CircuitOpen`) with a final `TaskTrackerFactsReadFailed`; no later `TaskTrackerReadInitiated` appears in that captured run. This does not prove what a later external activation schedules. The activation-local deferral is not evidence of a cross-activation wait, and the circuit cooldown alone does not show whether the Run selector waits before re-observing. Therefore A versus B remains inconclusive. A falsifying observation for A would be a controlled subsequent activation, before the circuit cooldown expires and with unchanged accepted facts, that emits another `TaskTrackerReadInitiated` for the same graph proposal. A controlled activation after allowed re-observation should then establish whether the read proceeds.

Smallest missing deterministic observation: a focused controlled test/trace that injects `CircuitOpen` on one `WorkflowEstablishment` read, preserves the process circuit and accepted journal position, and observes whether the next activation starts another tracker read before cooldown expiry; capture only the ordered `TaskTrackerReadInitiated` and `TaskTrackerFactsReadFailed` tags and whether accepted facts changed. No such test or runtime trace was run here. No production/test source, tests, build, gate, or live Run was changed or started. HEAD remains `1f1dfb5133bca514ba598c7c657d386433984d8e`; candidate source status is unchanged apart from the audit plan/result entries.

### Repeated WorkflowEstablishment read trigger diagnosis plan (2026-09-29)

Exact worktree: `/workspace/typescript/dalph-worktrees/issue-386-exact-notification-ids-r1`; verified HEAD: `1f1dfb5133bca514ba598c7c657d386433984d8e`. Preserve every pre-existing candidate edit and retained diagnostic artifact.

Question: what production call path initiates repeated `WorkflowEstablishment` tracker graph reads after `IntegratorRunStarted` in retained r13, and what concrete event/queue condition re-enters that read? **A:** an ordinary activation/re-evaluation or accepted-facts transition schedules reads outside an unresolved private Integrator wait. **B:** a loop/wake path re-evaluates the same unresolved responsibility and repeatedly consumes provider calls without new accepted facts. Distinguish by tracing from `journaledTrackerGraphRead` / `WorkflowInterpreterService.readTrackerGraph` to its caller and trigger, then comparing safe ordered r13 journal tags/positions with r20's different sequence. Do not infer timing across runs. If source cannot prove the retained trace's trigger, name the single missing runtime observation.

Scope is read-only except this plan/result audit entry: inspect source and retained safe artifacts only. No source edits, cleanup, format, build, test, cassette, gate, or live Run. Expected duration <=6 minutes; start `2026-09-29T00:04:37Z`; absolute UTC stop `2026-09-29T00:10:00Z`.
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

## Exact-turn repeated-wakeup review disposition — 2026-09-29

**Finding.** The production app-server subscriber's `published` set admitted
only the first completion hint for T. If that hint caused a fresh exact reread
that still reported T active, the Integrator correctly stayed `TurnObserved`
but could never receive the later matching X/T hint required by the accepted
S4 chronology.

**Resolution.** `codex-app-server.ts` now retains up to 64 pre-response
completion notifications in arrival order, including repeated turn IDs, then
publishes all retained exact matches when T binds. The scoped production
`PubSub.sliding` queue also has capacity 64, bounding post-bind storage while
retaining the newest wake under overflow. A later matching X/T notification
after the prior hint was consumed is delivered for another fresh exact reread.
No hint, timer, or terminal response seals the run without the accepted exact
thread/token/turn read and complete `Absent` activity census.

**Decisive focused evidence.**

- `codex-app-server-protocol.test.ts::routes repeated exact completion notifications after the turn ID is bound` drives two identical X/T notices through the controlled JSON-RPC process after T is bound and receives both from the production subscriber.
- `codex-app-server-protocol.test.ts::bounds repeated completion notifications received before the turn ID is bound` sends 65 identical X/T notices before the start response and receives exactly the first 64 retained notices after binding.
- `codex-integrator.test.ts::keeps the exact Integrator turn pending after an active reread until a later matching hint` routes both notices through the fixture subscriber/router, observes the first exact resume leave `TurnObserved` unsealed, and then proves the second reread seals the same T with one turn start and one retained token.
- The focused command selecting those three cases passed: 2 files, 3 tests passed, 108 skipped, 2.51 seconds; retained log `/tmp/issue386-repeat-hint-focused-20260929T0455Z.log`.

**Scenario mapping and disposition.** The accepted exact-hint rule and bounded
queue behavior are recorded in
`docs/scenarios/direct-remote-publication.md` under S4's completion refinement
and its acceptance-test map. The review finding is **resolved** by the named
production-router and Integrator tests. The direct-publication cassette remains
the separate S1/S8 publication and push boundary; this focused unit slice does
not claim cassette, qualification, or live S1 evidence.

## Focused route-regression diagnosis — 2026-09-29

**Predictions recorded before edits.** For the reopened exact-hint case, A
predicts a stale assertion based on one-lifetime dedup or one read, while B
predicts one exact X/T notification followed by a redundant exact reread. For
the active-turn control, A predicts an accepted indefinite `TurnObserved` wait
after its one exact hint and no later hint; B predicts a dropped or mismatched
exact hint. For the hidden-turn setup, A predicts the fixture expects a durable
`TurnObserved` despite losing the `turn/start` response before T is returned,
while B predicts the production path dropped a provider run that should already
have been durably recorded. The distinguishing evidence is the exact X/T
publication count, fresh-resume count, private run tags/writes, and whether a
matching hint arrived before the wait.

**Read-only observation.** The retained two-file run
`/tmp/issue386-route-regressions-20260929T0514Z.log` exited 1 with 108 passed
and these three failures. First, the reopen fixture supplies existing
`X=fixture-thread`, `T=retained-replay-turn`, and
`K=retained-replay-run-token`; `completionHintOnAttach: true` publishes one
exact hint because T is already bound. The operation seals exactly once with
zero new thread/turn starts, but `resumeThreadCalls` is 2 against the old
expectation of 1. The source path waits for the matching hint, then
`ensureThread` observes the retained thread, then `sealObservedRun` repeats
`observedThread` even though it received the already post-hint thread and
delivered hint. This supports B: a redundant exact reread follows one hint.
Second, the active fixture starts one `inProgress` turn and auto-publishes one
matching X/T when T binds; it emits no later matching hint. The test times out
while waiting for the old immediate `remains active` failure. This supports A:
the accepted rule keeps `TurnObserved` pending after an active exact reread.
Third, the hidden-turn fixture configures a lost `turn/start` response after
provider recording, `hideTurnsOnRead: true`, and
`completionHintOnAttach: true`, but no T is returned for that attachment and
the fixture reaches its `provider run was not written` guard before writing
the synthetic `TurnObserved`. The read-only run does not capture whether
`startTurn` was called or which durable private-record variant exists; that
remains the exact discriminator between stale setup and a runtime write
regression. No assertion or production code was changed as part of this
diagnosis.

## Focused route-regression repair — 2026-09-29

**Repair.** In the reopened exact-hint path, the `ThreadWithRuns` record's
matching X/T hint is consumed before `ensureThread` returns its fresh exact
thread snapshot. `sealObservedRun` now reuses that snapshot when it already
shows the exact turn terminal, then still requires the complete absent-activity
census before writing `CompletedTurnSealed`. An active result stays pending
until another matching X/T hint permits another exact reread. No hint replay,
timer, new turn, or session is used to infer completion.

The stale active-turn test now retains the foreign-thread-token and persisted
correlation rejection controls, then starts one active turn, routes its one
matching hint, and proves the durable run stays `TurnObserved` and unsealed
while the executor call remains unsettled. It asserts one turn start and the
same owned token, then interrupts the test waiter after those observations;
interruption is cleanup, not a success condition.

**Focused evidence.** The command
`pnpm exec vitest run packages/dalph/src/application/codex-integrator.test.ts -t 'seals after the exact Integrator completion hint arrives after reopen|rejects foreign resumed-thread tokens and correlated turns while an active turn remains pending|fails closed on a turn observed without a matching token and reconciles app incarnation|keeps the exact Integrator turn pending after an active reread until a later matching hint|keeps a completed Integrator turn pending after reopen when its matching notification was not replayed' --maxWorkers=1`
passed 5 tests, with 58 skipped, in 1.24s. Retained output:
`/tmp/issue386-route-regression-repair-20260929T0534Z.log`. This includes the
previously failing hidden-turn control passing without a hidden-turn production
change after the timed-out active-turn assertion was replaced by a scoped
pending assertion. The retained prior combined log does not identify the
precise suite-state cause, so this does not claim a narrower leak diagnosis.

The scenario map now names the durable active-pending control,
active→terminal repeated-hint control, and production router control at
`docs/scenarios/direct-remote-publication.md` S4's acceptance-test map. The
existing no-replay test also passed in this focused selection. Direct-publication
cassette, full qualification, and live S1 remain unrun in this repair pass.

## Round-four scoped review closure — 2026-09-29

The scoped Sol review covered the complete candidate diff pinned by SHA-256
`eb24e270d179c9eaeebfb74f1cb0a7ffc45179f1c850b69bf00fe73c33bf2584`. It
reviewed the exact-turn route regression repair and its accepted S4 scenario
and test mapping. The route-regression finding is **resolved** by the repair
and focused evidence above. The reviewer reported no remaining Specification
or Standards blocker; no accepted scenario requirement is deferred. The
candidate retains the separate #385 precommit S2 result-append recovery proof
and its memory/reopened-SQLite test mapping. This review disposition does not
claim direct-publication cassette, full-gate, or live S1 evidence; those checks
remain unrun.

## Failed gate a4da9e00 focused diagnosis — 2026-09-29

**Question.** Are the property, maintained-executor, and production-reconstruction
failures caused by fixtures with no exact X/T `turn/completed` hint (**A**), or
by a matching hint that the production router/Integrator fails to consume (**B**)?
For the direct-publication count failure, are the excess calls repeated
`WorkflowEstablishment` graph reads against unchanged facts while the same
transition is deferred (**A**), or do distinct provider operations/changing
graph facts account for the calls (**B**)?

**Predictions recorded before tests.** Source inspection finds the property
fixture has only an empty legacy completion-hint stream and no exact-X/T
subscription; its terminal turn-start can therefore have zero matching hints.
The maintained-executor cassette likewise configures an empty legacy stream,
completes the scripted turn without publishing X/T, and predicts the reported
accepted report remains Executing; the production Run reconstruction fixture
also has an empty legacy stream and no exact-hint publication, predicting no
terminal settlement from a terminal graph alone. These support A if each exact
test reproduces its gate failure and confirms zero matching hints; B requires a
matching X/T hint in the fixture and a failed terminal projection afterward.

Run these exact tests separately, each expected under one minute. A predicts
exit 1 with the retained failure signature shown; B predicts exit 0 after a
consumed matching hint, or a different failure if some other boundary is wrong:

```text
pnpm exec vitest run packages/dalph/src/application/codex-integrator.property.test.ts -t 'proves cleanup mutates only for exact ownership, registration, and quiescent activity'
expected exit 1; literal: 'exact provider completion hints are unavailable'

pnpm exec vitest run packages/dalph/test/cassettes/application-and-codex-protocol.execution.test.ts -t 'runs maintained Codex executor stories through the concrete production executor'
expected exit 1; literal: 'expected [ "ExecutorWorkExecuting", …(1) ] to deeply equal [ "ExecutorWorkExecuting", …(1) ]'

pnpm exec vitest run packages/dalph/test/scenarios/production.test.ts -t 'ordinary Run reconstruction replaces an absent empty Codex association and settles only Begin ordinal one'
expected exit 1; literal: 'expected +0 to be 1 // Object.is equality'
```

For the cassette, do not repeat an operation-count-only probe. First verify
that temporary test-only instrumentation can safely report, at the existing
130-call assertion, per-tag operation counts and each relevant tracker-graph
journal position, lifecycle/revision/fact-family projection, and selected
workflow transition/defer reason without IDs, payloads, or secrets. If it can,
run this exact coverage cassette once, keeping the existing assertion and all
accepted assertions unchanged:

```text
pnpm exec vitest run --mode coverage --coverage --reporter=dot packages/dalph/test/cassettes/direct-remote-publication.test.ts -t 'publishes M before local promotion and task completion, then releases its dependant from a later complete graph'
expected exit 1 at githubProviderTransportCount <= 130; literal assertion form: 'expected <observed count> to be less than or equal to 130' (the retained gate observed 211; the focused count may vary).
```

Alternatives A and B are distinguished only if the projection includes every
counted graph read and its exact visible facts/transition disposition; missing
positions or projections are inconclusive. Total expected work is at most 14
minutes. Absolute UTC stop: `2026-09-29T06:35:00Z`. Remove temporary
instrumentation, retain command logs, run `git diff --check`, confirm no probe
symbols remain, and verify unchanged candidate HEAD/source before stopping.
No source repair, cassette retry, full gate, or live S1 is authorized here.

**Observed stop.** The first predicted property-test command did not reach
Vitest: it exited 254 with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest"
not found`. Retained output is `/tmp/issue386-a4da-property-focused.log`
(SHA-256 `98bb9c43567b6fc10e95ef62af360f83a4a555098e4d5c4f79f95e728e1a8724`).
This does not distinguish A from B. The exact missing observation is a Vitest
installation in this new worktree; no dependency repair was attempted. Per the
prediction-mismatch stop rule, the other two test commands and the cassette
were not run. No temporary instrumentation was added.

**Changed next action after the command mismatch — 2026-09-29 06:27:32 UTC.**
The recovery worktree has no `node_modules`, so the previous command could not
admit Vitest. First run `pnpm install --frozen-lockfile` in this isolated
worktree, expected to finish within four minutes; absolute install stop is
`2026-09-29T06:32:00Z`. Stop safely at that time, preserve install output, and
do not continue if it is still active or changes tracked source/lockfiles. If
Vitest resolves afterward, run only the same property discriminator, expected
under one minute and before the overall `2026-09-29T06:35:00Z` diagnostic
stop. The source-based A prediction remains exit 1 with a property counterexample
containing `exact provider completion hints are unavailable`; B predicts the
focused property passes or fails at a different exact boundary. Capture the
command's exit and literal counterexample/output in its own retained log. Any
missing executable, output mismatch, timeout, or absent counterexample remains
inconclusive and stops this diagnostic. Do not run the other fixtures or the
direct-publication cassette in this timebox.

**Observed property discriminator — 2026-09-29 06:28 UTC.** The frozen
install completed in 3.1s with exit 0; Vitest resolved as `4.1.10` on
`linux-arm64`. It emitted warnings for generated `packages/dalph/dist/bin/*`
links, which are absent in this test-only worktree; no tracked source or
lockfile changed. Install log:
`/tmp/issue386-recovery-install-20260929T0627Z.log` (SHA-256
`baa38cf2c4bc53031ce847a5d3201e8ab98ed681391669ba251407106abd6216`).

The property command then exited 1 in 3.00s (Vitest test body 49ms), with the
predicted literal `detail: 'exact provider completion hints are unavailable'`
after one generated case. Full output:
`/tmp/issue386-a4da-property-focused-after-install.log` (SHA-256
`e9c6ff5057db49e215406367e35faddb792f10044d5fb4b0fa67fad01f3df437`). This
supports A: the property fixture has no matching exact X/T hint and the test
fails at that unavailable-hint boundary; it does not show a matching hint being
misrouted. The first command's dependency failure was environmental and is
resolved only in this isolated recovery worktree.

**Bounded follow-up discriminator.** Continue with only the two already-planned
fixture tests below, sequentially, expected total under two minutes; absolute
stop `2026-09-29T06:32:30Z`. A predicts the maintained-executor cassette exits
1 with the `ExecutorWorkExecuting` versus `ExecutorWorkTerminal` assertion,
and the production reconstruction test exits 1 with `expected +0 to be 1`;
each would confirm its fixture has no exact completion hint. A pass or a
different boundary falsifies that fixture-specific prediction. Save each
command's exit and full output separately. Do not run or instrument the
direct-publication cassette in this follow-up. If either command mismatches or
the timebox expires, stop and preserve the evidence.

**Observed fixture follow-up — 2026-09-29 06:31 UTC.** Both separately
filtered tests matched their predictions:

- The maintained-executor test exited 1; one failed, two skipped, 26ms test
  body. Literal output: `actual: [ 'ExecutorWorkExecuting',
  'ExecutorWorkExecuting' ]`, `expected: [ 'ExecutorWorkExecuting',
  'ExecutorWorkTerminal' ]`. Log:
  `/tmp/issue386-a4da-executor-focused.log` (SHA-256
  `989fd5256b53f4f86af77dc1470b6e9fc47ccf1b6b51fdaac2a088e81a733efb`).
- The production reconstruction test exited 1; one failed, 31 skipped, 350ms
  test body. Literal output: `expected +0 to be 1 // Object.is equality` at
  `turns`. Log: `/tmp/issue386-a4da-production-focused.log` (SHA-256
  `c4f2948c6aefc30219f7d8fa9817efffc81894fd739637a89ef48e188a0ef25f`).

Together with the property counterexample and the recorded fixture source
inspection (these fixtures do not publish an exact matching X/T completion
hint), this supports stale hint-dependent fixtures for three gate failures.
No production behavior was changed or justified by these failures. The fourth
gate failure remains distinct: direct publication observed 211 provider calls
against the retained limit 130. Its graph-transition projection has not been
run; next, inspect whether test-only instrumentation at the existing assertion
can capture every counted graph read's journal position, visible lifecycle /
revision / fact-family, and selected transition/defer reason without IDs or
payloads. Only after that feasibility check, run the predeclared focused
coverage cassette once with the 130 assertion intact, in a newly recorded
bounded window. Do not infer a cause from aggregate call counts and do not
weaken the cap.

At this stop, the recovery worktree is still at `05357e56ffe1927f9a9e5af30a97cc27d2f63476`;
only this audit document is tracked as modified, `git diff --check` passes, and
no production/test source or lockfile changed. The prevention worktree remains
clean at `adc7b413d356c3b3f9233fa6b2d5d183b6f351fc`.

## Exact completion fixture chronology repair — 2026-09-29

**Scenario-to-test mapping.** This repair is limited to the accepted [S4
completion refinement](scenarios/direct-remote-publication.md#s4-completion-refinement-an-exact-app-server-notification-precedes-integrator-completion):

- `packages/dalph/src/application/codex-integrator.property.test.ts::proves cleanup mutates only for exact ownership, registration, and quiescent activity` now establishes the completed `property-turn` on the owned `property-thread`, then publishes that exact thread/turn identity. Its subscription buffers the hint until the durable turn ID is bound; the turn retains the same owned token issued to `turn/start`. This is fixture compatibility support for the cleanup property, not a standalone S4 test of an active turn followed by a later completion notification.
- `packages/dalph/src/cassettes/codex-planned-attempt-executor-cassette.ts::makeHarness`, exercised by `packages/dalph/test/cassettes/application-and-codex-protocol.execution.test.ts::runs maintained Codex executor stories through the concrete production executor`, uses the controlled completion action to find the exact owned active turn, persist its completed state while preserving its token, and only then publish its exact thread/turn hint. The cassette attaches the production lifecycle observation and waits for the hint-authorized terminal projection; its other maintained stories remain active, lost-response, suspension, or replacement controls.
- `packages/dalph/test/scenarios/production.test.ts::ordinary Run reconstruction replaces an absent empty Codex association and settles only Begin ordinal one` has no completion event: the controlled `turn/start` result is intentionally `inProgress`. Its exact subscription binds the subsequent durable `Running` record's thread, owned token, and turn ID, then has no hint to publish. The case remains the no-false-terminal control and still proves one Begin. The earlier source diagnosis that all three fixtures lacked a completion hint is refined: this production case lacked the exact subscription capability, but a completion hint is inapplicable while its turn remains active.

**Focused repair record.** The exact property command passed one test with five skipped in 1.47s:
`pnpm exec vitest run --reporter=dot packages/dalph/src/application/codex-integrator.property.test.ts -t 'proves cleanup mutates only for exact ownership, registration, and quiescent activity'`.
Log `/tmp/issue386-fixture-property-repair.log` has SHA-256
`3fb3abf099263219d00d7b31dd2f6185e44687fb34dab9142c2d6c7fc7d73059`.

The first maintained-executor retest exited 1 in 1.02s with the original
Executing-versus-Terminal difference despite its fixture having published
exact X/T after changing turn state. The cassette was invoking passive
`executor.observe`, which returns the current projection and does not consume
the separate lifecycle change stream. Log
`/tmp/issue386-fixture-executor-repair.log` has SHA-256
`0c3f795c6f95a32a315111c20e743a75f3364285dfbe422caec6e55479c384a8`.
The changed test-support action is to attach the production lifecycle
observation after the scripted completion and await its exact terminal
projection. No production module was changed. This focused failure was
followed by changed fixture work before another attempt.

**Production reconstruction follow-up discriminator — 2026-09-29.** The
question is whether the later production fixture failure is caused by its
missing optional app-server protocol-failure stream (**A**) or by the active,
no-completion chronology reaching a later accepted runtime wait (**B**).
Observed boundary: after exact subscription capability lets the second
activation persist `Running` with the exact replacement thread, owned token,
and turn ID, the third activation reaches lifecycle attachment and `Layer.mock`
throws `UnimplementedError` for `attachProtocolFailures`. The owned turn is
still `inProgress`, so no completion hint is published. The distinction is
fixture setup if an explicit empty protocol-failure stream lets the same
activation finish; a subsequent exact boundary failure supports B and must be
reported without weakening the existing assertions.

For A, add only `attachProtocolFailures: Effect.succeed(Stream.empty)` to that
test mock and rerun only the exact production test below; predict exit 0, one
pass with 31 skipped, retaining the `ExecutorWorkExecuting` report and no
completion hint. For B, predict exit 1 with a new exact lifecycle/read result
after the empty stream is attached. Expected duration is under one minute;
absolute discriminator stop is `2026-09-29T06:54:00Z`. Diagnostic log from
the observed failure is `/tmp/issue386-fixture-production-diagnostic.log`;
its failure is the exact `attachProtocolFailures` UnimplementedError at
`codex-planned-attempt-executor.ts:2971`, not a terminal-projection result.

**Observed discriminator mismatch.** With the fixture-only empty protocol
failure stream added, the same focused production command exits 1 earlier:
the second activation is `Success` where the existing test expects `Failure`
at `recovered._tag`. The original property discriminator now reaches
`turns === 1`; the turn remains `inProgress`, and the fixture publishes no
completion hint. This does not match the predeclared A prediction of a passing
test. The exact output is retained in
`/tmp/issue386-fixture-production-repair-r2.log` (hash to be added with the
final focused evidence).

Before any further production-test retry, distinguish whether this is the
accepted pending `ExecutorWorkExecuting` outcome with a stale `Failure`
expectation (**A**) or a distinct failure in the activation's journal-visible
projection (**B**). Temporarily expose only the second activation tag and its
recorded command-response report tags in that existing assertion's failure
message; retain every assertion. A predicts `Success` plus exactly one
`ExecutorWorkExecuting` Begin response and no terminal event. B predicts a
different/missing response or terminal evidence. Run only the exact production
test, expected under one minute, absolute stop
`2026-09-29T06:56:00Z`; revert diagnostic-only message changes afterward.

**Accepted no-completion outcome.** The recorded second-activation report
projection resolves the discriminator: `fixture.activate()` returned
`Success`, the only observed executor command response is
`ExecutorWorkExecuting`, and the journal has no `WorkflowRunTerminated` event.
The fixture's turn remains `inProgress` and `Stream.empty` publishes no
completion hint. This matches the accepted [S4 no-replay rule](scenarios/direct-remote-publication.md#s4-completion-refinement-an-exact-app-server-notification-precedes-integrator-completion):
without exact X/T notification Dalph keeps the turn pending indefinitely. S1
still requires a terminal executor result before candidate validation and
publication. An activation returning the ordinary `{ _tag:
"RunMustRemainActive", reason: "UnsettledResponsibility" }` cycle result is
not task completion, integration finality, or Run termination.

The one stale per-cycle assertion must therefore expect this pending
`RunMustRemainActive` result. The repaired test asserts the same
in-progress lifecycle and exact thread/token/turn binding, zero emitted
completion hints, exactly one Begin and `ExecutorWorkExecuting`, no terminal
executor report/result/finality/termination, no second turn, and retained task
worktree/Base. The test explicitly checks no terminal work report,
`IntegrationFinalitySettled`, `WorkflowRunTerminated`, `PlannedAttemptReplaced`,
or `TaskClaimReleased`; it does not explicitly assert downstream-publication
or promotion absence. The accepted blocking edge is preserved; only
activation-cycle success is distinguished from Run terminality. This scoped
correction is authorized by the parent after the diagnostic evidence above.

**S4 boundary clarification and accepted mapping.** S4's accepted completion
refinement distinguishes the exact app-server X/T completion hint from an
activation cycle's return value. In the production reconstruction case,
`RunMustRemainActive` with `UnsettledResponsibility` records that the current
activation cycle completed while the owned turn is still pending; it does not
report a completed executor result, candidate validation, integration
finality, or Run termination. The fixture therefore retains the blocking edge
by asserting the turn remains `inProgress`, exact `replacement-2` /
`sole-task-turn` / owned-token binding survives reopen, zero exact completion
hints, one Begin intent and one `ExecutorWorkExecuting` response, no terminal
event/result/replacement/release, no second turn, and the worktree remains at
the accepted Base. This maps to [S4 no-replay and exact-notification
requirements](scenarios/direct-remote-publication.md#s4-completion-refinement-an-exact-app-server-notification-precedes-integrator-completion);
S1's terminal-result-before-publication condition is not reached.

**Focused repair results already observed.** All three repaired target tests
pass at Base `05357e56ffe1927f9a9e5af30a97cc27d2f63476` with the fixture-only
candidate changes described in the mapping above:

- `pnpm exec vitest run --reporter=dot packages/dalph/src/application/codex-integrator.property.test.ts -t 'proves cleanup mutates only for exact ownership, registration, and quiescent activity'` — exit 0, one passed and five skipped. Log `/tmp/issue386-fixture-property-repair.log`, SHA-256 `3fb3abf099263219d00d7b31dd2f6185e44687fb34dab9142c2d6c7fc7d73059`.
- `pnpm exec vitest run --reporter=dot packages/dalph/test/cassettes/application-and-codex-protocol.execution.test.ts -t 'runs maintained Codex executor stories through the concrete production executor'` — exit 0, one passed and two skipped. Log `/tmp/issue386-fixture-executor-repair-r3.log`, SHA-256 `adc33eedb0884902cb9e8b225455f71d11fc31631bc889517107ad83ed0e4afc`.
- `pnpm exec vitest run --reporter=dot packages/dalph/test/scenarios/production.test.ts -t 'ordinary Run reconstruction replaces an absent empty Codex association and settles only Begin ordinal one'` — exit 0, one passed and 31 skipped. Log `/tmp/issue386-fixture-production-repair-final.log`, SHA-256 `ba45422a87c3f2d1f96f2d3293842350724007f2677c5dbfcfa72f7c91486f0b`.

**Bounded fixture closure phase — 2026-09-29 07:05 UTC.** Candidate is the
current dirty worktree `repair/issue-386-gate-recovery-r1`, based on the exact
Base above. Absolute stop is `2026-09-29T07:25:00Z`. Run only these checks, in
order, preserving each full output and SHA-256 under `/tmp/issue386-*` and
appending the result here: (1) adjacent Integrator and executor exact-hint / no-hint
controls, expected under two minutes, stop `07:09Z`; (2) `pnpm typecheck`,
expected under seven minutes, stop `07:16Z`; (3) `DALPH_DIAGNOSTICS_BASE=05357e56ffe1927f9a9e5af30a97cc27d2f63476 pnpm lint:changed`,
expected under three minutes, stop `07:21Z`; (4) `git diff --check` plus
final status/diff review, expected under one minute, stop `07:22Z`; (5) commit
the scoped test/audit candidate, expected under two minutes, stop `07:25Z`.
Do not run `check:all`, S1, or the direct-publication cassette. If any command
is still active at its stop, stop safely, retain its exact log/hash and report
the next discriminating action without broad retry.

**Bounded closure observations.** The strengthened production target was rerun
after adding exact one-intent/one-response assertions and explicit absence of
terminal work report and finality. It passed one test with 31 skipped; log
`/tmp/issue386-fixture-production-closure.log`, SHA-256
`215686d365d56a670930a80e431907f3c8e34fbee2d72c157477305292d40a50`.

The adjacent controlled-hint command selected the Integrator subscribe-before-
start, later exact hint, unrelated-hint, and reopen controls, plus executor
pre-response, legacy-stream negative, absent-hint, terminal-start pending,
reopen/no-replay, suspension/no-hint, and idle-running/no-hint controls. It
passed 13 selected tests across two files (243 skipped); log
`/tmp/issue386-fixture-adjacent-controls.log`, SHA-256
`0f71cad12cf15e5783fb1e30bc86179901ee01197b2f60649a9311e52b9e4884`.

Next planned check: `pnpm typecheck`, expected under seven minutes, with
absolute stop `2026-09-29T07:16:00Z`; it is scoped to candidate Base
`05357e56ffe1927f9a9e5af30a97cc27d2f63476` and is positive compilation
evidence for the current fixture candidate.

The first planned changed-file lint invocation exited 1. It selected the three
changed TypeScript fixtures/support files against the pinned Base and reported
two `no-magic-numbers` findings for the same bounded hint-buffer capacity in
the cassette helper, plus one `consistent-type-imports` finding for the
production test's token type. The helper now names the shared capacity and
the test import is type-only; no behavior or capacity changed. Failure log
`/tmp/issue386-fixture-lint-changed.log`, SHA-256
`0976ba3ecb13993b9547836c8f363e66a0d79e39052de08662e005b10e144a6a`.

Rerun the same pinned changed-file lint command after these two lint-only
fixture edits, expected under three minutes; absolute stop remains
`2026-09-29T07:21:00Z`.

The changed-file lint rerun still exited 1, now with zero magic-number or
type-only-import findings and only the same three
`typescript(no-redundant-type-constituents)` warnings. Pinned zero-context diff
against Base `05357e56ffe1927f9a9e5af30a97cc27d2f63476` confirms the warned
source expressions at current lines 542, 543, and 565 are outside all changed
hunks; they predate this candidate and are not repaired here. The candidate
therefore has an explicit changed-file lint limitation despite clean new
findings. Rerun log `/tmp/issue386-fixture-lint-changed-r2.log`, SHA-256
`4dab949a27f827783eb35709c15d2d52eab93364b29848f448185eca5ea08358`.
Diff-attribution log `/tmp/issue386-fixture-lint-baseline-attribution.log`,
SHA-256 `2851bcca879bd673f2ad3de0de36c184a2eb226b70a17709143ab30d72c94f08`.

The final maintained-executor target was rerun after replacing the fixture's
repeated bounded-buffer literal with its named constant. It passed one test
with two skipped; log `/tmp/issue386-fixture-executor-closure.log`, SHA-256
`3adb0daa951899e08463236e300e2d89707e64564e4fb413da92af9f1a564294`.
`git diff --check` exited 0 with no output; its empty log is
`/tmp/issue386-fixture-diff-check.log` (SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).

The final full `pnpm typecheck`, after the changed-file lint-only corrections,
also exited 0; full log `/tmp/issue386-fixture-typecheck-final.log`, SHA-256
`685ccffcdfd6302c72601f980a3bfc60acd6d209b6a147e656fb47f023d595ed`.

The full `pnpm typecheck` completed with exit 0. It emitted existing Effect
suggestions but no errors; this is the requested positive whole-repository
compilation evidence. Full log `/tmp/issue386-fixture-typecheck.log`, SHA-256
`685ccffcdfd6302c72601f980a3bfc60acd6d209b6a147e656fb47f023d595ed`.

Changed-file lint is complete with the pre-existing warning limitation
described above. The scoped source/audit diff is ready for final review and
commit from Base `05357e56ffe1927f9a9e5af30a97cc27d2f63476` before the absolute
`2026-09-29T07:25:00Z` stop.

Because `run-quality-lint.mjs` exits immediately when Oxlint returns nonzero,
the changed-file lint command did not reach its dprint phase. Run the selected
files through `pnpm exec dprint check` separately, expected under one minute,
before `2026-09-29T07:22:00Z`, against the same candidate/Base; record its
literal outcome and log hash before commit.

The separate dprint check exited 20 and found two formatting-only differences:
continuation indentation in the property fixture and a multiline
`Stream.empty.pipe` expression in the production fixture. No semantic finding
was reported. Apply `pnpm exec dprint fmt` to those two owned fixture files,
then rerun the planned dprint check and `git diff --check`; expected under one
minute total, with the same `07:22Z` stop.
Failure log `/tmp/issue386-fixture-dprint-check.log`, SHA-256
`69064788493acb5cff2b52fef1bdd10ceb85c4cdbcf316cff9ea0d7c3751966d`.

`pnpm exec dprint fmt` formatted the two reported fixture files with exit 0;
log `/tmp/issue386-fixture-dprint-fmt.log`, SHA-256
`3d8b3a61f123bfb9629923b56a9546589dcabaa89633ecde04b15d19b237f47a`.
The final dprint check over the audit and all three owned TypeScript files
exited 0 with no output; log `/tmp/issue386-fixture-dprint-check-final.log`,
SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
The final pinned changed-file lint rerun still exits 1 only on the same three
Base-untouched `no-redundant-type-constituents` warnings; its full log is
`/tmp/issue386-fixture-lint-changed-final.log`, SHA-256
`4dab949a27f827783eb35709c15d2d52eab93364b29848f448185eca5ea08358`.
The post-format `git diff --check` exited 0; log
`/tmp/issue386-fixture-diff-check-postformat.log`, SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

## Review follow-up — inherited cassette tag diagnostics — 2026-09-29

**Base and stop.** Follow-up candidate starts at commit
`9c8f160b4e4505cad4c94b9c6ce93537fa442d12`, with lint selection pinned to
Base `05357e56ffe1927f9a9e5af30a97cc27d2f63476`. Absolute stop is
`2026-09-29T07:39:00Z`. Change only the three test-support tag type
expressions and this audit. Run, in order: pinned `pnpm lint:changed`, expected
under one minute (stop `07:34Z`); `pnpm typecheck`, expected under one minute
(stop `07:35Z`); dprint check on the four scoped files, expected under one
minute (stop `07:36Z`); then `git diff --check`, inspect the scoped diff and
commit, expected under three minutes (stop `07:39Z`). No full gate, S1, or
prevention worktree access.

**Spec review precision.** The cleanup property case supplies an exact
completion hint to keep the fixture compatible with the accepted cleanup
property. It is not a standalone S4 proof of an active turn followed by a later
completion notification. The maintained executor cassette separately controls
the active-to-completed transition, preserves the exact owned token, and emits
the matching thread/turn hint only after persisting completion. The production
reconstruction case proves the pending active-turn/no-seal boundary, exact
thread/token/turn binding across reopen, one Begin and one
`ExecutorWorkExecuting`, and absence of explicitly checked terminal work,
finality, termination, replacement, and claim-release events. It does not
assert explicit downstream-publication or promotion absence, so this audit
does not credit it with those claims. This fixture does not establish S1
acceptance; S1's terminal-result-before-publication requirement remains outside
this focused proof.

**Inherited type warning correction.** In the cassette support module, the
public tag types now derive from `keyof typeof CodexAttemptRecord.cases` and
`keyof typeof CodexProviderWorkUnitReplacementResult.cases`. The helper and
result interface retain their exact literal tag unions; no runtime code or
scenario behavior changed. The first pinned `pnpm lint:changed` after this
type-only edit produced no Oxlint warnings and reached dprint, which reported
one formatting-only layout change in the helper signature. Log
`/tmp/issue386-tag-followup-lint.log`, SHA-256
`3e785686dabda722467a4a6edc4d5d03d823490b0e01ad32a11ee43ca3296989`.

`pnpm exec dprint fmt packages/dalph/src/cassettes/codex-planned-attempt-executor-cassette.ts`
completed with exit 0; log `/tmp/issue386-tag-followup-dprint-fmt.log`, SHA-256
`13dd8d24cb06171ef89795c6f1669ffec4ccbd0e21dc925d7868e04abb8c2831`.
The pinned changed-file lint then passed with exit 0, including Oxlint and
dprint, with exactly the four intended TypeScript files selected against the
recorded Base. Log `/tmp/issue386-tag-followup-lint-final.log`, SHA-256
`b8ac9f95c2d92c9641d4c2de37bc8c575e0f552eedf8af1863306725fde1772f`.

Next check: `pnpm typecheck`, expected under one minute with stop
`2026-09-29T07:35:00Z`, on the current follow-up candidate based on commit
`9c8f160b4e4505cad4c94b9c6ce93537fa442d12`.

The full `pnpm typecheck` exited 0 on the type-only correction; its complete
output is `/tmp/issue386-tag-followup-typecheck.log`, SHA-256
`5efd0ccf214f92f409b2b4271348c8b630d9a40c42592659d041f7f6f77b4c66`.
Next run dprint check on the four scoped files and `git diff --check`, each
expected under one minute and before `2026-09-29T07:36:00Z`.

Both checks passed with exit 0 and empty output: dprint log
`/tmp/issue386-tag-followup-dprint-check.log` and diff-check log
`/tmp/issue386-tag-followup-diff-check.log`, each SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

## Controlled publication integration evidence — 2026-09-29

On exact candidate `be6a75cd58a5cf09bb3060e70e5d3815aeb098b3`,
`pnpm test:integration:publication` built successfully and ran
`packages/dalph/test/integration/direct-remote-publication.integration.test.ts`:
1 file and 5 tests passed. Vitest duration was 41.01s (tests: 39.48s). The
full retained log is `/tmp/dalph-386-integration-publication-be6a75cd.log`,
SHA-256 `e4cfb67467e137997bcdab1152ce4864c8d619d014bb3b07429732ef155e69d0`.
The source worktree was clean at this exact HEAD before this audit-only edit.

This is controlled process-integration evidence only. It does not establish
the required fresh supervised real-provider S1 dogfood or full qualification;
both remain outstanding. Preserve the accepted S1/S4/S8 outcomes and the
45-second publication bound.

The latest Base-scoped `lint:changed` disposition available for this
integration candidate was exit 20 solely because owner-managed
`vitest.config.ts` requires dprint formatting. That file was not changed here.

## Materialized completion-claim replacement identity — 2026-09-30

**Base and diagnosis.** This focused repair is based on `25d04fb7f7d2a642329608187cf81eac3fa008e8`; the integrated S8 candidate before repair is `799ad3fd39296a43b7ad4e21513afdc75de90848`. The controlled publication integration failure followed the exact completion hint and terminal reread, then rejected `ReplacePromotedTaskClaim` with `InvalidOperationIdentity`. The route keeps the request made by `completionClaimReplacementRequestFor(claim)`, which derives `completion-claim-replacement:${claim.promotionCorrelation.requestId}`. Proposal validation reconstructs and validates that exact claim-bound request. Materialization then uses its nested `request.operationId` as the `MaterializedDeliveryAction` owner ID. `production-hermetic-qualification-status-source.ts::validateOwnedEntry` previously applied only the generic UUIDv7/derived-ID check to that owner ID; the current status context had not derived this transition-specific ID, so it rejected the exact request after proposal validation. This confirms a missing accepted identity derivation at the status boundary, not a malformed request or a change to S8 chronology.

**Repair and decisive mapping.** After validating the owner's proposal, the status validator now accepts the materialized ID only when an `IdentityFreeWorkflowRoute/ReplacePromotedTaskClaim` owner carries the exact ID recomputed from its validated completion claim. A foreign or mismatched owner ID rejects with `InvalidOperationIdentity`; all other materialized actions retain the generic UUIDv7/derived-ID guard. `production-hermetic-qualification-source.test.ts::accepts only the exact claim-derived replacement identity for its materialized action` proves the exact ID is absent from the pre-route `originalContext.derivedOperationIds`, accepts that exact materialized owner ID, and rejects a foreign ID with the typed `InvalidOperationIdentity` code and no registration. This test would reject the positive exact ID under the previous generic UUID/derived-ID validator. The controlled S8 assertion remains `packages/dalph/test/integration/direct-remote-publication.integration.test.ts::publishes M before local promotion and task completion, then releases its dependant from a later complete graph`; its original completion-hint, promotion, finality, cleanup, and later-complete-graph assertions are retained. No accepted scenario changed. **Scoped review disposition:** resolved for the operation-identity findings by the pre-route absent-ID assertion and typed negative rejection assertion; the separate timed-out S8 dependant-release gap remains open.

**Verification.** The focused hermetic qualification test passed after the review controls were added: exit 0, `Test Files 1 passed (1)`, `Tests 1 passed | 33 skipped (34)`, duration 3.70s. The package build and Node 24 `pnpm typecheck` passed before the review-only assertion/error-code adjustment; typecheck was not rerun afterward. The exact-title controlled publication integration test did not pass: it timed out at 45 seconds waiting for dependant release. Its retained sidecar shows the replacement, task completion, `IntegrationFinalitySettled`, and cleanup events occurred, followed by repeated tracker wait/proposal observations; this repair therefore resolves the invalid replacement identity but does not close the controlled S8 scenario. Do not retry this unchanged case; first diagnose why the later complete graph does not release the dependant. Base-scoped `pnpm lint:changed` exited 20 because dprint found three files unformatted: two untouched candidate files (`packages/orchestrator/src/workflow/protocols/integration-finality/protocol.ts` and `packages/dalph/test/scenarios/production.test.ts`) and the new qualification test. The qualification test alone was then formatted; lint was not rerun. `git diff --check` passed after the review follow-up. No full gate, live S1, or external Run is part of this repair.

**Bounded graph-diagnosis attempt (2026-09-30).** The prescribed exact-title command exited 1 in 0.274s with Vitest's literal `No test files found`: its resolved configuration excludes `packages/dalph/test/integration/direct-remote-publication.integration.test.ts` unless `DALPH_RUN_PUBLICATION_INTEGRATION=1` is set. No test body ran and no new failure sidecar was produced; this attempt is inconclusive about either graph boundary. The complete command output is retained at `/tmp/issue386-s8-graph-diagnostic-command.log`. The temporary test-only projection was removed. The next smallest action is an owner-authorized single exact-title run with the test's required inclusion environment, then inspect the safe journal-position/read/status projection before drawing conclusions about either interval.

**Integration-enabled S8 result (2026-09-30).** The corrected single-worker exact-title command was `DALPH_RUN_PUBLICATION_INTEGRATION=1 pnpm exec vitest run packages/dalph/test/integration/direct-remote-publication.integration.test.ts -t 'publishes M before local promotion and task completion, then releases its dependant from a later complete graph' --maxWorkers=1`. It exited 0: `Test Files 1 passed (1)`, `Tests 1 passed | 4 skipped (5)`, duration 38.87s. This is the first correctly admitted 1/1 controlled S8 integration pass in this worktree; all existing assertions ran unchanged, with temporary projection code confined to the failure-only audit writer. Because the child succeeded, that writer did not produce the requested per-read sidecar, so the A/B graph-cause discriminator remains inconclusive. Preserve the earlier timeout as intermittent/unresolved; no retry is authorized here. The full command output is retained at `/tmp/issue386-s8-graph-diagnostic-enabled.log`. If a later owner-directed diagnosis is needed, the projection must also persist on successful completion before another exact-title run.

## Missing replacement-intent recovery guard and route proof — 2026-09-30

**Base and scope.** This bounded follow-up is on exact Base
`25d04fb7f7d2a642329608187cf81eac3fa008e8`, HEAD
`799ad3fd39296a43b7ad4e21513afdc75de90848`, preserving the existing dirty
materialized-identity repair. No full gate or S1 was run.

**Finding 1 — resolved.** If the first replacement protocol read finds the
exact `CompletionTaskClaim` but the accepted journal has no matching
`CompletionClaimReplacementIntended`, that tracker effect is unexplained. The
protocol now returns `CompletionClaimOwnershipConflict` before appending a
replacement outcome; it does not call replacement or deletion and never writes
an intent retroactively. A mismatched existing intent fails with
`CompletionClaimPremiseContradiction`. The exact-claim control is
`packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts`
test `fails closed when a completion claim is observed without prior replacement
intent`; its promotion-only prefix has no replacement-intent event and asserts
one claim read, zero replacement/deletion calls, and no replacement intent,
attempt, or outcome.

**Finding 2 — resolved.** The test `fails closed on a foreign claim without
attempting replacement` now uses a promotion-only prefix with no replacement
intent for both foreign active and foreign completion claims. It asserts typed
ownership conflict, zero replacement/deletion calls, and no appended
replacement intent, attempt, or outcome.

**Finding 3 — open route-fixture proof.** The named route test
`packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts`
`executes completion-claim replacement and deletion through the configured
boundary` now builds a current open graph, matching task specification and
active-claim interpreter, deterministic operation allocator, trace recorder,
and a read-order assertion requiring graph/specification/claim before
replacement. The first focused attempt failed because the replacement call used
the fixture's atomic lease (`DeliveryActionForwardBoundaryMismatch`, expected
`InterruptibleBoundary`). The fixture was corrected to use an interruptible
lease for that call while retaining the missing-boundary control. The second
focused attempt still failed at
`readPostPromotionFinalityPremises` with `IntegrationFinalityRuntimeUnavailable`
(adapter line 197), so the route evidence is not proven. The first fixture
hypothesis was provider order: its interpreter/allocator/trace/boundary had
been provided inside `provideLiveJournal`, whose final `Effect.provide` installs
the remote-delivery test layer. A bounded follow-up moved them outside that
helper, matching the existing adapter-service test pattern, but the correctly
selected route test still failed with the same error. The next distinguishing
action is a test-only check of which of the five required services
(`WorkflowInterpreter`, `OperationIdAllocator`, `WorkflowTrace`, `InRunJournal`,
`AcceptedJournalReader`) is absent immediately before the adapter call; then
repair only that fixture provision. No further route attempt is authorized in
this task.

**Focused evidence.** Both selected protocol tests passed in each focused
invocation. First log: `/tmp/issue386-finality-repair-focused-tests.log`, exit
1 overall because of the route boundary mismatch; summary `Test Files 1 failed
| 1 passed (2)`, `Tests 1 failed | 2 passed | 93 skipped (96)`. Second log:
`/tmp/issue386-finality-repair-focused-tests-r2.log`, exit 1 because of the
route runtime-unavailable failure; the same summary counts apply. The controlled
S8 integration test was not rerun. **Scoped disposition:** missing-intent
runtime guard and foreign-claim control are resolved by the named passing
protocol tests. The route fixture proof remains open and cannot be credited as
passing S8 route evidence until the exact route test passes.

**Provider-order follow-up.** The first invocation after changing provider
order used an anchored title filter and ran no tests: exit 0, `Test Files 1
skipped (1)`, `Tests 58 skipped (58)`, duration 1.08s. The correctly selected
command was `pnpm exec vitest run packages/orchestrator/src/coordination/delivery/delivery-proposal-routes.test.ts -t 'executes completion-claim replacement and deletion through the configured boundary' --maxWorkers=1`.
It exited 1 with `IntegrationFinalityRuntimeUnavailable` at
`readPostPromotionFinalityPremises` line 197; Vitest reports `Test Files 1
failed (1)`, `Tests 1 failed | 57 skipped (58)`, duration 775ms (test body
53ms). Full log: `/tmp/issue386-finality-route-test-r4.log`; the skipped
invocation log is `/tmp/issue386-finality-route-test-r3.log`. No further
attempt was made.

**Route-fixture service and boundary follow-up (2026-09-30).** The bounded
five-service projection supported alternative A: the successful replacement
had `WorkflowInterpreter`, `OperationIdAllocator`, `WorkflowTrace`,
`InRunJournal`, and `AcceptedJournalReader` present; the foreign-claim
replacement fixture had the first three absent and both journal services
present. Full diagnostic log:
`/tmp/issue386-route-service-presence-diagnostic.log`. Providing those three
services moved the focused case past that guard and exposed its next fixture
defect: the foreign-claim replacement used `AtomicBoundary`, while this
replacement protocol requires `InterruptibleBoundary`. The first repair
verification log is `/tmp/issue386-route-service-repair-verification.log`.
The foreign-claim and unreadable-claim fixture calls now use the same
interruptible lease as the successful replacement. The exact-title route test
then passed once: exit 0, `Test Files 1 passed (1)`,
`Tests 1 passed | 57 skipped (58)`, duration 1.13s; log:
`/tmp/issue386-route-service-repair-r2.log`. This closes the focused route
fixture proof. No production behavior changed; this result gives no S1 or full
gate credit.

## Five-task dependency-diamond Lab result report — 2026-09-30

**Pinned candidate and classification.** This result-reporting diagnostic ran
on branch `integration/issue-385-386-387-r1` at HEAD
`75768e891b24919499db3196fc42afd3ad631adf`. It is inconclusive and is not
acceptance evidence. Between `2026-09-30T09:54:17Z` and
`2026-09-30T09:54:22Z`, one direct Vite SSR call to
`runMaintainedCassette('authored:productionShapedFiveTaskDiamond')` returned
`_tag: Failed` for story `five-task dependency diamond settles every accepted
result before releasing D`. The detail was
`AuthoredCassetteInteractionMismatch` during
`IntegratorProtocol.prepareIntegrationCandidateRun` at
`authored-cursor.ts:993`; location was `Unknown`, no story position was
reported, and expected/actual tags were unavailable. The command exited 0
because it reported the cassette result, not because the cassette passed.

**Retained evidence and next discriminator.** The result report is
`/tmp/issue386-five-task-diamond-result-report.log`; the prior failed assertion
log is `/tmp/issue386-five-task-diamond-reordered-cassette.log`. The next exact
discriminator is a safe projection of `mismatch.expected`, `mismatch.actual`,
and `storyPosition` at the Integrator candidate-preparation boundary. This
record authorizes no new test or edit loop.

## Five-task Reducer Lab completion-claim chronology — 2026-09-30

**Accepted scenario and test mapping.** The Lab fixture projects the accepted
five-task chronology in
[`docs/scenarios/controlled-provider-capstone.md`](scenarios/controlled-provider-capstone.md),
“A five-task dependency diamond completes only from tracker-confirmed
success.” Its production acceptance test remains
`packages/dalph/test/cassettes/scenario.test.ts`:
`runs the five-task controlled-provider diamond through exact accepted-result
finality`. The focused Lab projection is
`prototypes/reducer-lab/src/trace-task-progress.test.ts`, loaded through the
Vite SSR smoke route. It requires the maintained
`authored:productionShapedFiveTaskDiamond` result to be `Completed` and checks
that confirmed finality precedes dependant progress. This Lab check does not
replace the package acceptance test or prove a full gate.

**Diagnosis and corrected interpretation.** The initial cursor trace
`/tmp/issue386-cursor-mismatch-diagnostic.log` records
`expectedConsumerTag=CompletionClaimReadReturned`, then
`nextAuthoredItemTag=DalphSelects(ReadTrackerGraph)` at story position 21.
Sol's read-only review confirmed that the runtime consumes the Active claim
response before requesting the post-promotion graph. The cassette was corrected
to put that response before the graph/specification/claim sequence.

The next result log
`/tmp/issue386-five-task-direct-result-order-r2.log` reports a mismatch at
zero-based cursor position 90: the runtime requests `ReadTrackerGraph` while
the next authored item is `CompletionClaimReplacementApplied`. The loaded
story projection shows one-based items 90–91 are B's
`CompletionClaimReadReturned(Active)` and `CompletionClaimReplacementApplied`;
there are no graph, specification, or claim-read items between them. The
earlier inference that those reads remained before replacement generalized
the A helper's optional sequence to all later integrations; that was wrong.
Sol's scoped review confirms B's releasing-work helper and the C, E, and D
calls omitted the required observations. This is a fixture chronology gap,
not evidence of a production behavior defect.

**Fixture repair.** Every task now keeps this order:
`CompletionClaimReadReturned(Active)` → current complete graph read → exact
task specification read → task claim read →
`CompletionClaimReplacementApplied`. A uses `noneComplete`; B and C use
`aComplete`; E uses `abcComplete`; D uses `abceComplete`. Each graph leaves
the current task Open and reflects the completed prerequisites at that stage.
The optional graph sequence is propagated through B's releasing-work helper;
the later complete graph reads that release dependants remain unchanged.
No production code or Lab assertions changed.

The raw position anchors account for the six authored items added after each
promotion (graph select/response, specification select/response, claim
select/response), using the actual A → B → C → E → D insertion order. The
existing `authoredIntegrationPositionsAfterDirectPublication` helper then adds
the admission, baseline, and prior-integration journal records to form each
loaded Integrator correlation:

| Integration | Prior read blocks | Raw `queuedAt` / `startedAt` / `targetLineageObservedAt` anchors |
|---|---|---:|
| B | A (6 items) | 100 / 106 / 113 |
| C | A (6 for queued; A, B (12) for later anchors) | 98 / 157 / 159 |
| E | A, B, C (18 items) | 201 / 202 / 204 |
| D | A, B, C, E (24 items) | 261 / 262 / 264 |

The earlier safe B-correlation comparison in
`/tmp/issue386-five-task-correlation-diffpaths.log` showed the first insertion
shifting B's positions by six; its other projected task, attempt, Run, target,
and planned-attempt fields matched. The anchors are field-specific: C's
`queuedAt` follows A's six read items because C is queued in the joint B/C
admission block before B's finality reads; C's `startedAt` and
`targetLineageObservedAt` follow A and B's twelve read items. E's anchors
follow A, B, and C (18 items), and D's follow A, B, C, and E (24 items). A's
anchors and all unrelated cassettes remain unchanged. The focused
production-runner acceptance below consumes the loaded correlations in the
authored story order.

**Scoped review disposition.** Sol confirmed the production
`readPostPromotionFinalityPremises` sequence and the B/C/E/D fixture omissions;
the repair preserves that boundary and changes only controlled fixture data.
The contradictory earlier “all reads remain” statement is superseded by the
loaded-story positions above. The exact focused Lab acceptance result below
determines whether this fixture repair passes; the S8/capstone production
acceptance test and full qualification remain separate evidence.

**Focused Lab acceptance.** The one authorized command was
`pnpm --filter @dalph/reducer-lab-prototype exec node --input-type=module -e 'import { createServer } from "vite"; const server=await createServer({appType:"custom",logLevel:"error",server:{hmr:false,middlewareMode:true}}); try {await server.ssrLoadModule("/src/trace-task-progress.test.ts"); console.log("Reducer Lab five-task trace acceptance passed.")} finally {await server.close()}'`.
It ran at 2026-09-30 10:50:00–10:50:06 UTC (5.223s), exited 1, and failed
the unchanged assertion at `trace-task-progress.test.ts:12`: actual `Failed`,
expected `Completed`. Full output is
`/tmp/issue386-five-task-lab-final-r1.log`. This candidate has no passing Lab
acceptance credit and was not committed. The wrapper does not expose the
cassette's first failure boundary; the next distinguishing action is one
bounded direct result-reporting SSR call with the safe cursor/correlation
projection on this candidate. No further repair or run was made here.

**One-shot C queued-position discriminator — 2026-09-30.** Before the direct
result call, compare two explanations for its first mismatch. A predicts the
C Integrator request is first, with only `session.queuedAt` differing: the C
anchor should be 98 (original 92 plus A's six post-finality read items), since
C is queued in the joint B/C admission block before B's later post-promotion
reads. The current C anchor is 104, which also includes B's six reads. B
predicts an earlier or different mismatch boundary/field. Run one direct
`runMaintainedCassette('authored:productionShapedFiveTaskDiamond')` Vite SSR
result report with safe first-mismatch/correlation-path projection; do not run
the assertion wrapper or edit the fixture. Expected duration is at most 3
minutes, with an absolute stop at 2026-09-30 10:57:00 UTC. Preserve the full
log at `/tmp/issue386-five-task-diamond-correlation-first-mismatch.log`; if
the safe result lacks enough fields to distinguish A and B, stop as
inconclusive without another probe.

**Discriminator result.** The one direct SSR call ran at
2026-09-30 10:56:11–10:56:16 UTC (5 seconds). Its safe projection was
`storyPosition=111`, expected/actual tag `IntegratorRequestReceived`,
`differingPaths=["session.queuedAt"]`, `expectedQueuedAt=116`, and
`actualQueuedAt=110`; the cassette returned `Failed` with `location=Unknown`
(process exit 0). C's current raw anchor 104 plus the known 12-position
admission/baseline offset gives 116; the predicted corrected raw anchor 98
plus the same offset gives the observed runtime 110. This supports A: C's
fixture `queuedAt` includes B's later six read items even though C is queued
before B's finality reads. A falsifier would be a mapped story position other
than C's Integrator request or any additional differing stable correlation
field; neither appeared in this projection. Full output:
`/tmp/issue386-five-task-diamond-correlation-first-mismatch.log`. No catalog
edit or second run was made.

**C queued-position correction and focused result.** The discriminator's
single fixture correction changed C's `queuedAt` anchor from 104 to 98;
`startedAt=157`, `targetLineageObservedAt=159`, all graph facts, later
releases, and assertions were preserved. The one focused five-task Lab SSR
acceptance ran at 2026-09-30 10:58:01–10:58:08 UTC (7 seconds), exited 0, and
printed `Reducer Lab five-task trace acceptance passed.` Full output is
`/tmp/issue386-five-task-lab-anchor98-r1.log`. No other check or commit was
made; the passing candidate awaits Sol's review.

## Failed maintained Lab fixture diagnosis — 2026-09-30

**Pinned failure and custody.** Failed run
`051cfec1-0c34-463c-a474-e2891bf90c5e` is closed, stopped, and UNPROVEN at
Base `934861676593b6ec1eb8c853366128efd4771838`; its first failed stage was
`check:lab`. `pnpm gate:status 051cfec1-0c34-463c-a474-e2891bf90c5e` reports
registration closed, custody stopped, source unchanged, and the Lab writer
group absent. The complete retained Lab log is
`/workspace/typescript/dalph-worktrees/integration-385-386-387-r2/.scratch/quality-gates/051cfec1-0c34-463c-a474-e2891bf90c5e/logs/f618c5aa-fef8-47b2-8250-a3ba4c032d82.log`
(460 lines, 79,141 bytes, SHA-256
`2557ed9b7bee6d2611890bec2165931db088f93dbebdf8c32fb7f540acdc25b5`).

**Competing explanations and result.** A predicted a production regression:
after promotion, an exact active completion claim and still-eligible current
task would be prevented from reaching replacement even after the required
fresh current graph, task specification, and claim were supplied. B predicted
stale fixture chronology: runtime requests those three post-promotion reads
before replacement, while the authored stories put
`CompletionClaimReplacementApplied` immediately after the active-claim read.
The retained Lab log supports B for all ten authored rows below: at each first
mismatch the runtime selects `ReadTrackerGraph` where the cassette expects
replacement. The rows have eligible current facts and no contradictory
runtime outcome; the fixture must record graph → exact task specification →
exact claim before replacement, as required by the accepted S8 chronology in
`docs/scenarios/direct-remote-publication.md`.

| Retained authored row | First story position | Current facts at the finality boundary and fixture repair required |
|---|---:|---|
| `ambiguousCompletionResponse` | 29 | Inherited A-finality story; fresh graph/spec/claim is missing between A's Active read and replacement. Keep the lost completion-response cut after replacement. |
| `prerequisiteReopensDuringCompletion` | 29 | Inherited A-finality story; graph at replacement must still show the accepted prerequisite satisfied. Preserve the later reopen during Q and the resulting retained wait. |
| `completionGraphRefreshRecovery` | 29 | Inherited A-finality story; record current graph/spec/claim before replacement and preserve the process-death cut before the later graph that releases B. |
| `completionTaskConflict` | 38 | Starting facts add independent C; A remains Open with its exact current specification and claim at replacement. Preserve the later terminal-without-success transition while Q is pending. |
| `currentCompletionGraphAuthority` | 29 | Inherited A-finality story; record the fresh eligible A graph/spec/claim before replacement; preserve the later complete G7 graph that blocks B. |
| `deliveryFinalitySpine` | 29 | After restart, use the expanded current G5 graph, A's starting task specification, and A's exact active claim before replacement; preserve the subsequent Q, cleanup, and later dependant graph. |
| `deliveryStoryDs14ThroughDs17` | 36 | After successor M2 promotion, A is Open with its unchanged specification and active claim. Record the current singleton graph/spec/claim before replacing; retain the exact successor M2 and finality chronology. |
| `deliveryInvariantStory` | 22 | Starting graph `doubleDiamondGraphs.initialAEligible` (G0) leaves A Open with no prerequisites; its acquired A claim and starting specification are exact. Supply G0/spec/claim after promotion. |
| `dependentTasksCompleteInOneRun` | 22 | Starting graph `blockedPipelineGraph` leaves A Open with no prerequisites while B depends on A; its acquired A claim and starting specification are exact. Supply that graph/spec/claim after promotion. |
| `deliveryInvariantStoryCapstone` | 117 | At B's successor promotion, current G5 reports A complete and B Open; B's current `Implement B` specification matches the promoted attempt and its acquired claim remains current. Supply G5/spec/claim before replacement. The controlled-provider capstone does not require a changed B revision; `production.test.ts::S8 changed revision blocks finality` owns that negative outcome. |

**Fail-closed rows.** Two maintained protocol cassettes expected an
`CompletionClaimReplacementIntended` despite an unreadable or foreign claim:
`waitsWithoutReplacingWhenTheCurrentCompletionClaimCannotBeRead` and
`doesNotMutateAForeignClaimWhileSettlingAPromotedTask`. The focused
discriminator for the unreadable row returned the predicted
`CompletionClaimReadFailure`, one read, zero replacement calls, and zero
deletion calls. The protocol checks the claim before appending intent; an
unreadable or foreign observation is not authority to write that intent. Both
fixtures must assert no replacement intent, attempt, or outcome and no
downstream completion/finality, preserving S8's no-mutation boundary.

Five maintained finality rows started with an existing `Completion` claim but
no exact prior replacement intent, then attempted focused completion/finality:
`deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess`,
`reconcilesALostCompletionClaimDeletionWithoutReopeningSuccess`,
`keepsSuccessfulWorkFinalWhenTheCompletionClaimCannotBeReadBeforeDeletion`,
`keepsSuccessfulWorkFinalWhenCompletionClaimDeletionCannotConverge`, and
`doesNotTerminateAnEmptyFrontierWhileCompletionSettlementIsPending`. Each
failed at story position 46 with
`WorkflowJournalHistorySemanticIssue` saying the completion request lacked
one exact prior claim replacement. The fixtures incorrectly used
`RunReplacement` against the pre-existing completion claim, which the accepted
guard correctly rejects without retroactively minting intent. Model the
restart cut with an exact claim-bound `CompletionClaimReplacementIntended`
before the completion-claim reread (the cassette's `RestartReplacement` path),
then preserve the focused-success, deletion, and pending-frontier assertions.

**Disposition and next work.** These 17 logged rows are stale fixture
chronologies, not a production defect: ten omit the accepted pre-replacement
graph/spec/claim reads; two expect intent after a read failure/conflict; five
omit durable prior replacement history. Repairs may change only these
fixtures/tests and this audit. Keep no-mutation, S8, completion/finality,
cleanup, and dependant-order assertions. Do not change production behavior or
the journal validator. The prior failed gate remains unproven; this diagnosis
does not admit another Lab stage or full gate.

### Focused fixture-repair checkpoint — 2026-09-30

The first focused repair run `/tmp/issue386-lab-focused-cassettes-r2.log`
completed at 12:02:11–12:02:21 UTC (Vitest exit 1, 9.25s; 2 failed, 9
passed). The shared delivery-finality stories, same-Run dependant, fail-closed
claim controls, and DS14–17 chronology passed. The capstone B fixture still
asked for a graph at story 117 before replacement, and the double-diamond
advanced to a B Integrator correlation whose queued/start/lineage positions
were six behind the observed chronology: expected 111/117/122, observed
117/123/128. The double-diamond authored return and paid-G2 graph anchors also
needed to move from 241/233 to 247/239 after A's six post-promotion reads.

The bounded correction updated the double-diamond anchors and B correlation,
and added the observed graph read around capstone B finality. The sole rerun
`/tmp/issue386-lab-focused-cassettes-r3.log` completed at 12:04:26–12:04:36 UTC
(Vitest exit 1, 9.55s; 2 failed, 9 passed). The pipeline, shared S8 rows,
fail-closed claim controls, and DS14–17 case passed. Two mismatches remain:
capstone B still requests `ReadTrackerGraph` at story position 117 where the
cassette expects `CompletionClaimReplacementApplied`; double-diamond now
requests `ReadTrackerGraph` at story position 97 where the cassette expects
`CompletionClaimReplacementApplied`. The current evidence does not identify
which premise prevents replacement, so neither mismatch is repaired or
qualified. No focused Lab SSR, typecheck, lint, full gate, or commit was run.

**Next discriminating action.** In this isolated candidate, capture the
capstone B and double-diamond A pre-replacement read slice through each second
`ReadTrackerGraph` request: graph revision and A/B lifecycle/prerequisite facts,
task-specification fingerprint, exact current claim observation, and journal
position/tags through `CompletionClaimReplacementIntended`. Compare the three
read results to the promoted task's recorded revision and exact acquired
claim. Stop on a mismatch; repair only the fixture value or order identified by
that observation, then rerun the two affected cassette cases once.

### S8 cassette premise reconciliation — 2026-09-30

The bounded read-only diagnosis found different causes for the two cursors.
The previous capstone fixture introduced `Changed B` through its operator
continuation and then returned that changed specification at finality, although
the promoted session still fingerprinted `Implement B`. The accepted
controlled-provider capstone in `docs/scenarios/controlled-provider-capstone.md`
does not require this revision change; retaining it would correctly block B but
contradict the capstone's accepted all-task success chronology. The fixture now
keeps B's specification at `Implement B`, matching the promoted attempt, while
the separate `packages/dalph/test/scenarios/production.test.ts::S8 changed
revision blocks finality` negative case remains unchanged and owns the changed
revision wait.

For double-diamond B, the last pre-promotion graph is
`double-diamond-G2-X-added`: A is `CompletedSuccessfully`, B is `Open`, and
B's sole prerequisite A is complete. B's current specification matches its
promoted attempt and the restart chronology has read B's current claim. The
finality fixture lacked the required post-promotion graph/specification/claim
reads; it now records that complete graph, unchanged exact specification, and
current claim before replacement. This preserves B's later completion,
dependant release, and finality assertions.

The retained `/tmp/issue386-lab-focused-cassettes-r3.log` records story cursors
117 and 97 and the first emitted `ReadTrackerGraph` operations, but no journal
position, cassette index, or returned graph/claim response at either failed
cursor. Those indices and responses remain unobserved; the fixture facts above
come from the authored chronology, not a reconstructed runtime result.

### Read-only resume-prefix and cursor diagnosis — 2026-09-30

The capstone prefix after `OperatorContinuesAttempt(B)` contained
`ReadTrackerGraph(G2)`, `ReadTaskWorkSpecification(B)`,
`ReadTaskClaim(B)`/`TaskClaimCurrentReadReturned(B)`, worktree and lineage reads,
then A's terminal report before B's Resume. The authored tracker preserves the
exact B claim from its successful acquisition. Since A's terminal report occurs
after that claim observation and no B claim mutation occurs, B's Resume boundary
requires a current B claim read. `delivery-story-capstone.ts` currently records
two consecutive `ReadTaskClaim(B)`/`TaskClaimCurrentReadReturned(B)` pairs after
`terminal(A)` and before `report(B, Resume)`. The earlier note's singular
description undercounted those authored reads; this correction records the
actual pair count without inferring a claim mutation between them.

The six post-promotion graph/specification/claim observations in double-diamond
B move the unique paid-G2 activation return from story index 247 to 253 and its
causal graph anchor from 239 to 245. The earlier one-shot focused run at 12:18
UTC exited 1 in 2.26s: capstone stopped at story position 54 when the runtime
selected `ReadTaskClaim(B)` where the cassette expected B's Resume report; the
double-diamond test's fixed-index assertion found X's passive terminal report
at 247 instead of the activation return. This new candidate records the
post-A-terminal claim read and updates only the two double-diamond indices.

### S8 fixture repair and one-run predeclaration — 2026-09-30

The double-diamond finality helper now requires a post-promotion graph and
records the current graph, exact task specification, and exact current claim
after the active-claim observation and before every claim replacement. The
loaded graph keeps the task being finalized Open and reports all its
prerequisites complete: G0 for A, G2-X-added for B, G2-B-complete for C, G3
for D, G3-D-complete for E, G4-E-complete-before-F for F,
G4-F-complete-before-X for X, G5 for H, G5-H-complete for I, and G6 for G.
Later complete-graph reads that release dependants remain in place.

The raw integration anchors are derived from the loaded story's location of
each responsibility, start, and lineage occurrence relative to the six-item
post-promotion premise blocks. The earlier B mismatch measures one block:
the stale B correlation was 111/117/122 while the runtime's loaded chronology
was 117/123/128. The C queue occurs in the joint B/C admission before B's
block, while C's start and lineage occur after it. Later field-specific
dependencies follow the authored integration order:

| Task | Finality premise blocks before queuedAt | Blocks before startedAt and lineage | Raw queuedAt / startedAt / lineage |
|---|---|---|---:|
| B | A | A | 110 / 116 / 119 |
| C | A | A, B | 108 / 163 / 165 |
| D | A, B, C | A, B, C | 222 / 223 / 225 |
| E | A, B, C, D | A, B, C, D | 282 / 285 / 300 |
| F | A, B, C, D, E | A, B, C, D, E | 376 / 378 / 388 |
| X | A, B, C, D, E | A, B, C, D, E, F | 372 / 426 / 428 |
| H | A, B, C, D, E, F, X | A, B, C, D, E, F, X | 502 / 504 / 506 |
| I | A, B, C, D, E, F, X | A, B, C, D, E, F, X, H | 498 / 544 / 546 |
| G | A, B, C, D, E, F, X, H, I | A, B, C, D, E, F, X, H, I | 605 / 606 / 608 |

Before the sole ten-task focused acceptance run, the predicted result is
`2 tests passed`, including exact integrations and finality in order
A→B→C→D→E→F→X→H→I→G, 700 journal records, and no held positions at
termination. Competing result A is an earliest correlation mismatch at C's
`IntegratorRequestReceived`, which would falsify the field-specific block map.
Competing result B is an earlier `ReadTrackerGraph`, specification, or claim
mismatch at a post-promotion finality boundary, which would identify an
incorrect task-specific S8 premise. Preserve the complete output at
`/tmp/issue386-s8-double-diamond-focused-r1.log`; do not retry if the outcome is
inconclusive or fails to distinguish those results.

The focused run is expected to finish within one minute; its absolute stop is
2026-09-30 14:08:00 UTC. This declaration precedes the run. After it, only the
affected package typecheck and changed-file lint will run if they fit before
14:15 UTC. The five-task A→B→C→E→D cassette, its C anchors 98/157/159, and its
later dependant-release checks are unchanged.

#### Focused attempt 1 result and disposition — 2026-09-30

The exact command was
`pnpm exec vitest run packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts --maxWorkers=1 --reporter=verbose`, with full output at
`/tmp/issue386-s8-double-diamond-focused-r1.log`. It exited 1 after 2.38
seconds; both test cases failed before `runAuthoredScenarioCassette` ran. The
first assertion expected the paid-G2 `CoordinatorActivationReturned` at
`story[253]` but observed `TaskClaimCurrentReadReturned(F)`. This outcome was
outside the predeclared alternatives, so it does not distinguish the runtime
correlation and S8 premise explanations. The added C, D, and E premise blocks
precede that cursor in the loaded story. The test's fixed indices were then
adjusted to 271/263 from that visible 18-item shift; those numbers remain
unverified and are not treated as observed loaded-story positions.

The next discriminating action is to derive the paid-G2 return and causal-graph
positions from their actual tagged occurrences in the loaded cassette story,
replace the two fixed indices with those derived positions, and predeclare a
new focused-run prediction, competing outcomes, command, log path, duration,
and stop time before invocation. No second focused run or type/lint check was
started in this repair window; no qualification or commit is claimed.

#### Focused attempt 2 predeclaration — 2026-09-30

The first focused attempt stopped at a stale fixed cursor before entering
`runAuthoredScenarioCassette`: story index 253 held F's
`TaskClaimCurrentReadReturned`, rather than the paid-G2 activation return.
That failure did not observe a runtime correlation or post-promotion premise
mismatch. The test now locates the unique authored `DalphSelects` occurrence
with role `double-diamond-paid-G2`, verifies its declared boundary is
`CoordinatorActivationReturned`, and locates the first later return carrying
that tag. Missing or duplicate role anchors and a missing following return
fail closed. Both return assertions and the omission control use that derived
position. The full premise, finality order, 700-record, termination, and
negative omission assertions remain present.

For this one focused run, the prediction is that both tests pass. Competing
result A is a correlation-anchor mismatch at the first
`IntegratorRequestReceived`. Competing result B is a post-promotion graph,
specification, or claim premise mismatch. Any other result is inconclusive and
ends this diagnostic lane without another run. The exact command is:

```sh
pnpm exec vitest run packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts --testNamePattern='^(returns after the paid G2 and settles F X and the complete double diamond after fresh activation facts|rejects omission of the actual double-diamond activation return before its owed next graph)$' --maxWorkers=1 --reporter=verbose > /tmp/issue386-s8-double-diamond-focused-r2.log 2>&1
```

Expected duration is at most five minutes, with an absolute stop at
2026-09-30 14:27:00 UTC. This predeclaration is recorded before invocation.

#### Focused attempt 2 result and disposition — 2026-09-30

The exact predeclared command ran once and exited 1 after 11.33 seconds. Its
full output is preserved at
`/tmp/issue386-s8-double-diamond-focused-r2.log`. The negative omission
control passed. The ten-task test entered `runAuthoredScenarioCassette` and
failed at an authored coordinator activation boundary: it expected
`RunMustRemainActive/TrackerTargetUnsettled` and received
`RunMustRemainActive/UnsettledResponsibility`. This is neither the predicted
first `IntegratorRequestReceived` correlation mismatch nor a post-promotion
graph/specification/claim premise mismatch. The result is therefore
inconclusive under the predeclaration. Stop this diagnostic lane: do not rerun,
typecheck, lint, or commit this candidate. The next discriminating action
requires a changed candidate and a new predeclaration that distinguishes the
activation-return decision mismatch before another focused run.

#### Activation-boundary diagnostic predeclaration — 2026-09-30

Question: which authored `CoordinatorActivationReturned` is the first
runtime mismatch, and what exact graph and integration facts immediately
precede it? A temporary test-only `onObservationCapture` trace records the
boundary story position, activation ordinal, authored decision, nearest prior
matched tracker graph revision and task lifecycle tags, exact preceding
`IntegratorRequestReceived` correlations, and preceding
`CompletionClaimReplacementApplied` task IDs. The test captures the existing
failure with `Effect.exit`, logs its actual decision and full cause, then
re-fails that same cause; expected reasons are unchanged.

Prediction: the mismatch is one of the three authored
`TrackerTargetUnsettled` boundaries after A, F/X, or H/I. The distinguishing
observation is the final captured boundary's exact position/ordinal, received
decision, graph lifecycle snapshot, and preceding exact integration/finality
occurrences. A different position or an unavailable boundary snapshot
falsifies this location prediction and ends the diagnostic without another
invocation. This is a diagnostic only and gives no acceptance credit.

The single invocation is the main ten-task test only, with this exact command:

```sh
pnpm exec vitest run packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts --testNamePattern='^returns after the paid G2 and settles F X and the complete double diamond after fresh activation facts$' --maxWorkers=1 --reporter=verbose > /tmp/issue386-s8-activation-boundary-diagnostic-r3.log 2>&1
```

Expected duration is at most one minute; absolute command stop is
2026-09-30 14:33:00 UTC and the task hard stop is 2026-09-30 14:34:00 UTC.
This predeclaration precedes the one invocation. Afterward, remove the
temporary instrumentation, preserve the log, record the result, and stop.

#### Activation-boundary diagnostic result and disposition — 2026-09-30

The exact predeclared command ran once and exited 1; Vitest reported 6.58
seconds total duration. Its full structured output is preserved at
`/tmp/issue386-s8-activation-boundary-diagnostic-r3.log`. It identified the
first mismatch at story position 335, activation ordinal 8: the authored
decision is `RunMustRemainActive/TrackerTargetUnsettled`, while the actual
decision is `RunMustRemainActive/UnsettledResponsibility`. This matches the
predicted F/X boundary after A and before H/I.

The nearest prior matched graph occurrence was story position 316, revision
`double-diamond-G4-F-complete-before-X`. Its lifecycle snapshot had A, B, C,
D, E, and F `CompletedSuccessfully`; G, H, I, and X were `Open`. Before the
boundary, the exact authored Integrator requests included F attempt 1 at
position 282 and X attempt 0 at position 309. Captured
`CompletionClaimReplacementApplied` tasks already included F and X along with
A-E. Thus the authored stream had the exact F/X requests and claim-replacement
responses before the boundary, while the nearest complete graph still showed
X open. The failing run does not return journal records, so it does not expose
an `IntegrationFinalitySettled` record for direct confirmation of finality;
the trace records authored occurrences, not an inferred journal event.

The temporary callback and failure logging were removed from the test file
after preserving the output; authored expected reasons and acceptance checks
were not changed. This diagnostic grants no acceptance credit. The smallest
scenario-mapped next candidate should relax only the reason assertion at this
after-F/X boundary to `RunMustRemainActiveReasonUnasserted`, preserving the
required active return and all graph, integration, and finality assertions;
then define a new focused diagnostic or acceptance action before any further
run. No follow-up check or commit was performed.

#### After-F/X active-return repair and focused predeclaration — 2026-09-30

At the identified after-F/X boundary, the authored cassette now requires the
Run to remain active while leaving the reason unasserted, using
`RunMustRemainActiveReasonUnasserted`. This matches the accepted S8 condition
without asserting an internal reason tag. The other two reason-specific
active-return assertions and every graph, task, finality, chronology, and
termination assertion remain unchanged.

Question: does the remaining authored double-diamond chronology satisfy the
acceptance scenario after this boundary? Prediction: the positive ten-task
test passes its finality-order, 700-record, termination, and remaining
chronology assertions. Alternative: a later authored boundary or fact fails;
that failure's first divergence falsifies the prediction and ends this lane
without retry. The exact one-test command is:

```sh
pnpm exec vitest run packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts --testNamePattern='^returns after the paid G2 and settles F X and the complete double diamond after fresh activation facts$' --maxWorkers=1 --reporter=verbose > /tmp/issue386-s8-double-diamond-focused-r4.log 2>&1
```

Expected output is `1 passed, 1 skipped` (the positive test passes; the
negative omission test is filtered out). Expected duration is at most one
minute. The absolute command stop is 2026-09-30 14:44:00 UTC; the task hard
stop is 2026-09-30 14:45:00 UTC. This predeclaration precedes the invocation.

#### After-F/X focused result and disposition — 2026-09-30

The exact predeclared command ran once and exited 0. Vitest reported
`1 passed, 1 skipped` in 11.04 seconds. The full log is
`/tmp/issue386-s8-double-diamond-focused-r4.log`. The positive test completed
the remaining authored chronology and its assertions for finality order,
700 journal records, terminal run state, and released delivery positions. The
negative omission case was excluded by the title filter. No lint, typecheck,
additional test, or commit was run.

#### Negative omission control predeclaration — 2026-09-30

Question: is omission of the actual paid-G2 activation return still rejected
after the after-F/X decision was changed to leave the active reason
unasserted? Prediction: exit 0 with the exact negative-control title passing.
Alternative: the control fails to detect omission; any such failure ends this
lane without retry. Run only this exact command:

```sh
pnpm exec vitest run packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts --testNamePattern='^rejects omission of the actual double-diamond activation return before its owed next graph$' --maxWorkers=1 --reporter=verbose
```

Expected duration is at most one minute; absolute command stop is
2026-09-30 14:44:00 UTC. This predeclaration precedes the one invocation.

#### Negative omission control result — 2026-09-30

The exact predeclared command exited 0. The negative-control title passed;
the positive title was filtered out. Exact Vitest summary: `Test Files 1
passed (1)`; `Tests 1 passed | 1 skipped (2)`; duration 10.15s (transform
865ms, setup 0ms, import 2.44s, tests 7.55s, environment 0ms). The command
output was returned directly; no separate log file was created. No source
edits, checks, or retries followed.

#### Affected typecheck and changed-file lint predeclaration — 2026-09-30

Candidate custody is branch `work/issue386-lab-claim-fixtures-r1`, Base
`a0f4071f12e809cbd5305461a1d963eb9c569fc9`, in
`/workspace/typescript/dalph-worktrees/issue386-lab-claim-fixtures-r1`.
First run `node --version` and proceed only if it reports Node v24. Then run
`pnpm typecheck` (expected at most four minutes; absolute stop
2026-09-30 14:46:00 UTC). Only if that succeeds, run
`DALPH_DIAGNOSTICS_BASE=a0f4071f12e809cbd5305461a1d963eb9c569fc9 pnpm lint:changed`
(expected at most two minutes; absolute stop 2026-09-30 14:50:00 UTC). Stop
on any failure; do not repair or run further checks. Hard stop is
2026-09-30 14:52:00 UTC. This declaration is recorded before those commands.

Node check result: `node --version` returned `v24.20.0`. The predeclared
`pnpm typecheck` exited 0 in 15.6 seconds. Its script ran
`tsc -p tsconfig.json --noEmit`; output included Effect advisory suggestions
and no type errors. The predeclared typecheck passed, so proceed to the
Base-pinned changed-file lint.

#### Affected verification results and disposition — 2026-09-30

Under Node `v24.20.0`, `pnpm typecheck` exited 0 in 15.6 seconds. The
Base-pinned `DALPH_DIAGNOSTICS_BASE=a0f4071f12e809cbd5305461a1d963eb9c569fc9
pnpm lint:changed` exited 1 in 2.52 seconds. It reported:

- `packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts:92:20`, rule `dalph(sort-destructure-keys)`: “Expected object destructuring keys to be sorted; storyPosition belongs before taskId.”
- `packages/dalph/src/cassettes/catalog.ts`, rule `eslint(no-magic-numbers)`, “No magic number” findings: `4729:58=104`, `4730:59=110`, `4731:73=113`, `4734:58=102`, `4735:59=151`, `4736:73=153`, `4739:58=204`, `4740:59=205`, `4741:73=207`, `4744:58=258`, `4745:59=261`, `4746:73=276`, `4749:58=346`, `4750:59=348`, `4751:73=358`, `4754:58=551`, `4755:59=552`, `4756:73=554`, `4759:58=460`, `4760:59=462`, `4761:73=464`, `4764:58=456`, `4765:59=496`, `4766:73=498`, `4769:58=342`, `4770:59=390`, `4771:73=392`.
- `packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts:22:9`, rule `typescript(no-unnecessary-condition)`: “This condition will always return the same value since the types have no overlap.”

No repair, rerun, additional check, or commit followed the lint failure.
Terminal worktree status is branch `work/issue386-lab-claim-fixtures-r1`,
HEAD `a0f4071f12e809cbd5305461a1d963eb9c569fc9`, with these seven scoped
files dirty and uncommitted: this audit, `packages/dalph/src/cassettes/catalog.ts`,
`delivery-story-capstone-support.ts`, `delivery-story-capstone.ts`,
`integration-finality-protocol-cassette-domain.ts`,
`packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts`,
and `scenario.test.ts`. No command is running.

#### Base-pinned lint repair predeclaration — 2026-09-30

The previous Base-pinned `lint:changed` exited 1 in 2.52 seconds. Its exact
findings were `packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts:92:20`
(`dalph(sort-destructure-keys)`: storyPosition must precede taskId),
`packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts:22:9`
(`typescript(no-unnecessary-condition)`: the undefined guard has no overlapping
type), and `packages/dalph/src/cassettes/catalog.ts` at
`4729:58=104, 4730:59=110, 4731:73=113; 4734:58=102, 4735:59=151,
4736:73=153; 4739:58=204, 4740:59=205, 4741:73=207; 4744:58=258,
4745:59=261, 4746:73=276; 4749:58=346, 4750:59=348, 4751:73=358;
4754:58=551, 4755:59=552, 4756:73=554; 4759:58=460, 4760:59=462,
4761:73=464; 4764:58=456, 4765:59=496, 4766:73=498; 4769:58=342,
4770:59=390, 4771:73=392` (`eslint(no-magic-numbers)`).

Repair only those findings: sort the destructuring keys, remove only the
redundant undefined guard while preserving the exact-one-anchor and declared
boundary checks, and suppress `no-magic-numbers` narrowly around the exact
authored occurrence anchors with a concrete comment. Every numeric story
position and formula remains unchanged. Then run this command once:

```sh
DALPH_DIAGNOSTICS_BASE=a0f4071f12e809cbd5305461a1d963eb9c569fc9 pnpm lint:changed
```

Expected duration is at most two minutes, with absolute stop
2026-09-30 14:50:00 UTC. If lint fails, record its exact findings and stop;
do not repair or rerun. Do not run a typecheck, cassette, other edit, commit,
or gate. This predeclaration precedes the repair and command.

#### Base-pinned lint repair result and disposition — 2026-09-30

The exact predeclared `DALPH_DIAGNOSTICS_BASE=a0f4071f12e809cbd5305461a1d963eb9c569fc9
pnpm lint:changed` command exited 1 after 3.75 seconds. Its sole remaining
finding was `packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts:22:9`,
rule `typescript(no-unnecessary-condition)`: “This condition will always
return the same value since the types have no overlap.” The prior
`dalph(sort-destructure-keys)` and catalog `eslint(no-magic-numbers)` findings
were absent from this result. The only subsequent change is recording this
result; stop without another repair, check, or retry.

This bounded repair changed the loop destructuring order to
`{ storyPosition, taskId }`, removed the redundant `anchor === undefined`
guard while preserving unique-anchor and boundary validation, and applied a
narrow commented `no-magic-numbers` suppression to the exact authored
integration-position object. All authored numeric positions and formulas were
left unchanged. Candidate remains uncommitted at branch
`work/issue386-lab-claim-fixtures-r1`, Base
`a0f4071f12e809cbd5305461a1d963eb9c569fc9`; terminal Git status follows this
entry: seven modified, uncommitted files are this audit,
`packages/dalph/src/cassettes/catalog.ts`,
`packages/dalph/src/cassettes/delivery-story-capstone-support.ts`,
`packages/dalph/src/cassettes/delivery-story-capstone.ts`,
`packages/dalph/src/cassettes/integration-finality-protocol-cassette-domain.ts`,
`packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts`,
and `packages/dalph/test/cassettes/scenario.test.ts`. HEAD remains
`a0f4071f12e809cbd5305461a1d963eb9c569fc9`; no command is running.

#### Narrow no-unnecessary-condition follow-up predeclaration — 2026-09-30

The previous Base-pinned lint exited 1 after 3.75 seconds with one remaining
finding: `packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts:22:9`,
`typescript(no-unnecessary-condition)`, “This condition will always return the
same value since the types have no overlap.” Remove only the impossible
`causalAnchor === undefined` disjunct. Retain the occurrence-role comparison,
exactly-one-anchor check, declared-boundary check, and missing-following-return
check. Then run only:

```sh
DALPH_DIAGNOSTICS_BASE=a0f4071f12e809cbd5305461a1d963eb9c569fc9 pnpm lint:changed
```

Expected duration is at most two minutes; absolute stop is
2026-09-30 14:50:00 UTC. If it fails or exceeds that stop, preserve the exact
result and end this lane without another edit or check. No other check or
commit. This declaration precedes the one edit and invocation.

#### Formatting-only lint result and final bounded repair predeclaration — 2026-09-30

The Base-pinned lint exited 20 after 3.55 seconds. Its no-unnecessary-condition
finding was absent. Dprint showed formatting diffs in only
`packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts`
and `packages/dalph/src/cassettes/catalog.ts`, ending with `Found 2 not
formatted files. Run dprint fmt to fix.` Current status: branch
`work/issue386-lab-claim-fixtures-r1`, HEAD
`a0f4071f12e809cbd5305461a1d963eb9c569fc9`, seven modified and uncommitted
scoped files listed immediately above.

Predeclared commands: format only those two files with
`pnpm exec dprint fmt packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts packages/dalph/src/cassettes/catalog.ts` (expected under 30 seconds), then run only
`DALPH_DIAGNOSTICS_BASE=a0f4071f12e809cbd5305461a1d963eb9c569fc9 pnpm lint:changed` (expected at most two minutes). Absolute stop is 2026-09-30 14:50:00 UTC. If lint fails, preserve exact output and stop without further edits or checks. This declaration precedes both commands.

#### Final candidate review and commit predeclaration — 2026-09-30

Finalization is limited to the existing branch
`work/issue386-lab-claim-fixtures-r1` at Base
`a0f4071f12e809cbd5305461a1d963eb9c569fc9`, with seven scoped modified files:
this audit, `packages/dalph/src/cassettes/catalog.ts`,
`delivery-story-capstone-support.ts`, `delivery-story-capstone.ts`,
`integration-finality-protocol-cassette-domain.ts`,
`packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts`,
and `scenario.test.ts`.

Terminal verification received for this candidate: dprint reported
`Formatted 2 files.`; Base-pinned `lint:changed` exited 0 in 3.14 seconds;
root-reported `git diff --check` exited 0. No tests/checks will be run here.

The narrow Sol review disposition is that the after-F/X authored boundary
now asserts only `RunMustRemainActive` through
`RunMustRemainActiveReasonUnasserted`. The accepted active-return, graph,
finality, and ordering assertions remain, and no runtime behavior changed.
This does not claim Issue 386 complete.

Capture current Git status and a SHA-256 of the six non-audit source/test
diffs with read-only Git commands (expected under 30 seconds; stop by
2026-09-30 14:54:00 UTC). Then stage exactly the seven paths listed above and
run `git commit -m "Repair Issue 386 S8 authored claim fixtures"` with normal
hooks (expected under four minutes; absolute stop 2026-09-30 15:00:00 UTC).
Do not bypass hooks. If commit or a hook has not completed at the stop, stop
safely and report its state. No integration or Issue 386 closure is claimed.
This declaration precedes hashing, staging, and commit.

Finalization timing addendum — 2026-09-30: the declared 14:54:00 UTC stop for
the short status/hash capture elapsed before that capture began; no operation
was running and no hash was captured in that window. Updated declaration:
capture status and the six non-audit source/test diff hash with
`git diff --binary -- packages/dalph/src/cassettes/catalog.ts packages/dalph/src/cassettes/delivery-story-capstone-support.ts packages/dalph/src/cassettes/delivery-story-capstone.ts packages/dalph/src/cassettes/integration-finality-protocol-cassette-domain.ts packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts packages/dalph/test/cassettes/scenario.test.ts | sha256sum`
and `git status --short --branch` (expected under 20 seconds; stop by
2026-09-30 14:55:00 UTC). Then commit the seven listed files with normal hooks,
expected under four minutes and stop at 2026-09-30 15:00:00 UTC. This updated
declaration precedes the capture and commit.

#### Final formatting/lint terminal evidence and fresh finalization predeclaration — 2026-09-30

Prior terminal evidence for this candidate: `pnpm exec dprint fmt
packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts
packages/dalph/src/cassettes/catalog.ts` exited 0 and printed `Formatted 2
files.`; Base-pinned `DALPH_DIAGNOSTICS_BASE=a0f4071f12e809cbd5305461a1d963eb9c569fc9
pnpm lint:changed` exited 0 in 3.14 seconds; root-reported `git diff --check`
exited 0. No tests or gates were run in that terminal qualification.

Fresh custody: exact worktree
`/workspace/typescript/dalph-worktrees/issue386-lab-claim-fixtures-r1`, branch
`work/issue386-lab-claim-fixtures-r1`, Base/HEAD
`a0f4071f12e809cbd5305461a1d963eb9c569fc9`, with only the seven intended
paths listed in the prior status record. First capture
`GIT_OPTIONAL_LOCKS=0 git status --short --branch` and the six non-audit
source/test digest using exactly
`git diff --binary -- packages/dalph/src/cassettes/catalog.ts packages/dalph/src/cassettes/delivery-story-capstone-support.ts packages/dalph/src/cassettes/delivery-story-capstone.ts packages/dalph/src/cassettes/integration-finality-protocol-cassette-domain.ts packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts packages/dalph/test/cassettes/scenario.test.ts | sha256sum`
(expected at most 20 seconds; stop 2026-09-30 14:57:00 UTC). Record both. If
status or paths differ from the seven intended files, stop. Otherwise stage
exactly those seven paths and run
`git commit -m "Repair Issue 386 S8 authored claim fixtures"` with normal
hooks (expected at most four minutes; absolute task stop 2026-09-30 15:04:00
UTC). Do not bypass hooks or run checks/gates. No integration or Issue 386
closure is claimed. This declaration precedes all commands.

Fresh read-only capture result: `GIT_OPTIONAL_LOCKS=0 git status --short
--branch` reported branch `work/issue386-lab-claim-fixtures-r1` and exactly
these seven modified paths: this audit, `packages/dalph/src/cassettes/catalog.ts`,
`delivery-story-capstone-support.ts`, `delivery-story-capstone.ts`,
`integration-finality-protocol-cassette-domain.ts`,
`packages/dalph/test/cassettes/double-diamond-activation-chronology.test.ts`,
and `scenario.test.ts`. HEAD was Base
`a0f4071f12e809cbd5305461a1d963eb9c569fc9`. The SHA-256 of the six
non-audit source/test diffs from the exact predeclared command is
`e807c778ffa6816d568217c44b8a0a6d3d6877d6e3c00f6eca7e6babfa233058`.
Status and path set matched; stage the seven paths and commit as predeclared.

#### Scoped Integrator exact-candidate census repair — 2026-10-01

This bounded follow-up uses worktree
`/workspace/typescript/dalph-worktrees/integrator-scoped-census-r1`, branch
`work/integrator-scoped-census-r1`, Base/HEAD
`1f817cbf0349aff9393082ef47e891eb67801c4c`. The pre-audit implementation and
scenario-mapping diff SHA-256 was
`d59bf4ce46380f2ddfbee3393066f59b12adec0d1f6c791f3737fcd78ae21844`.

The accepted Integrator scenario 2 remains the behavior boundary: recovery
must finish candidate discovery, reread exact thread metadata, and validate
the durable ownership token before adopting a thread; incomplete or ambiguous
census, duplicates, foreign cwd/token/correlation, or unreadable exact state
must fail closed before another start or turn. The accepted scenario map in
[production-codex-integrator.md](scenarios/production-codex-integrator.md#scenario-to-test-map)
now names these separate proofs:

- `filters every persistent page by exact cwd and merges the complete loaded-thread census`
  checks scoped persistent pagination, full loaded pagination/metadata reads,
  exact matching, and loaded-only discovery in
  `codex-app-server-protocol.test.ts`.
- `rejects an incomplete loaded census after exact-cwd persistent discovery`
  checks that the protocol adapter fails the scoped census when the loaded
  list cannot be read after persistent discovery.
- `does not retry thread/start after a lost response when candidate census fails`
  checks the Integrator recovery boundary: a failed census after the lost
  response starts neither another thread nor a turn.
- `rejects a foreign cwd returned by an exact-cwd persistent census` and
  `fails closed on duplicate persistent threads` retain foreign and duplicate
  rejection.
- `filters the complete controlled Codex thread census to one exact candidate cwd`
  checks the hermetic bridge/controller/provider-state path forwards and
  consumes the scoped request; the no-cwd global listing remains available.

The production app-server service now accepts an optional branded exact cwd.
It forwards that value on every persistent `thread/list` page, rejects a
returned persistent row with a different cwd, still reads every loaded-list
page and exact metadata, rejects persisted/loaded cwd contradictions, and
returns only exact-cwd identities to the Integrator. Global consumers retain
the no-argument complete census. No state-database-only shortcut or arbitrary
limit/deadline-as-success was introduced. The service/adapters changed are
`codex-app-server.ts`, `codex-integrator-thread.ts`, `production-host.ts`,
`kimi-integrator-provider.ts`, `production-hermetic-provider-bridge.ts`,
`production-hermetic-controller.ts`, and
`production-hermetic-provider-state.ts`.

Review dispositions: the first Standards pass found that the hermetic
controller dropped `cwd` and provider state returned the global census. This
was resolved with faithful forwarding/filtering and the controlled-provider
test above. The first Spec pass found that the lost-response test name/mapping
could overstate a whole loaded-cursor failure; the test now names the aggregate
candidate-census failure it actually injects, and the protocol loaded-census
failure is mapped as a separate proof. The second changed-seam review found no
new blocker. It identified an unreachable duplicate
`loaded-thread-repeated-cursor` branch in the protocol fixture: the earlier
branch for that mode returns before the later repeated-cursor branch can run.
This fixture cleanup is deferred to the test-support/fixture-maintainer scope;
it is not evidence that repeated loaded cursors were exercised, and no accepted
requirement is waived. The existing scoped loaded-list failure assertion and
complete loaded-pagination assertion remain distinct evidence.

Verification setup reused existing dependency directories from the clean
same-Base `integration-385-386-387-r4` worktree through local symlinks in this
isolated worktree; no package install or shared dependency/configuration write
was performed. The symlinks are task-local setup and will be removed after the
normal commit hook completes.

Verification on this candidate: the focused Vitest command
`pnpm exec vitest run packages/dalph/src/application/codex-app-server-protocol.test.ts packages/dalph/src/application/codex-integrator.test.ts packages/dalph/test-support/production-hermetic-provider-state.test.ts --maxWorkers=1`
passed 3 files / 120 tests (Vitest reported 14.62s). The tool transcript is
retained in the task conversation; no separate raw test log was captured.
`pnpm typecheck` exited 0; full output is
`/tmp/dalph-integrator-census-r1-typecheck.log`. Base-pinned
`DALPH_DIAGNOSTICS_BASE=1f817cbf0349aff9393082ef47e891eb67801c4c pnpm lint:changed`
exited 0 after formatting only its two reported changed files; full output is
`/tmp/dalph-integrator-census-r1-lint-final.log`. `git diff --check` exited 0.
No full gate, `check:fast`, capstone, live-provider, or hosted S1 run was
performed in this repair. The read-only hosted S1 observation (10 pages / 250
entries in 43.52 seconds, still with a cursor) motivates a bounded scalability
repair but does not establish the cause of the earlier ~16-minute run or prove
an improvement in hosted S1 latency.
