import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import type { JournalRecord, WorkflowJournalEvent } from "@dalph/orchestrator"
import {
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette,
  type AuthoredCassetteStoryItem,
  type AuthoredObservationCapture
} from "../../src/cassettes/index.js"

type JournalRecordFor<Tag extends WorkflowJournalEvent["_tag"]> = JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: Tag }>
}

type CapturedStoryOccurrence = Extract<AuthoredObservationCapture, { readonly _tag: "AuthoredStoryOccurrenceCaptured" }>

type CapturedOccurrenceFor<Tag extends AuthoredCassetteStoryItem["_tag"]> = CapturedStoryOccurrence & {
  readonly occurrence: Extract<AuthoredCassetteStoryItem, { readonly _tag: Tag }>
}

const recordsFor = <Tag extends WorkflowJournalEvent["_tag"]>(
  records: ReadonlyArray<JournalRecord>,
  tag: Tag
): ReadonlyArray<JournalRecordFor<Tag>> =>
  records.filter((record): record is JournalRecordFor<Tag> => record.event._tag === tag)

const capturedOccurrencesFor = <Tag extends AuthoredCassetteStoryItem["_tag"]>(
  captures: ReadonlyArray<AuthoredObservationCapture>,
  tag: Tag
): ReadonlyArray<CapturedOccurrenceFor<Tag>> =>
  captures.filter(
    (capture): capture is CapturedOccurrenceFor<Tag> =>
      capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.occurrence._tag === tag
  )

const exactlyOne = <A>(values: ReadonlyArray<A>, description: string): A => {
  return Option.match(Option.fromUndefinedOr(values.length === 1 ? values[0] : undefined), {
    onNone: () => expect.fail(`expected exactly one ${description}, received ${values.length}`),
    onSome: (value) => value
  })
}

const isTaskAClaimFinalityEvent = (event: WorkflowJournalEvent): boolean => {
  if (event._tag === "TaskClaimReleaseIntended") return event.operation.release.claim.taskId === "A"
  if (event._tag === "TaskClaimReleased") return event.release.claim.taskId === "A"
  if (
    event._tag === "CompletionClaimReplacementIntended" ||
    event._tag === "CompletionClaimReplacementAttemptIntended" ||
    event._tag === "CompletionClaimReplaced" ||
    event._tag === "CompletionClaimDeletionIntended" ||
    event._tag === "CompletionClaimDeletionAttemptIntended" ||
    event._tag === "CompletionClaimDeleted" ||
    event._tag === "IntegrationFinalitySettled"
  ) {
    return event.claim.plannedAttempt.taskId === "A"
  }
  return false
}

/** DS16 proof requires the durable numbered attempt and the captured rejected CAS boundary. */
interface Ds16PromotionEvidence {
  readonly attempt: JournalRecordFor<"TargetPromotionAttemptIntended">
  readonly stale: JournalRecordFor<"TargetPromotionStale">
  readonly rejectedCompareAndSet: CapturedOccurrenceFor<"TargetPromotionCompareAndSetReturned">
}

/** Extracts DS16 from durable positions plus the actual captured Git boundary occurrence. */
const extractDs16PromotionEvidence = (
  records: ReadonlyArray<JournalRecord>,
  captures: ReadonlyArray<AuthoredObservationCapture>
): Ds16PromotionEvidence | undefined => {
  const stale = recordsFor(records, "TargetPromotionStale").find(
    (record) => record.event.basis._tag === "AfterAttempt" && record.event.observation._tag === "CompareAndSetRejected"
  )
  if (stale === undefined) return undefined
  const staleBasis = stale.event.basis
  const staleObservation = stale.event.observation
  if (staleBasis._tag !== "AfterAttempt" || staleObservation._tag !== "CompareAndSetRejected") return undefined

  const attempt = recordsFor(records, "TargetPromotionAttemptIntended").find(
    (record) =>
      record.position < stale.position &&
      record.event.attemptOrdinal === staleBasis.attemptOrdinal &&
      record.event.correlation.requestId === stale.event.correlation.requestId
  )
  if (attempt === undefined || attempt.event.reason._tag !== "Initial") return undefined

  const rejectedCompareAndSets = capturedOccurrencesFor(captures, "TargetPromotionCompareAndSetReturned").filter(
    (capture) =>
      capture.occurrence.result._tag === "RejectedExpectedHead" &&
      capture.occurrence.result.observedHeadSha === staleObservation.observedHeadSha
  )
  if (rejectedCompareAndSets.length !== 1) return undefined
  const [rejectedCompareAndSet] = rejectedCompareAndSets
  if (rejectedCompareAndSet === undefined) return undefined

  return { attempt, stale, rejectedCompareAndSet }
}

