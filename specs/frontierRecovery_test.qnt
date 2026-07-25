module frontierRecoveryTest {
  import frontierRecovery.* from "./frontierRecovery"

  action applyAndRecordCurrentBoundary(task: TaskId): bool =
    requestApplies(task)
      .then(observeTask(task))
      .then(recordBoundaryOutcome(task))

  action completeClaim(task: TaskId): bool =
    commitFirstIntent(task)
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
      .then(commitFirstIntent(A))
      .expect(and {
        state.workflow.get(A).responsibility == Outstanding,
        state.workflow.get(C).responsibility == Unowned,
      })

  run secondIndependentAdmissionTest =
    init
      .then(commitFirstIntent(A))
      .then(commitFirstIntent(C))
      .expect(initialReservedCount(state) == CAPACITY)

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
      .then(commitFirstIntent(A))
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
      .then(commitFirstIntent(A))
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
      .then(commitFirstIntent(C))
      .then(requestTaskResume(A))
      .expect(not(canCommitFirstIntent(state, D)))
      .then(observeTask(D))
      .then(commitFirstIntent(D))
      .expect(and {
        state.workflow.get(C).responsibility == Outstanding,
        state.workflow.get(A).responsibility == Unowned,
        state.workflow.get(D).responsibility == Outstanding,
      })

  run runPauseResumeRereadsBeforeAdmissionTest =
    init
      .then(requestRunPause)
      .expect(and {
        not(canCommitFirstIntent(state, A)),
        not(canCommitFirstIntent(state, C)),
      })
      .then(requestRunResume)
      .expect(and {
        not(canCommitFirstIntent(state, A)),
        not(canCommitFirstIntent(state, C)),
      })
      .then(observeTask(A))
      .then(commitFirstIntent(A))
      .expect(state.workflow.get(A).responsibility == Outstanding)

  run pauseInterruptResumeRereadsBeforeReinvocationTest =
    init
      .then(reachInvocation(A))
      .then(commitResponsibleIntent(A))
      .then(requestApplies(A))
      .then(requestTaskPause(A))
      .then(providerInterruptsInvocation(A))
      .then(observeTask(A))
      .then(recordInterruptedInvocation(A))
      .then(requestTaskResume(A))
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
      .then(commitFirstIntent(C))
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
      .then(commitFirstIntent(C))
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
      .then(commitFirstIntent(A))
      .expect(and {
        state.workflow.get(C).responsibility == Unowned,
        state.workflow.get(A).responsibility == Outstanding,
      })
}
