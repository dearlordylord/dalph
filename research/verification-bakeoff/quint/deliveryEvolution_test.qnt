module deliveryEvolutionTest {
  import deliveryEvolutionCore(
    MUTANT = 0,
    TASKS = Set(0, 1),
    INITIAL_ARRIVAL_BUDGET = 2,
  ).* from "./deliveryEvolution"

  run blockerRemovalMakesBEligibleTest =
    init
      .then(observeArrival(0, Set()))
      .then(observeArrival(1, Set(0)))
      .then(acquireClaim(0))
      .then(beginWork(0))
      .then(doWork(0))
      .then(doWork(0))
      .then(settle(0))
      .then(observeBlockers(1, Set()))
      .then(acquireClaim(1))
      .expect(state.tickets.get(1).phase == Claimed)

  run blockerPreventsBClaimTest =
    init
      .then(observeArrival(0, Set()))
      .then(observeArrival(1, Set(0)))
      .expect(not(selected.contains(1)))

  run postSelectionBlockerPreservesObligationTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(observeArrival(1, Set()))
      .then(observeBlockers(0, Set(1)))
      .expect(and {
        state.tickets.get(0).phase == Claimed,
        deliveries.contains(0),
        postSelectionBlockerReached,
      })

  run blockerRemovalResumesSameObligationTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(observeArrival(1, Set()))
      .then(observeBlockers(0, Set(1)))
      .then(observeBlockers(0, Set()))
      .then(beginWork(0))
      .then(doWork(0))
      .then(doWork(0))
      .then(settle(0))
      .expect(state.tickets.get(0).phase == Settled)

  // Cycles are valid tracker states. They make both tasks ineligible; they do
  // not fail the run or erase an already established obligation.
  run blockerCycleIsValidAndIneligibleTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(observeArrival(1, Set()))
      .then(observeBlockers(0, Set(1)))
      .then(observeBlockers(1, Set(0)))
      .expect(and {
        blockersWellFormed,
        selected == Set(),
        deliveries.contains(0),
      })

  run boundedArrivalExhaustsBudgetTest =
    init
      .then(observeArrival(0, Set()))
      .then(observeArrival(1, Set()))
      .expect(arrivalBudgetExhaustedReached and arrivalBudgetIsBounded)
}

module deliveryEvolutionProgressTest {
  import deliveryEvolutionCore(
    MUTANT = 0,
    TASKS = Set(0, 1),
    INITIAL_ARRIVAL_BUDGET = 2,
  ).* from "./deliveryEvolution"

  run workCounterReachesEveryValueBeforeSettlementTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(beginWork(0))
      .expect(workZeroReached)

  run oneWorkStepCannotSettleTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(beginWork(0))
      .then(doWork(0))
      .expect(and { workOneReached, state.tickets.get(0).phase == Executing })

  run twoWorkStepsPermitSettlementTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(beginWork(0))
      .then(doWork(0))
      .then(doWork(0))
      .then(settle(0))
      .expect(and { workTwoReached, settlementRequiresCompleteWork })

  run suspensionPreservesProgressAndAttemptTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(beginWork(0))
      .then(doWork(0))
      .then(requestSuspension(0))
      .then(safelySuspend(0))
      .expect(suspendedWithPreservedWorkReached)

  run resumedAttemptContinuesFromOneTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(beginWork(0))
      .then(doWork(0))
      .then(requestSuspension(0))
      .then(safelySuspend(0))
      .then(resumeWork(0))
      .then(doWork(0))
      .then(settle(0))
      .expect(and {
        state.tickets.get(0).work == 2,
        state.tickets.get(0).attemptId == 1,
        state.tickets.get(0).phase == Settled,
      })
}

module deliveryEvolutionEarlyAcceptanceTest {
  import deliveryEvolutionCore(
    MUTANT = 3,
    TASKS = Set(0, 1),
    INITIAL_ARRIVAL_BUDGET = 2,
  ).* from "./deliveryEvolution"

  run earlyAcceptanceMutationMustFailTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(beginWork(0))
      .then(settle(0))
      .expect(settlementRequiresCompleteWork)
}

module deliveryEvolutionResetOnSuspendTest {
  import deliveryEvolutionCore(
    MUTANT = 4,
    TASKS = Set(0, 1),
    INITIAL_ARRIVAL_BUDGET = 2,
  ).* from "./deliveryEvolution"

  run resetOnSuspendMutationMustFailTest =
    init
      .then(observeArrival(0, Set()))
      .then(acquireClaim(0))
      .then(beginWork(0))
      .then(doWork(0))
      .then(requestSuspension(0))
      .then(safelySuspend(0))
      .expect(suspendedWithPreservedWorkReached)
}

module deliveryEvolutionIgnoreBlockersTest {
  import deliveryEvolutionCore(
    MUTANT = 1,
    TASKS = Set(0, 1),
    INITIAL_ARRIVAL_BUDGET = 2,
  ).* from "./deliveryEvolution"

  // Expected to fail: the seeded defect selects B while A still blocks it.
  run blockerMutationMustFailTest =
    init
      .then(observeArrival(0, Set()))
      .then(observeArrival(1, Set(0)))
      .expect(not(selected.contains(1)))
}
