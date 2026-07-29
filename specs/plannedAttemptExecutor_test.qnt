module plannedAttemptExecutorTest {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  run runningThenTerminal = {
    init
      .then(beginResponsibility)
      .then(startOrContinueRunning)
      .then(finishTerminal)
      .expect(terminalReached and terminalReleasesPosition)
  }

  run safelySuspendAndResumeSameAttempt = {
    init
      .then(beginResponsibility)
      .then(startOrContinueRunning)
      .then(requestSafeSuspension)
      .then(reportSafelySuspended)
      .then(startOrContinueRunning)
      .expect(runningReached and everyStatusUsesExactPlannedAttempt)
  }

  run suspensionRequestKeepsPosition = {
    init
      .then(beginResponsibility)
      .then(startOrContinueRunning)
      .then(requestSafeSuspension)
      .expect(suspensionRequestedReached and suspensionRequestRetainsPosition)
  }

  run responsibilityPrecedesFirstExecutorReport = {
    init
      .then(beginResponsibility)
      .expect(responsibilityBeganReached and positionHeldUntilSuspensionResult)
  }
}
