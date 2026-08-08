module controlDirectionApplicationTest {
  import controlDirectionApplication.* from "./controlDirectionApplication"

  run crashBeforeApplicationLosesOnlyTheRequestTest = {
    init
      .then(receiveTaskAPause)
      .then(proveCurrentTaskA)
      .then(crashAndRestart)
      .expect(state.pendingRequest == NoRequest and not(state.taskAPaused) and state.appliedCount == 0)
  }

  run crashAfterApplicationReconstructsTheExactDirectionTest = {
    init
      .then(receiveTaskAPause)
      .then(proveCurrentTaskA)
      .then(applyPending)
      .then(crashAndRestart)
      .expect(
        state.taskAPaused
          and not(state.taskBPaused)
          and state.lastApplied == Applied({ subject: TaskASubject, direction: Pause })
          and state.appliedCount == 1
      )
  }

  run laterDirectionReplacesOnlyItsExactSubjectTest = {
    init
      .then(receiveTaskAPause)
      .then(proveCurrentTaskA)
      .then(applyPending)
      .then(receiveRunPause)
      .then(applyPending)
      .then(receiveTaskAUnpause)
      .then(proveCurrentTaskA)
      .then(applyPending)
      .expect(state.runPaused and not(state.taskAPaused) and not(state.taskBPaused) and taskUnpauseAppliedReached)
  }

  run acceptedCurrentTaskRequiresMembershipReadTest = {
    init
      .then(receiveTaskAPause)
      .then(proveCurrentTaskA)
      .then(applyPending)
      .expect(state.taskAPaused and state.lastControlResult == DirectionApplied({ subject: TaskASubject, direction: Pause }))
  }

  run alreadyOutsideTaskRequestCannotChangePauseStateOrAnotherTaskTest = {
    init
      .then(receiveTaskBPause)
      .then(proveCurrentTaskB)
      .then(applyPending)
      .then(taskALeavesTarget)
      .then(receiveTaskAPause)
      .then(rejectStaleTaskA)
      .expect(
        not(state.taskAPaused)
          and state.taskBPaused
          and staleTaskRejectedReached
          and rejectedTaskControlPreservesPauseState
      )
  }

  run unreadableMembershipCannotApplyOrRejectAsStaleTest = {
    init
      .then(taskAReadBecomesUnreadable)
      .then(receiveTaskAUnpause)
      .then(failUnreadableTaskA)
      .expect(
        unreadableMembershipReached
          and not(staleTaskRejectedReached)
          and state.appliedCount == 0
          and rejectedTaskControlPreservesPauseState
      )
  }

  run appliedDirectionClaimsNoLaterEffectsTest = {
    init
      .then(receiveRunPause)
      .then(applyPending)
      .expect(applicationClaimsNoLaterEffects and appliedDirectionIsOperatorInitiated)
  }
}
