/*
 * I17-I19 of ../INVARIANTS.md in Alloy 6, against the transition system of
 * DeliveryL2.als.
 *
 * Alloy 6 has `always` and `eventually` as first-class operators, so the
 * PROPERTIES here read almost exactly like the TLA+ ones in
 * ../tlaplus/DeliveryLiveness.tla. What does not carry over is everything
 * around them:
 *
 *   1. There is no ENABLED. Alloy fixes the trace, so "some successor state
 *      satisfies A" is not expressible -- you cannot existentially quantify
 *      over the next state. Every guard below is therefore RESTATED as an
 *      `enabled*` predicate, duplicating the first line of the corresponding
 *      action in DeliveryL2.als. Nothing keeps the two copies in agreement.
 *
 *   2. There is no WF_/SF_ and no way to abstract over a formula, because
 *      predicates are not values. So the strong-fairness schema
 *      `(always eventually enabled) => (always eventually taken)` is written
 *      out once per action, by hand, ten times.
 *
 *   3. `check` here is bounded in TIME as well as in size. UNSAT means no
 *      counterexample LASSO of at most the given length exists, which is a
 *      strictly weaker statement than TLC's, since TLC checks all behaviours
 *      of the finite state graph.
 *
 * Taken together: Alloy states liveness as readably as TLA+ and verifies it
 * on much weaker terms, at a much higher price.
 */
module deliveryLiveness

open deliveryL2

/* --------------------------------------------------------------- enabledness
 *
 * Hand-maintained duplicates of the guards in DeliveryL2.als.
 */

