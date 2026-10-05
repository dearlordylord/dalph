// #433 G1-G7: one Run control serializes metadata for two deliberate request
// identities and two independent implementation owners. Owner observations
// abstract exact native custody; they do not establish providers or task facts.
// Text is ephemeral; digest classes distinguish equal and contradictory input.
module executorGuidance {
  type Phase = Empty | Admitted | Intended | Observed
  type Disposition = NoDisposition | InputAccepted | Refused | Unknown | PayloadLost
  type Receipt = { phase: Phase, attempt: int, digest: int, selectedTurn: int,
    calls: int, sentAttempt: int, sentTurn: int, disposition: Disposition,
    textPresent: bool, liveAtSend: bool }
  type State = { receipts: int -> Receipt, turns: int -> int, active: Set[int],
    owned: Set[int], capable: Set[int], running: bool, admissionOpen: bool,
    faultsAllowed: bool, lastIdentityContradiction: bool, durableText: bool, authorityChanges: int }
  var state: State
  pure val emptyReceipt = { phase: Empty, attempt: 1, digest: 1, selectedTurn: 0,
    calls: 0, sentAttempt: 0, sentTurn: 0, disposition: NoDisposition,
    textPresent: false, liveAtSend: false }
  pure def admittedReceipt(attempt: int, digest: int): Receipt = {
    ...emptyReceipt, phase: Admitted, attempt: attempt, digest: digest, textPresent: true,
  }
  action initWithFaults(faults: bool): bool = all { state' = {
    receipts: Map(1 -> emptyReceipt, 2 -> emptyReceipt), turns: Map(1 -> 1, 2 -> 1),
    active: Set(1, 2), owned: Set(1, 2), capable: Set(1, 2), running: true, admissionOpen: true,
    faultsAllowed: faults, lastIdentityContradiction: false, durableText: false, authorityChanges: 0,
  } }
  // Stratify healthy and fault-permitted traces so witness sampling also
  // exercises both active owners. The fault-permitted initial state retains
  // every crash, cutoff and unreadable-boundary interleaving.
  action init = { nondet faults = Set(true, false).oneOf() initWithFaults(faults) }
  action admit(nonce: int, attempt: int, digest: int): bool = all {
    state.running, state.admissionOpen,
    val prior = state.receipts.get(nonce)
    state' = { ...state,
      receipts: if (prior.phase == Empty)
        state.receipts.set(nonce, admittedReceipt(attempt, digest)) else state.receipts,
      lastIdentityContradiction: prior.phase != Empty and (prior.attempt != attempt or prior.digest != digest),
    },
  }
  val metadataDoesNotPersistText = not(state.durableText)
  val guidanceGrantsNoAuthority = state.authorityChanges == 0
  val sendsAreBounded = Set(1, 2).forall(n => state.receipts.get(n).calls <= 1)
  val admittedReached = Set(1, 2).exists(n => state.receipts.get(n).phase == Admitted)
  pure def selectable(s: State, r: Receipt): bool =
    r.digest != 3 and s.active.contains(r.attempt) and s.owned.contains(r.attempt) and s.capable.contains(r.attempt)
  action selectTurn(nonce: int): bool = {
    val receipt = state.receipts.get(nonce)
    all {
    state.running,
    receipt.phase == Admitted, receipt.textPresent,
    state' = { ...state, receipts: state.receipts.set(nonce,
      if (selectable(state, receipt)) { ...receipt, phase: Intended, selectedTurn: state.turns.get(receipt.attempt) }
      else { ...receipt, phase: Observed, disposition: Refused, textPresent: false }) },
    }
  }
  action dispatch(nonce: int): bool = {
    val receipt = state.receipts.get(nonce)
    all {
    state.running,
    receipt.phase == Intended, receipt.calls == 0, receipt.textPresent,
    state' = { ...state, receipts: state.receipts.set(nonce,
      if (selectable(state, receipt) and receipt.selectedTurn == state.turns.get(receipt.attempt))
        { ...receipt, calls: 1, sentAttempt: receipt.attempt, sentTurn: receipt.selectedTurn, liveAtSend: true }
      else { ...receipt, phase: Observed, disposition: Refused, textPresent: false }) },
    }
  }
  action acknowledge(nonce: int, exact: bool, readable: bool): bool = {
    val receipt = state.receipts.get(nonce)
    all {
    state.running,
    receipt.phase == Intended, receipt.calls == 1,
    state' = { ...state, receipts: state.receipts.set(nonce,
      { ...receipt, phase: Observed, textPresent: false,
        disposition: if (exact and readable) InputAccepted else Unknown }) },
    }
  }
  action finishTurn(attempt: int): bool = all {
    state.faultsAllowed,
    state.active.contains(attempt),
    state' = { ...state, active: state.active.exclude(Set(attempt)), turns: state.turns.set(attempt, 2) },
  }
  action loseCustody(attempt: int): bool = all {
    state.faultsAllowed,
    state.owned.contains(attempt), state' = { ...state, owned: state.owned.exclude(Set(attempt)) },
  }
  action loseCapability(attempt: int): bool = all {
    state.faultsAllowed,
    state.capable.contains(attempt), state' = { ...state, capable: state.capable.exclude(Set(attempt)) },
  }
  action closeAdmission = all {
    state.faultsAllowed,
    state.admissionOpen, state' = { ...state, admissionOpen: false },
  }
  action crash = all {
    state.faultsAllowed,
    state.running, state' = { ...state, running: false,
      receipts: state.receipts.set(1, { ...state.receipts.get(1), textPresent: false })
        .set(2, { ...state.receipts.get(2), textPresent: false }) },
  }
  action recover = all { not(state.running), state' = { ...state, running: true } }
  action reconcile(nonce: int): bool = {
    val receipt = state.receipts.get(nonce)
    all {
    state.running,
    not(receipt.textPresent), Set(Admitted, Intended).contains(receipt.phase),
    state' = { ...state, receipts: state.receipts.set(nonce, { ...receipt, phase: Observed,
      disposition: if (receipt.phase == Intended) Unknown else PayloadLost }) },
    }
  }
  val exactTurnOnly = Set(1, 2).forall(n => {
    val r = state.receipts.get(n)
    r.calls == 0 or (r.sentAttempt == r.attempt and r.sentTurn == r.selectedTurn and r.liveAtSend)
  })
  val acceptedRequiresExactEffect = Set(1, 2).forall(n => {
    val r = state.receipts.get(n)
    r.disposition != InputAccepted or (r.phase == Observed and r.calls == 1)
  })
  val lostTextCannotProveNoTransmission = Set(1, 2).forall(n => {
    val r = state.receipts.get(n)
    r.disposition != PayloadLost or (r.calls == 0 and r.selectedTurn == 0)
  })
  // Digest classes 1/2 distinguish two legal inputs; class 3 represents
  // an oversized input. Its retained identity cannot become a smaller message.
  val oversizedCannotTransmit = Set(1, 2).forall(n => {
    val r = state.receipts.get(n)
    r.digest != 3 or r.calls == 0
  })
  val oversizedRefusalReached = Set(1, 2).exists(n => {
    val r = state.receipts.get(n)
    r.digest == 3 and r.disposition == Refused
  })
  val acceptedReached = Set(1, 2).exists(n => state.receipts.get(n).disposition == InputAccepted)
  val unknownReached = Set(1, 2).exists(n => state.receipts.get(n).disposition == Unknown)
  val payloadLostReached = Set(1, 2).exists(n => state.receipts.get(n).disposition == PayloadLost)
  val refusedReached = Set(1, 2).exists(n => state.receipts.get(n).disposition == Refused)
  val independentAttemptsReached = state.receipts.get(1).calls == 1 and state.receipts.get(2).calls == 1
    and state.receipts.get(1).attempt != state.receipts.get(2).attempt
  val contradictionReached = state.lastIdentityContradiction
  val closedAdmissionReached = not(state.admissionOpen)
  action step = {
    nondet nonce = Set(1, 2).oneOf()
    nondet attempt = Set(1, 2).oneOf()
    nondet digest = Set(1, 2, 3).oneOf()
    nondet exact = Set(true, false).oneOf()
    nondet readable = Set(true, false).oneOf()
    any { admit(nonce, attempt, digest), selectTurn(nonce), dispatch(nonce), acknowledge(nonce, exact, readable),
      finishTurn(attempt), loseCustody(attempt), loseCapability(attempt), closeAdmission, crash, recover, reconcile(nonce) }
  }
  // Directed conformance control: the same retained nonce sees changed input.
  action identityMbtStep = {
    nondet nonce = Set(1).oneOf()
    nondet attempt = Set(1).oneOf()
    nondet digest = Set(1, 2).oneOf()
    nondet exact = Set(true).oneOf()
    nondet readable = Set(true).oneOf()
    val r = state.receipts.get(1)
    any {
      all { r.phase == Empty, digest == 1, admit(nonce, attempt, digest) },
      all { r.phase == Admitted, selectTurn(nonce) },
      all { r.phase == Intended, r.calls == 0, dispatch(nonce) },
      all { r.phase == Intended, r.calls == 1, acknowledge(nonce, exact, readable) },
      all { r.phase == Observed, digest == 2, admit(nonce, attempt, digest) },
    }
  }
}
