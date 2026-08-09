module runActivationTest {
  import runActivation.* from "./runActivation"

  run absentHistoryEstablishesOneBeginningTest = {
    init
      .then(establishAbsentHistory)
      .expect(and {
        state.trace.initialPolicyEvaluations == 1,
        state.trace.beginningAppends == 1,
        state.process.establishmentSource == BeginningAppended,
        beginningRecordsExactLazyPolicy,
        absentHistoryEstablishedReached,
      })
  }

  run ambiguousBeginningAppendReconstructsSameRunTest = {
    init
      .then(establishAbsentHistory)
      .then(crash)
      .then(establishExistingHistory)
      .expect(and {
        state.trace.initialPolicyEvaluations == 1,
        state.trace.beginningAppends == 1,
        not(state.process.initialPolicyEvaluated),
        not(state.process.beginningAppended),
        existingHistorySkipsInitialPolicy,
        processLossPreservesDurableHistory,
      })
  }

  run existingHistorySkipsInitialPolicyTest = {
    init
      .then(selectExactExistingHistory)
      .then(establishExistingHistory)
      .expect(and {
        state.trace.initialPolicyEvaluations == 0,
        state.trace.beginningAppends == 0,
        establishedFacts(state.process.establishedRun).latestPolicy == LATEST_POLICY,
        existingHistoryUsesLatestDurablePolicy,
        existingHistoryEstablishedReached,
      })
  }

  run heldAdmissionReconstructedBeforeNewWorkTest = {
    init
      .then(selectExactExistingHistory)
      .then(establishExistingHistory)
      .then(activateEstablishedRun)
      .expect(and {
        retainedPositionReconstructedReached,
        not(state.process.independentTaskAdmitted),
        everyDurableRetainedAttemptHasExactPosition,
        latestPolicyControlsAdmission,
      })
  }

  run contractedRetainedHolderIsRestoredDespiteCapacityTest = {
    init
      .then(selectContractedExactExistingHistory)
      .then(establishExistingHistory)
      .then(activateEstablishedRun)
      .expect(and {
        contractedRetainedPositionReached,
        state.process.heldPosition == ExactTaskPosition(RETAINED_ATTEMPT_A),
        state.process.otherHeldPosition == ExactTaskPosition(RETAINED_ATTEMPT_B),
        establishedFacts(state.process.establishedRun).initialPolicy.taskCapacity == Capacity2,
        establishedFacts(state.process.establishedRun).latestPolicy.taskCapacity == Capacity1,
        everyDurableRetainedAttemptHasExactPosition,
        latestPolicyControlsAdmission,
      })
  }

  run contractedCapacityBlocksNewAdmissionAfterRetainedHolderSettlesTest = {
    init
      .then(selectContractedExactExistingHistory)
      .then(establishExistingHistory)
      .then(activateEstablishedRun)
      .then(readInitialTrackerGraph)
      .then(settleRetainedAttempt)
      .expect(and {
        state.process.heldPosition == NoTaskPosition,
        state.process.otherHeldPosition == ExactTaskPosition(RETAINED_ATTEMPT_B),
        not(state.process.independentTaskAdmitted),
        not(newIndependentAdmissionAllowed),
        establishedFacts(state.process.establishedRun).latestPolicy.taskCapacity == Capacity1,
        latestPolicyControlsAdmission,
      })
  }

  run exactEvidenceReleasesHeldAdmissionBeforeNewWorkTest = {
    init
      .then(selectExactExistingHistory)
      .then(establishExistingHistory)
      .then(activateEstablishedRun)
      .then(readInitialTrackerGraph)
      .then(settleRetainedAttempt)
      .then(admitIndependentTask)
      .expect(and {
        independentAdmissionReached,
        state.process.heldPosition == ExactTaskPosition(INDEPENDENT_ATTEMPT_C),
        state.trace.executorCalls == 2,
        independentAdmissionRequiresAvailablePosition,
      })
  }

  run bothRetainedAttemptsSettleBeforeNewTaskAdmissionTest = {
    init
      .then(selectContractedExactExistingHistory)
      .then(establishExistingHistory)
      .then(activateEstablishedRun)
      .then(readInitialTrackerGraph)
      .then(settleRetainedAttempt)
      .then(settleOtherRetainedAttempt)
      .then(admitIndependentTask)
      .expect(and {
        state.process.heldPosition == ExactTaskPosition(INDEPENDENT_ATTEMPT_C),
        state.process.otherHeldPosition == NoTaskPosition,
        unfinishedFacts(state.durable.history).retainedAttempt
          == ExactRetainedAttempt(INDEPENDENT_ATTEMPT_C),
        unfinishedFacts(state.durable.history).otherRetainedAttempt == NoRetainedAttempt,
        state.trace.executorCalls == 3,
        otherRetainedAttemptSettledReached,
        everyDurableRetainedAttemptHasExactPosition,
        independentAdmissionRequiresAvailablePosition,
        latestPolicyControlsAdmission,
      })
  }

  run newAndReconstructedActivationHaveFinalityParityTest = {
    init
      .then(establishAbsentHistory)
      .then(activateEstablishedRun)
      .then(readInitialTrackerGraph)
      .then(reachQuiescence)
      .then(readPostQuiescenceTrackerGraph)
      .then(returnIncomplete)
      .then(invokeSameEntryAgain)
      .then(establishExistingHistory)
      .then(activateEstablishedRun)
      .then(readInitialTrackerGraph)
      .then(reachQuiescence)
      .then(readPostQuiescenceTrackerGraph)
      .expect(and {
        state.trace.activationsStarted == 2,
        state.trace.trackerCalls == 4,
        state.process.postQuiescenceReads == 1,
        postQuiescenceAfterExistingReached,
        establishmentSourceDoesNotChangeActivationBounds,
      })
  }

  run processLossReentersOrdinaryEstablishmentTest = {
    init
      .then(selectExactExistingHistory)
      .then(establishExistingHistory)
      .then(activateEstablishedRun)
      .then(crash)
      .then(establishExistingHistory)
      .then(activateEstablishedRun)
      .expect(and {
        state.trace.processLosses == 1,
        state.trace.activationsStarted == 2,
        state.process.establishmentSource == ExistingHistoryReduced,
        retainedPositionReconstructedReached,
        oneBeginningPerRun,
      })
  }

  run mismatchedExistingHistoryNeverActivatesTest = {
    init
      .then(selectMismatchedExistingHistory)
      .then(rejectMismatchedHistory)
      .expect(and {
        targetMismatchBlockedReached,
        state.process.entryFailure == TargetMismatchFailure,
        mismatchBlockedReached,
        state.trace.activationsStarted == 0,
        state.trace.trackerCalls == 0,
      })
  }

  run otherUnfinishedRunDoesNotStandInForRequestedRunTest = {
    init
      .then(selectOtherUnfinishedRun)
      .then(rejectMismatchedHistory)
      .expect(and {
        requestedRunAbsentBlockedReached,
        state.process.entryFailure == OtherUnfinishedRunFailure,
        mismatchBlockedReached,
        state.requestedRunId == R2,
        state.trace.activationsStarted == 0,
        state.trace.trackerCalls == 0,
      })
  }

  run invalidExistingHistoryNeverActivatesTest = {
    init
      .then(selectInvalidHistory)
      .then(rejectInvalidHistory)
      .expect(and {
        invalidChronologyBlockedReached,
        state.process.entryFailure == InvalidChronologyFailure,
        invalidHistoryBlockedReached,
        state.trace.activationsStarted == 0,
        state.trace.trackerCalls == 0,
      })
  }

  run duplicateBeginningHistoryNeverActivatesTest = {
    init
      .then(selectDuplicateBeginningHistory)
      .then(rejectInvalidHistory)
      .expect(and {
        duplicateBeginningBlockedReached,
        state.process.entryFailure == DuplicateBeginningFailure,
        invalidHistoryBlockedReached,
        state.trace.activationsStarted == 0,
        state.trace.trackerCalls == 0,
      })
  }

  run foreignRunRecordHistoryNeverActivatesTest = {
    init
      .then(selectForeignRunRecordHistory)
      .then(rejectInvalidHistory)
      .expect(and {
        foreignRunRecordBlockedReached,
        state.process.entryFailure == ForeignRunRecordFailure,
        invalidHistoryBlockedReached,
        state.trace.activationsStarted == 0,
        state.trace.trackerCalls == 0,
      })
  }

  run multipleUnfinishedRunsBlockEveryActivationTest = {
    init
      .then(selectMultipleUnfinishedHistories)
      .then(rejectMultipleUnfinishedHistories)
      .expect(and {
        multipleUnfinishedBlockedReached,
        state.process.entryFailure == MultipleUnfinishedRunsFailure,
        state.trace.activationsStarted == 0,
        state.trace.trackerCalls == 0,
        atMostOneDiscoveredUnfinishedRunMayActivate,
      })
  }

  run terminatedHistoryNeverActivatesTest = {
    init
      .then(selectTerminatedHistory)
      .then(rejectTerminatedHistory)
      .expect(and {
        terminatedHistoryBlockedReached,
        state.process.entryFailure == TerminatedRunFailure,
        state.trace.activationsStarted == 0,
        state.trace.trackerCalls == 0,
        terminatedRunIsFinal,
      })
  }

  run settledRunTerminatesOnlyAfterLaterObservationTest = {
    init
      .then(trackerFactsBecomeSettled)
      .then(establishAbsentHistory)
      .then(activateEstablishedRun)
      .then(readInitialTrackerGraph)
      .then(reachQuiescence)
      .then(readPostQuiescenceTrackerGraph)
      .then(terminateRun)
      .expect(and {
        terminatedReached,
        state.trace.trackerCalls == 2,
        terminationRequiresLaterSettledObservation,
        terminationRequiresNoRetainedResponsibilityOrPosition,
        terminatedRunIsFinal,
      })
  }
}
