// Deliberately weakened transition profiles for checking that the safety
// properties reject the exact bugs they are meant to detect.
module frontierRecoveryCounterexamples {
  import frontierRecovery(CAPACITY = 2).* from "./frontierRecovery"

  pure def applyEffectWithoutIntent(s: State, task: TaskId): State = {
    val boundary = ClaimBoundary
    val taskEffects = s.effects.get(task)
    val taskEffectOperationIds = s.effectOperationIds.get(task)
    {
      ...s,
      authority:
        s.authority.put(task, authorityAfterEffect(s.authority.get(task), boundary)),
      effects:
        s.effects.put(
          task,
          taskEffects.put(boundary, taskEffects.get(boundary) + 1)
        ),
      effectOperationIds:
        s.effectOperationIds.put(
          task,
          taskEffectOperationIds.put(boundary, Set(1))
        ),
    }
  }

  action effectWithoutIntent(task: TaskId): bool = all {
    state.workflow.get(task).responsibility == Unowned,
    state.effects.get(task).get(ClaimBoundary) == 0,
    state' = applyEffectWithoutIntent(state, task),
  }

  action duplicateAppliedEffect(task: TaskId): bool = {
    val boundary = state.workflow.get(task).boundary
    val operationId = state.workflow.get(task).operationId
    val taskOperationIds = state.effectOperationIds.get(task)
    state' = {
      ...state,
      effectOperationIds:
        state.effectOperationIds.put(
          task,
          taskOperationIds.put(
            boundary,
            taskOperationIds.get(boundary).union(Set(operationId))
          )
        ),
      duplicateEffectViolations: state.duplicateEffectViolations + 1,
    }
  }

  action requestUsingStaleKnowledge(task: TaskId): bool = {
    val workflow = state.workflow.get(task)
    all {
      workflow.intentCommitted,
      workflow.requestAuthorized,
      not(knowledgeIsUsable(state, task)),
      state' = applyRequestWithEffect(state, task),
    }
  }

  // Start after an intent survived a coordinator restart. The retained
  // observation names the previous activation, so using it for the request is
  // necessarily stale rather than merely one possible sampled path.
  action initStaleKnowledgeCounterexample: bool = {
    val committed =
      refreshSelectorProjection(applyCommitFirstIntent(initialState, A))
    val restarted =
      refreshSelectorProjection(applyRestart(applyCrash(committed)))
    state' = restarted
  }

  action missingIntentStep: bool = {
    nondet task = TASKS.oneOf()
    any {
      progressStep,
      effectWithoutIntent(task),
    }
  }

  action duplicateEffectStep: bool = {
    nondet task = TASKS.oneOf()
    any {
      progressStep,
      duplicateAppliedEffect(task),
    }
  }

  action staleKnowledgeStep: bool = {
    requestUsingStaleKnowledge(A)
  }

  action duplicateExactOwner(task: TaskId): bool = all {
    activationOwnerExists(state, task),
    state' = {
      ...state,
      activation: {
        ...state.activation,
        ownerRegistrationCounts:
          state.activation.ownerRegistrationCounts.put(task, 2),
      },
    },
  }

  action readmitOwnedTransition(task: TaskId): bool = all {
    activationOwnerExists(state, task),
    state' = {
      ...state,
      activation: {
        ...state.activation,
        selectedTransitions:
          state.activation.selectedTransitions.union(Set(task)),
      },
    },
  }

  action leakDuplicateReservation(task: TaskId): bool = all {
    activationOwnerExists(state, task),
    state' = {
      ...state,
      activation: {
        ...state.activation,
        duplicateReservationLeaks:
          state.activation.duplicateReservationLeaks.union(Set(task)),
        isolatedSubjects:
          state.activation.isolatedSubjects.union(Set(task)),
      },
    },
  }

  action stopIndependentCOnDuplicate: bool = all {
    activationOwnerExists(state, A),
    state.activation.derivedTransitions.contains(C),
    state' = {
      ...state,
      activation: {
        ...state.activation,
        isolatedSubjects:
          state.activation.isolatedSubjects.union(Set(A)),
        selectedTransitions:
          state.activation.selectedTransitions.exclude(Set(C)),
      },
    },
  }

  action leakPreIntentInterruption(task: TaskId): bool = all {
    state.activation.positions.get(task)
      == ActivationPositionReserved({ selectedTaskId: task }),
    state.activation.owners.get(task) == NoActivationOwner,
    state' = {
      ...state,
      activation: {
        ...state.activation,
        preIntentInterrupted:
          state.activation.preIntentInterrupted.union(Set(task)),
      },
    },
  }

  action releasePostIntentPositionWithoutFreshEvidence(task: TaskId): bool = all {
    match state.activation.owners.get(task) {
      | PostIntentActivationOwner(_) => true
      | _ => false
    },
    state' = {
      ...state,
      activation: {
        ...state.activation,
        activationInProgress:
          state.activation.activationInProgress.exclude(Set(task)),
        owners: state.activation.owners.put(task, NoActivationOwner),
        ownerRegistrationCounts:
          state.activation.ownerRegistrationCounts.put(task, 0),
        positions:
          state.activation.positions.put(task, ActivationPositionNotUsing),
        runners: state.activation.runners.exclude(Set(task)),
        postIntentExited:
          state.activation.postIntentExited.union(Set(task)),
      },
    },
  }

  action delayedReleaseA17RemovesA18: bool =
    state' = {
      ...state,
      activation: {
        ...state.activation,
        lastReleaseCorrelation:
          ActivationReleaseObserved({
            requestedOperationId: 17,
            affectedOperationId: 18,
          }),
      },
    }

  action reserveWhileObservedUsageIsAtLowerLimit: bool = {
    val operationA = state.workflow.get(A).operationId
    val invocationA = executorOuterInvocationIdForOperation(operationA)
    state' = {
      ...state,
      executorInvocationAuthority:
        state.executorInvocationAuthority.put(
          A,
          ExecutorOuterInvocationActive({ invocationId: invocationA })
        ),
      activation: {
        ...state.activation,
        configuredCapacity: 1,
        positions:
          state.activation.positions
            .put(A, ActivationPositionWorking({ invocationId: invocationA }))
            .put(C, ActivationPositionReserved({ selectedTaskId: C })),
        freshExecutorOuterInvocationReports:
          state.activation.freshExecutorOuterInvocationReports.put(
            A,
            ExecutorOuterInvocationActive({ invocationId: invocationA })
          ),
      },
    }
  }

  action admitPausedTransitionFromStaleOrder: bool =
    state' = {
      ...state,
      control: {
        ...state.control,
        taskPaused: state.control.taskPaused.put(A, true),
      },
      activation: {
        ...state.activation,
        selectedTransitions: Set(A),
      },
    }

  // Deliberately changes Dalph's requirement without re-projecting it,
  // representing orchestration that derives capacity from an operation name.
  action projectCapacityFromOperationName: bool = {
    val current = state.workflow.get(A)
    state' = {
      ...state,
      workflow:
        state.workflow.put(A, {
          ...current,
          taskWorkCapacityRequirement: DoesNotRequireTaskWorkCapacity,
        }),
    }
  }

  action duplicateOwnershipStep: bool =
    deriveActivationPass
      .then(reserveTaskAdmissionPosition(A))
      .then(claimActivationOwnership(A))
      .then(duplicateExactOwner(A))

  action ownedReadmissionStep: bool =
    deriveActivationPass
      .then(reserveTaskAdmissionPosition(A))
      .then(claimActivationOwnership(A))
      .then(readmitOwnedTransition(A))

  action duplicateReservationLeakStep: bool =
    deriveActivationPass
      .then(reserveTaskAdmissionPosition(A))
      .then(claimActivationOwnership(A))
      .then(leakDuplicateReservation(A))

  action duplicateStopsIndependentCStep: bool =
    deriveActivationPass
      .then(reserveTaskAdmissionPosition(A))
      .then(claimActivationOwnership(A))
      .then(stopIndependentCOnDuplicate)

  action preIntentInterruptionLeakStep: bool =
    deriveActivationPass
      .then(reserveTaskAdmissionPosition(A))
      .then(leakPreIntentInterruption(A))

  action earlyPostIntentReleaseStep: bool =
    deriveActivationPass
      .then(reserveTaskAdmissionPosition(A))
      .then(claimActivationOwnership(A))
      .then(recordOwnedOperationIntent(A))
      .then(releasePostIntentPositionWithoutFreshEvidence(A))
}

module frontierRecoveryCapacityCounterexample {
  import frontierRecovery(CAPACITY = 1).* from "./frontierRecovery"

  // Deliberately omits the configured-position check from
  // canCommitFirstIntent. With independently eligible A and C, two steps can
  // reserve both tasks even though this profile has one position.
  action commitIgnoringConfiguredCapacity(task: TaskId): bool = all {
    state.coordinator.running,
    freshTaskIsEligible(state, task),
    not(hasSmallerEligibleFreshTask(state, task)),
    state' = refreshSelectorProjection(applyCommitFirstIntent(state, task)),
  }

  action weakenedCapacityStep: bool = {
    nondet task = Set(A, C).oneOf()
    commitIgnoringConfiguredCapacity(task)
  }
}
