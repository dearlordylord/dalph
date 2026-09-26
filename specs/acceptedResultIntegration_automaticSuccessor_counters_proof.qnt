// Proof-only projection for the unchanged #385 catchUpCasIsBoundedByBaselineRounds
// property. The canonical successor model remains the behavior vocabulary.
//
// Counter/action correspondence to acceptedResultIntegration_automaticSuccessor_proof.qnt:
// - init initializes all projected counters to zero.
// - recordAutomaticSuccessorAuthorization atomically resets the authorization
//   read/CAS counters and the baseline-round CAS counter.
// - beginNextAutomaticCompetingHeadCycle clears the old authorization and its
//   transient intent while preserving the old authorization's counters.
//   Although its projection guard requires refreshAvailable=false, the
//   canonical successor push path can reach this cycle only after fixation,
//   whose action requires not(refreshRoundAvailable).
// - recordRemoteBaselineReadIntent increments baselineReadIntentCount and
//   resets only catchUpCasCountForBaselineRound. It admits one initial intent
//   after authorization, then one refresh when refreshRoundCount is zero; a
//   refresh increments that count and closes refresh availability.
// - observeAncestorLocalBaseline increments the read counter and enables the
//   only path to recordCatchUpIntent. observeAlreadyCurrentLocalBaseline,
//   observeUnsafeLocalBaseline(local), and observeAnyUnsafeLocalBaseline are
//   represented by observeOtherBaseline; each increments the read counter but
//   cannot enable a catch-up intent.
// - recordCatchUpIntent requires that ancestor-observation phase. The CAS
//   requires that recorded intent, a positive read count, and round CAS == 0;
//   it increments both original CAS counters.
// - restartCoordinator may set refreshRoundAvailable once after a completed
//   baseline; makeBaselineRefreshAvailable abstracts only this flag update.
//   Every other action in the canonical step (publication discovery/send,
//   denial/throttle waits, outside head changes, already-current target change,
//   catch-up result/recovery, lineage/session/publication work, activation,
//   crash/restart when it does not set refresh availability, and pause/exit) is
//   identity in the projected state.
// - Phase relation: AwaitingAuthorization abstracts the pre-authorization
//   publication states; Authorized abstracts AutomaticAuthorizationRecorded;
//   ReadPending abstracts BaselineReadIntentRecorded; AncestorObserved abstracts
//   BaselineObserved with LocalIsRemoteAncestor; OtherObserved abstracts the
//   already-current BaselineObserved and UnsafeLocalWorkRetained cases;
//   CatchUpIntentRecorded abstracts the same canonical phase; CatchUpApplied
//   abstracts CatchUpEffectUncertain and its post-CAS result/lineage/session
//   states; OccurrenceEnded abstracts the gap after beginNext... clears the old
//   authorization. The relation intentionally permits more phase paths.
// - Phase is a causal summary, not a copy of baselineReadIntentRecorded (which
//   remains true after observation in the canonical model). Each next intent
//   also requires intentCount == readCount and each observation requires one
//   outstanding intent, so every projected catch-up observation is fresh for
//   its round.
//
// This is an over-approximation: refresh availability is broader than its
// canonical restart guard and cycle eligibility is broader apart from the
// implied refreshAvailable=false condition. The two-intent bound follows
// from the distinct initial-intent and one-refresh phases plus refreshRoundCount;
// there is no maximum-intent guard. ReadPending summarizes the
// canonical BaselineReadIntentRecorded phase; it is not the durable
// baselineReadIntentRecorded boolean, which remains true after observation.
// Every catch-up CAS remains causally behind an ancestor observation in the
// same projected round.
module acceptedResultIntegrationAutomaticSuccessorCountersProof {
  type Phase =
    | AwaitingAuthorization
    | Authorized
    | ReadPending
    | AncestorObserved
    | OtherObserved
    | CatchUpIntentRecorded
    | CatchUpApplied
    | OccurrenceEnded

  type State = {
    phase: Phase,
    baselineReadIntentCount: int,
    baselineReadCountForAuthorization: int,
    refreshRoundCount: int,
    refreshAvailable: bool,
    catchUpCasCountForAuthorization: int,
    catchUpCasCountForBaselineRound: int,
  }

  var state: State

  // Keep both original conjuncts unchanged. The phase and transition guards
  // establish that every CAS has a preceding counted ancestor observation.
  val catchUpCasIsBoundedByBaselineRounds: bool = and {
    state.catchUpCasCountForAuthorization <= state.baselineReadCountForAuthorization,
    state.catchUpCasCountForBaselineRound <= 1,
  }

  val successorRefreshRoundsAreBounded: bool = and {
    state.refreshRoundCount >= 0,
    state.refreshRoundCount <= 1,
    state.baselineReadIntentCount <= 2,
    not(state.refreshAvailable) or and {
      state.phase != AwaitingAuthorization,
      state.phase != OccurrenceEnded,
      state.baselineReadIntentCount == 1,
      state.baselineReadCountForAuthorization == 1,
      state.refreshRoundCount == 0,
    },
  }

