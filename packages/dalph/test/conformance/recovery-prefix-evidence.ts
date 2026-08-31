import { trackerCompletionRecoveryTrace } from "./tracker-completion-recovery-trace.js"

const event = (tag: string) => ({ _tag: "WorkflowEventTag" as const, tag })
const cassette = (key: string) => ({ _tag: "MaintainedCassetteKey" as const, key })
const focused = (path: string, reference: string) => ({ _tag: "FocusedTestSeam" as const, path, reference })

/** Current journal, cassette, and focused-test evidence referenced by the recovery-prefix inventory. */
export const currentRecoveryPrefixEvidence = {
  trackerFacts: [
    event("TaskTrackerReadIntentRecorded"),
    event("TaskTrackerFactsObserved"),
    cassette("completionGraphRefreshRecovery"),
    focused(
      "packages/orchestrator/src/workflow/task-tracker-facts/observation.test.ts",
      "a lost post-success graph response authorizes no dependant and resumes only that read"
    )
  ],
  claimAcquisition: [
    event("TaskClaimAcquisitionIntended"),
    event("TaskClaimAcquired"),
    event("TaskClaimAcquisitionRejected"),
    cassette("changedAttemptReacquisitionForeignConflict"),
    focused(
      "packages/orchestrator/src/workflow/protocols/task-claim-acquisition/protocol.test.ts",
      "rereads tracker authority after an ambiguously applied acquisition"
    )
  ],
  claimRelease: [
    event("TaskClaimReleaseIntended"),
    event("TaskClaimReleased"),
    cassette("changedAttemptStopReleaseResponseLost"),
    focused(
      "packages/orchestrator/src/workflow/protocols/task-claim-release/protocol.test.ts",
      "accepts authoritative absence after an ambiguous release response"
    )
  ],
  worktree: [
    event("TaskWorktreeReconciliationIntended"),
    event("GitReadIntentRecorded"),
    event("PlannedAttemptWorktreeObserved"),
    event("TaskWorktreeReady"),
    cassette("lostPlannedWorktreeSafelySuspends"),
    focused(
      "packages/orchestrator/src/workflow-journal/journaled-worktree-observation.test.ts",
      "records the authored Git interruption and ordinary replay cassette"
    )
  ],
  targetLineage: [
    event("GitReadIntentRecorded"),
    event("TargetLineageObserved"),
    cassette("compatibleTargetAdvanceContinues"),
    focused(
      "packages/orchestrator/src/authorities/git/target-lineage.test.ts",
      "rejects unreadable targets, invalid commits, and indeterminate ancestry"
    )
  ],
  executor: [
    event("PlannedAttemptExecutorWorkResponsibilityBegan"),
    event("PlannedAttemptExecutorCommandIntended"),
    event("PlannedAttemptExecutorCommandProjectionObserved"),
    event("PlannedAttemptExecutorCommandResponseContradicted"),
    event("PlannedAttemptExecutorStateObserved"),
    event("PlannedAttemptExecutorWorkReported"),
    cassette("coordinatorProcessDeathContinues"),
    focused("packages/dalph/test/conformance/planned-attempt-executor.mbt.test.ts", "quintIt")
  ],
  integrator: [
    event("IntegrationResponsibilityBegan"),
    event("IntegrationStarted"),
    event("IntegratorSessionFixed"),
    event("IntegratorRunStarted"),
    event("IntegratorRunResultRecorded"),
    event("IntegratorRunCandidateGitReadIntended"),
    event("IntegratorRunCandidateGitObserved"),
    cassette("targetPromotionSuccess"),
    focused("packages/orchestrator/src/workflow/protocols/integrator/protocol.test.ts", "outer Integrator protocol")
  ],
  promotion: [
    event("TargetPromotionIntended"),
    event("TargetPromotionAttemptIntended"),
    event("TargetPromotionObservedSuccess"),
    event("TargetPromotionStale"),
    event("TargetPromotionNonConvergence"),
    cassette("targetPromotionLostResponseDiscoversCurrentCandidate"),
    focused(
      "packages/orchestrator/src/workflow/protocols/target-promotion/outer-protocol.test.ts",
      "reads before retrying an ambiguous exact-head promotion and never sends a fourth attempt"
    )
  ],
  completion: [
    event("CompletionTaskIntended"),
    event("CompletionTaskAttemptIntended"),
    event("CompletionTaskAcknowledged"),
    event("CompletionTaskRejected"),
    event("CompletionTaskResponseLost"),
    event("CompletionClaimReplacementIntended"),
    event("CompletionClaimReplacementAttemptIntended"),
    event("CompletionClaimReplaced"),
    event("CompletionClaimDeletionIntended"),
    event("CompletionClaimDeletionAttemptIntended"),
    event("CompletionClaimDeletionReadObserved"),
    event("CompletionClaimDeleted"),
    event("IntegrationFinalitySettled"),
    cassette(trackerCompletionRecoveryTrace.cassetteKey),
    focused(
      "packages/orchestrator/src/workflow/protocols/integration-finality/protocol.test.ts",
      "writes replacement intent first and reconciles an unknown response by a fresh claim read"
    )
  ],
  controlDirection: [
    event("ControlDirectionApplied"),
    cassette("runPauseSafelySuspends"),
    focused(
      "packages/orchestrator/src/workflow/protocols/control-direction-application/protocol.property.test.ts",
      "round-trips every generated applied control direction through the journal codec"
    )
  ],
  attemptChoice: [
    event("AttemptChoiceApplied"),
    event("AttemptStoppageIntended"),
    event("AttemptImplementationAbandoned"),
    cassette("changedAttemptChoiceRace"),
    focused(
      "packages/orchestrator/src/workflow/protocols/attempt-choice/control.test.ts",
      "lets the first journaled valid choice win a concurrent Continue and Stop race"
    )
  ],
  worktreeCleanup: [
    event("WorktreeCleanupAuthorized"),
    event("WorktreeCleanupObservationIntended"),
    event("WorktreeCleanupObserved"),
    event("WorktreeCleanupAbsenceConfirmed"),
    event("WorktreeCleanupMutationIntended"),
    event("WorktreeCleanupMutationResultRecorded"),
    event("WorktreeCleanupContradicted"),
    event("WorktreeCleanupSettled"),
    focused(
      "packages/orchestrator/src/workflow/protocols/disposition-cleanup/worktree.test.ts",
      "reconciles an applied response loss with a fresh absence and never duplicates remove"
    )
  ],
  branchCleanup: [
    event("BranchCleanupAuthorized"),
    event("BranchCleanupObservationIntended"),
    event("BranchCleanupObserved"),
    event("BranchCleanupAbsenceConfirmed"),
    event("BranchCleanupMutationIntended"),
    event("BranchCleanupMutationResultRecorded"),
    event("BranchCleanupContradicted"),
    event("BranchCleanupSettled"),
    focused(
      "packages/orchestrator/src/workflow/protocols/disposition-cleanup/branch.test.ts",
      "deletes a planned branch only after the exact worktree settlement"
    )
  ],
  integratorCandidateCleanup: [
    event("IntegratorCandidateCleanupAuthorized"),
    event("IntegratorCandidateCleanupObservationIntended"),
    event("IntegratorCandidateCleanupObserved"),
    event("IntegratorCandidateCleanupAbsenceConfirmed"),
    event("IntegratorCandidateCleanupMutationIntended"),
    event("IntegratorCandidateCleanupMutationResultRecorded"),
    event("IntegratorCandidateCleanupContradicted"),
    event("IntegratorCandidateCleanupSettled"),
    focused(
      "packages/orchestrator/src/workflow/protocols/disposition-cleanup/integrator-candidate.test.ts",
      "removes only a quarantined predecessor candidate"
    )
  ],
  runEstablishment: [
    event("WorkflowRunBegan"),
    event("WorkflowRunTerminated"),
    cassette("coordinatorProcessDeathContinues"),
    focused(
      "packages/orchestrator/src/coordination/run/journaled-run-bootstrap.test.ts",
      "re-enters an unfinished Run without evaluating the initial policy source"
    )
  ],
  applicationExit: [focused("packages/dalph/test/conformance/application-exit.mbt.test.ts", "quintIt")]
} as const