const capstoneTimeout = 600_000
const cachedRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStoryCapstone).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)

it.effect(
  "executes DS01 through DS13 in one maintained chronology",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      expect(run.cassette.story.at(-1)?._tag).toBe("ExpectedBehavior")

      const storyTags = run.cassette.story.map(({ _tag }) => _tag)
      expect(storyTags).toContain("InitialControlPolicy")
      expect(storyTags).toContain("SetTaskExecutionCapacity")
      expect(storyTags.filter((tag) => tag === "CoordinatorProcessDies").length).toBeGreaterThanOrEqual(2)
      expect(storyTags).toContain("OperatorContinuesAttempt")
      expect(storyTags).toContain("OperatorAppliesIntegrationQuarantineDirection")
      expect(storyTags).toContain("CompletionClaimDeletionApplied")
    }),
  capstoneTimeout
)

it.effect(
  "executes DS-14 through DS-17 from rejected exact-head offer through Operator-authorized successor finality",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      const records = run.records
      const captures = run.observationCaptures
      const acceptedCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      const initialHead = "1111111111111111111111111111111111111111"
      const changedHead = "2222222222222222222222222222222222222222"
      const initialCandidateCommit = "cccccccccccccccccccccccccccccccccccccccc"
      const successorCandidateCommit = "dddddddddddddddddddddddddddddddddddddddd"

      // DS14: the accepted result enters the journal queue exactly once, then crosses the start cutoff once.
      const responsibilityBegan = exactlyOne(
        recordsFor(records, "IntegrationResponsibilityBegan").filter(
          ({ event }) => event.plannedAttempt.taskId === "A"
        ),
        "A integration responsibility beginning"
      )
      const integrationStarted = exactlyOne(
        recordsFor(records, "IntegrationStarted").filter(({ event }) => event.plannedAttempt.taskId === "A"),
        "A integration start"
      )
      expect(integrationStarted.event.responsibilityBeganAt).toBe(responsibilityBegan.position)

      const predecessorSession = exactlyOne(
        recordsFor(records, "IntegratorSessionFixed").filter(
          ({ event }) => event.correlation.plannedAttempt.taskId === "A"
        ),
        "A predecessor Integrator session"
      )
      const predecessor = predecessorSession.event.correlation
      expect(predecessor.queuedAt).toBe(responsibilityBegan.position)
      expect(predecessor.startedAt).toBe(integrationStarted.position)
      expect(predecessor.acceptedResult.commit).toBe(acceptedCommit)
      expect(predecessor.expectedTargetHead).toBe(initialHead)
      expect(responsibilityBegan.event.acceptedResult).toEqual(predecessor.acceptedResult)
      expect(responsibilityBegan.event.integrationTarget).toEqual(predecessor.integrationTarget)
      expect(responsibilityBegan.event.plannedAttempt).toEqual(predecessor.plannedAttempt)
      expect(integrationStarted.event.acceptedResult).toEqual(predecessor.acceptedResult)
      expect(integrationStarted.event.integrationTarget).toEqual(predecessor.integrationTarget)
      expect(integrationStarted.event.plannedAttempt).toEqual(predecessor.plannedAttempt)

      const initialLineage = exactlyOne(
        recordsFor(records, "TargetLineageObserved").filter(
          ({ event, position }) =>
            position === predecessor.targetLineageObservedAt &&
            event.plannedAttempt.attemptId === predecessor.plannedAttempt.attemptId
        ),
        "initial target-lineage observation"
      )
      expect(initialLineage.event.observation.targetHeadSha).toBe(initialHead)
      expect(initialLineage.event.observation.plannedBaseSha).toBe(initialHead)

      const predecessorRun = exactlyOne(
        recordsFor(records, "IntegratorRunStarted").filter(
          ({ event }) => event.run.session.sessionId === predecessor.sessionId
        ),
        "predecessor Integrator run"
      )
      expect(predecessorRun.event.run.ordinal).toBe(1)
      const predecessorResult = exactlyOne(
        recordsFor(records, "IntegratorRunResultRecorded").filter(
          ({ event }) => event.run.session.sessionId === predecessor.sessionId
        ),
        "predecessor Integrator result"
      )
      expect(predecessorResult.event.result._tag).toBe("PreparedCandidate")
      if (predecessorResult.event.result._tag !== "PreparedCandidate") return

      const predecessorCandidateGit = exactlyOne(
        recordsFor(records, "IntegratorRunCandidateGitObserved").filter(
          ({ event }) => event.run.session.sessionId === predecessor.sessionId
        ),
        "predecessor candidate Git observation"
      )
      expect(predecessorCandidateGit.event.candidateText).toBe(predecessorResult.event.result.candidateText)
      expect(predecessorCandidateGit.event.observation._tag).toBe("Commit")
      if (predecessorCandidateGit.event.observation._tag !== "Commit") return
      expect(predecessorCandidateGit.event.observation.commit).toBe(initialCandidateCommit)
      expect(predecessorCandidateGit.event.observation.directParents).toEqual([initialHead, acceptedCommit])
      expect(predecessorCandidateGit.position).toBeGreaterThan(predecessor.targetLineageObservedAt)

      const predecessorRequest = exactlyOne(
        capturedOccurrencesFor(captures, "IntegratorRequestReceived").filter(
          ({ occurrence }) =>
            occurrence.correlation.expectedTargetHead === initialHead &&
            occurrence.correlation.acceptedResult.commit === acceptedCommit &&
            occurrence.correlation.plannedAttempt.attemptId === predecessor.plannedAttempt.attemptId
        ),
        "captured predecessor Integrator request"
      )
      expect(predecessorRequest.occurrence.correlation.queuedAt).toBe(predecessor.queuedAt)
      expect(predecessorRequest.occurrence.correlation.startedAt).toBe(predecessor.startedAt)
      const predecessorCandidateCapture = exactlyOne(
        capturedOccurrencesFor(captures, "IntegratorGitObservationReturned").filter(
          ({ occurrence }) =>
            occurrence.observation._tag === "Commit" &&
            occurrence.observation.commit === initialCandidateCommit &&
            occurrence.observation.directParents[0] === initialHead &&
            occurrence.observation.directParents[1] === acceptedCommit
        ),
        "captured predecessor candidate Git observation"
      )
      expect(predecessorCandidateCapture.captureOrder).toBeGreaterThan(predecessorRequest.captureOrder)

      // DS15/16: promotion intent and the actual Git boundary are separate evidence; both are required.
      const predecessorPromotionIntent = exactlyOne(
        recordsFor(records, "TargetPromotionIntended").filter(
          ({ event }) => event.correlation.qualifiedCandidate.run.session.sessionId === predecessor.sessionId
        ),
        "predecessor promotion intent"
      )
      const predecessorPromotionAttempt = exactlyOne(
        recordsFor(records, "TargetPromotionAttemptIntended").filter(
          ({ event }) => event.correlation.requestId === predecessorPromotionIntent.event.correlation.requestId
        ),
        "predecessor promotion attempt intent"
      )
      expect(predecessorPromotionIntent.event.correlation.qualifiedCandidate.directParents).toEqual([
        initialHead,
        acceptedCommit
      ])
      expect(predecessorPromotionAttempt.event.attemptOrdinal).toBe(1)
      expect(predecessorPromotionAttempt.event.reason).toEqual({ _tag: "Initial", observedHeadSha: initialHead })
      expect(predecessorPromotionIntent.position).toBeLessThan(predecessorPromotionAttempt.position)

      const ds16 = extractDs16PromotionEvidence(records, captures)
      expect(ds16).toBeDefined()
      if (ds16 === undefined) return
      expect(ds16.attempt.position).toBe(predecessorPromotionAttempt.position)
      expect(ds16.stale.event.correlation.requestId).toBe(predecessorPromotionIntent.event.correlation.requestId)
      expect(ds16.stale.event.basis).toEqual({ _tag: "AfterAttempt", attemptOrdinal: 1 })
      expect(ds16.stale.event.observation).toEqual({ _tag: "CompareAndSetRejected", observedHeadSha: changedHead })
      expect(ds16.attempt.position).toBeLessThan(ds16.stale.position)
      expect(ds16.rejectedCompareAndSet.occurrence.result).toEqual({
        _tag: "RejectedExpectedHead",
        observedHeadSha: changedHead
      })
      expect(ds16.rejectedCompareAndSet.captureOrder).toBeGreaterThan(predecessorCandidateCapture.captureOrder)

      const promotionStale = ds16.stale
      const promotionStaleQuarantines = recordsFor(records, "IntegrationQuarantined").filter(
        ({ event }) => event.basis._tag === "PromotionStale"
      )
      expect(promotionStaleQuarantines).toHaveLength(1)
      const quarantine = exactlyOne(
        promotionStaleQuarantines.filter(({ event }) => event.correlation.sessionId === predecessor.sessionId),
        "predecessor promotion-stale quarantine"
      )
      expect(quarantine.event.correlation).toEqual(predecessor)
      expect(quarantine.event.basis).toEqual({
        _tag: "PromotionStale",
        candidateCommit: initialCandidateCommit,
        observedTargetHead: changedHead,
        targetPromotionStaleAt: promotionStale.position
      })
      expect(promotionStale.position).toBeLessThan(quarantine.position)

      const direction = exactlyOne(
        recordsFor(records, "IntegrationQuarantineDirectionApplied").filter(
          ({ event }) =>
            event.fingerprint.sessionId === predecessor.sessionId &&
            event.fingerprint.quarantineAt === quarantine.position
        ),
        "predecessor FullRerun direction"
      )
      expect(recordsFor(records, "IntegrationQuarantineDirectionApplied")).toHaveLength(1)
      expect(direction.event.fingerprint.direction).toBe("FullRerun")
      expect(quarantine.position).toBeLessThan(direction.position)
      expect(
        recordsFor(records, "IntegratorSuccessorSessionFixed").some(({ position }) => position < direction.position)
      ).toBe(false)
      expect(
        records.some(({ event, position }) => position < quarantine.position && isTaskAClaimFinalityEvent(event))
      ).toBe(false)

      // DS17: one exact direction precedes one fresh lineage read and one distinct successor.
      const directionCapture = exactlyOne(
        capturedOccurrencesFor(captures, "OperatorAppliesIntegrationQuarantineDirection").filter(
          ({ occurrence }) => occurrence.request.fingerprint.quarantineAt === quarantine.position
        ),
        "captured FullRerun direction"
      )
      expect(ds16.rejectedCompareAndSet.captureOrder).toBeLessThan(directionCapture.captureOrder)
      const successor = exactlyOne(
        recordsFor(records, "IntegratorSuccessorSessionFixed").filter(
          ({ event }) => event.predecessor.sessionId === predecessor.sessionId
        ),
        "FullRerun successor session"
      )
      expect(recordsFor(records, "IntegratorSuccessorSessionFixed")).toHaveLength(1)
      const successorCorrelation = successor.event.successor
      expect(successor.event.direction).toBe("FullRerun")
      expect(successor.event.quarantineAt).toBe(quarantine.position)
      expect(successor.event.directionAppliedAt).toBe(direction.position)
      expect(successor.event.predecessor).toEqual(predecessor)
      expect(successorCorrelation.sessionId).not.toBe(predecessor.sessionId)
      expect(successorCorrelation.candidateResource).not.toBe(predecessor.candidateResource)
      expect(successorCorrelation.acceptedResult).toEqual(predecessor.acceptedResult)
      expect(successorCorrelation.plannedAttempt).toEqual(predecessor.plannedAttempt)
      expect(successorCorrelation.integrationTarget).toEqual(predecessor.integrationTarget)
      expect(successorCorrelation.queuedAt).toBe(predecessor.queuedAt)
      expect(successorCorrelation.startedAt).toBe(predecessor.startedAt)
      expect(successorCorrelation.expectedTargetHead).toBe(changedHead)

      const successorRequest = exactlyOne(
        capturedOccurrencesFor(captures, "IntegratorRequestReceived").filter(
          ({ captureOrder, occurrence }) =>
            captureOrder > directionCapture.captureOrder &&
            occurrence.correlation.expectedTargetHead === changedHead &&
            occurrence.correlation.acceptedResult.commit === acceptedCommit
        ),
        "captured successor Integrator request"
      )
      expect(successorRequest.occurrence.correlation.plannedAttempt.attemptId).toBe(
        successorCorrelation.plannedAttempt.attemptId
      )
      expect(successorRequest.occurrence.correlation.queuedAt).toBe(predecessor.queuedAt)
      expect(successorRequest.occurrence.correlation.startedAt).toBe(predecessor.startedAt)
      expect(successorRequest.captureOrder).toBeGreaterThan(directionCapture.captureOrder)

      const freshLineageSelection = exactlyOne(
        capturedOccurrencesFor(captures, "DalphSelects").filter(
          ({ captureOrder, occurrence }) =>
            captureOrder > directionCapture.captureOrder &&
            captureOrder < successorRequest.captureOrder &&
            occurrence.operation._tag === "ReadTargetLineage" &&
            occurrence.operation.attemptId === "attempt:A:0"
        ),
        "captured post-direction A target-lineage read"
      )
      const freshLineage = exactlyOne(
        recordsFor(records, "TargetLineageObserved").filter(
          ({ position }) => position === successorCorrelation.targetLineageObservedAt
        ),
        "post-direction target-lineage observation"
      )
      const freshLineageIntent = exactlyOne(
        recordsFor(records, "GitReadIntentRecorded").filter(
          ({ event, position }) =>
            position < freshLineage.position &&
            position > direction.position &&
            event.operation._tag === "ReadTargetLineage" &&
            event.operation.plannedAttempt.attemptId === "attempt:A:0"
        ),
        "post-direction target-lineage read intent"
      )
      expect(freshLineage.event.plannedAttempt.attemptId).toBe("attempt:A:0")
      expect(freshLineage.event.observation).toEqual({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: initialHead,
        targetHeadSha: changedHead
      })
      expect(freshLineageIntent.event.operation.operationId).toBe(freshLineage.event.operationId)
      expect(freshLineageIntent.position).toBeLessThan(freshLineage.position)
      expect(freshLineage.position).toBe(successorCorrelation.targetLineageObservedAt)
      expect(freshLineageSelection.captureOrder).toBeLessThan(successorRequest.captureOrder)
      expect(direction.position).toBeLessThan(freshLineageIntent.position)
      expect(freshLineage.position).toBeLessThan(successor.position)

      const successorRun = exactlyOne(
        recordsFor(records, "IntegratorRunStarted").filter(
          ({ event }) => event.run.session.sessionId === successorCorrelation.sessionId
        ),
        "successor Integrator run"
      )
      expect(successorRun.event.run.ordinal).toBe(1)
      const successorResult = exactlyOne(
        recordsFor(records, "IntegratorRunResultRecorded").filter(
          ({ event }) => event.run.session.sessionId === successorCorrelation.sessionId
        ),
        "successor Integrator result"
      )
      expect(successorResult.event.result._tag).toBe("PreparedCandidate")
      if (successorResult.event.result._tag !== "PreparedCandidate") return
      const successorCandidateGit = exactlyOne(
        recordsFor(records, "IntegratorRunCandidateGitObserved").filter(
          ({ event }) => event.run.session.sessionId === successorCorrelation.sessionId
        ),
        "successor candidate Git observation"
      )
      expect(successorCandidateGit.event.candidateText).toBe(successorResult.event.result.candidateText)
      expect(successorCandidateGit.event.observation).toMatchObject({
        _tag: "Commit",
        candidateText: successorResult.event.result.candidateText,
        commit: successorCandidateCommit,
        directParents: [changedHead, acceptedCommit]
      })
      if (successorCandidateGit.event.observation._tag !== "Commit") return
      expect(successorCandidateGit.event.observation.directParents).toEqual([changedHead, acceptedCommit])
      expect(successorCandidateGit.position).toBeGreaterThan(successorCorrelation.targetLineageObservedAt)

      const successorCandidateCapture = exactlyOne(
        capturedOccurrencesFor(captures, "IntegratorGitObservationReturned").filter(
          ({ occurrence }) =>
            occurrence.observation._tag === "Commit" &&
            occurrence.observation.commit === successorCandidateCommit &&
            occurrence.observation.directParents[0] === changedHead &&
            occurrence.observation.directParents[1] === acceptedCommit
        ),
        "captured successor candidate Git observation"
      )
      expect(successorCandidateCapture.captureOrder).toBeGreaterThan(successorRequest.captureOrder)
      expect(successorCandidateCapture.captureOrder).toBeGreaterThan(directionCapture.captureOrder)

      const successorPromotionIntent = exactlyOne(
        recordsFor(records, "TargetPromotionIntended").filter(
          ({ event }) => event.correlation.qualifiedCandidate.run.session.sessionId === successorCorrelation.sessionId
        ),
        "successor promotion intent"
      )
      const successorPromotionAttempt = exactlyOne(
        recordsFor(records, "TargetPromotionAttemptIntended").filter(
          ({ event }) => event.correlation.requestId === successorPromotionIntent.event.correlation.requestId
        ),
        "successor promotion attempt intent"
      )
      expect(successorPromotionIntent.event.correlation.qualifiedCandidate.directParents).toEqual([
        changedHead,
        acceptedCommit
      ])
      expect(successorPromotionAttempt.event.attemptOrdinal).toBe(1)
      expect(successorPromotionAttempt.event.reason).toEqual({ _tag: "Initial", observedHeadSha: changedHead })
      const successorPromotion = exactlyOne(
        recordsFor(records, "TargetPromotionObservedSuccess").filter(
          ({ event }) => event.correlation.requestId === successorPromotionIntent.event.correlation.requestId
        ),
        "successor promotion result"
      )
      expect(successorPromotion.event.basis).toEqual({ _tag: "AfterAttempt", attemptOrdinal: 1 })
      expect(successorPromotion.event.observation).toEqual({
        _tag: "CompareAndSetApplied",
        candidateAncestry: "Current",
        targetHeadSha: successorCandidateCommit
      })
      const appliedCompareAndSet = exactlyOne(
        capturedOccurrencesFor(captures, "TargetPromotionCompareAndSetReturned").filter(
          ({ occurrence }) => occurrence.result._tag === "Applied"
        ),
        "captured successor applied compare-and-set"
      )
      expect(appliedCompareAndSet.captureOrder).toBeGreaterThan(successorCandidateCapture.captureOrder)

      // Completion finality remains bound to A's original active claim and the focused success read.
      const originalClaim = exactlyOne(
        recordsFor(records, "TaskClaimAcquired").filter(({ event }) => event.claim.taskId === "A"),
        "A original active claim"
      ).event.claim
      const replacementIntent = exactlyOne(
        recordsFor(records, "CompletionClaimReplacementIntended").filter(
          ({ event }) => event.claim.plannedAttempt.taskId === "A"
        ),
        "A completion-claim replacement intent"
      )
      const replacementAttempt = exactlyOne(
        recordsFor(records, "CompletionClaimReplacementAttemptIntended").filter(
          ({ event }) => event.operationId === replacementIntent.event.operationId
        ),
        "A completion-claim replacement attempt"
      )
      const replacement = exactlyOne(
        recordsFor(records, "CompletionClaimReplaced").filter(
          ({ event }) => event.operationId === replacementIntent.event.operationId
        ),
        "A completion-claim replacement"
      )
      expect(replacementIntent.event.claim.originalClaim).toEqual(originalClaim)
      expect(replacementIntent.event.claim.promotionCorrelation).toEqual(successorPromotion.event.correlation)
      expect(replacementAttempt.event.claim).toEqual(replacementIntent.event.claim)
      expect(replacementAttempt.event.attemptOrdinal).toBe(1)
      expect(replacement.event.claim).toEqual(replacementIntent.event.claim)

      const focusedCompleted = exactlyOne(
        recordsFor(records, "TaskTrackerFactsObserved").filter(
          ({ event }) =>
            event.observation._tag === "FocusedTaskCompletionFacts" &&
            event.observation.facts.taskId === "A" &&
            event.observation.facts.lifecycle === "CompletedSuccessfully"
        ),
        "focused A CompletedSuccessfully observation"
      )
      const focusedObservation = focusedCompleted.event.observation
      if (focusedObservation._tag !== "FocusedTaskCompletionFacts") return
      const deletionIntent = exactlyOne(
        recordsFor(records, "CompletionClaimDeletionIntended").filter(
          ({ event }) => event.claim.plannedAttempt.taskId === "A"
        ),
        "A completion-claim deletion intent"
      )
      const deletionAttempt = exactlyOne(
        recordsFor(records, "CompletionClaimDeletionAttemptIntended").filter(
          ({ event }) => event.operationId === deletionIntent.event.operationId
        ),
        "A completion-claim deletion attempt"
      )
      const deletion = exactlyOne(
        recordsFor(records, "CompletionClaimDeleted").filter(
          ({ event }) => event.operationId === deletionIntent.event.operationId
        ),
        "A exact completion-claim deletion"
      )
      const settled = exactlyOne(
        recordsFor(records, "IntegrationFinalitySettled").filter(
          ({ event }) => event.claim.plannedAttempt.taskId === "A"
        ),
        "A integration finality settlement"
      )
      expect(focusedObservation.facts.lifecycle).toBe("CompletedSuccessfully")
      expect(deletionIntent.event.claim).toEqual(replacementIntent.event.claim)
      expect(deletionIntent.event.successObservation.observedAt).toBe(focusedCompleted.position)
      expect(deletionAttempt.event.claim).toEqual(deletionIntent.event.claim)
      expect(deletionAttempt.event.successObservation).toEqual(deletionIntent.event.successObservation)
      expect(deletion.event.claim).toEqual(deletionIntent.event.claim)
      expect(deletion.event.successObservation).toEqual(deletionIntent.event.successObservation)
      expect(settled.event.claim).toEqual(deletion.event.claim)
      expect(settled.event.successObservation).toEqual(deletion.event.successObservation)
      expect(settled.event.replacementOperationId).toBe(replacementIntent.event.operationId)
      expect(settled.event.deletionOperationId).toBe(deletionIntent.event.operationId)

      const orderedPositions = [
        successor.position,
        successorPromotion.position,
        replacementIntent.position,
        replacementAttempt.position,
        replacement.position,
        focusedCompleted.position,
        deletionIntent.position,
        deletionAttempt.position,
        deletion.position,
        settled.position
      ]
      expect(orderedPositions).toEqual([...orderedPositions].sort((left, right) => left - right))
      expect(quarantine.position).toBeLessThan(direction.position)
      expect(direction.position).toBeLessThan(successor.position)
      expect(successorPromotion.position).toBeLessThan(replacementIntent.position)
      expect(replacement.position).toBeLessThan(focusedCompleted.position)
      expect(focusedCompleted.position).toBeLessThan(deletion.position)
      expect(deletion.position).toBeLessThan(settled.position)
    }),
  capstoneTimeout
)

