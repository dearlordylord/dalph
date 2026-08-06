// Shared L2 benchmark: the Dalph delivery protocol, abstracted to the smallest
// model that still expresses invariants 7-19 of ../INVARIANTS.md.
//
// MUTANT selects a seeded defect from ../MUTANTS.md. 0 is the faithful model.
module deliveryCore {
  const MUTANT: int

  type TaskId = int

  type Phase =
    | NoObligation
    | Claimed
    | Planned
    | Executing
    | SuspensionRequested
    | Suspended
    | Accepted
    | Integrating
    | Promoted
    | Settled
    // Terminal, but retained rather than settled: the analogue of
    // CorrectionLimitReached in specs/acceptedResultIntegration.qnt. Only the
    // temporal properties need it -- parking in Integrating forever violates
    // no safety property at all.
    | Abandoned

  type Ticket = {
    phase: Phase,
    attempts: int,
    present: bool,
    open: bool,
    expectedHead: int,
  }

  pure val TASKS: Set[TaskId] = Set(0, 1)
  pure val MAX_CAPACITY: int = 2

  var tickets: TaskId -> Ticket
  var capacity: int
  var positions: Set[TaskId]
  var paused: bool
  var targetResource: Set[TaskId]
  var targetHead: int
  var crashed: bool

  // History flags: conditions that are properties of transitions, not of states.
  var admissionRespectedCeiling: bool
  var promotedFromExactHead: bool

  // ---------------------------------------------------------------- derivation

  pure def holdsPosition(phase: Phase): bool =
    phase == Executing or phase == SuspensionRequested

  /** Graph-eligible: present in the latest observation and open with prerequisites met. */
  val eligible: Set[TaskId] =
    TASKS.filter(id => tickets.get(id).present and tickets.get(id).open)

  /** Deterministic rank inside the eligible set; ordering is graph-owned, not runtime-owned. */
  def rankOf(id: TaskId): int =
    eligible.filter(other => other < id).size()

  val selected: Set[TaskId] =
    if (MUTANT == 1)
      eligible.filter(id => rankOf(id) <= capacity)
    else
      eligible.filter(id => rankOf(id) < capacity)

  /** An exact outstanding obligation Dalph must still settle. */
  def hasObligation(id: TaskId): bool =
    tickets.get(id).phase != NoObligation and tickets.get(id).phase != Settled

  /** The ticket-delivery relation: selected now, or retained by exact lower evidence. */
  val deliveries: Set[TaskId] =
    if (MUTANT == 2)
      selected
    else
      selected.union(TASKS.filter(hasObligation))

  // ---------------------------------------------------------------- invariants

  /** 1. Bound: selection never exceeds the configured ceiling. */
  val boundRespected: bool = selected.size() <= capacity

  /** 3. Exhaustive: every task is eligible or has a graph-owned reason not to be. */
  val exhaustiveClassification: bool =
    TASKS.forall(id =>
      eligible.contains(id) != (not(tickets.get(id).present) or not(tickets.get(id).open))
    )

  /** 4. Retention: an exact obligation survives every graph placement. */
  val retentionHolds: bool =
    TASKS.forall(id => not(hasObligation(id)) or deliveries.contains(id))

  /** 5. Settlement drop: settled tickets carry no obligation. */
  val settlementDropped: bool =
    TASKS.forall(id => tickets.get(id).phase != Settled or not(hasObligation(id)))

  /** 7. Position discipline: a position is held exactly while work is outstanding. */
  val positionDiscipline: bool =
    crashed or positions == TASKS.filter(id => holdsPosition(tickets.get(id).phase))

  /**
   * 8. The capacity trap. This is deliberately NOT the ceiling invariant: a
   * capacity contraction lets existing holders continue, so a state predicate
   * over held positions is the wrong specification. The true rule constrains
   * admission, which is a transition property.
   */
  val ceilingOverHeldPositions: bool = positions.size() <= capacity
  val admissionRule: bool = admissionRespectedCeiling

  /** 10. One attempt in flight per task, across crash and recovery. */
  val oneAttemptPerTask: bool =
    TASKS.forall(id => tickets.get(id).attempts <= 1)

  /** 12/13. Integration target is serialized and promotion is compare-and-set. */
  val targetResourceExclusive: bool = targetResource.size() <= 1
  val promotionUsedExactHead: bool = promotedFromExactHead

