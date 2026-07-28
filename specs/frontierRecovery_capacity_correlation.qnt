// Focused M2 proof projection for task-local provider invocation correlation.
// The broad frontier model remains the source of operational behavior and
// executable conformance. This artifact retains only the state that can
// affect one task admission position, an independent second task, and
// reconstruction after one process loss. The finite crash ordinal encodes
// M2's accepted one-crash profile instead of adding an ever-increasing
// counter to TLC state.
module frontierRecoveryCapacityCorrelation {
  const CAPACITY: int

  pure val EXPECTED_OPERATION_ID: int = 1
  pure val REPORTED_OPERATION_ID: int = 101

  type CapacityPosition =
    | NotUsing
    | Reserved
    | AwaitingProviderEvidence({ operationId: int })
    | Working({ operationId: int })
    | CapacityCorrelationConflict({
        expectedOperationId: int,
        observedOperationId: int,
      })

  type ProviderReport =
    | ReportNotObserved
    | ReportActive({ operationId: int })
    | ReportTerminal({ operationId: int })
    | ReportAbsent({ operationId: int })
    | ReportInterrupted({ operationId: int })
    | ReportUnknown({ operationId: int })

  type CrashOrdinal = NoCrash | CrashedOnce

  type CapacityCorrelationState = {
    coordinatorRunning: bool,
    crashOrdinal: CrashOrdinal,
    expectedTaskOutstanding: bool,
    expectedTaskPosition: CapacityPosition,
    independentTaskPosition: CapacityPosition,
    providerAuthority: ProviderReport,
    freshProviderReport: ProviderReport,
  }

  var state: CapacityCorrelationState

  pure def positionUsesCapacity(position: CapacityPosition): bool =
    position != NotUsing

  pure def capacityUsage(s: CapacityCorrelationState): int =
    (if (positionUsesCapacity(s.expectedTaskPosition)) 1 else 0)
      + (if (positionUsesCapacity(s.independentTaskPosition)) 1 else 0)

  pure def positionFromReport(
    s: CapacityCorrelationState,
    report: ProviderReport
  ): CapacityPosition =
    match report {
      | ReportActive(active) =>
          if (active.operationId == EXPECTED_OPERATION_ID)
            Working({ operationId: EXPECTED_OPERATION_ID })
          else
            CapacityCorrelationConflict({
              expectedOperationId: EXPECTED_OPERATION_ID,
              observedOperationId: active.operationId,
            })
      | ReportTerminal(terminal) =>
          if (terminal.operationId == EXPECTED_OPERATION_ID)
            NotUsing
          else if (s.expectedTaskOutstanding)
            AwaitingProviderEvidence({
              operationId: EXPECTED_OPERATION_ID,
            })
          else
            NotUsing
      | ReportAbsent(absent) =>
          if (absent.operationId == EXPECTED_OPERATION_ID)
            NotUsing
          else if (s.expectedTaskOutstanding)
            AwaitingProviderEvidence({
              operationId: EXPECTED_OPERATION_ID,
            })
          else
            NotUsing
      | ReportInterrupted(interrupted) =>
          if (interrupted.operationId == EXPECTED_OPERATION_ID)
            NotUsing
          else if (s.expectedTaskOutstanding)
            AwaitingProviderEvidence({
              operationId: EXPECTED_OPERATION_ID,
            })
          else
            NotUsing
      | ReportUnknown(_) =>
          if (s.expectedTaskOutstanding)
            AwaitingProviderEvidence({
              operationId: EXPECTED_OPERATION_ID,
            })
          else
            NotUsing
      | ReportNotObserved =>
          if (s.expectedTaskOutstanding)
            AwaitingProviderEvidence({
              operationId: EXPECTED_OPERATION_ID,
            })
          else
            NotUsing
    }

