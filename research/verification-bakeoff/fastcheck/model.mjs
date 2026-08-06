/**
 * The shared benchmark of ../MODEL.md, in JavaScript, with the same MUTANT
 * switch as the Quint encoding. Kept deliberately close to `deliveryCore.qnt`
 * so the two engines search the same state space and the comparison is about
 * the search, not about the model.
 */

export const TASKS = [0, 1]
export const MAX_CAPACITY = 2
export const MAX_EXTERNAL_ADVANCE = 2

const HOLDS_POSITION = new Set(["Executing", "SuspensionRequested"])

// ------------------------------------------------------------------------ L1

export const eligibleOf = (tickets) => TASKS.filter((id) => tickets[id].present && tickets[id].open)

export const selectedOf = (tickets, capacity, mutant) => {
  const eligible = eligibleOf(tickets)
  return eligible.filter((id) => {
    const rank = eligible.filter((other) => other < id).length
    return mutant === 1 ? rank <= capacity : rank < capacity
  })
}

export const hasObligation = (ticket) => ticket.phase !== "NoObligation" && ticket.phase !== "Settled"

export const deliveriesOf = (tickets, capacity, mutant) => {
  const selected = selectedOf(tickets, capacity, mutant)
  if (mutant === 2) return selected
  const retained = TASKS.filter((id) => hasObligation(tickets[id]))
  return [...new Set([...selected, ...retained])].sort((a, b) => a - b)
}

// ------------------------------------------------------------------------ L2

export const initialState = () => ({
  tickets: Object.fromEntries(
    TASKS.map((id) => [id, { phase: "NoObligation", attempts: 0, present: false, open: false, expectedHead: 0 }])
  ),
  capacity: 1,
  positions: [],
  paused: false,
  targetResource: [],
  targetHead: 0,
  crashed: false,
  admissionRespectedCeiling: true,
  promotedFromExactHead: true
})

const clone = (state) => structuredClone(state)

