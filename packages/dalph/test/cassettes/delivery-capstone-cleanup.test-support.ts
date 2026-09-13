import { expect } from "vitest"
import { type JournalRecord } from "@dalph/orchestrator"
import { type AuthoredScenarioCassetteRun } from "../../src/cassettes/authored-runner.js"
import {
  normalizeDeclaredIntegratorSession,
  resolveDeclaredAuthoredIdentity
} from "./delivery-capstone-authored-correlations.test-support.js"

type Event = JournalRecord["event"]
type TaggedRecord<Tag extends Event["_tag"]> = Omit<JournalRecord, "event"> & {
  readonly event: Extract<Event, { readonly _tag: Tag }>
}

const exactlyOne = <A>(values: ReadonlyArray<A>, detail: string): A => {
  expect(values, detail).toHaveLength(1)
  const value = values[0]
  if (value === undefined) return expect.fail(detail)
  return value
}

const recordsOf = <Tag extends Event["_tag"]>(run: AuthoredScenarioCassetteRun, tag: Tag) =>
  run.records.filter((record): record is TaggedRecord<Tag> => record.event._tag === tag)

const oneRecord = <Tag extends Event["_tag"]>(
  run: AuthoredScenarioCassetteRun,
  tag: Tag,
  predicate: (event: Extract<Event, { readonly _tag: Tag }>) => boolean = () => true
) =>
  exactlyOne(
    recordsOf(run, tag).filter(({ event }) => predicate(event)),
    `missing or duplicate exact ${tag}`
  )

