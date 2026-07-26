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
    val workflow = state.workflow.get(task)
    all {
      workflow.intentCommitted,
      state.effects.get(task).get(workflow.boundary) == 1,
      state' = applyRequestWithEffect(state, task),
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
    nondet task = TASKS.oneOf()
    any {
      orchestratorCommitsFreshTaskClaimIntent(task),
      crash,
      restart,
      requestUsingStaleKnowledge(task),
    }
  }
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
