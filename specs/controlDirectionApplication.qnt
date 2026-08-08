// Models #155/#166/#156: receiving Pause or Unpause is ephemeral; a task
// direction requires a current target-membership read before durable application.
module controlDirectionApplication {
  type Direction = Pause | Unpause
  type Subject = RunSubject | TaskASubject | TaskBSubject
  type PendingRequest = NoRequest | Requested({ subject: Subject, direction: Direction })
  type AppliedDirection = NoAppliedDirection | Applied({ subject: Subject, direction: Direction })
  type TaskMembership = CurrentMember | OutsideTarget | UnreadableMembership
  type MembershipProof = NoMembershipProof | CurrentMembershipProved({ subject: Subject })
  type ControlResult =
    | NoControlResult
    | DirectionApplied({ subject: Subject, direction: Direction })
    | StaleTaskRejected({ subject: Subject, direction: Direction })
    | MembershipReadFailed({ subject: Subject, direction: Direction })

  type PauseSnapshot = { runPaused: bool, taskAPaused: bool, taskBPaused: bool }

  type State = {
    pendingRequest: PendingRequest,
    runPaused: bool,
    taskAPaused: bool,
    taskBPaused: bool,
    pauseAtRequest: PauseSnapshot,
    taskAMembership: TaskMembership,
    taskBMembership: TaskMembership,
    membershipProof: MembershipProof,
    lastControlResult: ControlResult,
    // Saturating counter: this model distinguishes no application from at
    // least one application while the executable adapter retains exact rows.
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

  pure def pauseSnapshot(s: State): PauseSnapshot = {
    runPaused: s.runPaused,
    taskAPaused: s.taskAPaused,
    taskBPaused: s.taskBPaused,
  }

  pure def applyDirection(s: State, subject: Subject, direction: Direction): State = {
    ...s,
    pendingRequest: NoRequest,
    runPaused: if (subject == RunSubject) directionValue(direction) else s.runPaused,
    taskAPaused: if (subject == TaskASubject) directionValue(direction) else s.taskAPaused,
    taskBPaused: if (subject == TaskBSubject) directionValue(direction) else s.taskBPaused,
    membershipProof: NoMembershipProof,
    lastControlResult: DirectionApplied({ subject: subject, direction: direction }),
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

  val rejectedTaskControlPreservesPauseState: bool = match state.lastControlResult {
    | StaleTaskRejected(_) =>
        state.runPaused == state.pauseAtRequest.runPaused
          and state.taskAPaused == state.pauseAtRequest.taskAPaused
          and state.taskBPaused == state.pauseAtRequest.taskBPaused
    | MembershipReadFailed(_) =>
        state.runPaused == state.pauseAtRequest.runPaused
          and state.taskAPaused == state.pauseAtRequest.taskAPaused
          and state.taskBPaused == state.pauseAtRequest.taskBPaused
    | _ => true
  }

  val typeOk: bool = state.appliedCount >= 0 and state.appliedCount <= 1

  val runPauseAppliedReached: bool = state.runPaused and state.appliedCount > 0
  val taskPauseAppliedReached: bool = state.taskAPaused and state.appliedCount > 0
  val taskUnpauseAppliedReached: bool =
    not(state.taskAPaused)
      and state.lastApplied == Applied({ subject: TaskASubject, direction: Unpause })
  val staleTaskRejectedReached: bool = match state.lastControlResult {
    | StaleTaskRejected(_) => true
    | _ => false
  }
  val unreadableMembershipReached: bool = match state.lastControlResult {
    | MembershipReadFailed(_) => true
    | _ => false
  }

  action init: bool = all {
    state' = {
      pendingRequest: NoRequest,
      runPaused: false,
      taskAPaused: false,
      taskBPaused: false,
      pauseAtRequest: { runPaused: false, taskAPaused: false, taskBPaused: false },
      taskAMembership: CurrentMember,
      taskBMembership: CurrentMember,
      membershipProof: NoMembershipProof,
      lastControlResult: NoControlResult,
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
    state' = {
      ...state,
      pendingRequest: Requested({ subject: subject, direction: direction }),
      pauseAtRequest: pauseSnapshot(state),
      membershipProof: NoMembershipProof,
      lastControlResult: NoControlResult,
    },
  }

  action crashAndRestart: bool = all {
    state' = {
      ...state,
      pendingRequest: NoRequest,
      membershipProof: NoMembershipProof,
      lastControlResult: NoControlResult,
    },
  }

