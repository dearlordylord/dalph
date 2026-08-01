// Models #155/#166: receiving Pause or Unpause is ephemeral, while applying
// one exact run-or-task direction is a durable Operator-initiated action.
module controlDirectionApplication {
  type Direction = Pause | Unpause
  type Subject = RunSubject | TaskASubject | TaskBSubject
  type PendingRequest = NoRequest | Requested({ subject: Subject, direction: Direction })
  type AppliedDirection = NoAppliedDirection | Applied({ subject: Subject, direction: Direction })

  type State = {
    pendingRequest: PendingRequest,
    runPaused: bool,
    taskAPaused: bool,
    taskBPaused: bool,
    appliedCount: int,
    lastApplied: AppliedDirection,
    lastAppliedWasOperatorInitiated: bool,
    executorInterrupted: bool,
    trackerReread: bool,
    executorResumed: bool,
    finalPausePhaseClaimed: bool,
  }

  var state: State

  pure def directionValue(direction: Direction): bool = direction == Pause

  pure def applyDirection(s: State, subject: Subject, direction: Direction): State = {
    ...s,
    pendingRequest: NoRequest,
    runPaused: if (subject == RunSubject) directionValue(direction) else s.runPaused,
    taskAPaused: if (subject == TaskASubject) directionValue(direction) else s.taskAPaused,
    taskBPaused: if (subject == TaskBSubject) directionValue(direction) else s.taskBPaused,
    appliedCount: s.appliedCount + 1,
    lastApplied: Applied({ subject: subject, direction: direction }),
    lastAppliedWasOperatorInitiated: true,
  }

  val appliedDirectionIsOperatorInitiated: bool =
    state.appliedCount == 0 or state.lastAppliedWasOperatorInitiated

  val applicationClaimsNoLaterEffects: bool =
    not(state.executorInterrupted)
      and not(state.trackerReread)
      and not(state.executorResumed)
      and not(state.finalPausePhaseClaimed)

  val appliedCountIsNonNegative: bool = state.appliedCount >= 0

  val runPauseAppliedReached: bool = state.runPaused and state.appliedCount > 0
  val taskPauseAppliedReached: bool = state.taskAPaused and state.appliedCount > 0
  val taskUnpauseAppliedReached: bool =
    not(state.taskAPaused)
      and state.lastApplied == Applied({ subject: TaskASubject, direction: Unpause })

  action init: bool = all {
    state' = {
      pendingRequest: NoRequest,
      runPaused: false,
      taskAPaused: false,
      taskBPaused: false,
      appliedCount: 0,
      lastApplied: NoAppliedDirection,
      lastAppliedWasOperatorInitiated: false,
      executorInterrupted: false,
      trackerReread: false,
      executorResumed: false,
      finalPausePhaseClaimed: false,
    },
  }

  action receive(subject: Subject, direction: Direction): bool = all {
    state.pendingRequest == NoRequest,
    state' = { ...state, pendingRequest: Requested({ subject: subject, direction: direction }) },
  }

  action crashAndRestart: bool = all {
    state' = { ...state, pendingRequest: NoRequest },
  }

  action applyPending: bool = match state.pendingRequest {
    | Requested(request) => state' = applyDirection(state, request.subject, request.direction)
    | NoRequest => all { false, state' = state }
  }

  action receiveRunPause: bool = receive(RunSubject, Pause)
  action receiveRunUnpause: bool = receive(RunSubject, Unpause)
  action receiveTaskAPause: bool = receive(TaskASubject, Pause)
  action receiveTaskAUnpause: bool = receive(TaskASubject, Unpause)
  action receiveTaskBPause: bool = receive(TaskBSubject, Pause)
  action receiveTaskBUnpause: bool = receive(TaskBSubject, Unpause)

  action step: bool = any {
    receiveRunPause,
    receiveRunUnpause,
    receiveTaskAPause,
    receiveTaskAUnpause,
    receiveTaskBPause,
    receiveTaskBUnpause,
    applyPending,
    crashAndRestart,
  }
}
