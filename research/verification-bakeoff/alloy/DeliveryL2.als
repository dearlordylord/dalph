/*
 * L2 of ../INVARIANTS.md in Alloy 6, as a real transition system over `var`
 * state and temporal formulas -- not the state-only encoding of Delivery.als.
 *
 * Alloy earns a second appearance here for one reason: it is the only tool in
 * the bake-off that can be asked *is my invariant inductive?* directly, and
 * answer with a counterexample to induction. That is the mechanical route to
 * the strengthening that lean/L2.lean and agda/L2.agda made us invent by hand.
 *
 * See `attemptsAloneIsInductive` at the bottom, which fails, and
 * `invIsInductive`, which does not.
 */
module deliveryL2

abstract sig Phase {}
one sig NoObligation, Claimed, Planned, Executing, SuspensionRequested,
        Suspended, Accepted, Integrating, Promoted, Settled,
        Abandoned extends Phase {}

sig Task {
  var phase        : one Phase,
  var attempts     : one Int,
  var expectedHead : one Int
}

one sig Sys {
  var capacity : one Int,
  var head     : one Int,
  var target   : lone Task
}

// Booleans, in the Alloy idiom: a var subset of the singleton Sys.
var sig Paused, Crashed in Sys {}
// Graph placement and process-local positions.
var sig Present, Opened, Holds in Task {}

/* ------------------------------------------------------------------ frames
 *
 * Alloy has no UNCHANGED shorthand, so every action states its whole frame.
 * These three predicates carry the parts an action leaves alone.
 */

