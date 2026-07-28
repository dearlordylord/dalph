module frontierRecoveryTest {
  import frontierRecovery(CAPACITY = 2).* from "./frontierRecovery"

  action applyAndRecordCurrentBoundary(task: TaskId): bool =
    requestApplies(task)
      .then(observeTask(task))
      .then(recordBoundaryOutcome(task))

  action completeClaim(task: TaskId): bool =
    orchestratorCommitsFreshTaskClaimIntent(task)
      .then(applyAndRecordCurrentBoundary(task))

  action completeResponsibleBoundary(task: TaskId): bool =
    commitResponsibleIntent(task)
      .then(applyAndRecordCurrentBoundary(task))

  action reachInvocation(task: TaskId): bool =
    completeClaim(task)
      .then(completeResponsibleBoundary(task))
      .then(completeResponsibleBoundary(task))

  action acceptInvocation(task: TaskId): bool =
    commitResponsibleIntent(task)
      .then(requestApplies(task))
      .then(providerAcceptsInvocation(task))
      .then(observeTask(task))
      .then(recordBoundaryOutcome(task))

  action completeSuccessfulTask(task: TaskId): bool =
    reachInvocation(task)
      .then(acceptInvocation(task))
      .then(completeResponsibleBoundary(task))
      .then(completeResponsibleBoundary(task))
      .then(completeResponsibleBoundary(task))
      .then(completeResponsibleBoundary(task))

  run deterministicFirstAdmissionTest =
    init
      .then(orchestratorCommitsFreshTaskClaimIntent(A))
      .expect(and {
        taskWorkCapacityRequirementIsZeroOrOne,
        taskWorkCapacityRequirementIsProjected,
        state.workflow.get(A).responsibility == Outstanding,
        state.workflow.get(C).responsibility == Unowned,
      })

  run secondIndependentAdmissionTest =
    init
      .then(orchestratorCommitsFreshTaskClaimIntent(A))
      .then(orchestratorCommitsFreshTaskClaimIntent(C))
      .expect(initialReservedCount(state) == CAPACITY)

  run activationOwnershipBeforeAndAfterIntentTest =
    init
      .then(deriveActivationPass)
      .then(reserveTaskAdmissionPosition(A))
      .then(claimActivationOwnership(A))
      .expect(and {
        activationOwnershipBeforeIntentReached,
        ownedTransitionIsNotReadmitted,
      })
      .then(recordOwnedOperationIntent(A))
      .expect(and {
        activationOwnershipAfterIntentReached,
        postIntentOwnerUsesStableOperationIdentity,
        postIntentSelectionAliasIsCorrelationOnly,
      })

  run preIntentInterruptionMakesExactPositionAvailableTest =
    init
      .then(deriveActivationPass)
      .then(reserveTaskAdmissionPosition(A))
      .then(interruptBeforeOwnership(A))
      .expect(state.activation.positions.get(A) == ActivationPositionNotUsing)
      .then(deriveActivationPass)
      .then(reserveTaskAdmissionPosition(A))
      .then(claimActivationOwnership(A))
      .then(interruptAfterOwnershipBeforeIntent(A))
      .expect(and {
        state.activation.positions.get(A) == ActivationPositionNotUsing,
        state.activation.owners.get(A) == NoActivationOwner,
      })

  run postIntentExitWaitsForFreshEvidenceTest =
    init
      .then(deriveActivationPass)
      .then(reserveTaskAdmissionPosition(A))
      .then(claimActivationOwnership(A))
      .then(recordOwnedOperationIntent(A))
      .then(interruptAfterIntent(A))
      .expect(and {
        activationPostIntentInterruptionReached,
        postIntentExitRetainsPositionUntilFreshEvidence,
      })
      .then(observeCapacityReleased(A))
      .expect(and {
        activationFreshNonConsumptionReached,
        state.activation.positions.get(A) == ActivationPositionNotUsing,
      })

  run resultReleaseSignalsRederivationTest =
    init
      .then(deriveActivationPass)
      .then(reserveTaskAdmissionPosition(A))
      .then(claimActivationOwnership(A))
      .then(recordOwnedOperationIntent(A))
      .then(recordOwnedResultAndRelease(A))
      .expect(and {
        activationResultReleaseReached,
        state.activation.positions.get(A) == ActivationPositionNotUsing,
      })

  run changedCapacityReconstructionDoesNotPreemptTest =
    initChangedCapacityActivationProfile
      .then(reconstructActivation)
      .expect(and {
        activationChangedCapacityReconstructionReached,
        lowerRestartCapacityDoesNotPreemptObservedUsage,
        newReservedPositionsRespectConfiguredCapacity,
      })

  run mismatchedProviderOperationCountsTaskOnceAndAdmitsAnotherTaskTest =
    initCorrelationConflictActivationProfile
      .then(deriveActivationPass)
      .expect(and {
        capacityUsageCountsTasksNotOperationCorrelations,
        correlationConflictRetainsOneTaskPosition,
        activationCapacityUsage(state) == 1,
        canReserveTaskAdmissionPosition(state, C),
      })
      .then(reserveTaskAdmissionPosition(C))
      .expect(and {
        activationCapacityUsage(state) == 2,
        match state.activation.positions.get(A) {
          | ActivationPositionCorrelationConflict(conflict) =>
              conflict.expectedOperationId
                != conflict.observedOperationId
          | _ => false
        },
        state.activation.positions.get(C)
          == ActivationPositionReserved({ selectedTaskId: C }),
      })

  run differentlyCorrelatedTerminalReportKeepsExpectedOperationHeldTest =
    initCorrelationConflictActivationProfile
      .then(observeConflictingOperationReleased(A, 101))
      .expect(and {
        activationCapacityUsage(state) == 1,
        state.activation.positions.get(A)
          == ActivationPositionAwaitingProviderEvidence({
            operationId: 1,
          }),
      })

  run repeatedMismatchedReportsKeepOneTaskPositionTest =
    initCorrelationConflictActivationProfile
      .then(observeConflictingCapacityCorrelation(A, 101))
      .then(observeConflictingCapacityCorrelation(A, 101))
      .expect(and {
        capacityUsageCountsTasksNotOperationCorrelations,
        activationCapacityUsage(state) == 1,
        state.activation.positions.get(A)
          == ActivationPositionCorrelationConflict({
            expectedOperationId: 1,
            observedOperationId: 101,
          }),
      })

  run restartRecreatesExactCorrelationConflictTest =
    initCorrelationConflictActivationProfile
      .then(crashCoordinatorWithActivation)
      .then(readProviderInvocationForReconstruction(A))
      .then(reconstructActivation)
      .expect(
        state.activation.positions.get(A)
          == ActivationPositionCorrelationConflict({
            expectedOperationId: 1,
            observedOperationId: 101,
          })
      )

  run unknownProviderReportKeepsExpectedTaskPositionTest =
    initAwaitingProviderEvidenceActivationProfile
      .then(observeCapacityUnknown(A))
      .expect(and {
        activationCapacityUsage(state) == 1,
        state.activation.positions.get(A)
          == ActivationPositionAwaitingProviderEvidence({
            operationId: 1,
          }),
        state.activation.freshProviderInvocationObservations.get(A)
          == ProviderInvocationUnknown({ operationId: 1 }),
      })

  run unknownReportDoesNotEraseDifferentlyCorrelatedActiveEvidenceTest =
    initCorrelationConflictActivationProfile
      .then(observeCapacityUnknown(A))
      .expect(and {
        activationCapacityUsage(state) == 1,
        state.activation.positions.get(A)
          == ActivationPositionCorrelationConflict({
            expectedOperationId: 1,
            observedOperationId: 101,
          }),
      })

  run absentProviderReportReleasesExpectedTaskPositionTest =
    initAwaitingProviderEvidenceActivationProfile
      .then(observeCapacityUnknown(A))
      .then(observeCapacityAbsent(A))
      .expect(and {
        activationCapacityUsage(state) == 0,
        state.activation.positions.get(A)
          == ActivationPositionNotUsing,
        state.activation.freshProviderInvocationObservations.get(A)
          == ProviderInvocationAbsent({ operationId: 1 }),
      })

  run interruptedProviderReportReleasesExpectedTaskPositionTest =
    initAwaitingProviderEvidenceActivationProfile
      .then(observeCapacityUnknown(A))
      .then(observeCapacityInterrupted(A))
      .expect(and {
        activationCapacityUsage(state) == 0,
        state.activation.positions.get(A)
          == ActivationPositionNotUsing,
        state.activation.freshProviderInvocationObservations.get(A)
          == ProviderInvocationInterrupted({ operationId: 1 }),
      })

  run rejectsTwoCurrentCapacityOperationsForOneTaskTest =
    initInvalidCurrentCapacityHistory
      .then(validateCurrentCapacityHistoryBeforeReconstruction)
      .expect(and {
        state.currentCapacityHistoryValidation
          == CapacityHistoryRejected,
        rejectedCapacityHistoryDerivesNoFrontier,
        not(state.coordinator.running),
        state.activation.derivedTransitions.size() == 0,
        state.selectorProjection.frontierTaskIds.size() == 0,
        state.selectorProjection.admittedTaskIds.size() == 0,
      })

  run completeProtocolKeepsFinalitiesDistinctTest =
    init
      .then(completeSuccessfulTask(A))
      .expect(and {
        state.authority.get(A).lifecycle == Completed,
        state.authority.get(A).claim == Unclaimed,
        state.workflow.get(A).attemptOutcome == AttemptAccepted,
        state.workflow.get(A).settlement == TrackerCompleted,
        state.workflow.get(A).responsibility == Settled,
        state.workflow.get(A).boundary == NoBoundary,
      })

  run absentRequestRetriesSameOperationTest =
    init
      .then(orchestratorCommitsFreshTaskClaimIntent(A))
      .then(requestChangesNothing(A))
      .then(observeTask(A))
      .then(authorizeRetry(A))
      .then(requestApplies(A))
      .then(observeTask(A))
      .then(recordBoundaryOutcome(A))
      .expect(and {
        state.requestOperationIds.get(A).get(ClaimBoundary) == Set(1),
        state.effects.get(A).get(ClaimBoundary) == 1,
        state.workflow.get(A).boundary == WorktreeBoundary,
      })

  run crashAfterIntentRequiresFreshReadTest =
    init
      .then(orchestratorCommitsFreshTaskClaimIntent(A))
      .then(crash)
      .then(restart)
      .expect(not(canApplyRequestEffect(state, A)))
      .then(observeTask(A))
      .then(requestApplies(A))
      .expect(state.requestFreshnessViolations == 0)

  run taskPauseLeavesIndependentBranchRunnableTest =
    init
      .then(requestTaskPause(A))
      .expect(and {
        not(canCommitFirstIntent(state, A)),
        not(canCommitFirstIntent(state, D)),
        not(isGroupingPaused(state, B)),
        not(isGroupingPaused(state, C)),
        isGroupingPaused(state, D),
      })
      .then(orchestratorCommitsFreshTaskClaimIntent(C))
      .then(requestTaskUnpause(A))
      .expect(not(canCommitFirstIntent(state, D)))
      .then(observeTask(D))
      .then(orchestratorCommitsFreshTaskClaimIntent(D))
      .expect(and {
        state.workflow.get(C).responsibility == Outstanding,
        state.workflow.get(A).responsibility == Unowned,
        state.workflow.get(D).responsibility == Outstanding,
      })

  run runPauseUnpauseRereadsBeforeAdmissionTest =
    init
      .then(requestRunPause)
      .expect(and {
        not(canCommitFirstIntent(state, A)),
        not(canCommitFirstIntent(state, C)),
      })
      .then(requestRunUnpause)
      .expect(and {
        not(canCommitFirstIntent(state, A)),
        not(canCommitFirstIntent(state, C)),
      })
      .then(observeTask(A))
      .then(orchestratorCommitsFreshTaskClaimIntent(A))
      .expect(state.workflow.get(A).responsibility == Outstanding)

  run pauseInterruptUnpauseRereadsBeforeReinvocationTest =
    init
      .then(reachInvocation(A))
      .then(commitResponsibleIntent(A))
      .then(requestApplies(A))
      .then(requestTaskPause(A))
      .then(providerInterruptsInvocation(A))
      .then(observeTask(A))
      .then(recordInterruptedInvocation(A))
      .then(requestTaskUnpause(A))
      .expect(not(canCommitResponsibleIntent(state, A)))
      .then(observeTask(A))
      .then(commitResponsibleIntent(A))
      .expect(and {
        state.workflow.get(A).boundary == InvocationBoundary,
        state.workflow.get(A).operationId == 5,
        state.workflow.get(A).attemptOutcome == AttemptPending,
      })

  run claimLossIsolatesOnlyAffectedTaskTest =
    init
      .then(completeClaim(A))
      .then(loseClaim(A))
      .then(observeTask(A))
      .then(classifyAuthorityConstraint(A))
      .then(orchestratorCommitsFreshTaskClaimIntent(C))
      .expect(and {
        state.workflow.get(A).isolation == ClaimAuthorityIsolated,
        state.workflow.get(C).responsibility == Outstanding,
      })

  run unreadabilityBoundIsolatesExactSubjectTest =
    init
      .then(completeClaim(A))
      .then(authorityBecomesUnreadable(A))
      .then(observeTask(A))
      .then(observeTask(A))
      .then(classifyAuthorityConstraint(A))
      .expect(state.workflow.get(A).isolation == ObservationIsolated)

  run compatibleTargetAdvanceContinuesAfterFreshReadTest =
    init
      .then(completeClaim(A))
      .then(advanceTargetCompatibly(A))
      .expect(not(canCommitResponsibleIntent(state, A)))
      .then(observeTask(A))
      .then(commitResponsibleIntent(A))
      .expect(state.workflow.get(A).boundary == WorktreeBoundary)

  run rewrittenTargetIsolatesOnlyAffectedTaskTest =
    init
      .then(completeClaim(A))
      .then(rewriteTarget(A))
      .then(observeTask(A))
      .then(classifyAuthorityConstraint(A))
      .then(orchestratorCommitsFreshTaskClaimIntent(C))
      .expect(and {
        state.workflow.get(A).isolation == GitLineageIsolated,
        state.workflow.get(C).responsibility == Outstanding,
      })

  run lostWorktreeRecordsAttemptOutcomeTest =
    init
      .then(reachInvocation(A))
      .then(loseWorktree(A))
      .then(observeTask(A))
      .then(classifyAuthorityConstraint(A))
      .expect(and {
        state.workflow.get(A).isolation == WorktreeLostIsolated,
        state.workflow.get(A).attemptOutcome == AttemptWorktreeLost,
        state.workflow.get(A).responsibility == Outstanding,
      })

  run externallyCompletedTaskSettlesWithoutDuplicateEffectTest =
    init
      .then(completeClaim(A))
      .then(externallyCompleteTask(A))
      .then(observeTask(A))
      .then(settleExternalCompletion(A))
      .expect(and {
        state.workflow.get(A).settlement == TrackerCompleted,
        state.workflow.get(A).responsibility == Settled,
        state.effects.get(A).get(CompletionBoundary) == 0,
      })

  run newBlockerWaitsWithoutStoppingUnrelatedTaskTest =
    init
      .then(addBlockerToC)
      .then(observeTask(C))
      .expect(not(canCommitFirstIntent(state, C)))
      .then(orchestratorCommitsFreshTaskClaimIntent(A))
      .expect(and {
        state.workflow.get(C).responsibility == Unowned,
        state.workflow.get(A).responsibility == Outstanding,
      })
}