  /** 14. Process-local resources never survive a crash. */
  val processLocalLostOnCrash: bool =
    not(crashed) or (positions == Set() and targetResource == Set())

  /** 17. Pause admits no new work. */
  val pauseBlocksAdmission: bool =
    not(paused) or TASKS.forall(id => tickets.get(id).phase != Planned or not(positions.contains(id)))

  val allInvariants: bool = and {
    boundRespected,
    exhaustiveClassification,
    retentionHolds,
    settlementDropped,
    positionDiscipline,
    admissionRule,
    oneAttemptPerTask,
    targetResourceExclusive,
    promotionUsedExactHead,
    processLocalLostOnCrash,
  }

  // ----------------------------------------------------------------- witnesses

  val executingReached: bool = TASKS.exists(id => tickets.get(id).phase == Executing)
  val suspendedReached: bool = TASKS.exists(id => tickets.get(id).phase == Suspended)
  val integratingReached: bool = TASKS.exists(id => tickets.get(id).phase == Integrating)
  val settledReached: bool = TASKS.exists(id => tickets.get(id).phase == Settled)
  val crashReached: bool = crashed
  val absentWithObligationReached: bool =
    TASKS.exists(id => hasObligation(id) and not(tickets.get(id).present))

  // ------------------------------------------------------------------- actions

  pure val freshTicket: Ticket = {
    phase: NoObligation,
    attempts: 0,
    present: false,
    open: false,
    expectedHead: 0,
  }

  action init: bool = all {
    tickets' = TASKS.mapBy(_ => freshTicket),
    capacity' = 1,
    positions' = Set(),
    paused' = false,
    targetResource' = Set(),
    targetHead' = 0,
    crashed' = false,
    admissionRespectedCeiling' = true,
    promotedFromExactHead' = true,
  }

