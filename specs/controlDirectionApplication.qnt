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
    // Saturating counter: 0 means no direction applied, 1 means at least one.
    // Every invariant and witness below uses only that == 0 vs > 0 distinction,
    // and the saturation keeps the state space finite so the gate's exhaustive
    // TLC run is genuinely exhaustive. Revisit the day anyone needs an actual count.
    //
    // TODO: the saturation buys exhaustive checking by giving up detection power.
    // One application and two are the same state here, so a production defect that
    // applies a direction twice is unrepresentable and no mutant can express it.
    // The conformance driver must saturate to match
    // (packages/dalph/test/conformance/control-direction-application.mbt.test.ts),
    // which couples spec and driver in a way nothing enforces. Decide whether the
    // exhaustive run is worth more than double-application coverage; a bounded
    // counter with an explicit ceiling would keep both.
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
    appliedCount: if (s.appliedCount == 0) 1 else s.appliedCount,
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

  // Constrains which states are representable, not how the model behaves.
  // Quint has no natural-number type, so the bound is stated here instead;
  // the upper bound holds by construction because the counter saturates.
  // It is not evidence that any control direction was applied correctly.
  val typeOk: bool = state.appliedCount >= 0 and state.appliedCount <= 1

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
