// Models issue #41's one session-establishment operation. It intentionally
// excludes SQLite/WAL mechanics, Layer acquisition, task completion, provider
// work-unit replacement, and journal-version migration.
module taskWorkSessionRecovery {
  type Evidence = NoEvidence | Matching | Absent | Unreadable | Conflict
  type Authorization = NoAuthorization | InitialRequest | FreshAbsence
  type Status = Active | LookupDidNotConverge | EstablishmentDidNotConverge | CorrelationConflict | Established

  type State = {
    coordinatorRunning: bool,
    candidateSelected: bool,
    operationId: int,
    predecessorOperationIds: Set[int],
    intentCommitted: bool,
    requestOperationIds: Set[int],
    requestPayloads: Set[int],
    requestCount: int,
    providerHasSession: bool,
    lookupAttempts: int,
    pendingEvidence: Evidence,
    recordedEvidence: Evidence,
    authorization: Authorization,
    matchingReportRecorded: bool,
    status: Status,
    everCrashed: bool,
  }

  pure val LOOKUP_BOUND = 3
  pure val PLANNED_ATTEMPT_PAYLOAD = 41
  pure val PLANNED_PREDECESSOR_OPERATION_ID = -1

  pure def canSelect(s: State): bool = and {
    s.coordinatorRunning,
    not(s.candidateSelected),
    not(s.intentCommitted),
    s.status == Active,
  }

  pure def applySelect(s: State): State =
    {
      ...s,
      candidateSelected: true,
      operationId: s.operationId + 1,
      predecessorOperationIds: Set(PLANNED_PREDECESSOR_OPERATION_ID),
    }

  pure def canCommitIntent(s: State): bool = and {
    s.coordinatorRunning,
    s.candidateSelected,
    not(s.intentCommitted),
    s.status == Active,
  }

  pure def applyCommitIntent(s: State): State =
    {...s, intentCommitted: true, authorization: InitialRequest}

  pure def canRequest(s: State): bool = and {
    s.coordinatorRunning,
    s.intentCommitted,
    s.authorization != NoAuthorization,
    s.pendingEvidence == NoEvidence,
    s.status == Active,
  }

  pure def applyRequest(s: State, createsSession: bool): State = {
    val nextProviderSession = s.providerHasSession or createsSession
    {
      ...s,
      requestOperationIds: s.requestOperationIds.union(Set(s.operationId)),
      requestPayloads: s.requestPayloads.union(Set(PLANNED_ATTEMPT_PAYLOAD)),
      requestCount: s.requestCount + 1,
      providerHasSession: nextProviderSession,
      authorization: NoAuthorization,
      recordedEvidence: NoEvidence,
    }
  }

  pure def canLookup(s: State): bool = and {
    s.coordinatorRunning,
    s.intentCommitted,
    s.authorization == NoAuthorization,
    s.pendingEvidence == NoEvidence,
    not(s.matchingReportRecorded),
    s.lookupAttempts < LOOKUP_BOUND,
    s.status == Active,
  }

  pure def applyLookup(s: State, evidence: Evidence): State =
    {...s, lookupAttempts: s.lookupAttempts + 1, pendingEvidence: evidence}

  pure def canRecordLookup(s: State): bool = and {
    s.coordinatorRunning,
    s.pendingEvidence != NoEvidence,
    s.status == Active,
  }

  pure def applyRecordLookup(s: State): State = {
    val atBound = s.lookupAttempts == LOOKUP_BOUND
    match s.pendingEvidence {
      | Matching => {
          ...s,
          pendingEvidence: NoEvidence,
          recordedEvidence: Matching,
          matchingReportRecorded: true,
        }
      | Absent => if (s.recordedEvidence == Matching)
          {...s, pendingEvidence: NoEvidence, recordedEvidence: Absent, status: CorrelationConflict}
        else if (atBound)
          {...s, pendingEvidence: NoEvidence, recordedEvidence: Absent, status: EstablishmentDidNotConverge}
        else
          {...s, pendingEvidence: NoEvidence, recordedEvidence: Absent, authorization: FreshAbsence}
      | Unreadable => if (atBound)
          {...s, pendingEvidence: NoEvidence, recordedEvidence: Unreadable, status: LookupDidNotConverge}
        else
          {...s, pendingEvidence: NoEvidence, recordedEvidence: Unreadable}
      | Conflict =>
          {...s, pendingEvidence: NoEvidence, recordedEvidence: Conflict, status: CorrelationConflict}
      | NoEvidence => s
    }
  }

  pure def canRecordOutcome(s: State): bool = and {
    s.coordinatorRunning,
    s.matchingReportRecorded,
    s.status == Active,
  }

