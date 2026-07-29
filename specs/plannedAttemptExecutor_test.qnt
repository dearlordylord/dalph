module plannedAttemptExecutorTest {
  import plannedAttemptExecutor.* from "./plannedAttemptExecutor"

  run runningThenTerminal = {
    init
      .then(startOrContinueRunning)
      .then(finishTerminal)
      .expect(terminalReached and terminalReleasesPosition)
  }

  run safelySuspendAndResumeSameAttempt = {
    init
      .then(startOrContinueRunning)
      .then(requestSafeSuspension)
      .then(startOrContinueRunning)
      .expect(runningReached and everyReportUsesExactPlannedAttempt)
  }
}
