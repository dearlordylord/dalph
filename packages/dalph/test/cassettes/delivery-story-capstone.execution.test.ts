import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import { TaskId, makeTaskWorkSpecification } from "@dalph/contracts"
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

/** One Integrator boundary is proved by its journal run/result/candidate records and bounded raw captures. */
interface IntegratorBoundaryEvidence {
  readonly session: JournalRecordFor<"IntegratorSessionFixed" | "IntegratorSuccessorSessionFixed">
  readonly run: JournalRecordFor<"IntegratorRunStarted">
  readonly result: JournalRecordFor<"IntegratorRunResultRecorded">
  readonly candidateGit: JournalRecordFor<"IntegratorRunCandidateGitObserved">
  readonly request: CapturedOccurrenceFor<"IntegratorRequestReceived">
  readonly candidateCapture: CapturedOccurrenceFor<"IntegratorGitObservationReturned">
}

interface IntegratorBoundaryExpectation {
  readonly runId: string
  readonly sessionKind: "Predecessor" | "Successor"
  readonly sessionId: string
  readonly acceptedCommit: string
  readonly expectedTargetHead: string
  readonly candidateCommit: string
  readonly directParents: readonly [string, string]
  readonly requestCaptureAfter: number
  readonly candidateCaptureBefore: number
}

/** Keeps predecessor/successor candidate evidence session-specific without treating raw capture tags as authority. */
const integratorBoundaryEvidenceFor = (
  records: ReadonlyArray<JournalRecord>,
  captures: ReadonlyArray<AuthoredObservationCapture>,
  expectation: IntegratorBoundaryExpectation
): IntegratorBoundaryEvidence | undefined => {
  const authoredSessionId = expectation.sessionId.replaceAll(expectation.runId, "$authored-run")
  const sessionRecords =
    expectation.sessionKind === "Predecessor"
      ? recordsFor(records, "IntegratorSessionFixed")
      : recordsFor(records, "IntegratorSuccessorSessionFixed")
  const session = exactlyOne(
    sessionRecords.filter(({ event }) =>
      event._tag === "IntegratorSessionFixed"
        ? event.correlation.sessionId === expectation.sessionId
        : event.successor.sessionId === expectation.sessionId
    ),
    `${expectation.sessionId} Integrator session`
  )
  const run = exactlyOne(
    recordsFor(records, "IntegratorRunStarted").filter(
      ({ event }) => event.run.session.sessionId === expectation.sessionId
    ),
    `${expectation.sessionId} Integrator run`
  )
  const result = exactlyOne(
    recordsFor(records, "IntegratorRunResultRecorded").filter(
      ({ event }) => event.run.session.sessionId === expectation.sessionId
    ),
    `${expectation.sessionId} Integrator result`
  )
  if (result.event.result._tag !== "PreparedCandidate") return undefined
  const candidateText = result.event.result.candidateText
  const candidateGit = exactlyOne(
    recordsFor(records, "IntegratorRunCandidateGitObserved").filter(
      ({ event }) => event.run.session.sessionId === expectation.sessionId
    ),
    `${expectation.sessionId} candidate Git observation`
  )
  if (candidateGit.event.observation._tag !== "Commit") return undefined
  expect(candidateGit.event.candidateText).toBe(result.event.result.candidateText)
  expect(candidateGit.event.observation.commit).toBe(expectation.candidateCommit)
  expect(candidateGit.event.observation.directParents).toEqual(expectation.directParents)
  const request = exactlyOne(
    capturedOccurrencesFor(captures, "IntegratorRequestReceived").filter(
      ({ captureOrder, occurrence }) =>
        captureOrder > expectation.requestCaptureAfter &&
        occurrence.correlation.sessionId === authoredSessionId &&
        occurrence.correlation.expectedTargetHead === expectation.expectedTargetHead &&
        occurrence.correlation.acceptedResult.commit === expectation.acceptedCommit
    ),
    `${expectation.sessionId} captured Integrator request`
  )
  const candidateCapture = exactlyOne(
    capturedOccurrencesFor(captures, "IntegratorGitObservationReturned").filter(
      ({ captureOrder, occurrence }) =>
        captureOrder > request.captureOrder &&
        captureOrder < expectation.candidateCaptureBefore &&
        occurrence.candidateText === candidateText &&
        occurrence.observation._tag === "Commit" &&
        occurrence.observation.commit === expectation.candidateCommit &&
        occurrence.observation.directParents[0] === expectation.directParents[0] &&
        occurrence.observation.directParents[1] === expectation.directParents[1]
    ),
    `${expectation.sessionId} captured candidate Git observation`
  )
  return { candidateCapture, candidateGit, request, result, run, session }
}