  pure def applyRecordOutcome(s: State): State = {...s, status: Established}

  pure def canCrash(s: State): bool = s.coordinatorRunning

  pure def applyCrash(s: State): State = {
    ...s,
    coordinatorRunning: false,
    lookupAttempts: 0,
    pendingEvidence: NoEvidence,
    authorization: NoAuthorization,
    matchingReportRecorded: if (s.status == Established) true else false,
    everCrashed: true,
  }

  pure def canRestart(s: State): bool = not(s.coordinatorRunning)

  pure def applyRestart(s: State): State = {
    ...s,
    coordinatorRunning: true,
    candidateSelected: if (s.intentCommitted) true else false,
  }

  var state: State

  val requestRequiresIntent: bool = state.requestCount == 0 or state.intentCommitted
  val everyRequestUsesStableIdentity: bool =
    state.requestOperationIds == Set() or state.requestOperationIds == Set(state.operationId)
  val everyRequestUsesStablePayload: bool =
    state.requestPayloads == Set() or state.requestPayloads == Set(PLANNED_ATTEMPT_PAYLOAD)
  val causalPredecessorsAreStable: bool =
    not(state.candidateSelected)
      or state.predecessorOperationIds == Set(PLANNED_PREDECESSOR_OPERATION_ID)
  val absenceAloneAuthorizesRepeat: bool =
    state.authorization != FreshAbsence or state.recordedEvidence == Absent
  val unreadableAndConflictNeverAuthorize: bool =
    not(state.recordedEvidence == Unreadable or state.recordedEvidence == Conflict)
      or state.authorization == NoAuthorization
  val establishmentRequiresMatchingReport: bool =
    state.status != Established or state.matchingReportRecorded
  val lookupBoundIsRespected: bool = state.lookupAttempts <= LOOKUP_BOUND
  val terminalOutcomeIsStable: bool = state.status != Established or state.matchingReportRecorded

  val intentReached: bool = state.intentCommitted
  val requestReached: bool = state.requestCount > 0
  val absenceAuthorizedRepeatReached: bool = state.requestCount > 1
  val matchingReached: bool = state.matchingReportRecorded
  val outcomeReached: bool = state.status == Established
  val unreadableBoundReached: bool = state.status == LookupDidNotConverge
  val absenceBoundReached: bool = state.status == EstablishmentDidNotConverge
  val conflictReached: bool = state.status == CorrelationConflict
  val crashRestartReached: bool = state.everCrashed and state.coordinatorRunning

  action init: bool = all {
    state' = {
      coordinatorRunning: true,
      candidateSelected: false,
      operationId: 0,
      predecessorOperationIds: Set(),
      intentCommitted: false,
      requestOperationIds: Set(),
      requestPayloads: Set(),
      requestCount: 0,
      providerHasSession: false,
      lookupAttempts: 0,
      pendingEvidence: NoEvidence,
      recordedEvidence: NoEvidence,
      authorization: NoAuthorization,
      matchingReportRecorded: false,
      status: Active,
      everCrashed: false,
    }
  }

  action selectIdentity: bool = all { canSelect(state), state' = applySelect(state) }
  action commitIntent: bool = all { canCommitIntent(state), state' = applyCommitIntent(state) }
  action requestCreatesSession: bool = all { canRequest(state), state' = applyRequest(state, true) }
  action requestCreatesNothing: bool = all { canRequest(state), state' = applyRequest(state, false) }
  action lookupMatching: bool = all { canLookup(state), state.providerHasSession, state' = applyLookup(state, Matching) }
  action lookupAbsent: bool = all { canLookup(state), not(state.providerHasSession), state' = applyLookup(state, Absent) }
  action lookupContradictoryAbsence: bool = all {
    canLookup(state),
    state.recordedEvidence == Matching,
    state' = applyLookup(state, Absent),
  }
  action lookupUnreadable: bool = all { canLookup(state), state' = applyLookup(state, Unreadable) }
  action lookupConflict: bool = all { canLookup(state), state' = applyLookup(state, Conflict) }
  action recordLookup: bool = all { canRecordLookup(state), state' = applyRecordLookup(state) }
  action recordOutcome: bool = all { canRecordOutcome(state), state' = applyRecordOutcome(state) }
  action crash: bool = all { canCrash(state), state' = applyCrash(state) }
  action restart: bool = all { canRestart(state), state' = applyRestart(state) }

  action step: bool = any {
    selectIdentity,
    commitIntent,
    requestCreatesSession,
    requestCreatesNothing,
    lookupMatching,
    lookupAbsent,
    lookupContradictoryAbsence,
    lookupUnreadable,
    lookupConflict,
    recordLookup,
    recordOutcome,
    crash,
    restart,
  }
}