pred ticketsUnchanged { phase' = phase and attempts' = attempts and expectedHead' = expectedHead }
pred sysUnchanged { Sys.capacity' = Sys.capacity and Sys.head' = Sys.head and Sys.target' = Sys.target }
pred graphUnchanged { Present' = Present and Opened' = Opened }
pred flagsUnchanged { Paused' = Paused and Crashed' = Crashed }
pred holdsUnchanged { Holds' = Holds }

pred live { Sys not in Crashed }

/* ----------------------------------------------------------------- actions
 *
 * `++` is relational override, and it is the distinctive move of this
 * encoding: `phase' = phase ++ (t -> Claimed)` updates one task and frames
 * every other in a single equation. The Lean and Agda encodings needed a
 * hand-written `upd` function plus lemmas about it.
 */

pred observeGraph[t : Task] {
  ticketsUnchanged and sysUnchanged and flagsUnchanged and holdsUnchanged
  Present' = Present - t + (t & Present')
  Opened' = Opened - t + (t & Opened')
}

pred acquireClaim[t : Task] {
  live and t.phase = NoObligation
  phase' = phase ++ (t -> Claimed)
  attempts' = attempts and expectedHead' = expectedHead
  sysUnchanged and graphUnchanged and flagsUnchanged and holdsUnchanged
}

pred planAttempt[t : Task] {
  live and t.phase = Claimed
  phase' = phase ++ (t -> Planned)
  attempts' = attempts ++ (t -> plus[t.attempts, 1])
  expectedHead' = expectedHead
  sysUnchanged and graphUnchanged and flagsUnchanged and holdsUnchanged
}

pred beginWork[t : Task] {
  live and Sys not in Paused and t.phase = Planned and #Holds < Sys.capacity
  phase' = phase ++ (t -> Executing)
  Holds' = Holds + t
  attempts' = attempts and expectedHead' = expectedHead
  sysUnchanged and graphUnchanged and flagsUnchanged
}

pred requestSuspension[t : Task] {
  live and t.phase = Executing
  phase' = phase ++ (t -> SuspensionRequested)
  attempts' = attempts and expectedHead' = expectedHead
  sysUnchanged and graphUnchanged and flagsUnchanged and holdsUnchanged
}

pred safelySuspend[t : Task] {
  live and t.phase = SuspensionRequested
  phase' = phase ++ (t -> Suspended)
  Holds' = Holds - t
  attempts' = attempts and expectedHead' = expectedHead
  sysUnchanged and graphUnchanged and flagsUnchanged
}

pred resumeWork[t : Task] {
  live and Sys not in Paused and t.phase = Suspended and #Holds < Sys.capacity
  phase' = phase ++ (t -> Executing)
  Holds' = Holds + t
  attempts' = attempts and expectedHead' = expectedHead
  sysUnchanged and graphUnchanged and flagsUnchanged
}

pred reportAccepted[t : Task] {
  live and t.phase = Executing
  phase' = phase ++ (t -> Accepted)
  Holds' = Holds - t
  attempts' = attempts and expectedHead' = expectedHead
  sysUnchanged and graphUnchanged and flagsUnchanged
}

pred startIntegration[t : Task] {
  live and t.phase = Accepted and no Sys.target
  phase' = phase ++ (t -> Integrating)
  expectedHead' = expectedHead ++ (t -> Sys.head)
  Sys.target' = t
  Sys.capacity' = Sys.capacity and Sys.head' = Sys.head
  attempts' = attempts
  graphUnchanged and flagsUnchanged and holdsUnchanged
}

pred promote[t : Task] {
  live and t.phase = Integrating and t.expectedHead = Sys.head
  phase' = phase ++ (t -> Promoted)
  no Sys.target'
  Sys.head' = plus[Sys.head, 1]
  Sys.capacity' = Sys.capacity
  attempts' = attempts and expectedHead' = expectedHead
  graphUnchanged and flagsUnchanged and holdsUnchanged
}

/*
 * The escape from a stale integration head. Only the liveness checks in
 * DeliveryLiveness.als need this: without it a ticket parks in Integrating
 * forever, which violates no safety property at all.
 */
pred abandonIntegration[t : Task] {
  live and t.phase = Integrating and t.expectedHead != Sys.head
  phase' = phase ++ (t -> Abandoned)
  no Sys.target'
  Sys.capacity' = Sys.capacity and Sys.head' = Sys.head
  attempts' = attempts and expectedHead' = expectedHead
  graphUnchanged and flagsUnchanged and holdsUnchanged
}

pred settle[t : Task] {
  live and t.phase = Promoted
  phase' = phase ++ (t -> Settled)
  attempts' = attempts and expectedHead' = expectedHead
  sysUnchanged and graphUnchanged and flagsUnchanged and holdsUnchanged
}

pred applyPause {
  live and Sys not in Paused
  Paused' = Sys and Crashed' = Crashed
  ticketsUnchanged and sysUnchanged and graphUnchanged and holdsUnchanged
}

pred applyUnpause {
  live and Sys in Paused
  no Paused' and Crashed' = Crashed
  ticketsUnchanged and sysUnchanged and graphUnchanged and holdsUnchanged
}

pred changeCapacity {
  live
  Sys.capacity' >= 0 and Sys.capacity' =< 2
  Sys.head' = Sys.head and Sys.target' = Sys.target
  ticketsUnchanged and graphUnchanged and flagsUnchanged and holdsUnchanged
}

// The integration target may advance outside Dalph, staling a captured head.
pred externalTargetAdvance {
  Sys.head' = plus[Sys.head, 1]
  Sys.capacity' = Sys.capacity and Sys.target' = Sys.target
  ticketsUnchanged and graphUnchanged and flagsUnchanged and holdsUnchanged
}

pred crash {
  live
  Crashed' = Sys and Paused' = Paused
  no Holds'
  no Sys.target'
  // Integrating falls back to Accepted; the isolated Git work survives.
  phase' = phase ++ { t : Task, p : Phase | t.phase = Integrating and p = Accepted }
  attempts' = attempts and expectedHead' = expectedHead
  Sys.capacity' = Sys.capacity and Sys.head' = Sys.head
  graphUnchanged
}

pred recover {
  Sys in Crashed
  no Crashed' and Paused' = Paused
  Holds' = { t : Task | t.phase in Executing + SuspensionRequested }
  ticketsUnchanged and sysUnchanged and graphUnchanged
}

pred stutter {
  ticketsUnchanged and sysUnchanged and graphUnchanged and flagsUnchanged and holdsUnchanged
}

pred step {
  (some t : Task |
      observeGraph[t] or acquireClaim[t] or planAttempt[t] or beginWork[t]
   or requestSuspension[t] or safelySuspend[t] or resumeWork[t]
   or reportAccepted[t] or startIntegration[t] or promote[t] or settle[t]
   or abandonIntegration[t])
  or applyPause or applyUnpause or changeCapacity
  or externalTargetAdvance or crash or recover or stutter
}

pred init {
  all t : Task | t.phase = NoObligation and t.attempts = 0 and t.expectedHead = 0
  no Holds and no Present and no Opened
  no Paused and no Crashed
  Sys.capacity = 1 and Sys.head = 0 and no Sys.target
}

/*
 * Deliberately a predicate, not a fact. A `fact` would force every instance to
 * begin at `init`, which silently turns the inductiveness checks below into
 * statements about reachable states only -- the very thing they are meant to
 * avoid asking about.
 */
pred trace { init and always step }

/* -------------------------------------------------------------- invariants */

pred positionDiscipline {
  Sys in Crashed or Holds = { t : Task | t.phase in Executing + SuspensionRequested }
}
pred processLocalLostOnCrash {
  Sys not in Crashed or (no Holds and no Sys.target)
}
pred attemptsBounded { all t : Task | t.attempts =< 1 }
pred phaseBoundsAttempts {
  all t : Task | t.phase in NoObligation + Claimed => t.attempts = 0
}
pred targetMatchesPhase { all t : Task | Sys.target = t => t.phase = Integrating }

pred Inv {
  positionDiscipline and processLocalLostOnCrash and attemptsBounded
  and phaseBoundsAttempts and targetMatchesPhase
}

/* ------------------------------------------------------------------ checks */

// Reachability: does Inv hold along every trace, up to the step bound?
// Reachability: does Inv hold along every trace from init, up to the bound?
check invAlwaysHolds { trace => always Inv } for 2 Task, 5 Int, 1..14 steps

/*
 * The reason this file exists.
 *
 * `attemptsBounded` is exactly the invariant TLC was handed and discharged
 * without comment, and exactly the one that is NOT provable by induction in
 * Lean or Agda. Alloy can be asked the induction question directly, and it
 * answers with a two-state counterexample: a state where every task has
 * attempts =< 1, a `planAttempt` step, and a successor where one does not.
 *
 * That counterexample to induction is the mechanical discovery of the
 * strengthening that the proof assistants made us invent.
 */
check attemptsAloneIsInductive {
  (attemptsBounded and step) => after attemptsBounded
} for 2 Task, 5 Int, 2 steps

// With the strengthening, induction goes through.
check invIsInductive { (Inv and step) => after Inv } for 2 Task, 5 Int, 2 steps

/* ----------------------------------------------------------------- witnesses
 *
 * SAT means the state is reachable, so the checks above are not vacuous.
 */

run executingIsReachable {
  trace and eventually (some t : Task | t.phase = Executing and t in Holds)
} for 2 Task, 5 Int, 1..10 steps

run staleHeadIsReachable {
  trace and eventually (some t : Task | t.phase = Integrating and t.expectedHead != Sys.head)
} for 2 Task, 5 Int, 1..10 steps

run settledIsReachable {
  trace and eventually (some t : Task | t.phase = Settled)
} for 2 Task, 5 Int, 1..14 steps

run crashThenRecover {
  trace and eventually (Sys in Crashed and after (Sys not in Crashed))
} for 2 Task, 5 Int, 1..10 steps

/*
 * The counterexample to induction, made explicit.
 *
 * SAT means Alloy can build a state that satisfies `attemptsBounded`, take one
 * `planAttempt` step, and land in a state that does not. That pair is the
 * whole reason lean/L2.lean and agda/L2.agda carry `phaseBoundsAttempts`.
 *
 * Note it is NOT reachable from `init` -- `invAlwaysHolds` passes. An
 * unreachable counterexample to induction is exactly what a strengthening is
 * for: it rules out a state the transition relation alone permits.
 */
run attemptsCounterexampleToInduction {
  some t : Task |
    t.phase = Claimed and t.attempts = 1 and planAttempt[t] and after t.attempts = 2
} for 2 Task, 5 Int, 2 steps

// And the strengthening is exactly what excludes it.
check strengtheningExcludesTheCTI {
  phaseBoundsAttempts => (all t : Task | t.phase = Claimed => t.attempts = 0)
} for 2 Task, 5 Int, 2 steps