it.effect(
  "rejects DS16 evidence without the rejected CAS attempt or with a pre-request stale read",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      const stale = exactlyOne(recordsFor(run.records, "TargetPromotionStale"), "capstone stale promotion")
      const omittedAttemptRecords = run.records.filter(
        (record) =>
          !(
            record.event._tag === "TargetPromotionAttemptIntended" &&
            record.event.correlation.requestId === stale.event.correlation.requestId
          )
      )
      expect(extractDs16PromotionEvidence(omittedAttemptRecords, run.observationCaptures)).toBeUndefined()

      const preRequestRun = yield* runAuthoredScenarioCassette(
        maintainedAuthoredCassetteCatalog.targetPromotionStaleBeforeCompareAndSet
      ).pipe(Effect.provide(NodeCrypto.layer))
      const preRequestStale = exactlyOne(
        recordsFor(preRequestRun.records, "TargetPromotionStale"),
        "pre-request stale promotion"
      )
      expect(preRequestStale.event.basis).toEqual({ _tag: "BeforeFirstAttempt" })
      expect(
        capturedOccurrencesFor(preRequestRun.observationCaptures, "TargetPromotionCompareAndSetReturned")
      ).toHaveLength(0)
      expect(extractDs16PromotionEvidence(preRequestRun.records, preRequestRun.observationCaptures)).toBeUndefined()
    }),
  capstoneTimeout
)