module frontierRecoveryCapacityOneTest {
  import frontierRecovery(CAPACITY = 1).* from "./frontierRecovery"

  run twoEligibleTasksUseOneConfiguredPositionTest =
    init
      .expect(and {
        state.selectorProjection.capacity == 1,
        state.selectorProjection.frontierTaskIds == Set(A, C),
        state.selectorProjection.admittedTaskIds == Set(A),
        state.selectorProjection.reservationTaskIds == Set(A),
      })
      .then(orchestratorCommitsNextFreshTaskClaimIntent)
      .then(orchestratorCommitsNextFreshTaskClaimIntent)
      .expect(and {
        state.workflow.get(A).responsibility == Outstanding,
        state.workflow.get(C).responsibility == Unowned,
        state.selectorProjection.frontierTaskIds == Set(A, C),
        state.selectorProjection.admittedTaskIds == Set(A),
        state.selectorProjection.transitionOperations.get(A)
          == DurableTransitionOperation({ operationId: 1 }),
        state.selectorProjection.transitionOperations.get(C)
          == FreshTransitionWithoutOperation(()),
        state.selectorProjection.reservationTaskIds == Set(A),
        state.selectorProjection.explanations == Set({
          taskId: C,
          tag: "CapacityWait",
          wakeCondition: "CapacityReleasedOrReconstructedStateChanged",
        }),
        initialReservedCount(state) == 1,
      })

  run existingResponsibilityPrecedesSmallerFreshTaskTest =
    initCapacityOneResponsibilityFirstProfile
      .expect(and {
        state.selectorProjection.frontierTaskIds == Set(A, C),
        state.selectorProjection.admittedTaskIds == Set(C),
        state.selectorProjection.reservationTaskIds == Set(C),
        state.selectorProjection.explanations == Set({
          taskId: A,
          tag: "CapacityWait",
          wakeCondition: "CapacityReleasedOrReconstructedStateChanged",
        }),
      })

  run unresolvedTaskUsesTheOnlyPositionOnceTest =
    initCorrelationConflictActivationProfile
      .then(deriveActivationPass)
      .expect(and {
        capacityUsageCountsTasksNotOperationCorrelations,
        correlationConflictRetainsOneTaskPosition,
        activationCapacityUsage(state) == 1,
        not(canReserveTaskAdmissionPosition(state, C)),
        state.activation.positions.get(C) == ActivationPositionNotUsing,
      })
}
