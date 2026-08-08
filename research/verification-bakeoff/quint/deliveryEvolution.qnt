// Follow-up experiments #197-#199. The model is deliberately separate from
// deliveryCore.qnt: it studies tracker blocker changes, bounded arrival,
// preserved executor progress, and task-cardinality scaling without changing
// the historical seven-tool benchmark recorded in SCOREBOARD.md.
module deliveryEvolutionCore {
  const MUTANT: int
  const TASKS: Set[int]
  const INITIAL_ARRIVAL_BUDGET: int

  type Phase =
    | NoObligation
    | Claimed
    | Executing
    | Settled
    | Retained

  type Ticket = {
    phase: Phase,
    present: bool,
    open: bool,
    blockers: Set[int],
    retainedForBlocker: bool,
  }

  type State = {
    tickets: int -> Ticket,
    capacity: int,
    arrivalsRemaining: int,
  }

  var state: State

  pure val freshTicket: Ticket = {
    phase: NoObligation,
    present: false,
    open: false,
    blockers: Set(),
    retainedForBlocker: false,
  }

  pure def isBlocked(ticket: Ticket): bool =
    if (MUTANT == 1) false else ticket.blockers.size() > 0

  pure def isEligible(ticket: Ticket): bool =
    ticket.present and ticket.open and not(isBlocked(ticket))

  val eligible: Set[int] = TASKS.filter(id => isEligible(state.tickets.get(id)))

  def rankOf(id: int): int = eligible.filter(other => other < id).size()

  val selected: Set[int] =
    eligible.filter(id => rankOf(id) < state.capacity)

  pure def hasObligation(ticket: Ticket): bool =
    ticket.phase != NoObligation and ticket.phase != Settled

  val deliveries: Set[int] =
    selected.union(TASKS.filter(id => hasObligation(state.tickets.get(id))))

  val blockersWellFormed: bool = TASKS.forall(id => {
    val blockers = state.tickets.get(id).blockers
    blockers.subseteq(TASKS) and blockers.size() <= 1 and not(blockers.contains(id))
  })

  val selectionRespectsBlockers: bool =
    selected.forall(id => state.tickets.get(id).blockers.size() == 0)

  val selectionRespectsCapacity: bool = selected.size() <= state.capacity

  val obligationsSurviveGraphChanges: bool = TASKS.forall(id =>
    not(hasObligation(state.tickets.get(id))) or deliveries.contains(id))

  val retainedTicketsStateAReason: bool = TASKS.forall(id =>
    state.tickets.get(id).phase != Retained
      or state.tickets.get(id).retainedForBlocker)

  val arrivalBudgetIsBounded: bool =
    state.arrivalsRemaining >= 0 and state.arrivalsRemaining <= INITIAL_ARRIVAL_BUDGET

  val allInvariants: bool = and {
    blockersWellFormed,
    selectionRespectsBlockers,
    selectionRespectsCapacity,
    obligationsSurviveGraphChanges,
    retainedTicketsStateAReason,
    arrivalBudgetIsBounded,
  }

  val blockedTaskReached: bool =
    TASKS.exists(id => state.tickets.get(id).blockers.size() > 0)

  val postSelectionBlockerReached: bool = TASKS.exists(id => {
    val ticket = state.tickets.get(id)
    hasObligation(ticket) and ticket.blockers.size() > 0
  })

  val arrivalBudgetExhaustedReached: bool = state.arrivalsRemaining == 0