/** Mirrors the authored runner's run-id and acceptance-digest normalization while retaining every correlation field. */
const normalizeCorrelationForCapture = <
  A extends { readonly acceptedResult: { readonly evidenceManifest: { readonly digest: string } } }
>(
  correlation: A,
  runId: string,
  authoredDigest: string
): A => {
  const normalized = JSON.parse(JSON.stringify(correlation).replaceAll(runId, "$authored-run")) as A
  return {
    ...normalized,
    acceptedResult: {
      ...normalized.acceptedResult,
      evidenceManifest: { ...normalized.acceptedResult.evidenceManifest, digest: authoredDigest }
    }
  }
}

const capstoneTimeout = 600_000
const authoredAcceptanceManifestDigest = "1111111111111111111111111111111111111111111111111111111111111111"
const plannedBaseSha = "1111111111111111111111111111111111111111"
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

      const heldTaskIds = (frame: (typeof run.deliveryFrames)[number]) =>
        frame.heldPositions
          .map(({ taskId }) => String(taskId))
          .toSorted()
          .join(",")
      const retainedTaskIds = (frame: (typeof run.deliveryFrames)[number]) => {
        const held = new Set(frame.heldPositions.map(({ taskId }) => taskId))
        return frame.deliveries
          .filter(({ obligations, taskId }) => obligations.length > 0 && !held.has(taskId))
          .map(({ taskId }) => String(taskId))
          .toSorted()
          .join(",")
      }
      const frameFor = (input: {
        readonly activationAtLeast?: number
        readonly capacity: number
        readonly graph?: "Established" | "NotEstablished"
        readonly held: string
        readonly retained: string
      }) =>
        run.deliveryFrames.find(
          (frame) =>
            frame.capacity === input.capacity &&
            heldTaskIds(frame) === input.held &&
            retainedTaskIds(frame) === input.retained &&
            (input.activationAtLeast === undefined || frame.activationOrdinal >= input.activationAtLeast) &&
            (input.graph === undefined || frame.graph._tag === input.graph)
        )
      const capacityChronology = [
        frameFor({ capacity: 3, held: "A,B,C", retained: "" }),
        frameFor({ capacity: 3, held: "A,C", retained: "B" }),
        frameFor({ capacity: 3, held: "A,C,D", retained: "B" }),
        frameFor({ capacity: 2, held: "A,C,D", retained: "B" }),
        frameFor({ activationAtLeast: 2, capacity: 2, graph: "NotEstablished", held: "A,C,D", retained: "B" })
      ]
      expect(capacityChronology.every((frame) => frame !== undefined)).toBe(true)
      const chronologyPositions = capacityChronology.flatMap((frame) =>
        frame === undefined ? [] : [frame.storyPosition]
      )
      expect(chronologyPositions).toHaveLength(capacityChronology.length)
      expect(chronologyPositions).toEqual(chronologyPositions.toSorted((left, right) => left - right))

      const expectedAttempts = [
        {
          attemptId: "attempt:A:0",
          branch: "refs/heads/dalph/attempt-A-0",
          taskId: "A",
          worktree: "/dalph/cassettes/ds-probe/attempt-A-0"
        },
        {
          attemptId: "attempt:B:1",
          branch: "refs/heads/dalph/attempt-B-1",
          taskId: "B",
          worktree: "/dalph/cassettes/ds-probe/attempt-B-1"
        },
        {
          attemptId: "attempt:C:2",
          branch: "refs/heads/dalph/attempt-C-2",
          taskId: "C",
          worktree: "/dalph/cassettes/ds-probe/attempt-C-2"
        },
        {
          attemptId: "attempt:D:3",
          branch: "refs/heads/dalph/attempt-D-3",
          taskId: "D",
          worktree: "/dalph/cassettes/ds-probe/attempt-D-3"
        }
      ] as const
      const plannedRecords = recordsFor(run.records, "TaskAttemptPlanned")
      const claimIntents = recordsFor(run.records, "TaskClaimAcquisitionIntended")
      const claims = recordsFor(run.records, "TaskClaimAcquired")
      const worktreeIntents = recordsFor(run.records, "TaskWorktreeReconciliationIntended")
      const worktrees = recordsFor(run.records, "TaskWorktreeReady")
      for (const expected of expectedAttempts) {
        const plan = exactlyOne(
          plannedRecords.filter(({ event }) => event.operation.plannedAttempt.attemptId === expected.attemptId),
          `${expected.taskId} exact planned attempt`
        ).event.operation.plannedAttempt
        expect(plan).toMatchObject({
          attemptId: expected.attemptId,
          baseSha: plannedBaseSha,
          branch: expected.branch,
          executor: "executor:ds-probe",
          runId: run.runId,
          taskId: expected.taskId,
          worktree: expected.worktree
        })
        const claimIntent = exactlyOne(
          claimIntents.filter(({ event }) => event.operation.acquisition.taskId === expected.taskId),
          `${expected.taskId} exact claim intent`
        ).event.operation.acquisition
        const claim = exactlyOne(
          claims.filter(({ event }) => event.claim.taskId === expected.taskId),
          `${expected.taskId} exact acquired claim`
        ).event.claim
        expect(claim).toEqual({
          _tag: "ActiveTaskClaim",
          operationId: claimIntent.operationId,
          owner: "ds-probe-owner",
          taskId: expected.taskId,
          token: `ds-probe-claim:${expected.taskId}:${claimIntent.operationId}`
        })
        const worktreeIntent = exactlyOne(
          worktreeIntents.filter(({ event }) => event.operation.plannedAttempt.attemptId === expected.attemptId),
          `${expected.taskId} exact worktree intent`
        )
        const ready = exactlyOne(
          worktrees.filter(({ event }) => event.operationId === worktreeIntent.event.operation.operationId),
          `${expected.taskId} exact ready worktree`
        ).event.proof
        expect(ready).toEqual({
          _tag: "PlannedWorktreeReady",
          baseSha: plannedBaseSha,
          branch: expected.branch,
          headSha: plannedBaseSha,
          worktree: expected.worktree
        })
      }

      const plannedB = exactlyOne(
        plannedRecords.filter(({ event }) => event.operation.plannedAttempt.attemptId === "attempt:B:1"),
        "B planned fingerprint"
      ).event.operation.plannedAttempt.taskRevision
      const originalB = makeTaskWorkSpecification({
        body: "Implement task B.",
        taskId: TaskId.make("B"),
        title: "Implement B"
      })
      const changedB = makeTaskWorkSpecification({
        body: "Alice changed task B instructions.",
        taskId: TaskId.make("B"),
        title: "Changed B"
      })
      expect(plannedB).toBe(originalB.fingerprint)
      expect(changedB.fingerprint).not.toBe(originalB.fingerprint)
      expect(
        recordsFor(run.records, "TaskTrackerFactsObserved").some(
          ({ event }) =>
            event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
            event.observation.factFamily.taskId === "B" &&
            event.observation.factFamily.fingerprint === changedB.fingerprint
        )
      ).toBe(true)
      const graphIntents = recordsFor(run.records, "TaskTrackerReadIntentRecorded").filter(
        ({ event }) => event.operation._tag === "ReadTrackerGraph"
      )
      const graphCoverage = (record: (typeof graphIntents)[number]) =>
        record.event.operation._tag === "ReadTrackerGraph"
          ? record.event.operation.readShape.explicitlyCoveredTaskIds.map(String)
          : []
      const establishmentReads = graphIntents.filter((record) => graphCoverage(record).length === 0)
      const restartEstablishment = establishmentReads[1]
      expect(restartEstablishment).toBeDefined()
      if (restartEstablishment === undefined) return
      const executorReports = recordsFor(run.records, "PlannedAttemptExecutorWorkReported")
      const report = (attemptId: string, ordinal: number) =>
        exactlyOne(
          executorReports.filter(
            ({ event }) => event.report.correlation.attemptId === attemptId && event.ordinal === ordinal
          ),
          `${attemptId} executor report ordinal ${ordinal}`
        )
      const initialReports = [report("attempt:A:0", 1), report("attempt:B:1", 1), report("attempt:C:2", 1)]
      const laterBatchReports = [report("attempt:C:2", 2), report("attempt:B:1", 2), report("attempt:A:0", 2)]
      const dReport = report("attempt:D:3", 1)
      const preRestartProgressReads = graphIntents.filter(
        (record) =>
          record.position > Math.min(...initialReports.map(({ position }) => position)) &&
          record.position < restartEstablishment.position
      )
      expect(preRestartProgressReads.map(graphCoverage)).toEqual([["A", "B", "C"], ["A", "C"], ["D"]])
      const [initialBatchRead, laterBatchRead, dRead] = preRestartProgressReads
      expect(initialBatchRead).toBeDefined()
      expect(laterBatchRead).toBeDefined()
      expect(dRead).toBeDefined()
      if (initialBatchRead === undefined || laterBatchRead === undefined || dRead === undefined) return
      expect(initialBatchRead.position).toBeGreaterThan(Math.max(...initialReports.map(({ position }) => position)))
      expect(laterBatchRead.position).toBeGreaterThan(Math.max(...laterBatchReports.map(({ position }) => position)))
      expect(dRead.position).toBeGreaterThan(dReport.position)
      const graphOutcomes = recordsFor(run.records, "TaskTrackerFactsObserved")
      const outcomeFor = (intent: (typeof graphIntents)[number]) =>
        exactlyOne(
          graphOutcomes.filter(({ event }) => event.operationId === intent.event.operation.operationId),
          `${intent.event.operation.operationId} graph outcome`
        )
      const initialBatchOutcome = outcomeFor(initialBatchRead)
      const laterBatchOutcome = outcomeFor(laterBatchRead)
      const dOutcome = outcomeFor(dRead)
      expect(initialBatchOutcome.position).toBeGreaterThan(initialBatchRead.position)
      expect(laterBatchOutcome.position).toBeGreaterThan(laterBatchRead.position)
      expect(dReport.position).toBeGreaterThan(laterBatchOutcome.position)
      expect(dOutcome.position).toBeGreaterThan(dRead.position)
      expect(restartEstablishment.position).toBeGreaterThan(dOutcome.position)
      expect(restartEstablishment.event.operation.operationId).not.toBe(dRead.event.operation.operationId)
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
      const trackerTarget = "ds-probe-target"
      expect(recordsFor(records, "TargetPromotionAttemptIntended")).toHaveLength(2)
      expect(recordsFor(records, "TargetPromotionStale")).toHaveLength(1)
      expect(capturedOccurrencesFor(captures, "TargetPromotionCompareAndSetReturned")).toHaveLength(2)

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

      // The rejected CAS capture is an exact upper boundary for predecessor candidate evidence.
      const rejectedCompareAndSetCapture = exactlyOne(
        capturedOccurrencesFor(captures, "TargetPromotionCompareAndSetReturned").filter(
          ({ occurrence }) =>
            occurrence.result._tag === "RejectedExpectedHead" && occurrence.result.observedHeadSha === changedHead
        ),
        "captured predecessor rejected compare-and-set"
      )
      const predecessorEvidence = integratorBoundaryEvidenceFor(records, captures, {
        acceptedCommit,
        candidateCaptureBefore: rejectedCompareAndSetCapture.captureOrder,
        candidateCommit: initialCandidateCommit,
        directParents: [initialHead, acceptedCommit],
        expectedTargetHead: initialHead,
        requestCaptureAfter: 0,
        runId: String(run.runId),
        sessionKind: "Predecessor",
        sessionId: predecessor.sessionId
      })
      expect(predecessorEvidence).toBeDefined()
      if (predecessorEvidence === undefined) return
      expect(predecessorEvidence.run.event.run.ordinal).toBe(1)
      expect(initialLineage.position).toBeLessThan(predecessorEvidence.session.position)
      expect(predecessorEvidence.session.position).toBeLessThan(predecessorEvidence.run.position)
      expect(predecessorEvidence.candidateGit.position).toBeGreaterThan(predecessor.targetLineageObservedAt)
      const predecessorRequest = predecessorEvidence.request
      const predecessorCandidateCapture = predecessorEvidence.candidateCapture
      expect(predecessorRequest.occurrence.correlation).toEqual(
        normalizeCorrelationForCapture(predecessor, String(run.runId), authoredAcceptanceManifestDigest)
      )
      expect(predecessorRequest.occurrence.correlation.queuedAt).toBe(predecessor.queuedAt)
      expect(predecessorRequest.occurrence.correlation.startedAt).toBe(predecessor.startedAt)

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
      expect(predecessorEvidence.run.position).toBeLessThan(predecessorEvidence.result.position)
      expect(predecessorEvidence.result.position).toBeLessThan(predecessorEvidence.candidateGit.position)
      expect(predecessorEvidence.candidateGit.position).toBeLessThan(predecessorPromotionIntent.position)

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
      expect(ds16.rejectedCompareAndSet.captureOrder).toBe(rejectedCompareAndSetCapture.captureOrder)
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

      const appliedCompareAndSet = exactlyOne(
        capturedOccurrencesFor(captures, "TargetPromotionCompareAndSetReturned").filter(
          ({ occurrence }) => occurrence.result._tag === "Applied"
        ),
        "captured successor applied compare-and-set"
      )
      const successorEvidence = integratorBoundaryEvidenceFor(records, captures, {
        acceptedCommit,
        candidateCaptureBefore: appliedCompareAndSet.captureOrder,
        candidateCommit: successorCandidateCommit,
        directParents: [changedHead, acceptedCommit],
        expectedTargetHead: changedHead,
        requestCaptureAfter: directionCapture.captureOrder,
        runId: String(run.runId),
        sessionKind: "Successor",
        sessionId: successorCorrelation.sessionId
      })
      expect(successorEvidence).toBeDefined()
      if (successorEvidence === undefined) return
      const successorRequest = successorEvidence.request
      const successorCandidateCapture = successorEvidence.candidateCapture
      expect(successorRequest.occurrence.correlation.plannedAttempt.attemptId).toBe(
        successorCorrelation.plannedAttempt.attemptId
      )
      expect(successorRequest.occurrence.correlation).toEqual(
        normalizeCorrelationForCapture(successorCorrelation, String(run.runId), authoredAcceptanceManifestDigest)
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
      expect(freshLineage.position).toBeLessThan(successorEvidence.session.position)
      expect(successorEvidence.session.position).toBeLessThan(successorEvidence.run.position)
      expect(successorEvidence.run.position).toBeLessThan(successorEvidence.result.position)
      expect(successorEvidence.result.position).toBeLessThan(successorEvidence.candidateGit.position)

      expect(successorEvidence.run.event.run.ordinal).toBe(1)
      expect(successorEvidence.candidateGit.position).toBeGreaterThan(successorCorrelation.targetLineageObservedAt)
      expect(successorCandidateCapture.captureOrder).toBeGreaterThan(successorRequest.captureOrder)
      expect(successorCandidateCapture.captureOrder).toBeGreaterThan(directionCapture.captureOrder)

      const postCandidateLineageSelection = exactlyOne(
        capturedOccurrencesFor(captures, "DalphSelects").filter(
          ({ captureOrder, occurrence }) =>
            captureOrder > successorCandidateCapture.captureOrder &&
            occurrence.operation._tag === "ReadTargetLineage" &&
            occurrence.operation.attemptId === "attempt:A:0"
        ),
        "captured post-candidate A target-lineage read"
      )
      const postCandidateLineage = exactlyOne(
        recordsFor(records, "TargetLineageObserved").filter(
          ({ event, position }) =>
            position > successorEvidence.candidateGit.position && event.plannedAttempt.attemptId === "attempt:A:0"
        ),
        "post-candidate H2 target-lineage observation"
      )
      expect(postCandidateLineageSelection.captureOrder).toBeGreaterThan(successorCandidateCapture.captureOrder)
      expect(postCandidateLineage.event.observation).toEqual({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: initialHead,
        targetHeadSha: changedHead
      })
      expect(postCandidateLineage.event.operationId).not.toBe(freshLineage.event.operationId)
      expect(postCandidateLineage.position).toBeGreaterThan(successorEvidence.candidateGit.position)

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
      expect(successorEvidence.candidateGit.position).toBeLessThan(successorPromotionIntent.position)
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

      const completionIntent = exactlyOne(
        recordsFor(records, "CompletionTaskIntended").filter(({ event }) => event.request.taskId === "A"),
        "A exact completion request intent"
      )
      const completionAttempt = exactlyOne(
        recordsFor(records, "CompletionTaskAttemptIntended").filter(
          ({ event }) => event.request.operationId === completionIntent.event.request.operationId
        ),
        "A exact completion request attempt"
      )
      const completionAcknowledged = exactlyOne(
        recordsFor(records, "CompletionTaskAcknowledged").filter(
          ({ event }) => event.request.operationId === completionIntent.event.request.operationId
        ),
        "A exact completion request acknowledgement"
      )
      expect(completionIntent.event.request.claim).toEqual(replacementIntent.event.claim)
      expect(completionAttempt.event.request).toEqual(completionIntent.event.request)
      expect(completionAttempt.event.attemptOrdinal).toBe(1)
      expect(completionAcknowledged.event.request).toEqual(completionIntent.event.request)
      expect(completionAcknowledged.event.attemptOrdinal).toBe(1)
      expect(completionAcknowledged.event.acknowledgement).toEqual({
        operationId: completionIntent.event.request.operationId,
        taskId: "A"
      })

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
      expect(focusedObservation.purpose._tag).toBe("Confirmation")
      expect(focusedObservation.facts.currentClaim).toEqual(replacementIntent.event.claim)
      expect(focusedObservation.facts.targetMembership).toBe("Member")
      expect(focusedObservation.facts.taskId).toBe("A")
      expect(focusedObservation.facts.taskRevision).toBe(replacementIntent.event.claim.plannedAttempt.taskRevision)
      expect(focusedObservation.facts.target).toBe(trackerTarget)
      expect(focusedObservation.facts.unfinishedPrerequisiteTaskIds).toEqual([])
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
      expect(focusedObservation.operationId).toBe(deletionIntent.event.successObservation.operationId)
      expect(focusedCompleted.position).toBe(deletionIntent.event.successObservation.observedAt)
      expect(deletionIntent.event.successObservation.claim).toEqual(focusedObservation.facts.currentClaim)
      expect(deletionIntent.event.successObservation.taskId).toBe(focusedObservation.facts.taskId)
      expect(deletionIntent.event.successObservation.taskRevision).toBe(focusedObservation.facts.taskRevision)
      expect(deletionIntent.event.successObservation.trackerRevision).toBe(focusedObservation.facts.trackerRevision)
      expect(deletionIntent.event.successObservation.target).toEqual(focusedObservation.facts.target)
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
        completionIntent.position,
        completionAttempt.position,
        completionAcknowledged.position,
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
      expect(replacementIntent.position).toBeLessThan(replacementAttempt.position)
      expect(replacementAttempt.position).toBeLessThan(replacement.position)
      expect(replacement.position).toBeLessThan(completionIntent.position)
      expect(completionIntent.position).toBeLessThan(completionAttempt.position)
      expect(completionAttempt.position).toBeLessThan(completionAcknowledged.position)
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
      const retainedAttempt = exactlyOne(
        recordsFor(run.records, "TargetPromotionAttemptIntended").filter(
          ({ event }) => event.correlation.requestId === stale.event.correlation.requestId
        ),
        "retained predecessor promotion attempt"
      )
      expect(retainedAttempt.position).toBeLessThan(stale.position)
      expect(extractDs16PromotionEvidence(run.records, run.observationCaptures)).toBeDefined()
      const omittedRejectedCompareAndSetCaptures = run.observationCaptures.filter(
        (capture) =>
          !(
            capture._tag === "AuthoredStoryOccurrenceCaptured" &&
            capture.occurrence._tag === "TargetPromotionCompareAndSetReturned" &&
            capture.occurrence.result._tag === "RejectedExpectedHead"
          )
      )
      expect(extractDs16PromotionEvidence(run.records, omittedRejectedCompareAndSetCaptures)).toBeUndefined()

      const preRequestRun = yield* runAuthoredScenarioCassette(
        maintainedAuthoredCassetteCatalog.targetPromotionStaleBeforeCompareAndSet
      ).pipe(Effect.provide(NodeCrypto.layer))
      const preRequestStale = exactlyOne(
        recordsFor(preRequestRun.records, "TargetPromotionStale"),
        "pre-request stale promotion"
      )
      expect(preRequestStale.event.basis).toEqual({ _tag: "BeforeFirstAttempt" })
      expect(recordsFor(preRequestRun.records, "TargetPromotionAttemptIntended")).toHaveLength(0)
      expect(
        capturedOccurrencesFor(preRequestRun.observationCaptures, "TargetPromotionCompareAndSetReturned")
      ).toHaveLength(0)
      expect(extractDs16PromotionEvidence(preRequestRun.records, preRequestRun.observationCaptures)).toBeUndefined()
      expect(
        recordsFor(preRequestRun.records, "IntegrationQuarantined").filter(
          ({ event }) => event.basis._tag === "PromotionStale"
        )
      ).toHaveLength(0)
      expect(recordsFor(preRequestRun.records, "IntegrationQuarantineDirectionApplied")).toHaveLength(0)
      expect(recordsFor(preRequestRun.records, "IntegratorSuccessorSessionFixed")).toHaveLength(0)
    }),
  capstoneTimeout
)
