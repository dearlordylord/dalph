module plannedAttemptExecutorTest {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  run runningThenTerminalTest = {
    init
      .then(beginResponsibility)
      .then(startOrContinueRunning)
      .then(finishTerminal)
      .expect(terminalReached and terminalReleasesPosition)
  }

  run safelySuspendAndResumeSameAttemptTest = {
    init
      .then(beginResponsibility)
      .then(startOrContinueRunning)
      .then(requestSafeSuspension)
      .then(reportSafelySuspended)
      .then(startOrContinueRunning)
      .expect(runningReached and everyReportCarriesPlannedAttempt)
  }

  run suspensionRequestKeepsPositionTest = {
    init
      .then(beginResponsibility)
      .then(startOrContinueRunning)
      .then(requestSafeSuspension)
      .expect(suspensionRequestedReached and suspensionRequestRetainsPosition)
  }

  run responsibilityPrecedesFirstExecutorReportTest = {
    init
      .then(beginResponsibility)
      .expect(responsibilityBeganReached and positionHeldUntilSuspensionResult)
  }
}