/** DS17/21/22: recorded tracker proof, not a graph lifecycle or acknowledgement, authorizes exact claim deletion. */
export const assertDeliveryCapstoneFinalityCorrelations = (run: AuthoredScenarioCassetteRun): void => {
  for (const settlement of recordsOf(run, "IntegrationFinalitySettled")) {
    const { claim, deletionOperationId, replacementOperationId, successObservation } = settlement.event
    const acquired = oneRecord(
      run,
      "TaskClaimAcquired",
      (event) => event.claim.operationId === claim.originalClaim.operationId
    )
    expect(acquired.event.claim).toEqual(claim.originalClaim)
    const promotion = oneRecord(
      run,
      "TargetPromotionObservedSuccess",
      (event) => event.correlation.requestId === claim.promotionCorrelation.requestId
    )
    expect(promotion.event.correlation).toEqual(claim.promotionCorrelation)
    const replacementIntent = oneRecord(
      run,
      "CompletionClaimReplacementIntended",
      (event) => event.operationId === replacementOperationId
    )
    const replaced = oneRecord(run, "CompletionClaimReplaced", (event) => event.operationId === replacementOperationId)
    expect(replacementIntent.event.claim).toEqual(claim)
    expect(replaced.event.claim).toEqual(claim)
    expect(replacementIntent.position).toBeGreaterThan(promotion.position)
    expect(replaced.position).toBeGreaterThan(replacementIntent.position)
    const completion = oneRecord(
      run,
      "CompletionTaskAttemptIntended",
      (event) => event.request.claim.promotionCorrelation.requestId === claim.promotionCorrelation.requestId
    )
    const acknowledged = oneRecord(
      run,
      "CompletionTaskAcknowledged",
      (event) => event.request.operationId === completion.event.request.operationId
    )
    expect(completion.event.request.claim).toEqual(claim)
    expect(acknowledged.event.request).toEqual(completion.event.request)
    expect(acknowledged.event.acknowledgement).toEqual({
      operationId: completion.event.request.operationId,
      taskId: claim.plannedAttempt.taskId
    })
    expect(completion.position).toBeGreaterThan(replaced.position)
    expect(acknowledged.position).toBeGreaterThan(completion.position)

    const focused = exactlyOne(
      run.records.filter(({ position }) => position === successObservation.observedAt),
      `missing focused success for ${claim.plannedAttempt.taskId}`
    )
    if (
      focused.event._tag !== "TaskTrackerFactsObserved" ||
      focused.event.observation._tag !== "FocusedTaskCompletionFacts"
    )
      return expect.fail("success is not focused tracker evidence")
    const observation = focused.event.observation
    expect(focused.event.operationId).toBe(successObservation.operationId)
    expect(observation.facts).toMatchObject({
      currentClaim: claim,
      lifecycle: "CompletedSuccessfully",
      operationId: successObservation.operationId,
      target: successObservation.target,
      taskId: claim.plannedAttempt.taskId,
      taskRevision: claim.plannedAttempt.taskRevision,
      trackerRevision: successObservation.trackerRevision
    })
    expect(observation.request.claim).toEqual(claim)
    expect(successObservation.claim).toEqual(claim)
    expect(successObservation.taskId).toBe(claim.plannedAttempt.taskId)
    expect(successObservation.taskRevision).toBe(claim.plannedAttempt.taskRevision)
    expect(focused.position).toBeGreaterThan(replaced.position)
    expect(focused.position).toBeGreaterThan(acknowledged.position)
    const released = oneRecord(
      run,
      "TaskClaimReleased",
      (event) => event.release.claim.operationId === claim.originalClaim.operationId
    )
    const releaseIntent = oneRecord(
      run,
      "TaskClaimReleaseIntended",
      (event) => event.operation.release.operationId === released.event.release.operationId
    )
    expect(released.event.release.claim).toEqual(claim.originalClaim)
    expect(releaseIntent.event.operation.release).toEqual(released.event.release)
    expect(releaseIntent.position).toBeGreaterThan(focused.position)
    expect(released.position).toBeGreaterThan(releaseIntent.position)

    const intended = oneRecord(
      run,
      "CompletionClaimDeletionIntended",
      (event) => event.operationId === deletionOperationId
    )
    const attempted = oneRecord(
      run,
      "CompletionClaimDeletionAttemptIntended",
      (event) => event.operationId === deletionOperationId
    )
    const deleted = oneRecord(run, "CompletionClaimDeleted", (event) => event.operationId === deletionOperationId)
    for (const record of [intended, attempted, deleted]) {
      expect(record.event.claim).toEqual(claim)
      expect(record.event.successObservation).toEqual(successObservation)
    }
    const cleanup = recordsOf(run, "CompletionClaimDeletionReadObserved").filter(
      ({ event }) => event.request.operationId === deletionOperationId
    )
    const marker = exactlyOne(
      cleanup.filter(
        ({ event, position }) =>
          event.purpose._tag === "BeforeDeletionAttempt" &&
          event.purpose.attemptOrdinal === attempted.event.attemptOrdinal &&
          position < attempted.position
      ),
      "exact completion marker read before deletion attempt"
    )
    const activeAbsence = exactlyOne(
      cleanup.filter(
        ({ event, position }) =>
          event.purpose._tag === "ConfirmOriginalClaimReleased" &&
          event.purpose.attemptOrdinal === attempted.event.attemptOrdinal &&
          position < attempted.position
      ),
      "fresh original claim absence before deletion attempt"
    )
    expect(marker.event.observation).toEqual(claim)
    expect(activeAbsence.event.observation).toEqual({ _tag: "UnclaimedTask", taskId: claim.plannedAttempt.taskId })
    expect(marker.position).toBeGreaterThan(released.position)
    expect(activeAbsence.position).toBeGreaterThan(marker.position)
    expect(attempted.position).toBeGreaterThan(activeAbsence.position)
    for (const record of cleanup) {
      expect(record.event.replacementOperationId).toBe(replacementOperationId)
      expect(record.event.request.claim).toEqual(claim)
      expect(record.event.request.successObservation).toEqual(successObservation)
      expect(record.position).toBeGreaterThan(focused.position)
      expect(record.position).toBeLessThan(deleted.position)
    }
    expect(intended.position).toBeGreaterThan(focused.position)
    expect(attempted.position).toBeGreaterThan(intended.position)
    expect(deleted.position).toBeGreaterThan(attempted.position)
    expect(deleted.position).toBeGreaterThan(released.position)
    expect(settlement.position).toBeGreaterThan(deleted.position)
  }
}