// Note: DeliveryL2.als does NOT gate acquireClaim on selection, unlike the
// TLA+ model. Writing the guard from memory here got that wrong on the first
// attempt, which is exactly the drift hazard the missing ENABLED creates.
pred enAcquireClaim[t : Task]  { live and t.phase = NoObligation }
pred enPlanAttempt[t : Task]   { live and t.phase = Claimed }
pred enBeginWork[t : Task]     { live and Sys not in Paused and t.phase = Planned and #Holds < Sys.capacity }
pred enSafelySuspend[t : Task] { live and t.phase = SuspensionRequested }
pred enResumeWork[t : Task]    { live and Sys not in Paused and t.phase = Suspended and #Holds < Sys.capacity }
pred enReportAccepted[t : Task]   { live and t.phase = Executing }
pred enStartIntegration[t : Task] { live and t.phase = Accepted and no Sys.target }
pred enPromote[t : Task]          { live and t.phase = Integrating and t.expectedHead = Sys.head }
pred enAbandon[t : Task]          { live and t.phase = Integrating and t.expectedHead != Sys.head }
pred enSettle[t : Task]           { live and t.phase = Promoted }
pred enRecover                    { Sys in Crashed }

// I19's "no currently executable action", spelled out because there is no
// ENABLED to negate.
pred quiescent {
  no t : Task |
    enAcquireClaim[t] or enPlanAttempt[t] or enBeginWork[t] or enSafelySuspend[t]
    or enResumeWork[t] or enReportAccepted[t] or enStartIntegration[t]
    or enPromote[t] or enAbandon[t] or enSettle[t]
  not enRecover
}

/* ------------------------------------------------------------------ fairness
 *
 * Strong rather than weak, for the reason ../tlaplus/DeliveryLiveness.tla
 * gives: weak fairness starves startIntegration under an exclusive target.
 *
 * Per action rather than on the disjunction removes the suspend/resume lasso,
 * and that is faithful rather than convenient: docs/CONTEXT.md defines safe
 * suspension as preserving what is needed to resume, so the cycle progresses
 * and the lasso is an artifact of work being atomic here. I18 carries no
 * operator hypothesis -- see `interruptionForeverBreaksI18` at the bottom.
 *
 * requestSuspension is deliberately absent: being asked to suspend is an
 * operator decision, not an obligation.
 */
pred sfAll {
  all t : Task {
    (always eventually enAcquireClaim[t])    implies (always eventually acquireClaim[t])
    (always eventually enPlanAttempt[t])     implies (always eventually planAttempt[t])
    (always eventually enBeginWork[t])       implies (always eventually beginWork[t])
    (always eventually enSafelySuspend[t])   implies (always eventually safelySuspend[t])
    (always eventually enResumeWork[t])      implies (always eventually resumeWork[t])
    (always eventually enReportAccepted[t])  implies (always eventually reportAccepted[t])
    (always eventually enStartIntegration[t]) implies (always eventually startIntegration[t])
    (always eventually enPromote[t])         implies (always eventually promote[t])
    (always eventually enAbandon[t])         implies (always eventually abandonIntegration[t])
    (always eventually enSettle[t])          implies (always eventually settle[t])
  }
  (always eventually enRecover) implies (always eventually recover)
}

pred liveTrace { init and always step and sfAll }

/* ------------------------------------------------------- environment assumptions */

pred eventuallyStable  { eventually always (Sys not in Crashed) }
pred eventuallyRunning { eventually always (Sys not in Paused) }
pred eventuallyRoomy   { eventually always Sys.capacity > 0 }

/*
 * The operator eventually stops interrupting.
 *
 * NOT a hypothesis of I18. docs/CONTEXT.md defines executor-work suspension as
 * a proof that the work "is safely stopped, HAS PRESERVED WHAT IT NEEDS TO
 * RESUME the same attempt, and has no executor-owned activity still running",
 * so progress survives a suspend/resume cycle and an operator suspending
 * forever does not prevent completion.
 *
 * Used by `interruptionRestoresI18UnderDisjunction` at the bottom, which shows
 * what assuming it would buy.
 */
pred eventuallyUninterrupted {
  eventually always (no t : Task | t.phase = SuspensionRequested)
}

/* ------------------------------------------------------------------- I17-I19 */

/*
 * I17. A pause that stays applied drains every held position and keeps them
 * empty, since beginWork and resumeWork are disabled by their own guards.
 *
 * `eventually always`, NOT `always`. `init` says `no Paused` and `liveTrace`
 * conjoins `init`, so `always (Sys in Paused)` holds of no trace at all and
 * that form makes the check vacuously UNSAT. `pauseIsSustainable` below is
 * the witness that the hypothesis is satisfiable.
 */
check pauseDrainsPositions {
  (liveTrace and eventually always (Sys in Paused) and eventuallyStable)
    implies eventually always (no Holds)
} for 2 Task, 5 Int, 1..12 steps

// Must be SAT: a position is held, then a pause is applied and never lifted.
run pauseIsSustainable {
  liveTrace and eventuallyStable
  eventually always (Sys in Paused)
  eventually (some Holds)
} for 2 Task, 5 Int, 1..12 steps

// I18. Both disjuncts of "settles or is retained with a stated reason".
check everyBegunSettles {
  (liveTrace and eventuallyStable and eventuallyRunning and eventuallyRoomy)
    implies (all t : Task |
      always (t.phase = Executing implies eventually t.phase in Settled + Abandoned))
} for 2 Task, 5 Int, 1..12 steps

// I19. Strictly weaker than I18: a run parked at Planned under capacity 0 is
// quiescent and has completed nothing.
check reachesQuiescence {
  (liveTrace and eventuallyStable) implies eventually always quiescent
} for 2 Task, 5 Int, 1..12 steps

/*
 * The negative control, and the more interesting of the two commands here.
 *
 * Weaken fairness to the disjunction and I18 fails with a lasso in which the
 * ticket cycles Executing -> SuspensionRequested -> Suspended -> Executing
 * forever.
 *
 * The lasso is a MODELLING ARTIFACT, not a domain behaviour. Work is atomic
 * here, so a cycle that preserves progress is indistinguishable from one that
 * makes none -- and docs/CONTEXT.md says safe suspension preserves what is
 * needed to resume. Adding `eventuallyUninterrupted` removes the lasso by
 * assuming the operator away; per-action strong fairness removes it by
 * abstracting preservation plus finite work, which is the faithful choice.
 * `../tlaplus/run-liveness.sh --lasso` runs the three-way comparison.
 *
 * Alloy earns its place here by handing the lasso back as a structure you can
 * step through in the visualizer rather than as fourteen states of console
 * text.
 */
// The faithful port of `SF_vars(Progress(t))`: fairness on the disjunction of
// ALL ten lifecycle actions, not on a three-action subset. A subset would make
// the control below SAT for a trivial reason -- nothing forces
// `startIntegration` at all, so the ticket parks in `Accepted` and the
// suspend/resume lasso never has to appear.
pred progressDisjunctionEnabled[t : Task] {
  enAcquireClaim[t] or enPlanAttempt[t] or enBeginWork[t] or enSafelySuspend[t]
  or enResumeWork[t] or enReportAccepted[t] or enStartIntegration[t]
  or enPromote[t] or enAbandon[t] or enSettle[t]
}

pred progressDisjunctionTaken[t : Task] {
  acquireClaim[t] or planAttempt[t] or beginWork[t] or safelySuspend[t]
  or resumeWork[t] or reportAccepted[t] or startIntegration[t]
  or promote[t] or abandonIntegration[t] or settle[t]
}

pred sfDisjunction {
  all t : Task |
    (always eventually progressDisjunctionEnabled[t])
      implies (always eventually progressDisjunctionTaken[t])
  (always eventually enRecover) implies (always eventually recover)
}

check interruptionForeverBreaksI18 {
  (init and always step and sfDisjunction and eventuallyStable and eventuallyRunning
     and eventuallyRoomy)
    implies (all t : Task |
      always (t.phase = Executing implies eventually t.phase in Settled + Abandoned))
} for 2 Task, 5 Int, 1..12 steps

/*
 * Row 2 of the three-way comparison `../tlaplus/run-liveness.sh --lasso` runs.
 * Same weakened fairness, plus the assumption that the operator eventually
 * stops interrupting. Expected UNSAT: assuming the operator away removes the
 * lasso too.
 *
 * Both fixes work, and that is the point -- neither the tool nor the model
 * says which one is right. Per-action fairness (the primary checks above) is
 * the faithful one, because the domain guarantees preservation across
 * suspension; this one buys the same verdict with a hypothesis the domain does
 * not need.
 */
check interruptionRestoresI18UnderDisjunction {
  (init and always step and sfDisjunction and eventuallyStable and eventuallyRunning
     and eventuallyRoomy and eventuallyUninterrupted)
    implies (all t : Task |
      always (t.phase = Executing implies eventually t.phase in Settled + Abandoned))
} for 2 Task, 5 Int, 1..12 steps

/*
 * Vacuity. Every check above is an implication, so all of them hold trivially
 * if no fair trace exists at all. This must be SAT.
 */
run fairTraceExists {
  liveTrace and eventuallyStable and eventuallyRunning
  eventually (some t : Task | t.phase = Settled)
} for 2 Task, 5 Int, 1..12 steps
