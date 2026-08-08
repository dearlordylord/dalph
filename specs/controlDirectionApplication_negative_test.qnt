// Mutation profile proving that stale and unreadable task-control outcomes
// cannot change any Run or task pause state.
module controlDirectionApplicationNegativeTest {
  import controlDirectionApplication.* from "./controlDirectionApplication"

  action rejectStaleTaskAAndPauseTaskB: bool = all {
    state.pendingRequest == Requested({ subject: TaskASubject, direction: Pause }),
    state.taskAMembership == OutsideTarget,
    state' = {
      ...state,
      pendingRequest: NoRequest,
      taskBPaused: true,
      membershipProof: NoMembershipProof,
      lastControlResult: StaleTaskRejected({ subject: TaskASubject, direction: Pause }),
    },
  }

  action failUnreadableTaskAAndPauseRun: bool = all {
    state.pendingRequest == Requested({ subject: TaskASubject, direction: Unpause }),
    state.taskAMembership == UnreadableMembership,
    state' = {
      ...state,
      pendingRequest: NoRequest,
      runPaused: true,
      membershipProof: NoMembershipProof,
      lastControlResult: MembershipReadFailed({ subject: TaskASubject, direction: Unpause }),
    },
  }

  run staleRejectionPauseMutationIsDetectedTest = {
    init
      .then(taskALeavesTarget)
      .then(receiveTaskAPause)
      .then(rejectStaleTaskAAndPauseTaskB)
      .expect(not(rejectedTaskControlPreservesPauseState))
  }

  run unreadableFailurePauseMutationIsDetectedTest = {
    init
      .then(taskAReadBecomesUnreadable)
      .then(receiveTaskAUnpause)
      .then(failUnreadableTaskAAndPauseRun)
      .expect(not(rejectedTaskControlPreservesPauseState))
  }
}