/** Every action is a guard plus an update; `null` means the guard failed. */
export const actions = {
  observeGraph: (s, { id, present, open }) => {
    const next = clone(s)
    next.tickets[id].present = present
    next.tickets[id].open = open
    return next
  },
  acquireClaim: (s, { id }, mutant) => {
    if (s.crashed || s.tickets[id].phase !== "NoObligation") return null
    if (!selectedOf(s.tickets, s.capacity, mutant).includes(id)) return null
    const next = clone(s)
    next.tickets[id].phase = "Claimed"
    return next
  },
  planAttempt: (s, { id }) => {
    if (s.crashed || s.tickets[id].phase !== "Claimed") return null
    const next = clone(s)
    next.tickets[id].phase = "Planned"
    next.tickets[id].attempts += 1
    return next
  },
  beginWork: (s, { id }) => {
    if (s.crashed || s.paused || s.tickets[id].phase !== "Planned") return null
    if (s.positions.length >= s.capacity) return null
    const next = clone(s)
    next.tickets[id].phase = "Executing"
    next.positions = [...s.positions, id]
    next.admissionRespectedCeiling = s.admissionRespectedCeiling && next.positions.length <= s.capacity
    return next
  },
  requestSuspension: (s, { id }, mutant) => {
    if (s.crashed || s.tickets[id].phase !== "Executing") return null
    const next = clone(s)
    next.tickets[id].phase = "SuspensionRequested"
    if (mutant === 4) next.positions = s.positions.filter((held) => held !== id)
    return next
  },
  safelySuspend: (s, { id }) => {
    if (s.crashed || s.tickets[id].phase !== "SuspensionRequested") return null
    const next = clone(s)
    next.tickets[id].phase = "Suspended"
    next.positions = s.positions.filter((held) => held !== id)
    return next
  },
  resumeWork: (s, { id }) => {
    if (s.crashed || s.paused || s.tickets[id].phase !== "Suspended") return null
    if (s.positions.length >= s.capacity) return null
    const next = clone(s)
    next.tickets[id].phase = "Executing"
    next.positions = [...s.positions, id]
    next.admissionRespectedCeiling = s.admissionRespectedCeiling && next.positions.length <= s.capacity
    return next
  },
  reportAccepted: (s, { id }) => {
    if (s.crashed || s.tickets[id].phase !== "Executing") return null
    const next = clone(s)
    next.tickets[id].phase = "Accepted"
    next.positions = s.positions.filter((held) => held !== id)
    return next
  },
  startIntegration: (s, { id }) => {
    if (s.crashed || s.tickets[id].phase !== "Accepted" || s.targetResource.length > 0) return null
    const next = clone(s)
    next.tickets[id].phase = "Integrating"
    next.tickets[id].expectedHead = s.targetHead
    next.targetResource = [id]
    return next
  },
  promote: (s, { id }, mutant) => {
    if (s.crashed || s.tickets[id].phase !== "Integrating") return null
    const exact = s.tickets[id].expectedHead === s.targetHead
    if (mutant !== 6 && !exact) return null
    const next = clone(s)
    next.tickets[id].phase = "Promoted"
    next.targetHead = s.targetHead + 1
    next.targetResource = []
    next.promotedFromExactHead = s.promotedFromExactHead && exact
    return next
  },
  // The escape from a stale integration head. Needed only by the bounded
  // liveness surrogate in ./liveness.mjs -- parking in Integrating forever
  // breaks no invariant.
  abandonIntegration: (s, { id }) => {
    if (s.crashed || s.tickets[id].phase !== "Integrating") return null
    if (s.tickets[id].expectedHead === s.targetHead) return null
    const next = clone(s)
    next.tickets[id].phase = "Abandoned"
    next.targetResource = []
    return next
  },
  settle: (s, { id }) => {
    if (s.crashed || s.tickets[id].phase !== "Promoted") return null
    const next = clone(s)
    next.tickets[id].phase = "Settled"
    return next
  },
  applyPause: (s) => {
    if (s.crashed || s.paused) return null
    return { ...clone(s), paused: true }
  },
  applyUnpause: (s) => {
    if (s.crashed || !s.paused) return null
    return { ...clone(s), paused: false }
  },
  changeCapacity: (s, { capacity }) => {
    if (s.crashed || capacity === s.capacity) return null
    return { ...clone(s), capacity }
  },
  externalTargetAdvance: (s) => {
    if (s.targetHead >= MAX_EXTERNAL_ADVANCE) return null
    return { ...clone(s), targetHead: s.targetHead + 1 }
  },
  crash: (s) => {
    if (s.crashed) return null
    const next = clone(s)
    next.crashed = true
    next.positions = []
    next.targetResource = []
    for (const id of TASKS) {
      if (next.tickets[id].phase === "Integrating") next.tickets[id].phase = "Accepted"
    }
    return next
  },
  recover: (s, _args, mutant) => {
    if (!s.crashed) return null
    const next = clone(s)
    next.crashed = false
    next.positions = TASKS.filter((id) => HOLDS_POSITION.has(next.tickets[id].phase))
    if (mutant === 5) {
      for (const id of next.positions) next.tickets[id].attempts += 1
    }
    return next
  }
}

export const actionNames = Object.keys(actions)

// ----------------------------------------------------------------- invariants

const sameSet = (left, right) => {
  const l = [...left].sort((a, b) => a - b)
  const r = [...right].sort((a, b) => a - b)
  return l.length === r.length && l.every((value, index) => value === r[index])
}

export const invariants = {
  boundRespected: (s, mutant) => selectedOf(s.tickets, s.capacity, mutant).length <= s.capacity,
  retentionHolds: (s, mutant) => {
    const delivered = deliveriesOf(s.tickets, s.capacity, mutant)
    return TASKS.every((id) => !hasObligation(s.tickets[id]) || delivered.includes(id))
  },
  settlementDropped: (s) => TASKS.every((id) => s.tickets[id].phase !== "Settled" || !hasObligation(s.tickets[id])),
  positionDiscipline: (s) =>
    s.crashed || sameSet(s.positions, TASKS.filter((id) => HOLDS_POSITION.has(s.tickets[id].phase))),
  admissionRule: (s) => s.admissionRespectedCeiling,
  oneAttemptPerTask: (s) => TASKS.every((id) => s.tickets[id].attempts <= 1),
  targetResourceExclusive: (s) => s.targetResource.length <= 1,
  promotionUsedExactHead: (s) => s.promotedFromExactHead,
  processLocalLostOnCrash: (s) => !s.crashed || (s.positions.length === 0 && s.targetResource.length === 0),

  /** M8: the seeded specification error of ../MUTANTS.md. Not enabled by default. */
  ceilingOverHeldPositions: (s) => s.positions.length <= s.capacity
}

export const defaultInvariantNames = Object.keys(invariants).filter((name) => name !== "ceilingOverHeldPositions")

export const checkInvariants = (state, mutant, names = defaultInvariantNames) =>
  names.filter((name) => !invariants[name](state, mutant))