/** Alice's FullRerun permits only predecessor disposal; absence below is recorded provider evidence, not a filesystem claim. */
export const assertDeliveryCapstonePredecessorCleanup = (run: AuthoredScenarioCassetteRun): void => {
  const fixed = oneRecord(run, "IntegratorSuccessorSessionFixed")
  const { directionAppliedAt, predecessor, quarantineAt, successor } = fixed.event
  const authorized = oneRecord(run, "IntegratorCandidateCleanupAuthorized")
  const authorization = authorized.event.authorization
  expect(authorization).toMatchObject({
    disposition: { _tag: "Superseded", directionAppliedAt, dispositionAt: quarantineAt, predecessor, successor },
    locator: predecessor.candidateResource,
    owner: { sessionId: predecessor.sessionId },
    writerQuiescent: true
  })
  expect(authorized.position).toBeGreaterThan(fixed.position)
  const direction = exactlyOne(
    run.records.filter(({ position }) => position === directionAppliedAt),
    "missing FullRerun choice"
  )
  expect(direction.event).toMatchObject({
    _tag: "IntegrationQuarantineDirectionApplied",
    fingerprint: { direction: "FullRerun", sessionId: predecessor.sessionId }
  })

  const intended = oneRecord(run, "IntegratorCandidateCleanupMutationIntended")
  const lost = oneRecord(run, "IntegratorCandidateCleanupMutationResultRecorded")
  const absent = oneRecord(run, "IntegratorCandidateCleanupAbsenceConfirmed")
  const settled = oneRecord(run, "IntegratorCandidateCleanupSettled")
  const present = oneRecord(run, "IntegratorCandidateCleanupObserved", (event) => event.observation._tag === "Present")
  expect(present.event.authorization).toEqual(authorization)
  expect(present.event.observation).toEqual({
    _tag: "Present",
    locator: authorization.locator,
    revision: authorization.evidenceRevision,
    sessionId: predecessor.sessionId,
    writerQuiescent: true
  })
  expect(present.position).toBeGreaterThan(authorized.position)
  expect(intended.position).toBeGreaterThan(present.position)
  for (const record of [intended, lost, absent, settled]) expect(record.event.authorization).toEqual(authorization)
  expect(lost.event.operationId).toBe(intended.event.operationId)
  expect(lost.event.attempt).toBe(intended.event.attempt)
  expect(lost.event.result).toMatchObject({
    _tag: "Unknown",
    locator: authorization.locator,
    sessionId: predecessor.sessionId
  })
  expect(absent.event.cause).toBe("MutationResponseReconciliation")
  expect(absent.event.observation.locator).toBe(authorization.locator)
  expect(absent.event.observation.revision).toBeGreaterThan(authorization.evidenceRevision)
  const fresh = oneRecord(
    run,
    "IntegratorCandidateCleanupObserved",
    (event) => event.operationId === absent.event.operationId
  )
  const freshIntent = oneRecord(
    run,
    "IntegratorCandidateCleanupObservationIntended",
    (event) => event.operationId === absent.event.operationId
  )
  expect(fresh.event.authorization).toEqual(authorization)
  expect(fresh.event.observation).toEqual(absent.event.observation)
  expect(freshIntent.event.authorization).toEqual(authorization)
  expect(fresh.event.ordinal).toBe(absent.event.ordinal)
  expect(freshIntent.event.ordinal).toBe(absent.event.ordinal)
  expect(settled.event.result).toEqual({
    _tag: "AlreadyAbsent",
    locator: authorization.locator,
    revision: absent.event.observation.revision,
    sessionId: predecessor.sessionId
  })
  expect(intended.position).toBeGreaterThan(authorized.position)
  expect(lost.position).toBeGreaterThan(intended.position)
  expect(freshIntent.position).toBeGreaterThan(lost.position)
  expect(fresh.position).toBeGreaterThan(freshIntent.position)
  expect(absent.position).toBeGreaterThan(fresh.position)
  expect(settled.position).toBeGreaterThan(absent.position)

  const occurrences = run.observationCaptures.flatMap((capture) =>
    capture._tag === "AuthoredStoryOccurrenceCaptured" ? [capture.occurrence] : []
  )
  const removed = exactlyOne(
    occurrences.filter((item) => item._tag === "IntegratorCandidateCleanupRemovalReturned"),
    "one predecessor remove boundary"
  )
  expect({
    ...removed.result,
    locator: resolveDeclaredAuthoredIdentity(removed.result.locator, run.runId),
    sessionId: resolveDeclaredAuthoredIdentity(removed.result.sessionId, run.runId)
  }).toEqual(lost.event.result)
  for (const item of occurrences) {
    if (item._tag === "IntegratorCandidateCleanupEvidenceRevisionReturned") {
      const predecessorWithActualIdentity = normalizeDeclaredIntegratorSession(item.subject.predecessor, run.runId)
      expect({
        ...item.subject,
        locator: predecessorWithActualIdentity.candidateResource,
        predecessor: predecessorWithActualIdentity
      }).toEqual({ locator: predecessor.candidateResource, predecessor })
      expect(item.revision).toBe(authorization.evidenceRevision)
    }
  }
  // The final journal still contains predecessor qualification and rejected promotion evidence.
  const predecessorQualification = oneRecord(
    run,
    "IntegratorRunCandidateGitObserved",
    (event) => event.run.session.sessionId === predecessor.sessionId
  )
  const rejected = oneRecord(
    run,
    "TargetPromotionStale",
    (event) => event.correlation.qualifiedCandidate.run.session.sessionId === predecessor.sessionId
  )
  expect(predecessorQualification.position).toBeLessThan(fixed.position)
  expect(rejected.position).toBeLessThan(fixed.position)
  expect(authorization.locator).not.toBe(successor.candidateResource)
  expect(authorization.owner.sessionId).not.toBe(successor.sessionId)
  for (const record of run.records) {
    if ("authorization" in record.event && record.event._tag.startsWith("IntegratorCandidateCleanup"))
      expect(record.event.authorization).toEqual(authorization)
  }
  const terminal = oneRecord(run, "WorkflowRunTerminated")
  expect(terminal.position).toBeGreaterThan(settled.position)
}