  val catchUpAppliedReached: bool =
    state.catchUpCasCountForAuthorization > 0

  val secondRoundCatchUpReached: bool = and {
    state.baselineReadIntentCount == 2,
    state.baselineReadCountForAuthorization == 2,
    state.catchUpCasCountForAuthorization == 2,
    state.catchUpCasCountForBaselineRound == 1,
  }

  action init: bool = all {
    state' = {
      phase: AwaitingAuthorization,
      baselineReadIntentCount: 0,
      baselineReadCountForAuthorization: 0,
      refreshRoundCount: 0,
      refreshAvailable: false,
      catchUpCasCountForAuthorization: 0,
      catchUpCasCountForBaselineRound: 0,
    },
  }

  action recordAutomaticSuccessorAuthorization: bool = all {
    state.phase == AwaitingAuthorization or state.phase == OccurrenceEnded,
    state' = {
      ...state,
      phase: Authorized,
      baselineReadIntentCount: 0,
      baselineReadCountForAuthorization: 0,
      refreshRoundCount: 0,
      refreshAvailable: false,
      catchUpCasCountForAuthorization: 0,
      catchUpCasCountForBaselineRound: 0,
    },
  }

  action beginNextAutomaticCompetingHeadCycle: bool = all {
    state.phase != AwaitingAuthorization,
    state.phase != OccurrenceEnded,
    not(state.refreshAvailable),
    state' = {
      ...state,
      phase: OccurrenceEnded,
    },
  }

  action recordRemoteBaselineReadIntent: bool = all {
    (state.phase == Authorized and state.baselineReadIntentCount == 0)
      or and {
        state.refreshAvailable,
        state.refreshRoundCount == 0,
        state.baselineReadIntentCount > 0,
      },
    state.baselineReadIntentCount == state.baselineReadCountForAuthorization,
    state' = {
      ...state,
      phase: ReadPending,
      baselineReadIntentCount: state.baselineReadIntentCount + 1,
      refreshRoundCount: if (state.baselineReadIntentCount == 0) state.refreshRoundCount else state.refreshRoundCount + 1,
      refreshAvailable: false,
      catchUpCasCountForBaselineRound: 0,
    },
  }

  // Abstract restartCoordinator setting refreshRoundAvailable. The canonical
  // action additionally checks baselineReadyPosition and successor fixation;
  // this projection retains the counted-observation/one-refresh ordering.
  action makeBaselineRefreshAvailable: bool = all {
    not(state.refreshAvailable),
    state.refreshRoundCount == 0,
    state.baselineReadIntentCount == 1,
    state.baselineReadCountForAuthorization == 1,
    state.phase == AncestorObserved or state.phase == OtherObserved or state.phase == CatchUpApplied,
    state' = {
      ...state,
      refreshAvailable: true,
    },
  }

  action observeAncestorLocalBaseline: bool = all {
    state.phase == ReadPending,
    state.baselineReadIntentCount == state.baselineReadCountForAuthorization + 1,
    state' = {
      ...state,
      phase: AncestorObserved,
      baselineReadCountForAuthorization: state.baselineReadCountForAuthorization + 1,
    },
  }

  // Represents observeAlreadyCurrentLocalBaseline and both unsafe-observation
  // variants. They count the read but cannot create a catch-up intent.
  action observeOtherBaseline: bool = all {
    state.phase == ReadPending,
    state.baselineReadIntentCount == state.baselineReadCountForAuthorization + 1,
    state' = {
      ...state,
      phase: OtherObserved,
      baselineReadCountForAuthorization: state.baselineReadCountForAuthorization + 1,
    },
  }

  action recordCatchUpIntent: bool = all {
    state.phase == AncestorObserved,
    state.catchUpCasCountForBaselineRound == 0,
    state' = {
      ...state,
      phase: CatchUpIntentRecorded,
    },
  }

  action compareAndSetLocalTargetToRemoteHead: bool = all {
    state.phase == CatchUpIntentRecorded,
    state.baselineReadCountForAuthorization > 0,
    state.catchUpCasCountForBaselineRound == 0,
    state' = {
      ...state,
      phase: CatchUpApplied,
      catchUpCasCountForAuthorization: state.catchUpCasCountForAuthorization + 1,
      catchUpCasCountForBaselineRound: state.catchUpCasCountForBaselineRound + 1,
    },
  }

  action step: bool = any {
    recordAutomaticSuccessorAuthorization,
    beginNextAutomaticCompetingHeadCycle,
    recordRemoteBaselineReadIntent,
    makeBaselineRefreshAvailable,
    observeAncestorLocalBaseline,
    observeOtherBaseline,
    recordCatchUpIntent,
    compareAndSetLocalTargetToRemoteHead,
  }
}
