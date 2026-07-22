module taskWorkSessionRecoveryTest {
  import taskWorkSessionRecovery.* from "./taskWorkSessionRecovery"

  run matchingAfterUncertainRequestTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(requestCreatesSession)
      .then(crash)
      .then(restart)
      .then(lookupMatching)
      .then(recordLookup)
      .then(recordOutcome)
      .expect(outcomeReached)
  }

  run afterIntentCrashLooksUpBeforeAnyRequestTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(crash)
      .then(restart)
      .then(lookupAbsent)
      .expect(state.requestCount == 0)
  }

  run afterReportCrashRecordsTheKnownOutcomeTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(requestCreatesSession)
      .then(lookupMatching)
      .then(recordLookup)
      .then(crash)
      .then(restart)
      .then(lookupMatching)
      .then(recordLookup)
      .then(recordOutcome)
      .expect(outcomeReached)
  }

  run priorMatchingThenAbsenceIsConflictTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(requestCreatesSession)
      .then(lookupMatching)
      .then(recordLookup)
      .then(crash)
      .then(restart)
      .then(lookupContradictoryAbsence)
      .then(recordLookup)
      .expect(conflictReached)
  }

  run afterOutcomeCrashKeepsTheTerminalOutcomeTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(requestCreatesSession)
      .then(lookupMatching)
      .then(recordLookup)
      .then(recordOutcome)
      .then(crash)
      .then(restart)
      .expect(outcomeReached)
  }

  run absenceAuthorizedRepeatTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(requestCreatesNothing)
      .then(lookupAbsent)
      .then(recordLookup)
      .then(requestCreatesSession)
      .expect(state.requestCount == 2)
  }

  run recordedAbsenceLosesAuthorizationOnCrashTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(requestCreatesNothing)
      .then(lookupAbsent)
      .then(recordLookup)
      .then(crash)
      .then(restart)
      .expect(state.authorization == NoAuthorization)
  }

  run unreadableBoundTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(requestCreatesNothing)
      .then(lookupUnreadable)
      .then(recordLookup)
      .then(lookupUnreadable)
      .then(recordLookup)
      .then(lookupUnreadable)
      .then(recordLookup)
      .expect(unreadableBoundReached)
  }

  run absenceBoundTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(requestCreatesNothing)
      .then(lookupAbsent)
      .then(recordLookup)
      .then(requestCreatesNothing)
      .then(lookupAbsent)
      .then(recordLookup)
      .then(requestCreatesNothing)
      .then(lookupAbsent)
      .then(recordLookup)
      .expect(absenceBoundReached)
  }

  run conflictStopsTest = {
    init
      .then(selectIdentity)
      .then(commitIntent)
      .then(requestCreatesNothing)
      .then(lookupConflict)
      .then(recordLookup)
      .expect(conflictReached)
  }

  run beforeIntentCrashAllocatesNewCandidateTest = {
    init
      .then(selectIdentity)
      .then(crash)
      .then(restart)
      .then(selectIdentity)
      .expect(state.operationId == 2)
  }
}