  action applyRunPending: bool = match state.pendingRequest {
    | Requested(request) => all {
        request.subject == RunSubject,
        state' = applyDirection(state, request.subject, request.direction),
      }
    | NoRequest => all { false, state' = state }
  }

  action proveCurrentTaskA: bool = all {
    state.taskAMembership == CurrentMember,
    state.pendingRequest == Requested({ subject: TaskASubject, direction: Pause })
      or state.pendingRequest == Requested({ subject: TaskASubject, direction: Unpause }),
    state' = { ...state, membershipProof: CurrentMembershipProved({ subject: TaskASubject }) },
  }

  action proveCurrentTaskB: bool = all {
    state.taskBMembership == CurrentMember,
    state.pendingRequest == Requested({ subject: TaskBSubject, direction: Pause })
      or state.pendingRequest == Requested({ subject: TaskBSubject, direction: Unpause }),
    state' = { ...state, membershipProof: CurrentMembershipProved({ subject: TaskBSubject }) },
  }

  action rejectStaleTaskA: bool = match state.pendingRequest {
    | Requested(request) => all {
        request.subject == TaskASubject,
        state.taskAMembership == OutsideTarget,
        state' = {
          ...state,
          pendingRequest: NoRequest,
          membershipProof: NoMembershipProof,
          lastControlResult: StaleTaskRejected(request),
        },
      }
    | NoRequest => all { false, state' = state }
  }

  action rejectStaleTaskB: bool = match state.pendingRequest {
    | Requested(request) => all {
        request.subject == TaskBSubject,
        state.taskBMembership == OutsideTarget,
        state' = {
          ...state,
          pendingRequest: NoRequest,
          membershipProof: NoMembershipProof,
          lastControlResult: StaleTaskRejected(request),
        },
      }
    | NoRequest => all { false, state' = state }
  }

  action failUnreadableTaskA: bool = match state.pendingRequest {
    | Requested(request) => all {
        request.subject == TaskASubject,
        state.taskAMembership == UnreadableMembership,
        state' = {
          ...state,
          pendingRequest: NoRequest,
          membershipProof: NoMembershipProof,
          lastControlResult: MembershipReadFailed(request),
        },
      }
    | NoRequest => all { false, state' = state }
  }

  action failUnreadableTaskB: bool = match state.pendingRequest {
    | Requested(request) => all {
        request.subject == TaskBSubject,
        state.taskBMembership == UnreadableMembership,
        state' = {
          ...state,
          pendingRequest: NoRequest,
          membershipProof: NoMembershipProof,
          lastControlResult: MembershipReadFailed(request),
        },
      }
    | NoRequest => all { false, state' = state }
  }

  action applyCurrentTaskPending: bool = match state.pendingRequest {
    | Requested(request) => all {
        request.subject != RunSubject,
        state.membershipProof == CurrentMembershipProved({ subject: request.subject }),
        state' = applyDirection(state, request.subject, request.direction),
      }
    | NoRequest => all { false, state' = state }
  }

  action taskALeavesTarget: bool = all {
    state' = { ...state, taskAMembership: OutsideTarget },
  }

  action taskAReadBecomesUnreadable: bool = all {
    state' = { ...state, taskAMembership: UnreadableMembership },
  }

  action receiveRunPause: bool = receive(RunSubject, Pause)
  action receiveRunUnpause: bool = receive(RunSubject, Unpause)
  action receiveTaskAPause: bool = receive(TaskASubject, Pause)
  action receiveTaskAUnpause: bool = receive(TaskASubject, Unpause)
  action receiveTaskBPause: bool = receive(TaskBSubject, Pause)
  action receiveTaskBUnpause: bool = receive(TaskBSubject, Unpause)
  action applyPending: bool = any { applyRunPending, applyCurrentTaskPending }

  action step: bool = any {
    receiveRunPause,
    receiveRunUnpause,
    receiveTaskAPause,
    receiveTaskAUnpause,
    receiveTaskBPause,
    receiveTaskBUnpause,
    proveCurrentTaskA,
    proveCurrentTaskB,
    rejectStaleTaskA,
    rejectStaleTaskB,
    failUnreadableTaskA,
    failUnreadableTaskB,
    applyPending,
    taskALeavesTarget,
    taskAReadBecomesUnreadable,
    crashAndRestart,
  }
}
