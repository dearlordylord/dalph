/* Symbolic one-step induction check for the complete #197-#199 transition
 * system at exactly three tasks. Fields and actions correspond directly to
 * deliveryEvolution3; this is not the older DeliveryL2 surrogate. */
module deliveryThreeStrengthened

open util/ordering[Task]

abstract sig Phase {}
one sig NoObligation, Claimed, Executing, SuspensionRequested, Suspended,
        Settled, Retained extends Phase {}

sig Task {
  var phase : one Phase,
  var blocker : lone Task,
  var attemptId : one Int,
  var work : one Int
}
one sig Sys { var arrivalsRemaining : one Int }
var sig Present, Opened, RetainedWithReason, Failed, Contradicted in Task {}

fun eligible : set Task { Present & Opened - Failed - blocker.Task }
fun selected : set Task {
  { t : eligible | #{ u : eligible | lt[u, t] } < 2 }
}
fun deliveries : set Task {
  selected + { t : Task | t.phase not in NoObligation + Settled }
}

pred allInvariants {
  all t : Task | t.blocker != t
  no selected.blocker
  #selected =< 2
  all t : selected | #{ u : eligible | lt[u, t] } < 2
  all t : Task | t.phase not in NoObligation + Settled => t in deliveries
  all t : Task | t.phase = Retained => t in RetainedWithReason
  Sys.arrivalsRemaining >= 0 and Sys.arrivalsRemaining =< 3
  all t : Task | t.work >= 0 and t.work =< 2
  all t : Task | t.phase = Settled => t.work = 2
  all t : Task | (t.phase = NoObligation => t.attemptId = 0)
                 and (t.phase != NoObligation => t.attemptId = 1)
  Failed = Contradicted
  Failed in { t : Task | t.phase = Retained }
}

pred ticketFieldsUnchanged {
  phase' = phase and blocker' = blocker and attemptId' = attemptId and work' = work
}
pred setsUnchanged {
  Present' = Present and Opened' = Opened
  RetainedWithReason' = RetainedWithReason
  Failed' = Failed and Contradicted' = Contradicted
}

pred observeArrival[t : Task, b : lone Task] {
  t not in Present and t.phase = NoObligation
  b != t and Sys.arrivalsRemaining > 0
  phase' = phase and attemptId' = attemptId and work' = work
  // `b` is lone. Remove the old domain entry first so `none` really clears
  // an observed blocker, matching Quint's `Set()` blocker observation.
  blocker' = (blocker - (t -> Task)) + (t -> b)
  Present' = Present + t and Opened' = Opened + t
  RetainedWithReason' = RetainedWithReason - t
  Failed' = Failed - t and Contradicted' = Contradicted - t
  Sys.arrivalsRemaining' = minus[Sys.arrivalsRemaining, 1]
}

pred observeBlockers[t : Task, b : lone Task] {
  t in Present and b != t and t.blocker != b
  blocker' = (blocker - (t -> Task)) + (t -> b)
  phase' = phase and attemptId' = attemptId and work' = work
  setsUnchanged and Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred acquireClaim[t : Task] {
  t in selected and t.phase = NoObligation
  phase' = phase ++ (t -> Claimed)
  attemptId' = attemptId ++ (t -> 1)
  blocker' = blocker and work' = work
  setsUnchanged and Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred beginWork[t : Task] {
  t.phase = Claimed and t not in Failed and no t.blocker
  phase' = phase ++ (t -> Executing)
  blocker' = blocker and attemptId' = attemptId and work' = work
  setsUnchanged and Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred doWork[t : Task] {
  t.phase = Executing and t not in Failed and no t.blocker and t.work < 2
  work' = work ++ (t -> plus[t.work, 1])
  phase' = phase and blocker' = blocker and attemptId' = attemptId
  setsUnchanged and Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred requestSuspension[t : Task] {
  t.phase = Executing and t not in Failed
  phase' = phase ++ (t -> SuspensionRequested)
  blocker' = blocker and attemptId' = attemptId and work' = work
  setsUnchanged and Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred safelySuspend[t : Task] {
  t.phase = SuspensionRequested and t not in Failed
  phase' = phase ++ (t -> Suspended)
  blocker' = blocker and attemptId' = attemptId and work' = work
  setsUnchanged and Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred resumeWork[t : Task] {
  t.phase = Suspended and t not in Failed and no t.blocker
  phase' = phase ++ (t -> Executing)
  blocker' = blocker and attemptId' = attemptId and work' = work
  setsUnchanged and Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred settle[t : Task] {
  t.phase = Executing and t not in Failed and no t.blocker and t.work = 2
  phase' = phase ++ (t -> Settled)
  Opened' = Opened - t
  Present' = Present and RetainedWithReason' = RetainedWithReason
  Failed' = Failed and Contradicted' = Contradicted
  blocker' = blocker and attemptId' = attemptId and work' = work
  Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred retainBlocked[t : Task] {
  t.phase in Claimed + Executing + SuspensionRequested + Suspended and some t.blocker
  phase' = phase ++ (t -> Retained)
  RetainedWithReason' = RetainedWithReason + t
  Present' = Present and Opened' = Opened
  Failed' = Failed and Contradicted' = Contradicted
  blocker' = blocker and attemptId' = attemptId and work' = work
  Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred recordLocalContradiction[t : Task] {
  t.phase not in NoObligation + Settled and t not in Failed
  phase' = phase ++ (t -> Retained)
  RetainedWithReason' = RetainedWithReason + t
  Failed' = Failed + t and Contradicted' = Contradicted + t
  Present' = Present and Opened' = Opened
  blocker' = blocker and attemptId' = attemptId and work' = work
  Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

pred recycleArrival[t : Task] {
  t.phase in Settled + Retained and Sys.arrivalsRemaining > 0
  phase' = phase ++ (t -> NoObligation)
  blocker' = blocker - (t -> Task)
  attemptId' = attemptId ++ (t -> 0)
  work' = work ++ (t -> 0)
  Present' = Present + t and Opened' = Opened + t
  RetainedWithReason' = RetainedWithReason - t
  Failed' = Failed - t and Contradicted' = Contradicted - t
  Sys.arrivalsRemaining' = minus[Sys.arrivalsRemaining, 1]
}

pred step {
  (some t : Task | observeArrival[t, none] or observeBlockers[t, none])
  or (some t, b : Task | observeArrival[t, b] or observeBlockers[t, b])
  or (some t : Task | acquireClaim[t] or beginWork[t] or doWork[t]
    or requestSuspension[t] or safelySuspend[t] or resumeWork[t] or settle[t]
    or retainBlocked[t] or recordLocalContradiction[t] or recycleArrival[t])
}

check strengthenedInvIsInductiveThree {
  (allInvariants and step) => after allInvariants
} for exactly 3 Task, 5 Int, 2 steps

pred reversedRankMutation {
  ticketFieldsUnchanged and Present' = Present and Opened' = Opened
  RetainedWithReason' = RetainedWithReason and Failed' = Failed and Contradicted' = Contradicted
  Sys.arrivalsRemaining' = Sys.arrivalsRemaining
  // A mutation to the selected formula is represented by asserting its wrong
  // result as the next-state rank obligation.
  some t : eligible | #{ u : eligible | lt[t, u] } < 2
    and #{ u : eligible | lt[u, t] } >= 2
}

check reversedRankMutationBreaksStrengthening {
  allInvariants => not reversedRankMutation
} for exactly 3 Task, 5 Int, 2 steps

pred failureLeakMutation[t : Task] {
  t.phase not in NoObligation + Settled and t not in Failed
  phase' = phase ++ (t -> Retained)
  RetainedWithReason' = RetainedWithReason + t
  Failed' = Task and Contradicted' = Contradicted + t
  Present' = Present and Opened' = Opened
  blocker' = blocker and attemptId' = attemptId and work' = work
  Sys.arrivalsRemaining' = Sys.arrivalsRemaining
}

check failureLeakMutationBreaksStrengthening {
  (allInvariants and (some t : Task | failureLeakMutation[t])) => after allInvariants
} for exactly 3 Task, 5 Int, 2 steps