  /** Everything except `tickets` is unchanged. */
  action onlyTickets(updated: TaskId -> Ticket): bool = all {
    tickets' = updated,
    capacity' = capacity,
    positions' = positions,
    paused' = paused,
    targetResource' = targetResource,
    targetHead' = targetHead,
    crashed' = crashed,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action observeGraph(id: TaskId, nowPresent: bool, nowOpen: bool): bool =
    onlyTickets(tickets.setBy(id, t => t.with("present", nowPresent).with("open", nowOpen)))

  action acquireClaim(id: TaskId): bool = all {
    not(crashed),
    tickets.get(id).phase == NoObligation,
    selected.contains(id),
    onlyTickets(tickets.setBy(id, t => t.with("phase", Claimed))),
  }

  action planAttempt(id: TaskId): bool = all {
    not(crashed),
    tickets.get(id).phase == Claimed,
    onlyTickets(tickets.setBy(id, t => t.with("phase", Planned).with("attempts", t.attempts + 1))),
  }

  action beginWork(id: TaskId): bool = all {
    not(crashed),
    not(paused),
    tickets.get(id).phase == Planned,
    positions.size() < capacity,
    tickets' = tickets.setBy(id, t => t.with("phase", Executing)),
    positions' = positions.union(Set(id)),
    admissionRespectedCeiling' = (admissionRespectedCeiling and (positions.size() + 1 <= capacity)),
    capacity' = capacity,
    paused' = paused,
    targetResource' = targetResource,
    targetHead' = targetHead,
    crashed' = crashed,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action requestSuspension(id: TaskId): bool = all {
    not(crashed),
    tickets.get(id).phase == Executing,
    tickets' = tickets.setBy(id, t => t.with("phase", SuspensionRequested)),
    // MUTANT 4 releases the position at the request instead of at the proof.
    positions' = if (MUTANT == 4) positions.exclude(Set(id)) else positions,
    capacity' = capacity,
    paused' = paused,
    targetResource' = targetResource,
    targetHead' = targetHead,
    crashed' = crashed,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action releasePosition(id: TaskId, nextPhase: Phase): bool = all {
    tickets' = tickets.setBy(id, t => t.with("phase", nextPhase)),
    positions' = positions.exclude(Set(id)),
    capacity' = capacity,
    paused' = paused,
    targetResource' = targetResource,
    targetHead' = targetHead,
    crashed' = crashed,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action safelySuspend(id: TaskId): bool = all {
    not(crashed),
    tickets.get(id).phase == SuspensionRequested,
    releasePosition(id, Suspended),
  }

  action resumeWork(id: TaskId): bool = all {
    not(crashed),
    not(paused),
    tickets.get(id).phase == Suspended,
    positions.size() < capacity,
    tickets' = tickets.setBy(id, t => t.with("phase", Executing)),
    positions' = positions.union(Set(id)),
    admissionRespectedCeiling' = (admissionRespectedCeiling and (positions.size() + 1 <= capacity)),
    capacity' = capacity,
    paused' = paused,
    targetResource' = targetResource,
    targetHead' = targetHead,
    crashed' = crashed,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action reportAccepted(id: TaskId): bool = all {
    not(crashed),
    tickets.get(id).phase == Executing,
    releasePosition(id, Accepted),
  }

  action startIntegration(id: TaskId): bool = all {
    not(crashed),
    tickets.get(id).phase == Accepted,
    targetResource == Set(),
    tickets' = tickets.setBy(id, t => t.with("phase", Integrating).with("expectedHead", targetHead)),
    targetResource' = Set(id),
    positions' = positions,
    capacity' = capacity,
    paused' = paused,
    targetHead' = targetHead,
    crashed' = crashed,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action promote(id: TaskId): bool = all {
    not(crashed),
    tickets.get(id).phase == Integrating,
    // MUTANT 6 drops the compare-and-set guard against the exact expected head.
    or { MUTANT == 6, tickets.get(id).expectedHead == targetHead },
    tickets' = tickets.setBy(id, t => t.with("phase", Promoted)),
    targetHead' = targetHead + 1,
    targetResource' = Set(),
    promotedFromExactHead' = (promotedFromExactHead and (tickets.get(id).expectedHead == targetHead)),
    positions' = positions,
    capacity' = capacity,
    paused' = paused,
    crashed' = crashed,
    admissionRespectedCeiling' = admissionRespectedCeiling,
  }

  /** The escape from a stale integration head; see I18. */
  action abandonIntegration(id: TaskId): bool = all {
    not(crashed),
    tickets.get(id).phase == Integrating,
    tickets.get(id).expectedHead != targetHead,
    tickets' = tickets.setBy(id, t => t.with("phase", Abandoned)),
    targetResource' = Set(),
    positions' = positions,
    capacity' = capacity,
    paused' = paused,
    crashed' = crashed,
    targetHead' = targetHead,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action settle(id: TaskId): bool = all {
    not(crashed),
    tickets.get(id).phase == Promoted,
    onlyTickets(tickets.setBy(id, t => t.with("phase", Settled))),
  }

  action applyPause: bool = all {
    not(crashed),
    not(paused),
    paused' = true,
    tickets' = tickets,
    capacity' = capacity,
    positions' = positions,
    targetResource' = targetResource,
    targetHead' = targetHead,
    crashed' = crashed,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action applyUnpause: bool = all {
    not(crashed),
    paused,
    paused' = false,
    tickets' = tickets,
    capacity' = capacity,
    positions' = positions,
    targetResource' = targetResource,
    targetHead' = targetHead,
    crashed' = crashed,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action changeCapacity(target: int): bool = all {
    not(crashed),
    target >= 0,
    target <= MAX_CAPACITY,
    target != capacity,
    capacity' = target,
    tickets' = tickets,
    positions' = positions,
    paused' = paused,
    targetResource' = targetResource,
    targetHead' = targetHead,
    crashed' = crashed,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  /** The integration target may advance outside Dalph, staling a captured expected head. */
  action externalTargetAdvance: bool = all {
    targetHead < 2,
    targetHead' = targetHead + 1,
    tickets' = tickets,
    capacity' = capacity,
    positions' = positions,
    paused' = paused,
    targetResource' = targetResource,
    crashed' = crashed,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  /** Process loss: durable phases survive, process-local ownership does not. */
  action crash: bool = all {
    not(crashed),
    crashed' = true,
    positions' = Set(),
    targetResource' = Set(),
    tickets' = TASKS.mapBy(id =>
      if (tickets.get(id).phase == Integrating)
        tickets.get(id).with("phase", Accepted)
      else
        tickets.get(id)
    ),
    capacity' = capacity,
    paused' = paused,
    targetHead' = targetHead,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  /** Recovery continues the exact reconstructed attempt; it plans no replacement. */
  action recover: bool = all {
    crashed,
    crashed' = false,
    positions' = TASKS.filter(id => holdsPosition(tickets.get(id).phase)),
    // MUTANT 5 treats process loss as a reason to plan a second attempt.
    tickets' =
      if (MUTANT == 5)
        TASKS.mapBy(id =>
          if (holdsPosition(tickets.get(id).phase))
            tickets.get(id).with("attempts", tickets.get(id).attempts + 1)
          else
            tickets.get(id)
        )
      else
        tickets,
    capacity' = capacity,
    paused' = paused,
    targetResource' = targetResource,
    targetHead' = targetHead,
    admissionRespectedCeiling' = admissionRespectedCeiling,
    promotedFromExactHead' = promotedFromExactHead,
  }

  action step: bool = {
    nondet id = TASKS.oneOf()
    nondet nextCapacity = 0.to(MAX_CAPACITY).oneOf()
    nondet nowPresent = Set(false, true).oneOf()
    nondet nowOpen = Set(false, true).oneOf()
    any {
      observeGraph(id, nowPresent, nowOpen),
      acquireClaim(id),
      planAttempt(id),
      beginWork(id),
      requestSuspension(id),
      safelySuspend(id),
      resumeWork(id),
      reportAccepted(id),
      startIntegration(id),
      promote(id),
      settle(id),
      abandonIntegration(id),
      applyPause,
      applyUnpause,
      changeCapacity(nextCapacity),
      externalTargetAdvance,
      crash,
      recover,
    }
  }

  // ------------------------------------------------------------------ temporal
  //
  // I17-I19 of ../INVARIANTS.md. Quint has `always`, `eventually`, `weakFair`
  // and `strongFair` as builtins, so these read closer to the TLA+ originals
  // than the Alloy ones do -- `strongFair` is literally `SF_e(A)`.
  //
  // The catch is at the back end. `quint run` cannot evaluate temporal
  // operators at all, and only Apalache can, so every property below is
  // reachable exclusively through `quint verify --temporal`. See ./NOTES.md
  // for what that actually did.

  val vars = (tickets, capacity, positions, paused, targetResource, targetHead,
              crashed, admissionRespectedCeiling, promotedFromExactHead)

  /// Strong, not weak, and per action, not on the disjunction: the two
  /// mistakes ../tlaplus/DeliveryLiveness.tla made and TLC caught.
  temporal fairness = and {
    TASKS.forall(id => and {
      acquireClaim(id).strongFair(vars),
      planAttempt(id).strongFair(vars),
      beginWork(id).strongFair(vars),
      safelySuspend(id).strongFair(vars),
      resumeWork(id).strongFair(vars),
      reportAccepted(id).strongFair(vars),
      startIntegration(id).strongFair(vars),
      promote(id).strongFair(vars),
      abandonIntegration(id).strongFair(vars),
      settle(id).strongFair(vars),
    }),
    recover.strongFair(vars),
  }

  temporal eventuallyStable = eventually(always(not(crashed)))
  temporal eventuallyRunning = eventually(always(not(paused)))
  temporal eventuallyRoomy = eventually(always(capacity > 0))

  /// I17: a pause that stays applied drains every held position.
  temporal pauseDrainsPositions =
    (fairness and always(paused) and eventuallyStable)
      implies eventually(positions == Set())

  /// I18: settles OR is retained with an exact stated reason. Both disjuncts.
  temporal everyBegunSettles =
    (fairness and eventuallyStable and eventuallyRunning and eventuallyRoomy)
      implies TASKS.forall(id =>
        always(
          (tickets.get(id).phase != Executing)
            or eventually(tickets.get(id).phase == Settled
                            or tickets.get(id).phase == Abandoned)
        ))

  /// I19: strictly weaker than I18 -- parked at Planned under capacity 0 is
  /// quiescent and has completed nothing.
  temporal reachesQuiescence =
    (fairness and eventuallyStable) implies eventually(always(not(step.enabled())))
}

module delivery {
  import deliveryCore(MUTANT = 0).*
}

module deliveryM1 { import deliveryCore(MUTANT = 1).* }
module deliveryM2 { import deliveryCore(MUTANT = 2).* }
module deliveryM4 { import deliveryCore(MUTANT = 4).* }
module deliveryM5 { import deliveryCore(MUTANT = 5).* }
module deliveryM6 { import deliveryCore(MUTANT = 6).* }