  action init: bool = all {
    state' = {
      tickets: TASKS.mapBy(_ => freshTicket),
      capacity: 2,
      arrivalsRemaining: INITIAL_ARRIVAL_BUDGET,
    }
  }

  action observeArrival(id: int, blockers: Set[int]): bool = {
    val current = state.tickets.get(id)
    all {
      TASKS.contains(id),
      not(current.present),
      current.phase == NoObligation,
      blockers.subseteq(TASKS),
      blockers.size() <= 1,
      not(blockers.contains(id)),
      or { MUTANT == 2, state.arrivalsRemaining > 0 },
      state' = {
        ...state,
        tickets: state.tickets.set(id, {
          ...current,
          present: true,
          open: true,
          blockers: blockers,
        }),
        arrivalsRemaining:
          if (state.arrivalsRemaining > 0) state.arrivalsRemaining - 1
          else 0,
      },
    }
  }

  action observeBlockers(id: int, blockers: Set[int]): bool = {
    val current = state.tickets.get(id)
    all {
      TASKS.contains(id),
      current.present,
      blockers.subseteq(TASKS),
      blockers.size() <= 1,
      not(blockers.contains(id)),
      blockers != current.blockers,
      state' = {
        ...state,
        tickets: state.tickets.set(id, {...current, blockers: blockers}),
      },
    }
  }

  action acquireClaim(id: int): bool = {
    val current = state.tickets.get(id)
    all {
      selected.contains(id),
      current.phase == NoObligation,
      state' = {
        ...state,
        tickets: state.tickets.set(id, {...current, phase: Claimed}),
      },
    }
  }

  action beginWork(id: int): bool = {
    val current = state.tickets.get(id)
    all {
      current.phase == Claimed,
      current.blockers.size() == 0,
      state' = {
        ...state,
        tickets: state.tickets.set(id, {...current, phase: Executing}),
      },
    }
  }

  action settle(id: int): bool = {
    val current = state.tickets.get(id)
    all {
      current.phase == Executing,
      current.blockers.size() == 0,
      state' = {
        ...state,
        tickets: state.tickets.set(id, {...current, phase: Settled, open: false}),
      },
    }
  }

  action retainBlocked(id: int): bool = {
    val current = state.tickets.get(id)
    all {
      current.phase == Claimed or current.phase == Executing,
      current.blockers.size() > 0,
      state' = {
        ...state,
        tickets: state.tickets.set(id, {
          ...current,
          phase: Retained,
          retainedForBlocker: true,
        }),
      },
    }
  }

  // A later tracker task is represented by recycling a bounded slot only
  // after the earlier obligation has a terminal disposition. MUTANT 2 removes
  // the budget guard and is the negative control for unbounded arrival.
  action recycleArrival(id: int): bool = {
    val current = state.tickets.get(id)
    all {
      current.phase == Settled or current.phase == Retained,
      or { MUTANT == 2, state.arrivalsRemaining > 0 },
      state' = {
        ...state,
        tickets: state.tickets.set(id, {
          ...freshTicket,
          present: true,
          open: true,
        }),
        arrivalsRemaining:
          if (state.arrivalsRemaining > 0) state.arrivalsRemaining - 1
          else 0,
      },
    }
  }

  action progress(id: int): bool = any {
    acquireClaim(id),
    beginWork(id),
    settle(id),
    retainBlocked(id),
    recycleArrival(id),
  }

  action arrival(id: int): bool = observeArrival(id, Set())

  action step: bool = {
    nondet id = TASKS.oneOf()
    nondet blocker = TASKS.oneOf()
    any {
      observeArrival(id, Set()),
      observeArrival(id, Set(blocker)),
      observeBlockers(id, Set()),
      observeBlockers(id, Set(blocker)),
      progress(id),
    }
  }

  val vars = Set(state)

  temporal fairLifecycle: bool = and {
    TASKS.forall(id => progress(id).strongFair(vars)),
    TASKS.forall(id => arrival(id).strongFair(vars)),
  }

  temporal blockersEventuallyClear: bool =
    eventually(always(TASKS.forall(id => state.tickets.get(id).blockers.size() == 0)))

  temporal reachesQuiescenceAfterBoundedArrival: bool =
    (fairLifecycle and blockersEventuallyClear)
      implies eventually(always(and {
        state.arrivalsRemaining == 0,
        TASKS.forall(id => {
          val ticket = state.tickets.get(id)
          not(ticket.present) or ticket.phase == Settled or ticket.phase == Retained
        }),
        not(TASKS.exists(id => progress(id).enabled())),
      }))
}

module deliveryEvolution2 {
  import deliveryEvolutionCore(
    MUTANT = 0,
    TASKS = Set(0, 1),
    INITIAL_ARRIVAL_BUDGET = 2,
  ).*
}

module deliveryEvolution2IgnoreBlockers {
  import deliveryEvolutionCore(
    MUTANT = 1,
    TASKS = Set(0, 1),
    INITIAL_ARRIVAL_BUDGET = 2,
  ).*
}

module deliveryEvolution2UnboundedArrival {
  import deliveryEvolutionCore(
    MUTANT = 2,
    TASKS = Set(0, 1),
    INITIAL_ARRIVAL_BUDGET = 2,
  ).*
}
