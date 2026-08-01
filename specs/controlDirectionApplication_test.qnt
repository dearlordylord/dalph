module controlDirectionApplicationTest {
  import controlDirectionApplication.* from "./controlDirectionApplication"

  run crashBeforeApplicationLosesOnlyTheRequest = {
    init
      .then(receiveTaskAPause)
      .then(crashAndRestart)
      .expect(
        state.pendingRequest == NoRequest
          and not(state.taskAPaused)
          and state.appliedCount == 0
      )
  }

  run crashAfterApplicationReconstructsTheExactDirection = {
    init
      .then(receiveTaskAPause)
      .then(applyPending)
      .then(crashAndRestart)
      .expect(
        state.taskAPaused
          and not(state.taskBPaused)
          and state.lastApplied == Applied({ subject: TaskASubject, direction: Pause })
          and state.appliedCount == 1
      )
  }

  run laterDirectionReplacesOnlyItsExactSubject = {
    init
      .then(receiveTaskAPause)
      .then(applyPending)
      .then(receiveRunPause)
      .then(applyPending)
      .then(receiveTaskAUnpause)
      .then(applyPending)
      .expect(
        state.runPaused
          and not(state.taskAPaused)
          and not(state.taskBPaused)
          and taskUnpauseAppliedReached
      )
  }

  run appliedDirectionClaimsNoLaterEffects = {
    init
      .then(receiveRunPause)
      .then(applyPending)
      .expect(applicationClaimsNoLaterEffects and appliedDirectionIsOperatorInitiated)
  }
}