  action init: bool =
    state' = {
      coordinatorRunning: true,
      crashOrdinal: NoCrash,
      expectedTaskOutstanding: true,
      expectedTaskPosition:
        AwaitingProviderEvidence({
          operationId: EXPECTED_OPERATION_ID,
        }),
      independentTaskPosition: NotUsing,
      providerAuthority:
        ReportActive({ operationId: REPORTED_OPERATION_ID }),
      freshProviderReport: ReportNotObserved,
    }

  action observeCapacityCorrelationConflict: bool = all {
    state.coordinatorRunning,
    positionUsesCapacity(state.expectedTaskPosition),
    state' = {
      ...state,
      expectedTaskPosition:
        CapacityCorrelationConflict({
          expectedOperationId: EXPECTED_OPERATION_ID,
          observedOperationId: REPORTED_OPERATION_ID,
        }),
      providerAuthority:
        ReportActive({ operationId: REPORTED_OPERATION_ID }),
      freshProviderReport:
        ReportActive({ operationId: REPORTED_OPERATION_ID }),
    },
  }

  action observeMismatchedInvocationTerminal: bool = all {
    state.coordinatorRunning,
    state.expectedTaskPosition
      == CapacityCorrelationConflict({
        expectedOperationId: EXPECTED_OPERATION_ID,
        observedOperationId: REPORTED_OPERATION_ID,
      }),
    state' = {
      ...state,
      expectedTaskPosition:
        AwaitingProviderEvidence({
          operationId: EXPECTED_OPERATION_ID,
        }),
      providerAuthority:
        ReportTerminal({ operationId: REPORTED_OPERATION_ID }),
      freshProviderReport:
        ReportTerminal({ operationId: REPORTED_OPERATION_ID }),
    },
  }

  action observeUnknownProviderReport: bool = all {
    state.coordinatorRunning,
    positionUsesCapacity(state.expectedTaskPosition),
    state' = {
      ...state,
      freshProviderReport:
        ReportUnknown({ operationId: EXPECTED_OPERATION_ID }),
    },
  }

  action observeExpectedInvocationActive: bool = all {
    state.coordinatorRunning,
    positionUsesCapacity(state.expectedTaskPosition),
    state' = {
      ...state,
      expectedTaskPosition:
        Working({ operationId: EXPECTED_OPERATION_ID }),
      providerAuthority:
        ReportActive({ operationId: EXPECTED_OPERATION_ID }),
      freshProviderReport:
        ReportActive({ operationId: EXPECTED_OPERATION_ID }),
    },
  }

  action observeExpectedInvocationTerminal: bool = all {
    state.coordinatorRunning,
    positionUsesCapacity(state.expectedTaskPosition),
    state' = {
      ...state,
      expectedTaskPosition: NotUsing,
      expectedTaskOutstanding: false,
      providerAuthority:
        ReportTerminal({ operationId: EXPECTED_OPERATION_ID }),
      freshProviderReport:
        ReportTerminal({ operationId: EXPECTED_OPERATION_ID }),
    },
  }

  action observeExpectedInvocationAbsent: bool = all {
    state.coordinatorRunning,
    positionUsesCapacity(state.expectedTaskPosition),
    state' = {
      ...state,
      expectedTaskPosition: NotUsing,
      expectedTaskOutstanding: false,
      providerAuthority:
        ReportAbsent({ operationId: EXPECTED_OPERATION_ID }),
      freshProviderReport:
        ReportAbsent({ operationId: EXPECTED_OPERATION_ID }),
    },
  }

  action observeExpectedInvocationInterrupted: bool = all {
    state.coordinatorRunning,
    positionUsesCapacity(state.expectedTaskPosition),
    state' = {
      ...state,
      expectedTaskPosition: NotUsing,
      expectedTaskOutstanding: false,
      providerAuthority:
        ReportInterrupted({ operationId: EXPECTED_OPERATION_ID }),
      freshProviderReport:
        ReportInterrupted({ operationId: EXPECTED_OPERATION_ID }),
    },
  }

  action reserveIndependentTask: bool = all {
    state.coordinatorRunning,
    state.independentTaskPosition == NotUsing,
    capacityUsage(state) < CAPACITY,
    state' = {
      ...state,
      independentTaskPosition: Reserved,
    },
  }

  action crashCoordinator: bool = all {
    state.coordinatorRunning,
    state.crashOrdinal == NoCrash,
    state' = {
      ...state,
      coordinatorRunning: false,
      crashOrdinal: CrashedOnce,
      expectedTaskPosition: NotUsing,
      independentTaskPosition: NotUsing,
      freshProviderReport: ReportNotObserved,
    },
  }

  action readProviderForReconstruction: bool = all {
    not(state.coordinatorRunning),
    state.freshProviderReport == ReportNotObserved,
    state' = {
      ...state,
      freshProviderReport: state.providerAuthority,
    },
  }

  action reconstructCapacity: bool = all {
    not(state.coordinatorRunning),
    state.freshProviderReport != ReportNotObserved,
    state' = {
      ...state,
      coordinatorRunning: true,
      expectedTaskPosition:
        positionFromReport(state, state.freshProviderReport),
      independentTaskPosition: NotUsing,
    },
  }

  val boundedCapacity: bool = capacityUsage(state) <= CAPACITY

  val mismatchUsesOneTaskPosition: bool =
    match state.expectedTaskPosition {
      | CapacityCorrelationConflict(conflict) => and {
          conflict.expectedOperationId != conflict.observedOperationId,
          positionUsesCapacity(state.expectedTaskPosition),
        }
      | _ => true
    }

  val mismatchedTerminalKeepsExpectedTaskPosition: bool =
    not(state.coordinatorRunning)
      or match state.freshProviderReport {
        | ReportTerminal(terminal) =>
            terminal.operationId == EXPECTED_OPERATION_ID
              or not(state.expectedTaskOutstanding)
              or positionUsesCapacity(state.expectedTaskPosition)
        | _ => true
      }

  val unknownReportNeverReleasesOutstandingTask: bool =
    not(state.coordinatorRunning)
      or match state.freshProviderReport {
        | ReportUnknown(_) =>
            not(state.expectedTaskOutstanding)
              or positionUsesCapacity(state.expectedTaskPosition)
        | _ => true
      }

  val mismatchReached: bool =
    match state.expectedTaskPosition {
      | CapacityCorrelationConflict(_) => true
      | _ => false
    }

  val independentTaskAdmitted: bool =
    state.independentTaskPosition == Reserved

  val mismatchedTerminalReached: bool =
    state.expectedTaskPosition
      == AwaitingProviderEvidence({
        operationId: EXPECTED_OPERATION_ID,
      })
      and state.freshProviderReport
        == ReportTerminal({ operationId: REPORTED_OPERATION_ID })

  val mismatchReconstructedAfterCrash: bool =
    state.crashOrdinal == CrashedOnce
      and state.coordinatorRunning
      and mismatchReached

  action step: bool = any {
    observeCapacityCorrelationConflict,
    observeMismatchedInvocationTerminal,
    observeUnknownProviderReport,
    observeExpectedInvocationActive,
    observeExpectedInvocationTerminal,
    observeExpectedInvocationAbsent,
    observeExpectedInvocationInterrupted,
    reserveIndependentTask,
    crashCoordinator,
    readProviderForReconstruction,
    reconstructCapacity,
  }
}

module frontierRecoveryCapacityCorrelationOne {
  import frontierRecoveryCapacityCorrelation(CAPACITY = 1).*
}

module frontierRecoveryCapacityCorrelationTwo {
  import frontierRecoveryCapacityCorrelation(CAPACITY = 2).*
}
